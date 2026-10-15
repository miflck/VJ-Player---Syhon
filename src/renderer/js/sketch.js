// p5.js Media Player - Electron Version with External Assets Folder
// Displays images and videos in random order with automatic transitions.
//
// Scripts (loaded in this order by index.html):
//   config.js   shared config, app state, filename flags
//   playlist.js playlists.json handling and random file picking
//   player.js   media loading, playback, transitions
//   sketches.js p5 sketch files as media
//   words.js    word list text layer
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

function draw() {
  const current = Player.current;
  updateWords();
  const isAnimated = (current && current.kind !== "image" && !App.isBlackedOut) || (Words.text && !App.isBlackedOut); // video, sketch or visible word
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
  if (!App.isBlackedOut) renderWords();

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
