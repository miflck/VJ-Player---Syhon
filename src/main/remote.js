// Remote control for the main process: optionally hosts the hub (src/server/hub.js)
// and connects this player to a hub as a socket.io client.
//
// Settings live in the "remote" object of config.json (in Electron's userData folder):
//   {
//     "remote": {
//       "enabled": true,     // false turns all of this off
//       "host": true,        // run a hub in this app (serves the controller page)
//       "port": 3000,
//       "url": "",           // hub to connect to; empty = our own hub
//       "token": "",         // optional shared secret
//       "name": "My Mac"     // shown in the controller; default = hostname
//     }
//   }

const os = require("os");
const path = require("path");
const { ipcMain } = require("electron");
const { io: connect } = require("socket.io-client");
const { startHub } = require("../server/hub");

function lanUrls(port) {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((net) => net && net.family === "IPv4" && !net.internal)
    .map((net) => `http://${net.address}:${port}`);
}

function startRemote({ getWindow, userConfig = {} }) {
  const settings = { enabled: true, host: true, port: 3000, url: "", token: "", name: os.hostname(), ...(userConfig.remote || {}) };
  const info = { enabled: settings.enabled, hosting: false, urls: [], connected: false, error: "" };

  ipcMain.handle("get-remote-info", () => info);
  if (!settings.enabled) return info;

  const hubUrl = settings.url || (settings.host ? `http://127.0.0.1:${settings.port}` : "");

  const connectClient = () => {
    if (!hubUrl) return;
    let lastState = null; // resent after a reconnect, so the hub never shows stale or empty state
    const client = connect(hubUrl, { auth: { role: "player", name: settings.name, token: settings.token }, reconnection: true });

    client.on("connect", () => {
      info.connected = true;
      console.log(`[remote] connected to ${hubUrl}`);
      if (lastState) client.emit("state", lastState);
    });
    client.on("disconnect", () => (info.connected = false));
    client.on("connect_error", (error) => {
      info.connected = false;
      console.warn(`[remote] cannot reach ${hubUrl}: ${error.message}`);
    });

    // hub → this player's page
    client.on("command", (cmd) => {
      const win = getWindow();
      if (win && !win.isDestroyed()) win.webContents.send("remote-command", cmd);
    });

    // this player's page → hub
    ipcMain.on("remote-state", (_event, state) => {
      lastState = { ...state, name: settings.name };
      if (client.connected) client.emit("state", lastState);
    });
  };

  if (settings.host) {
    startHub({ port: settings.port, token: settings.token, staticDir: path.join(__dirname, "..", "controller") })
      .then(() => {
        info.hosting = true;
        info.urls = lanUrls(settings.port);
        console.log(`[remote] controller page: ${info.urls.join("  ") || `http://localhost:${settings.port}`}`);
        connectClient();
      })
      .catch((error) => {
        info.error = error.message;
        console.error(`[remote] could not start the hub on port ${settings.port}: ${error.message}`);
        connectClient(); // still try the configured hub, if any
      });
  } else {
    connectClient();
  }

  return info;
}

module.exports = { startRemote };
