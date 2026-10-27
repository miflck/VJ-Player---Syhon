const { app, BrowserWindow, ipcMain, dialog, shell, powerSaveBlocker } = require("electron");
const { startRemote } = require("./remote");
const { applyCommandLine } = require("./cli");
const path = require("path");
const fs = require("fs").promises;
const fsSync = require("fs");
const { spawn } = require("child_process");

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

// Word lists are "words.txt" or "<name>.words.txt": one word or phrase per line
// (empty lines and lines starting with # are ignored). They are not media; they
// are shown as a text layer over the media of the playlist they belong to.
function isWordsFile(filename) {
  const lower = path.basename(filename).toLowerCase();
  return lower === "words.txt" || lower.endsWith(".words.txt");
}

// Any other .txt file is a text page: long text on a coloured background, scrolled if it is taller than the canvas
function isTextFile(filename) {
  return path.extname(filename).toLowerCase() === ".txt" && !isWordsFile(filename);
}

function isMediaFile(filename) {
  return MEDIA_EXTENSIONS.includes(path.extname(filename).toLowerCase()) || isSketchFile(filename) || isTextFile(filename);
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

// Recursively collect word list files under basePath/relativeFolder (relative paths, forward slashes).
async function scanFolderForWordFiles(basePath, relativeFolder) {
  let entries;
  try {
    entries = await fs.readdir(path.join(basePath, relativeFolder), { withFileTypes: true });
  } catch (error) {
    return []; // scanFolderForMedia already reports unreadable folders
  }

  let results = [];
  for (const entry of entries) {
    const relative = path.join(relativeFolder, entry.name);
    if (entry.isDirectory()) results = results.concat(await scanFolderForWordFiles(basePath, relative));
    else if (entry.isFile() && isWordsFile(entry.name)) results.push(relative.split(path.sep).join("/"));
  }
  return results;
}

// Reads the given word list files and returns all words/phrases, one per line.
async function readWords(basePath, relativeFiles) {
  const words = [];
  for (const relPath of relativeFiles) {
    try {
      const raw = await fs.readFile(path.join(basePath, relPath), "utf8");
      for (const line of raw.split(/\r?\n/)) {
        const word = line.trim();
        if (word && !word.startsWith("#")) words.push(word);
      }
    } catch (error) {
      console.warn(`Could not read word list "${relPath}":`, error.message);
    }
  }
  return words;
}

// Reads the text pages among the given files: { [relative path]: text }
async function readTexts(basePath, relativeFiles) {
  const texts = {};
  for (const relPath of relativeFiles.filter(isTextFile)) {
    try {
      texts[relPath] = await fs.readFile(path.join(basePath, relPath), "utf8");
    } catch (error) {
      console.warn(`Could not read text file "${relPath}":`, error.message);
    }
  }
  return texts;
}

// Validates an explicit list of file paths (relative to basePath), dropping
// any that don't exist or aren't a supported media type.
async function resolveExplicitFiles(basePath, relativeFiles) {
  const results = [];

  for (const relPath of relativeFiles) {
    if (typeof relPath !== "string" || !relPath) continue;

    const normalized = relPath.split(path.sep).join("/");

    if (!isMediaFile(normalized) && !isWordsFile(normalized)) {
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

// Output (canvas / Syphon) size: config.json { "output": { "width": 1920, "height": 1080 } } or --output=WxH.
const DEFAULT_OUTPUT = { width: 1920, height: 1080 };
function outputSize() {
  const out = settings.output || {};
  const valid = (n) => Number.isInteger(n) && n >= 64 && n <= 8192;
  if (out.width === undefined && out.height === undefined) return { ...DEFAULT_OUTPUT };
  if (!valid(out.width) || !valid(out.height)) {
    console.warn(`Ignoring output size ${out.width}x${out.height} (whole numbers from 64 to 8192); using ${DEFAULT_OUTPUT.width}x${DEFAULT_OUTPUT.height}`);
    return { ...DEFAULT_OUTPUT };
  }
  return { width: out.width, height: out.height };
}

// Names that depend on the instance. Syphon and window title can be overridden in
// config.json: { "syphon": { "name": "..." } }
function instanceInfo() {
  const label = instance ? `VJ Player ${instance}` : "VJ Player";
  return { instance, title: label, syphonName: (settings.syphon && settings.syphon.name) || label, output: outputSize() };
}

function createWindow() {
  // The output is a fixed-size canvas; the window shows it at half size by default
  // (config.json: { "window": { "width": 960, "height": 540, "x": 0, "y": 0 } }, content size)
  const win = settings.window || {};
  const output = outputSize();
  mainWindow = new BrowserWindow({
    width: win.width || Math.round(output.width / 2),
    height: win.height || Math.round(output.height / 2),
    x: win.x,
    y: win.y,
    useContentSize: true,
    frame: win.frame === true, // no title bar by default; config.json "window": { "frame": true } brings it back
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
  registerInstance();
  powerSaveBlocker.start("prevent-display-sleep"); // keep the display on while the player runs
  createWindow();
  startRemote({
    getWindow: () => mainWindow,
    launchLayout,
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

// Returns { playlists: { [name]: { files: string[], full: boolean, words: string[] } }, order: string[], configPath: string }
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
      let wordFiles = [];

      if (entry.folder) {
        files = files.concat(await scanFolderForMedia(assetsPath, entry.folder));
        wordFiles = wordFiles.concat(await scanFolderForWordFiles(assetsPath, entry.folder));
      }

      if (Array.isArray(entry.files)) {
        const explicit = await resolveExplicitFiles(assetsPath, entry.files);
        files = files.concat(explicit.filter((f) => !isWordsFile(f)));
        wordFiles = wordFiles.concat(explicit.filter(isWordsFile));
      }

      if (files.length > 0) {
        const words = await readWords(assetsPath, [...new Set(wordFiles)]);
        const texts = await readTexts(assetsPath, files);
        playlists[entry.name] = { files, texts, full: entry.full === true, sequential: entry.sequential === true || entry.hold === true, hold: entry.hold === true, words, wordOptions: entry.words && typeof entry.words === "object" ? entry.words : {} };
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

// ----------------------------------------------------------------------------
// Launching more copies from the settings screen. Each running copy leaves a
// "<name>.pid" file in a shared folder, so the next free instance number can be found.
// ----------------------------------------------------------------------------
const instancesDir = path.join(app.getPath("appData"), "VJ Player instances");
const pidFile = (name) => path.join(instancesDir, `${name || "default"}.pid`);

function isRunning(name) {
  try {
    process.kill(Number(fsSync.readFileSync(pidFile(name), "utf8")), 0);
    return true;
  } catch (error) {
    return error.code === "EPERM"; // exists but not ours: still running
  }
}

function registerInstance() {
  try {
    fsSync.mkdirSync(instancesDir, { recursive: true });
    fsSync.writeFileSync(pidFile(instance), String(process.pid));
  } catch (error) {
    console.error("Could not register instance:", error);
  }
}
app.on("will-quit", () => {
  try {
    fsSync.unlinkSync(pidFile(instance));
  } catch (error) {
    /* already gone */
  }
});

// Starts another copy. `taken` lists instance numbers already handed out in this batch,
// because a copy only registers itself once it has started.
function launchInstance(extraArgs = [], taken = []) {
  let n = 2;
  while (isRunning(String(n)) || taken.includes(String(n))) n++;
  const name = String(n);
  // unpackaged (npm start) electron needs the app folder as first argument
  const args = [...(app.isPackaged ? [] : [app.getAppPath()]), `--instance=${name}`, ...extraArgs];
  try {
    const child = spawn(process.execPath, args, { detached: true, stdio: "ignore" });
    child.on("error", (error) => console.error("Could not launch instance:", error));
    child.unref();
  } catch (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true, name: `VJ Player ${name}`, number: name };
}

ipcMain.handle("launch-instance", () => launchInstance());

// Layout of five players, left to right: two half HD, one HD, two half HD. The running player is
// the first one, so the controller's "Open players" button starts the other four (instances 2 to 5).
// Change the sizes with "layout" in config.json, e.g. ["960x1080", "1920x1080"].
const DEFAULT_LAYOUT = ["960x1080", "960x1080", "1920x1080", "960x1080", "960x1080"];

function launchLayout() {
  const layout = Array.isArray(settings.layout) && settings.layout.length ? settings.layout : DEFAULT_LAYOUT;
  const taken = [];
  for (const size of layout.slice(1)) {
    const result = launchInstance([`--output=${size}`], taken);
    if (!result.ok) return { ok: false, error: result.error };
    taken.push(result.number);
  }
  return { ok: true, count: layout.length - 1 };
}

// Output size chosen in the settings screen: saved to config.json, used from the next start
ipcMain.handle("set-output-size", (_event, { width, height }) => {
  const valid = (n) => Number.isInteger(n) && n >= 64 && n <= 8192;
  if (!valid(width) || !valid(height)) return { ok: false, error: "Width and height must be whole numbers from 64 to 8192." };
  userConfig.output = { width, height };
  saveConfig();
  return { ok: true };
});
ipcMain.on("get-instance-info-sync", (event) => (event.returnValue = instanceInfo())); // the page needs the output size before it starts

ipcMain.handle("quit-app", () => {
  app.quit();
});

ipcMain.handle("toggle-fullscreen", async () => {
  const isFullscreen = mainWindow.isFullScreen();
  mainWindow.setFullScreen(!isFullscreen);
  return !isFullscreen;
});
