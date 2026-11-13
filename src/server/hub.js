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
const REMOTE_KEYS = ["n", "x", "arrowright", "a", "b", "c", "d", "m", "l", "f", "y", "r", "k"];

// Returns a clean command, or null if it is not allowed.
//   { key: "n" }      press a key
//   { playlist: 2 }   jump to a playlist by index
//   { timing: { images: [3, 8] } }   change times live (keys: images videos texts wordHold wordGap, [min, max] seconds);
//                     { timing: "reset" } goes back to what is saved in the player's settings
//   { wipe: true }    the same random wipe on every player at once (the hub picks it from the wipes a player reports)
//   { auto: 180 }     auto-rotate: spread the playlists over the players now, then move every player one playlist
//                     on every 180 seconds (5–86400); { auto: false } stops it. Handled by the hub, not relayed.
//   { scene: 2 }      toggle the scene that is playlist 2 (same as { playlist: 2 } on a scene playlist)
// Either may carry "target": a player id (from the "players" list) to address only that
// player; without it the command goes to every player.
function sanitizeCommand(cmd) {
  if (!cmd || typeof cmd !== "object") return null;

  let clean = null;
  if (typeof cmd.key === "string" && REMOTE_KEYS.includes(cmd.key.toLowerCase())) clean = { key: cmd.key.toLowerCase() };
  else if (Number.isInteger(cmd.playlist) && cmd.playlist >= 0) clean = { playlist: cmd.playlist };
  else if (Number.isInteger(cmd.scene) && cmd.scene >= 0) clean = { scene: cmd.scene };
  else if (cmd.wipe === true) clean = { wipe: true };
  else if (cmd.auto === false) clean = { auto: false };
  else if (typeof cmd.auto === "number" && cmd.auto >= 5 && cmd.auto <= 86400) clean = { auto: cmd.auto };
  else if (cmd.timing === "reset") clean = { timing: "reset" };
  else if (cmd.timing && typeof cmd.timing === "object") {
    const timing = {};
    for (const key of ["images", "videos", "texts", "wordHold", "wordGap"]) {
      const r = cmd.timing[key];
      if (r === undefined) continue;
      if (!Array.isArray(r) || r.length !== 2 || !r.every((n) => typeof n === "number" && n >= 0 && n <= 3600)) return null;
      timing[key] = [Math.min(...r), Math.max(...r)];
    }
    if (Object.keys(timing).length) clean = { timing };
  }
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

  // Auto-rotate: every player gets its own playlist, then all move one place down the list every `seconds`.
  let auto = { on: false, seconds: 180, nextAt: 0 };
  let autoTimer = null;
  const byName = (a, b) => String(a.name).localeCompare(String(b.name), undefined, { numeric: true });
  const sendAuto = () => io.to("controllers").emit("auto", auto);
  const autoPool = (p) => (Array.isArray(p.randomPool) && p.randomPool.length ? p.randomPool : (p.playlists || []).map((_, i) => i));

  // One wipe file for everybody: from the first player that has wipes. Never the same twice in a row.
  let lastWipe = null;
  const pickWipe = () => {
    const files = ([...players.values()].sort(byName).find((p) => Array.isArray(p.wipes) && p.wipes.length) || {}).wipes || [];
    const options = files.length > 1 ? files.filter((f) => f !== lastWipe) : files;
    return (lastWipe = options.length ? options[Math.floor(Math.random() * options.length)] : null);
  };

  const autoStep = (spread) => {
    const list = [...players.values()].sort(byName);
    const wipe = spread ? null : pickWipe(); // a wipe at every move, the playlist changes in its middle
    list.forEach((p, i) => {
      const pool = autoPool(p);
      if (!pool.length) return;
      const at = pool.indexOf(p.playlist);
      // spread: player i → i-th playlist; later: the playlist after the one it is on (a player on one outside the pool joins at the start)
      const index = spread ? pool[i % pool.length] : pool[(at + 1) % pool.length];
      io.to(p.id).emit("command", wipe ? { wipe, playlist: index } : { playlist: index });
    });
    auto.nextAt = Date.now() + auto.seconds * 1000;
    sendAuto();
  };

  const setAuto = (seconds) => {
    clearInterval(autoTimer);
    autoTimer = null;
    auto = seconds ? { on: true, seconds, nextAt: Date.now() + seconds * 1000 } : { on: false, seconds: auto.seconds, nextAt: 0 };
    if (seconds) {
      autoStep(true);
      autoTimer = setInterval(() => autoStep(false), seconds * 1000);
    }
    log(`[remote] auto-rotate ${seconds ? `every ${seconds}s` : "off"}`);
    sendAuto();
  };

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
    socket.emit("auto", auto);

    socket.on("command", (cmd, ack) => {
      if (cmd && cmd.launch === "layout") {
        const reply = onLaunchLayout ? onLaunchLayout() : { ok: false, error: "this hub cannot open players" };
        log(`[remote] open layout → ${JSON.stringify(reply)}`);
        return typeof ack === "function" && ack(reply);
      }
      const clean = sanitizeCommand(cmd);
      if (!clean) return typeof ack === "function" && ack({ ok: false, error: "command not allowed" });

      if (clean.wipe === true) {
        const wipe = pickWipe();
        if (!wipe) return typeof ack === "function" && ack({ ok: false, error: "no wipes (see \"wipes\" in playlists.json)" });
        io.to("players").emit("command", { wipe });
        return typeof ack === "function" && ack({ ok: true, players: players.size });
      }
      if ("auto" in clean) {
        setAuto(clean.auto);
        return typeof ack === "function" && ack({ ok: true, players: players.size });
      }

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
    server.listen(port, "0.0.0.0", () => resolve({ port, close: () => new Promise((done) => (clearInterval(autoTimer), io.close(), server.close(done))) }));
  });
}

module.exports = { startHub, sanitizeCommand, REMOTE_KEYS };
