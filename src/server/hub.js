// Remote-control hub: a socket.io server that relays commands from controllers
// (the web page in src/controller, or any socket.io client) to all connected
// players, and relays player state back to the controllers.
//
//   controller --"command"--> hub --"command"--> every player
//   player     --"state"----> hub --"players"--> every controller
//                                 hub --"peers"----> every player (files the other players show)
//
// Clients say what they are in the handshake: auth: { role: "player" | "controller", name, token }.
// Anything that isn't a player is a controller.

const http = require("http");
const fs = require("fs");
const path = require("path");
const { Server } = require("socket.io");

// Keys a controller may press. They are the same keys as on the keyboard; players check this list again.
const REMOTE_KEYS = ["n", "x", "arrowright", "a", "b", "c", "d", "m", "l", "f", "y", "r"];

// Returns a clean command, or null if it is not allowed.
//   { key: "n" }      press a key
//   { playlist: 2 }   jump to a playlist by index
// Either may carry "target": a player id (from the "players" list) to address only that
// player; without it the command goes to every player.
function sanitizeCommand(cmd) {
  if (!cmd || typeof cmd !== "object") return null;

  let clean = null;
  if (typeof cmd.key === "string" && REMOTE_KEYS.includes(cmd.key.toLowerCase())) clean = { key: cmd.key.toLowerCase() };
  else if (Number.isInteger(cmd.playlist) && cmd.playlist >= 0) clean = { playlist: cmd.playlist };
  if (!clean) return null;

  if (cmd.target !== undefined) {
    if (typeof cmd.target !== "string" || !cmd.target) return null;
    clean.target = cmd.target;
  }
  return clean;
}

const CONTENT_TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css" };

// onLaunchLayout (optional): called for { launch: "layout" }, which opens a set of new players
// on the machine that hosts the hub. It is not relayed to the players.
function startHub({ port = 3000, token = "", staticDir = null, onLaunchLayout = null, log = console.log } = {}) {
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

  const sendPlayers = () => {
    io.to("controllers").emit("players", [...players.values()]);
    // each player also hears which files the *other* players show or have ready, so it can pick something else
    for (const id of players.keys()) {
      const files = [...players.values()].filter((p) => p.id !== id).flatMap((p) => [p.file, p.next]);
      io.to(id).emit("peers", files.filter((f) => typeof f === "string" && f));
    }
  };

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
      if (cmd && cmd.launch === "layout") {
        const reply = onLaunchLayout ? onLaunchLayout() : { ok: false, error: "this hub cannot open players" };
        log(`[remote] open layout → ${JSON.stringify(reply)}`);
        return typeof ack === "function" && ack(reply);
      }
      const clean = sanitizeCommand(cmd);
      if (!clean) return typeof ack === "function" && ack({ ok: false, error: "command not allowed" });

      const { target, ...command } = clean;
      if (target && !players.has(target)) return typeof ack === "function" && ack({ ok: false, error: "player not connected" });

      log(`[remote] command ${JSON.stringify(clean)} → ${target ? "1 player" : `${players.size} player(s)`}`);
      if (target) io.to(target).emit("command", command);
      else io.to("players").emit("command", command);
      if (typeof ack === "function") ack({ ok: true, players: target ? 1 : players.size });
    });
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "0.0.0.0", () => resolve({ port, close: () => new Promise((done) => (io.close(), server.close(done))) }));
  });
}

module.exports = { startHub, sanitizeCommand, REMOTE_KEYS };
