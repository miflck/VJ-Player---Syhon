// p5.js Media Player - Electron Version with External Assets Folder
// Displays images and videos in random order with automatic transitions.
//
// Scripts (loaded in this order by index.html):
//   config.js   shared config, app state, filename flags
//   playlist.js playlists.json handling and random file picking
//   player.js   media loading, playback, transitions
//   sketches.js p5 sketch files as media
//   words.js    word list text layer
//   text.js     text pages (.txt files) on a coloured background
//   ui.js       canvas rendering
//   settings.js settings panel (HTML)
//   syphon.js   Syphon output (macOS)
//   remote.js   remote control over socket.io (commands in, state out)
//   sketch.js   p5 setup/draw, initialisation and input

function setup() {
  pixelDensity(Config.PIXEL_DENSITY); // before createCanvas; also sets the Syphon output resolution
  const canvas = createCanvas(Config.OUTPUT_WIDTH, Config.OUTPUT_HEIGHT);
  canvas.parent("sketch-container");
  // style.css scales the canvas down/up to fit the window, keeping this aspect ratio
  document.documentElement.style.setProperty("--output-aspect", Config.OUTPUT_WIDTH / Config.OUTPUT_HEIGHT);

  // "VJ Player", or "VJ Player <n>" when started with --instance=<n>
  window.electronAPI.getInstanceInfo().then((info) => {
    if (!info) return;
    document.title = info.title;
    SyphonOut.serverName = info.syphonName;
  });

  initializeMediaPlayer();
  initRemote();
}

// Random blackouts: while enabled, the output alternates between visible and dark for random times.
function updateBlackouts() {
  if (!App.randomBlackouts) {
    if (App.randomDark) {
      App.randomDark = false;
      invalidate();
    }
    return;
  }
  const now = millis();
  if (now < App.blackoutNextAt) return;

  App.randomDark = !App.randomDark;
  const range = App.randomDark ? Config.BLACKOUT_HOLD : Config.BLACKOUT_GAP;
  App.blackoutNextAt = now + random(range.min, range.max) * 1000;
  invalidate();
}

function toggleRandomBlackouts() {
  App.randomBlackouts = !App.randomBlackouts;
  App.randomDark = false;
  App.blackoutNextAt = millis() + random(Config.BLACKOUT_GAP.min, Config.BLACKOUT_GAP.max) * 1000;
  invalidate();
}

// Random colours: while enabled, the output flashes a random flat colour now and then, for a random time.
function updateRandomColors() {
  if (!App.randomColors) {
    if (App.randomColor) {
      App.randomColor = null;
      invalidate();
    }
    return;
  }
  const now = millis();
  if (now < App.colorNextAt) return;

  App.randomColor = App.randomColor ? null : pickColor();
  const range = App.randomColor ? Config.COLOR_HOLD : Config.COLOR_GAP;
  App.colorNextAt = now + random(range.min, range.max) * 1000;
  invalidate();
}

function toggleRandomColors() {
  App.randomColors = !App.randomColors;
  App.randomColor = null;
  App.colorNextAt = millis() + random(Config.COLOR_GAP.min, Config.COLOR_GAP.max) * 1000;
  invalidate();
}

// A colour from the palette, never the same twice in a row
function pickColor() {
  const palette = Config.COLOR_FILL_COLORS || Config.WORD_COLORS;
  const options = palette.length > 1 ? palette.filter((c) => c !== lastColorFill) : palette;
  return (lastColorFill = options[Math.floor(random(options.length))]);
}

// "C": cover the output with one colour picked at random from the palette (never the same twice in a row); again = off
function toggleColorFill() {
  if (App.colorFill) {
    App.colorFill = null;
    return;
  }
  App.colorFill = pickColor();
}
let lastColorFill = null;

function draw() {
  const current = Player.current;
  updateWords();
  updateText();
  updateBlackouts();
  updateRandomColors();
  const dark = App.isBlackedOut || App.randomDark;
  const flat = App.colorFill || App.randomColor; // flat colour over the output, if any
  const covered = dark || !!flat; // media and words are hidden
  const isAnimated = (current && current.kind !== "image" && !covered) || (Words.text && !covered); // video, sketch or visible word
  if (!isAnimated && !App.needsRedraw) {
    publishSyphon(false); // nothing changed on a still screen
    return;
  }
  App.needsRedraw = false;

  background(dark ? 0 : flat || 0);

  if (current && !covered) {
    if (current.kind === "sketch") stepSketch(current);
    renderMedia(current);
  }
  if (!covered) renderWords();

  publishSyphon(true);
}

// ============================================================================
// INITIALIZATION
// ============================================================================

async function initializeMediaPlayer() {
  try {
    App.assetsPath = await window.electronAPI.getAssetsPath();
    log("Assets path:", App.assetsPath);

    if (!App.assetsPath) {
      openSettings();
      return;
    }

    await startPlaylists();
  } catch (error) {
    console.error("Failed to initialize:", error);
  }
}

async function selectAssetsFolder() {
  const newPath = await window.electronAPI.selectAssetsFolder();
  if (!newPath) return;

  App.assetsPath = newPath;
  closeSettings();
  await startPlaylists();
}

// ============================================================================
// USER INPUT
// ============================================================================

const KEY_ACTIONS = {
  s: toggleSettings,
  escape: () => (App.showSettings ? closeSettings() : window.electronAPI.quitApp()), // closes settings, otherwise quits
  n: () => switchPlaylist(1),
  x: () => switchPlaylist(-1),
  arrowright: advance, // skip to another random file within the playlist
  a: () => (App.isBlackedOut = !App.isBlackedOut), // hides output without stopping playback
  r: toggleShuffleAll, // random files from all playlists on/off
  b: toggleRandomBlackouts, // random blackouts on/off
  c: toggleColorFill, // flat random colour on/off
  d: toggleRandomColors, // random colour flashes on/off
  m: () => (App.isMasked = !App.isMasked), // circle mask
  l: reloadPlaylists, // re-read playlists.json
  e: () => window.electronAPI.openPlaylistsConfig(), // open playlists.json in the default editor
  f: () => window.electronAPI.toggleFullscreen(),
  y: toggleSyphon, // Syphon output on/off
  backspace: () => window.location.reload(),
};

function keyPressed() {
  if (isTypingInSettings() && key !== "Escape") return; // typing in the settings panel
  const action = KEY_ACTIONS[key.toLowerCase()];
  if (action) action();
  invalidate();
}
