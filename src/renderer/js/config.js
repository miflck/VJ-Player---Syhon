// Shared configuration, app-level state and filename-flag parsing.
// Loaded before the other scripts; everything here is a plain global.

const DEBUG = false;
const log = (...args) => {
  if (DEBUG) console.log(...args);
};

const Config = {
  IMAGE_DISPLAY_TIME: { min: 5, max: 20 }, // seconds
  VIDEO_SEGMENT_TIME: { min: 2, max: 15 }, // seconds
  VIDEO_VOLUME: 0.5,
  IMAGE_ZOOM_FACTOR: 1.05,
  PIXEL_DENSITY: 1, // 1 = canvas is window size in pixels (cheaper, and the Syphon output size); 2 = retina sharpness on screen
  PRELOAD_RETRY_LIMIT: 5,
  PRELOAD_RETRY_DELAY: 250, // ms
};

// UI-level state that isn't tied to playlists or playback.
const App = {
  assetsPath: "",
  remoteUrls: [], // where the remote-control page can be opened (shown in settings)
  showSettings: false,
  isBlackedOut: false, // "A" toggles this — hides output without stopping playback
  isMasked: true, // "M" toggles this — circular mask (r = height/2), media contained within it
  needsRedraw: true, // static images are only redrawn when something changed (see invalidate)
};

// Marks the canvas as dirty. Videos redraw every frame regardless; a still image
// (or settings screen) is only redrawn after something called this.
function invalidate() {
  App.needsRedraw = true;
}

// ----------------------------------------------------------------------------
// Filename flags — parsed once per file and cached.
//
//   clip@w5.mp4      → weight 5 (5x more likely to be picked; default 1)
//   clip@contain.mp4 → letterbox instead of fill/crop (default "cover")
//   clip@full.mp4    → this file plays in full (video to its end, image/sketch until skipped), whatever the playlist says
//   Name@15s/sketch.js → flags also work in the name of a sketch folder
//   clip@12s.mp4     → 12 second segment (videos); how long an image or sketch stays (images, sketches)
//   clip_x3.mp4      → 3x VIDEO_SEGMENT_TIME.min
//   clip_LONG.mp4    → 3x VIDEO_SEGMENT_TIME.min
// ----------------------------------------------------------------------------

const flagCache = new Map();

function getFlags(filename) {
  if (!filename) return { kind: "image", weight: 1, fit: "cover", duration: null, full: false };

  let flags = flagCache.get(filename);
  if (!flags) {
    flags = parseFlags(filename);
    flagCache.set(filename, flags);
  }
  return flags;
}

function parseFlags(filename) {
  const weight = parseFloat((filename.match(/@w(\d+(?:\.\d+)?)/i) || [])[1]);

  let duration = null;
  const seconds = filename.match(/@(\d+)s/);
  const multiplier = filename.match(/_x(\d+)/);
  if (seconds) duration = parseInt(seconds[1], 10);
  else if (multiplier) duration = Config.VIDEO_SEGMENT_TIME.min * parseInt(multiplier[1], 10);
  else if (filename.includes("_LONG")) duration = Config.VIDEO_SEGMENT_TIME.min * 3;

  return {
    kind: /(^|[./])sketch\.js$/i.test(filename) ? "sketch" : /\.(mp4|mov)$/i.test(filename) ? "video" : "image",
    weight: weight > 0 ? weight : 1,
    fit: /@contain\b/i.test(filename) ? "contain" : "cover",
    full: /@full\b/i.test(filename),
    duration,
  };
}

// Builds a file:// URL for a media file. Each path segment is percent-encoded so
// names containing '#', '?' or '%' load correctly; Windows paths get the
// file:///C:/... form.
function buildMediaUrl(filename) {
  const fullPath = `${App.assetsPath}/${filename}`.replace(/\\/g, "/");
  const encoded = fullPath
    .split("/")
    .map((segment) => (/^[A-Za-z]:$/.test(segment) ? segment : encodeURIComponent(segment)))
    .join("/");
  return "file://" + (encoded.startsWith("/") ? "" : "/") + encoded;
}
