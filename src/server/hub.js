// Remote-control hub: a socket.io server that relays commands from controllers
// (the web page in src/controller, or any socket.io client) to all connected
// players, and relays player state back to the controllers.
//
//   controller --"command"--> hub --"command"--> every player
//   player     --"state"----> hub --"players"--> every controller
//
// Clients say what they are in the handshake: auth: { role: "player" | "controller", name, token }.
// Anything that isn't a player is a controller.

const http = require("http");
const fs = require("fs");
const path = require("path");
const { Server } = require("socket.io");

// Keys a controller may press. They are the same keys as on the keyboard; players check this list again.
const REMOTE_KEYS = ["n", "x", "arrowright", "a", "m", "l", "f", "y"];

// Returns a clean command, or null if it is not allowed.
//   { key: "n" }      press a key
//   { playlist: 2 }   jump to a playlist by index
function sanitizeCommand(cmd) {
  if (!cmd || typeof cmd !== "object") return null;
  if (typeof cmd.key === "string" && REMOTE_KEYS.includes(cmd.key.toLowerCase())) return { key: cmd.key.toLowerCase() };
  if (Number.isInteger(cmd.playlist) && cmd.playlist >= 0) return { playlist: cmd.playlist };
  return null;
}

const CONTENT_TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css" };

function startHub({ port = 3000, token = "", staticDir = null, log = console.log } = {}) {
  const server = http.createServer((req, res) => {
    if (!staticDir) return res.writeHead(404).end();

    const name = req.url.split("?")[0] === "/" ? "index.html" : path.basename(req.url.split("?")[0]);
    const type = CONTENT_TYPES[path.extname(name)];
    if (!type) return res.writeHead(404).end();

    fs.readFile(path.join(staticDir, name), (error, data) => {
      if (error) return res.writeHead(404).end();
      res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-cache" }).end(data);
    });
  });

  const io = new Server(server, { cors: { origin: true } });
  const players = new Map(); // socket id → last state

  if (token) {
    io.use((socket, next) => (socket.handshake.auth?.token === token ? next() : next(new Error("unauthorized"))));
  }

  const sendPlayers = () => io.to("controllers").emit("players", [...players.values()]);

  io.on("connection", (socket) => {
    const auth = socket.handshake.auth || {};

    if (auth.role === "player") {
      socket.join("players");
      players.set(socket.id, { id: socket.id, name: String(auth.name || "Player"), connected: true });
      log(`[remote] player connected: ${auth.name || socket.id}`);
      sendPlayers();

      socket.on("state", (state) => {
        if (!state || typeof state !== "object") return;
        players.set(socket.id, { ...state, id: socket.id, name: String(state.name || auth.name || "Player") });
        sendPlayers();
      });

      socket.on("disconnect", () => {
        players.delete(socket.id);
        sendPlayers();
      });
      return;
    }

    socket.join("controllers");
    socket.emit("players", [...players.values()]);

    socket.on("command", (cmd, ack) => {
      const clean = sanitizeCommand(cmd);
      if (!clean) return typeof ack === "function" && ack({ ok: false, error: "command not allowed" });

      log(`[remote] command ${JSON.stringify(clean)} → ${players.size} player(s)`);
      io.to("players").emit("command", clean);
      if (typeof ack === "function") ack({ ok: true, players: players.size });
    });
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "0.0.0.0", () => resolve({ port, close: () => new Promise((done) => (io.close(), server.close(done))) }));
  });
}

module.exports = { startHub, sanitizeCommand, REMOTE_KEYS };
