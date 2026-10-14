const { contextBridge, ipcRenderer } = require("electron");
const path = require("path");

// ---------------------------------------------------------------------------
// Syphon (macOS). The native addon is loaded here in the preload script, so the
// page keeps contextIsolation and gets no Node access. The addon is loaded
// lazily so other platforms (or a missing build) just report "unavailable".
// ---------------------------------------------------------------------------
let syphonAddon;
let syphonServer = null;

function loadSyphonAddon() {
  if (syphonAddon !== undefined) return syphonAddon;
  syphonAddon = null;
  if (process.platform !== "darwin") return null;

  try {
    syphonAddon = require(path.join(__dirname, "..", "..", "build", "Release", "syphon_addon.node"));
  } catch (error) {
    console.warn("Syphon addon not available (run `npm run build:syphon`):", error.message);
  }
  return syphonAddon;
}

const syphon = {
  start(name) {
    if (syphonServer) return true;
    const addon = loadSyphonAddon();
    if (!addon) return false;
    try {
      syphonServer = new addon.SyphonServerWrapper(name);
      return true;
    } catch (error) {
      console.error("Failed to create Syphon server:", error);
      return false;
    }
  },
  stop() {
    if (!syphonServer) return;
    try {
      syphonServer.stop();
    } catch (_) {}
    syphonServer = null;
  },
  hasClients: () => !!syphonServer && syphonServer.hasClients(),
  // rgba: tightly packed RGBA bytes; flipped = rows are top-down (2D canvas getImageData)
  publish(rgba, width, height, flipped) {
    if (syphonServer) syphonServer.publishFrame(rgba, width, height, flipped);
  },
};

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld("electronAPI", {
  getMediaFiles: () => ipcRenderer.invoke("get-media-files"),
  getAssetsPath: () => ipcRenderer.invoke("get-assets-path"),
  selectAssetsFolder: () => ipcRenderer.invoke("select-assets-folder"),
  toggleFullscreen: () => ipcRenderer.invoke("toggle-fullscreen"),
  openPlaylistsConfig: () => ipcRenderer.invoke("open-playlists-config"),
  syphonStart: syphon.start,
  syphonStop: syphon.stop,
  syphonHasClients: syphon.hasClients,
  syphonPublish: syphon.publish,
});
