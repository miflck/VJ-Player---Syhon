// Tests the command-line overrides (src/main/cli.js): run with `npm test`.
const path = require("path");
const { applyCommandLine } = require("../src/main/cli");

const results = [];
const check = (name, ok) => { results.push(ok); console.log(ok ? "PASS" : "FAIL", name); };

// minimal stand-in for Electron's app.commandLine
const line = (...args) => {
  const switches = Object.fromEntries(args.map((a) => a.replace(/^--/, "").split(/=(.*)/s).slice(0, 2)));
  return { hasSwitch: (n) => n in switches, getSwitchValue: (n) => switches[n] || "" };
};
const warnings = [];
const run = (config, ...args) => applyCommandLine(config, line(...args), (w) => warnings.push(w));

const base = { assetsPath: "/a", remote: { token: "t", port: 3000 } };

let r = run(base);
check("no flags: config unchanged", JSON.stringify(r.config.remote) === JSON.stringify(base.remote) && r.assets === null);

r = run(base, "--hub=http://10.0.0.5:3000");
check("--hub: client mode with that url, other remote keys kept", r.config.remote.host === false && r.config.remote.url === "http://10.0.0.5:3000" && r.config.remote.token === "t");

r = run({ remote: { host: false, url: "http://x" } }, "--host");
check("--host: host mode, url cleared", r.config.remote.host === true && r.config.remote.url === "");

r = run({ remote: { host: true } }, "--host", "--hub=http://y:1");
check("--hub wins over --host", r.config.remote.host === false && r.config.remote.url === "http://y:1");

r = run(base, "--port=3544", "--name=Right screen", "--syphon-name=Left Out");
check("--port, --name, --syphon-name", r.config.remote.port === 3544 && r.config.remote.name === "Right screen" && r.config.syphon.name === "Left Out");

r = run(base, "--window=640x360");
check("--window=640x360", r.config.window.width === 640 && r.config.window.height === 360);

r = run(base, "--assets=relative/dir");
check("--assets is resolved to an absolute path", r.assets === path.resolve("relative/dir"));

const before = JSON.stringify(base);
run(base, "--hub=http://z:1", "--name=N", "--window=1x1");
check("the original config object is not modified", JSON.stringify(base) === before);

warnings.length = 0;
r = run(base, "--port=abc", "--window=big", "--hub=");
check("bad values are ignored with a warning", warnings.length === 3 && r.config.remote.port === 3000 && r.config.window.width === undefined && r.config.remote.host === undefined);

console.log(results.every(Boolean) ? "ALL PASSED" : "SOME FAILED");
process.exit(results.every(Boolean) ? 0 : 1);
