// p5.js Media Player - Electron Version with External Assets Folder
// Displays images and videos in random order with automatic transitions.
//
// Scripts (loaded in this order by index.html):
//   config.js   shared config, app state, filename flags
//   playlist.js playlists.json handling and random file picking
//   player.js   media loading, playback, transitions
//   sketches.js p5 sketch files as media
//   ui.js       canvas rendering and settings screen
//   syphon.js   Syphon output (macOS)
//   remote.js   remote control over socket.io (commands in, state out)
//   sketch.js   p5 setup/draw, initialisation and input

function setup() {
  pixelDensity(Config.PIXEL_DENSITY); // before createCanvas; also sets the Syphon output resolution
  const canvas = createCanvas(1920, 1080);
  canvas.parent("sketch-container");
  initializeMediaPlayer();
  initRemote();
}

function draw() {
  const current = Player.current;
  const isAnimated = current && current.kind !== "image" && !App.isBlackedOut; // video or sketch
  if (!isAnimated && !App.needsRedraw) {
    publishSyphon(false); // nothing changed on a still screen
    return;
  }
  App.needsRedraw = false;

  background(0);

  if (current && !App.isBlackedOut) {
    if (current.kind === "sketch") stepSketch(current);
    renderMedia(current);
  }

  if (App.showSettings) {
    renderSettingsScreen();
  }

  publishSyphon(true);
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  invalidate();
}

// ============================================================================
// INITIALIZATION
// ============================================================================

async function initializeMediaPlayer() {
  try {
    App.assetsPath = await window.electronAPI.getAssetsPath();
    log("Assets path:", App.assetsPath);

    if (!App.assetsPath) {
      App.showSettings = true;
      invalidate();
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
  App.showSettings = false;
  invalidate();
  await startPlaylists();
}

// ============================================================================
// USER INPUT
// ============================================================================

const KEY_ACTIONS = {
  s: () => (App.showSettings ? selectAssetsFolder() : (App.showSettings = true)),
  escape: () => (App.showSettings ? (App.showSettings = false) : window.electronAPI.quitApp()), // closes settings, otherwise quits
  n: () => switchPlaylist(1),
  x: () => switchPlaylist(-1),
  arrowright: advance, // skip to another random file within the playlist
  a: () => (App.isBlackedOut = !App.isBlackedOut), // hides output without stopping playback
  m: () => (App.isMasked = !App.isMasked), // circle mask
  l: reloadPlaylists, // re-read playlists.json
  e: () => window.electronAPI.openPlaylistsConfig(), // open playlists.json in the default editor
  f: () => window.electronAPI.toggleFullscreen(),
  y: toggleSyphon, // Syphon output on/off
  backspace: () => window.location.reload(),
};

function keyPressed() {
  const action = KEY_ACTIONS[key.toLowerCase()];
  if (action) action();
  invalidate();
}

function mousePressed() {
  if (!App.showSettings) return;
  invalidate();

  const b = settingsButtonRect();
  if (mouseX >= b.x && mouseX <= b.x + b.w && mouseY >= b.y && mouseY <= b.y + b.h) {
    selectAssetsFolder();
  }
}
