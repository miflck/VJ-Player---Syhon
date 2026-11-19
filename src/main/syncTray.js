// Menu-bar icon with "Sync playlists": copies this player's playlists.json (from its assets folder)
// into the Setlist folders of the other players. Targets: config.json
//   "playlistSync": { "targets": ["/Users/me/Dropbox/left/Setlist", "/Users/me/Dropbox/right/Setlist"] }

const { Tray, Menu, Notification, nativeImage, shell } = require("electron");
const fs = require("fs");
const path = require("path");

const FILE = "playlists.json";

function setupSyncTray({ getAssetsPath, getTargets, configPath }) {
  const icon = nativeImage.createFromPath(path.join(__dirname, "tray.png"));
  icon.setTemplateImage(false);
  const tray = new Tray(icon);
  tray.setToolTip("VJ Player: sync playlists");

  const notify = (body) => new Notification({ title: "Sync playlists", body, silent: true }).show();

  function sync() {
    const source = path.join(getAssetsPath() || "", FILE);
    const targets = getTargets();
    if (!fs.existsSync(source)) return notify(`${FILE} not found in the assets folder`);
    if (!targets.length) return notify('No targets: add "playlistSync": { "targets": [...] } to config.json');
    const results = targets.map((dir) => {
      try {
        fs.copyFileSync(source, path.join(dir, FILE));
        return { dir, ok: true };
      } catch (error) {
        return { dir, ok: false, error: error.code || error.message };
      }
    });
    const failed = results.filter((r) => !r.ok);
    notify(failed.length
      ? `${results.length - failed.length} of ${results.length} copied. Failed: ${failed.map((r) => path.basename(path.dirname(r.dir)) + " (" + r.error + ")").join(", ")}`
      : `Copied to ${results.length} folders`);
  }

  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Sync playlists", click: sync },
    { type: "separator" },
    { label: "Show config.json", click: () => shell.showItemInFolder(configPath) },
  ]));
  return tray;
}

module.exports = { setupSyncTray };
