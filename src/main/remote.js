// Remote control for the main process: optionally hosts the hub (src/server/hub.js)
// and connects this player to a hub as a socket.io client. Host or client can also be
// switched while the app runs (settings screen), see "set-remote-settings".
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

// saveRemote(partial): called when the settings screen changes host/url, to store it in config.json
function startRemote({ getWindow, launchLayout, userConfig = {}, instance = "", saveRemote = () => {} }) {
  const defaultName = instance ? `${os.hostname()} ${instance}` : os.hostname();
  const settings = { enabled: true, host: true, port: 3000, url: "", token: "", name: defaultName, ...(userConfig.remote || {}) };

  const state = { hosting: false, connected: false, urls: [], error: "" };
  let hub = null;
  let client = null;
  let lastState = null; // latest state of this player, resent after a reconnect
  let generation = 0; // bumped on every (re)start; late results of an old start are ignored

  const snapshot = () => ({
    enabled: settings.enabled,
    mode: settings.host ? "host" : "client",
    url: settings.url,
    port: settings.port,
    name: settings.name,
    ...state,
  });

  function sendToPage(channel, payload) {
    const win = getWindow();
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  }

  function connectClient(gen) {
    const hubUrl = settings.url || (settings.host ? `http://127.0.0.1:${settings.port}` : "");
    if (!hubUrl || gen !== generation) return;

    const socket = connect(hubUrl, { auth: { role: "player", name: settings.name, token: settings.token }, reconnection: true });
    client = socket;

    socket.on("connect", () => {
      state.connected = true;
      console.log(`[remote] connected to ${hubUrl}`);
      if (lastState) socket.emit("state", lastState);
    });
    socket.on("disconnect", () => {
      state.connected = false;
      sendToPage("remote-peers", []); // without the hub there is nothing to avoid
    });
    socket.on("connect_error", (error) => {
      state.connected = false;
      console.warn(`[remote] cannot reach ${hubUrl}: ${error.message}`);
    });

    // hub → this player's page
    socket.on("command", (cmd) => sendToPage("remote-command", cmd));
    socket.on("peers", (files) => sendToPage("remote-peers", files));
  }

  async function start() {
    if (!settings.enabled) return;
    const gen = ++generation;

    if (!settings.host) return connectClient(gen);

    try {
      hub = await startHub({ port: settings.port, token: settings.token, onLaunchLayout: launchLayout, staticDir: path.join(__dirname, "..", "controller") });
      if (gen !== generation) return; // stopped again while starting
      state.hosting = true;
      state.urls = lanUrls(settings.port);
      console.log(`[remote] controller page: ${state.urls.join("  ") || `http://localhost:${settings.port}`}`);
    } catch (error) {
      state.error = error.message;
      if (error.code === "EADDRINUSE" && !settings.url) {
        // another copy of the player already hosts the hub: join it
        console.log(`[remote] port ${settings.port} is taken (another instance?), joining the hub that is running there`);
      } else {
        console.error(`[remote] could not start the hub on port ${settings.port}: ${error.message}`);
      }
    }
    connectClient(gen); // our own hub, or the configured one if hosting failed
  }

  async function stop() {
    generation++;
    if (client) client.close();
    client = null;
    if (hub) await hub.close();
    hub = null;
    Object.assign(state, { hosting: false, connected: false, urls: [], error: "" });
  }

  // this player's page → hub
  ipcMain.on("remote-state", (_event, pageState) => {
    lastState = { ...pageState, name: settings.name };
    if (client && client.connected) client.emit("state", lastState);
  });

  ipcMain.handle("get-remote-info", () => snapshot());

  // { mode: "host" } or { mode: "client", url: "http://192.168.1.20:3000" }
  ipcMain.handle("set-remote-settings", async (_event, request) => {
    if (!settings.enabled) return { ok: false, error: 'Remote control is turned off ("enabled": false in config.json).' };

    const mode = request && request.mode;
    const url = request && typeof request.url === "string" ? request.url.trim() : "";
    if (mode !== "host" && mode !== "client") return { ok: false, error: "Choose host or client." };
    if (mode === "client" && !/^https?:\/\/[^\s/]+/i.test(url)) {
      return { ok: false, error: "Enter the hub address, e.g. http://192.168.1.20:3000" };
    }

    await stop();
    settings.host = mode === "host";
    settings.url = mode === "client" ? url.replace(/\/+$/, "") : "";
    saveRemote({ host: settings.host, url: settings.url });
    await start();
    return { ok: true, info: snapshot() };
  });

  start();
  return { snapshot };
}

module.exports = { startRemote };
