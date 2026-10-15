// Command-line options. They override config.json for this launch only and are never
// written back to it (so one app can be started in different roles from a script).
//
//   --hub=<url>          connect to a hub elsewhere (and don't host one)
//   --host               run the hub here (the default)
//   --port=<n>           hub port when hosting
//   --name=<text>        how this player is listed in the controller
//   --syphon-name=<text> Syphon server name
//   --assets=<folder>    assets folder (not saved)
//   --window=<W>x<H>     visible window size, e.g. 960x540
//
// (--instance=<name> is handled in main.js because it must run before the app starts.)

const path = require("path");

// `commandLine` is Electron's app.commandLine (anything with hasSwitch/getSwitchValue works).
// Returns { config, assets }: config.json's content with the overrides applied, and the assets
// folder from --assets (or null).
function applyCommandLine(config, commandLine, warn = console.warn) {
  const has = (name) => commandLine.hasSwitch(name);
  const get = (name) => commandLine.getSwitchValue(name);
  const config2 = { ...config, remote: { ...config.remote }, syphon: { ...config.syphon }, window: { ...config.window } };

  if (has("hub")) {
    if (get("hub")) {
      config2.remote.host = false;
      config2.remote.url = get("hub");
    } else {
      warn("--hub needs an address, e.g. --hub=http://192.168.1.20:3000");
    }
  } else if (has("host")) {
    config2.remote.host = true;
    config2.remote.url = "";
  }

  if (has("port")) {
    const port = Number(get("port"));
    if (Number.isInteger(port) && port > 0 && port < 65536) config2.remote.port = port;
    else warn(`--port=${get("port")} is not a valid port`);
  }

  if (has("name") && get("name")) config2.remote.name = get("name");
  if (has("syphon-name") && get("syphon-name")) config2.syphon.name = get("syphon-name");

  if (has("window")) {
    const match = /^(\d+)x(\d+)$/i.exec(get("window"));
    if (match) {
      config2.window.width = Number(match[1]);
      config2.window.height = Number(match[2]);
    } else {
      warn(`--window=${get("window")} should look like 960x540`);
    }
  }

  const assets = has("assets") && get("assets") ? path.resolve(get("assets")) : null;
  return { config: config2, assets };
}

module.exports = { applyCommandLine };
