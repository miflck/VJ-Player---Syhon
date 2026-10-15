// Tests the remote-control hub (src/server/hub.js): run with `npm test`.
const path = require("path");
const root = path.join(__dirname, "..");
const { startHub } = require(root + "/src/server/hub");
const { io } = require(root + "/node_modules/socket.io-client");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok) => { results.push(ok); console.log(ok ? "PASS" : "FAIL", name); };

(async () => {
  const hub = await startHub({ port: 3456, token: "s3cret", staticDir: path.join(root, "src/controller"), log: () => {} });
  const base = "http://127.0.0.1:3456";

  check("controller page is served", (await (await fetch(base + "/")).text()).includes("VJ Remote"));
  check("socket.io client script is served", (await fetch(base + "/socket.io/socket.io.js")).ok);
  check("unknown file is 404", (await fetch(base + "/hub.js")).status === 404);

  const bad = io(base, { auth: { role: "controller", token: "nope" }, reconnection: false });
  const badErr = await new Promise((r) => bad.on("connect_error", (e) => r(e.message)));
  check("wrong token is rejected", badErr === "unauthorized");

  const auth = (role, name) => ({ role, name, token: "s3cret" });
  const playerA = io(base, { auth: auth("player", "A") });
  const playerB = io(base, { auth: auth("player", "B") });
  const gotA = [], gotB = [];
  playerA.on("command", (c) => gotA.push(c));
  playerB.on("command", (c) => gotB.push(c));
  await sleep(300);

  const ctl = io(base, { auth: auth("controller") });
  let lastPlayers = [];
  ctl.on("players", (p) => (lastPlayers = p));
  await sleep(300);
  check("controller sees both players", lastPlayers.length === 2);

  const ack = (cmd) => new Promise((r) => ctl.emit("command", cmd, r));
  const r1 = await ack({ key: "n" });
  const r2 = await ack({ key: "ArrowRight" });
  const r3 = await ack({ playlist: 2 });
  await sleep(200);
  check("n reaches every player", gotA.some((c) => c.key === "n") && gotB.some((c) => c.key === "n"));
  check("keys are lower-cased (ArrowRight → arrowright)", gotA.some((c) => c.key === "arrowright"));
  check("playlist index reaches every player", gotA.some((c) => c.playlist === 2) && gotB.some((c) => c.playlist === 2));
  check("ack reports player count", r1.ok && r1.players === 2 && r2.ok && r3.ok);

  const before = gotA.length;
  const bads = await Promise.all([ack({ key: "escape" }), ack({ key: "e" }), ack({ key: "s" }), ack({ key: "backspace" }), ack({ playlist: -1 }), ack({ playlist: "1" }), ack("n"), ack(null)]);
  await sleep(200);
  check("escape/e/s/backspace and malformed commands are refused", bads.every((r) => r && r.ok === false) && gotA.length === before);

  playerA.emit("state", { playlist: 1, playlists: ["x", "y"], file: "y/a.mp4", kind: "video" });
  await sleep(300);
  const a = lastPlayers.find((p) => p.name === "A");
  check("player state is forwarded to controllers", a && a.file === "y/a.mp4" && a.playlist === 1);

  playerB.disconnect();
  await sleep(300);
  check("disconnected player disappears", lastPlayers.length === 1);

  // a controller can't impersonate a player's state
  ctl.emit("state", { file: "evil" });
  await sleep(200);
  check("controller 'state' events are ignored", !lastPlayers.some((p) => p.file === "evil"));

  [playerA, ctl, bad].forEach((s) => s.close());
  await hub.close();
  console.log(results.every(Boolean) ? "ALL PASSED" : "SOME FAILED");
  process.exit(results.every(Boolean) ? 0 : 1);
})();
