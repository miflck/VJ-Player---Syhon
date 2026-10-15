const { app, BrowserWindow, ipcMain, dialog, shell, powerSaveBlocker } = require("electron");
const { startRemote } = require("./remote");
const { applyCommandLine } = require("./cli");
const path = require("path");
const fs = require("fs").promises;
const fsSync = require("fs");

// Keep rendering (and publishing to Syphon) when the window is hidden or covered.
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
app.commandLine.appendSwitch("disable-background-timer-throttling");

// Several copies can run side by side: `--instance=<name>` gives each its own
// settings folder ("VJ Player <name>"), Syphon server name and window title.
// Must be set before anything reads userData.
const instance = (app.commandLine.getSwitchValue("instance") || "").replace(/[^\w.-]/g, "");
if (instance) app.setPath("userData", `${app.getPath("userData")} ${instance}`);

let mainWindow;
let assetsPath = "";
let userConfig = {}; // everything in config.json, so saving the assets path keeps other settings (e.g. "remote")
let settings = {}; // userConfig plus command-line overrides; what the app actually uses (never saved)

// Path to store user data
const userDataPath = app.getPath("userData");
const configPath = path.join(userDataPath, "config.json");

// Supported media extensions
const MEDIA_EXTENSIONS = [".mp4", ".mov", ".jpg", ".jpeg", ".png", ".gif", ".webp"];

// p5 sketches are "<name>.sketch.js" or a "sketch.js" inside a folder named
// after the sketch (other .js files are ignored)
function isSketchFile(filename) {
  const lower = path.basename(filename).toLowerCase();
  return lower === "sketch.js" || lower.endsWith(".sketch.js");
}

function isMediaFile(filename) {
  return MEDIA_EXTENSIONS.includes(path.extname(filename).toLowerCase()) || isSketchFile(filename);
}

// Name of the playlist config file that lives inside the assets folder
const PLAYLISTS_FILENAME = "playlists.json";

// Load saved configuration
function loadConfig() {
  try {
    if (fsSync.existsSync(configPath)) {
      const data = fsSync.readFileSync(configPath, "utf8");
      const config = JSON.parse(data);
      userConfig = config;
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
    // userConfig is what is in the file; command-line overrides (settings) are never written
    fsSync.writeFileSync(configPath, JSON.stringify(userConfig, null, 2));
    console.log("Saved config");
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
//
// A folder that contains a sketch.js is a sketch: its sketch.js is added, and
// everything else inside it (textures, data, ...) is not played as media. Other
// sketches inside it (sub-folders with a sketch.js, or *.sketch.js files) are
// still found, so a folder can hold several sketches that play in random order.
async function scanFolderForMedia(basePath, relativeFolder, sketchesOnly = false) {
  const fullPath = path.join(basePath, relativeFolder);
  let entries;

  try {
    entries = await fs.readdir(fullPath, { withFileTypes: true });
  } catch (error) {
    console.error(`Could not read playlist folder "${relativeFolder}":`, error.message);
    return [];
  }

  const toRelative = (name) => path.join(relativeFolder, name).split(path.sep).join("/");
  const isSketchFolder = entries.some((entry) => entry.isFile() && entry.name.toLowerCase() === "sketch.js");
  const onlySketches = sketchesOnly || isSketchFolder;

  let results = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      results = results.concat(await scanFolderForMedia(basePath, path.join(relativeFolder, entry.name), onlySketches));
    } else if (entry.isFile() && (onlySketches ? isSketchFile(entry.name) : isMediaFile(entry.name))) {
      results.push(toRelative(entry.name));
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

    if (!isMediaFile(normalized)) {
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

// Names that depend on the instance. Syphon and window title can be overridden in
// config.json: { "syphon": { "name": "..." } }
function instanceInfo() {
  const label = instance ? `VJ Player ${instance}` : "VJ Player";
  return { instance, title: label, syphonName: (settings.syphon && settings.syphon.name) || label };
}

function createWindow() {
  // The output is a fixed 1920x1080 canvas; the window shows it at half size by default
  // (config.json: { "window": { "width": 960, "height": 540, "x": 0, "y": 0 } }, content size)
  const win = settings.window || {};
  mainWindow = new BrowserWindow({
    width: win.width || 960,
    height: win.height || 540,
    x: win.x,
    y: win.y,
    useContentSize: true,
    title: instanceInfo().title,
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
  mainWindow.on("page-title-updated", (event) => event.preventDefault()); // keep the instance title

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
  const cli = applyCommandLine(userConfig, app.commandLine); // command-line options beat config.json
  settings = cli.config;
  if (cli.assets) {
    assetsPath = cli.assets;
    console.log("Assets folder from --assets:", assetsPath);
  }
  powerSaveBlocker.start("prevent-display-sleep"); // keep the display on while the player runs
  createWindow();
  startRemote({
    getWindow: () => mainWindow,
    userConfig: settings,
    instance,
    // host/client chosen in the settings screen is remembered
    saveRemote: (remote) => {
      userConfig.remote = { ...userConfig.remote, ...remote };
      saveConfig();
    },
  });
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
    userConfig.assetsPath = assetsPath;
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

ipcMain.handle("get-instance-info", () => instanceInfo());

ipcMain.handle("quit-app", () => {
  app.quit();
});

ipcMain.handle("toggle-fullscreen", async () => {
  const isFullscreen = mainWindow.isFullScreen();
  mainWindow.setFullScreen(!isFullscreen);
  return !isFullscreen;
});
