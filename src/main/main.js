const { app, BrowserWindow, ipcMain, dialog, shell, powerSaveBlocker } = require("electron");
const path = require("path");
const fs = require("fs").promises;
const fsSync = require("fs");

// Keep rendering (and publishing to Syphon) when the window is hidden or covered.
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
app.commandLine.appendSwitch("disable-background-timer-throttling");

let mainWindow;
let assetsPath = "";

// Path to store user data
const userDataPath = app.getPath("userData");
const configPath = path.join(userDataPath, "config.json");

// Supported media extensions
const MEDIA_EXTENSIONS = [".mp4", ".mov", ".jpg", ".jpeg", ".png", ".gif", ".webp"];

// Name of the playlist config file that lives inside the assets folder
const PLAYLISTS_FILENAME = "playlists.json";

// Load saved configuration
function loadConfig() {
  try {
    if (fsSync.existsSync(configPath)) {
      const data = fsSync.readFileSync(configPath, "utf8");
      const config = JSON.parse(data);
      assetsPath = config.assetsPath || "";
      console.log("Loaded assets path:", assetsPath);
    }
  } catch (error) {
    console.error("Error loading config:", error);
  }
}

// Save configuration
function saveConfig() {
  try {
    const config = {
      assetsPath: assetsPath,
    };
    fsSync.writeFileSync(configPath, JSON.stringify(config, null, 2));
    console.log("Saved assets path:", assetsPath);
  } catch (error) {
    console.error("Error saving config:", error);
  }
}

// ============================================================================
// PLAYLISTS
//
// Playlists are defined by a "playlists.json" file that lives inside the
// selected assets folder. It's an array of entries, each with a "name" and
// either (or both):
//
//   "folder": a path (relative to the assets folder) to scan recursively
//   "files":  an explicit list of file paths (relative to the assets folder)
//
// Optionally, "full": true marks the playlist as "play in full": videos
// play from 0 to their natural end instead of a random segment, and images
// are shown indefinitely instead of on a timer.
//
// Examples:
//
// [
//   { "name": "Kong", "files": ["kong/1.mp4", "kong/2.mp4", "kong/3.mp4"] },
//   { "name": "Space", "folder": "techbck/space" },
//   { "name": "Intro", "files": ["intro.mp4"], "full": true },
//   { "name": "Everything", "folder": "." }
// ]
//
// If no playlists.json is found, one is generated automatically: one
// folder-based playlist per top-level subfolder, or a single "All" playlist
// if there are no subfolders.
// ============================================================================

// Recursively collect media files under basePath/relativeFolder.
// Returns paths relative to basePath, using forward slashes.
async function scanFolderForMedia(basePath, relativeFolder) {
  const fullPath = path.join(basePath, relativeFolder);
  let entries;

  try {
    entries = await fs.readdir(fullPath, { withFileTypes: true });
  } catch (error) {
    console.error(`Could not read playlist folder "${relativeFolder}":`, error.message);
    return [];
  }

  let results = [];

  for (const entry of entries) {
    const entryRelPath = path.join(relativeFolder, entry.name);

    if (entry.isDirectory()) {
      const nested = await scanFolderForMedia(basePath, entryRelPath);
      results = results.concat(nested);
    } else if (entry.isFile() && MEDIA_EXTENSIONS.includes(path.extname(entry.name).toLowerCase())) {
      results.push(entryRelPath.split(path.sep).join("/"));
    }
  }

  return results;
}

// Validates an explicit list of file paths (relative to basePath), dropping
// any that don't exist or aren't a supported media type.
async function resolveExplicitFiles(basePath, relativeFiles) {
  const results = [];

  for (const relPath of relativeFiles) {
    if (typeof relPath !== "string" || !relPath) continue;

    const normalized = relPath.split(path.sep).join("/");
    const ext = path.extname(normalized).toLowerCase();

    if (!MEDIA_EXTENSIONS.includes(ext)) {
      console.warn(`Skipping "${normalized}" — not a supported media type`);
      continue;
    }

    const fullPath = path.join(basePath, normalized);
    if (!fsSync.existsSync(fullPath)) {
      console.warn(`Skipping "${normalized}" — file not found at ${fullPath}`);
      continue;
    }

    results.push(normalized);
  }

  return results;
}

// Create a default playlists.json: one playlist per top-level subfolder,
// or a single "All" playlist covering everything if there are none.
async function generateDefaultPlaylistsConfig(basePath) {
  const configFilePath = path.join(basePath, PLAYLISTS_FILENAME);
  let entries;

  try {
    const items = await fs.readdir(basePath, { withFileTypes: true });
    const subfolders = items.filter((item) => item.isDirectory());

    entries =
      subfolders.length > 0
        ? subfolders.map((d) => ({ name: d.name, folder: d.name }))
        : [{ name: "All", folder: "." }];
  } catch (error) {
    console.error("Error scanning assets folder for default playlists:", error);
    entries = [{ name: "All", folder: "." }];
  }

  try {
    await fs.writeFile(configFilePath, JSON.stringify(entries, null, 2), "utf8");
    console.log("Generated default playlists.json at", configFilePath);
  } catch (error) {
    console.error("Failed to write default playlists.json:", error);
  }

  return entries;
}

// Load (or lazily create) the playlists.json config for the given assets folder.
async function loadPlaylistsConfig(basePath) {
  const configFilePath = path.join(basePath, PLAYLISTS_FILENAME);

  if (fsSync.existsSync(configFilePath)) {
    try {
      const raw = await fs.readFile(configFilePath, "utf8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
      console.warn("playlists.json is empty or not an array — regenerating default");
    } catch (error) {
      console.error("Error parsing playlists.json, regenerating default:", error.message);
    }
  }

  return generateDefaultPlaylistsConfig(basePath);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1920,
    height: 1080,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
      autoplayPolicy: "no-user-gesture-required",
      backgroundThrottling: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "..", "renderer", "index.html"));

  // Open DevTools in development
  if (!app.isPackaged) {
    //mainWindow.webContents.openDevTools();
  }

  // Log console messages
  mainWindow.webContents.on("console-message", (event, level, message, line, sourceId) => {
    console.log(`Renderer: ${message}`);
  });

  mainWindow.webContents.on("did-fail-load", (event, errorCode, errorDescription) => {
    console.error("Failed to load:", errorCode, errorDescription);
  });
}

app.whenReady().then(() => {
  loadConfig(); // Load saved path before creating window
  powerSaveBlocker.start("prevent-display-sleep"); // keep the display on while the player runs
  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// IPC Handlers
ipcMain.handle("get-assets-path", async () => {
  return assetsPath;
});

ipcMain.handle("select-assets-folder", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory"],
  });

  if (!result.canceled && result.filePaths.length > 0) {
    assetsPath = result.filePaths[0];
    saveConfig(); // Save immediately after selection
    return assetsPath;
  }

  return null;
});

// Returns { playlists: { [name]: { files: string[], full: boolean } }, order: string[], configPath: string }
ipcMain.handle("get-media-files", async () => {
  if (!assetsPath) return { playlists: {}, order: [], configPath: "" };

  try {
    const configEntries = await loadPlaylistsConfig(assetsPath);
    const playlists = {};
    const order = [];

    for (const entry of configEntries) {
      if (!entry || !entry.name || (!entry.folder && !entry.files)) {
        console.warn("Skipping invalid playlists.json entry (needs name + folder and/or files):", entry);
        continue;
      }

      let files = [];

      if (entry.folder) {
        files = files.concat(await scanFolderForMedia(assetsPath, entry.folder));
      }

      if (Array.isArray(entry.files)) {
        files = files.concat(await resolveExplicitFiles(assetsPath, entry.files));
      }

      if (files.length > 0) {
        playlists[entry.name] = { files, full: entry.full === true };
        order.push(entry.name);
      } else {
        console.warn(`Playlist "${entry.name}" has no valid media files — skipping`);
      }
    }

    return { playlists, order, configPath: path.join(assetsPath, PLAYLISTS_FILENAME) };
  } catch (error) {
    console.error("Error building playlists:", error);
    return { playlists: {}, order: [], configPath: "" };
  }
});

// Opens playlists.json in the user's default editor so they can hand-edit it.
// Creates a default one first if it doesn't exist yet.
ipcMain.handle("open-playlists-config", async () => {
  if (!assetsPath) return false;

  const configFilePath = path.join(assetsPath, PLAYLISTS_FILENAME);

  if (!fsSync.existsSync(configFilePath)) {
    await generateDefaultPlaylistsConfig(assetsPath);
  }

  const errorMessage = await shell.openPath(configFilePath);
  if (errorMessage) {
    console.error("Failed to open playlists.json:", errorMessage);
    return false;
  }
  return true;
});

ipcMain.handle("toggle-fullscreen", async () => {
  const isFullscreen = mainWindow.isFullScreen();
  mainWindow.setFullScreen(!isFullscreen);
  return !isFullscreen;
});
