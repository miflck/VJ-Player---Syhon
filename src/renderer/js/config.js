// Shared configuration, app-level state and filename-flag parsing.
// Loaded before the other scripts; everything here is a plain global.

const DEBUG = false;
const log = (...args) => {
  if (DEBUG) console.log(...args);
};

const Config = {
  IMAGE_DISPLAY_TIME: { min: 2, max: 5 }, // seconds
  VIDEO_SEGMENT_TIME: { min: 2, max: 7 }, // seconds
  VIDEO_WRAP: true, // a random segment may start anywhere and loop around the end of the clip
  VIDEO_VOLUME: 0.5,
  IMAGE_ZOOM_FACTOR: 1.05,
  // The canvas is always this size, whatever the window size; it is also the Syphon size.
  // Set in config.json ("output") or with --output=WxH; default 1920x1080.
  OUTPUT_WIDTH: (window.electronAPI.instance.output || {}).width || 1920,
  OUTPUT_HEIGHT: (window.electronAPI.instance.output || {}).height || 1080,
  PIXEL_DENSITY: 1, // 1 = one canvas pixel per output pixel; 2 would double the Syphon readback size
  // Word layer (see words.js); all times in seconds
  WORD_FADE: 0.25, // fade in and fade out
  WORD_HOLD: { min: 1, max: 5 }, // fully visible
  WORD_GAP: { min: 2, max: 7 }, // pause between two words
  WORD_SIZE: 0.16, // font size as a fraction of the output height
  WORD_FONT_FILE: "Everett-Bold-web.woff", // file in src/renderer/fonts/, e.g. "MyFont-Bold.woff2"; empty = Helvetica bold
  WORD_LETTER_DELAY: 0.02, // seconds between two letters appearing (W, O, R, T ...)
  WORD_COLORS: ["#7e8afb", "#c8fa32", "#ffffff"], // each word picks one at random (never the same twice in a row)
  //WORD_COLORS: ["#ff0000", "#7e8afb", "#c8fa32", "#000000", "#ffffff"], // each word picks one at random (never the same twice in a row)
  WORD_LEADING: 0.9, // line height as a multiple of the font size (tight)
  WORD_SHADOW: false, // soft drop shadow behind the words
  WORD_FONT_WEIGHT: "bold", // only used for the fallback font
  // Random blackouts (controller button / "B"); each player runs its own timeline, in seconds
  BLACKOUT_GAP: { min: 10, max: 40 }, // picture on
  BLACKOUT_HOLD: { min: 1, max: 6 }, // picture dark
  PRELOAD_RETRY_LIMIT: 5,
  PRELOAD_RETRY_DELAY: 250, // ms
};

// UI-level state that isn't tied to playlists or playback.
const App = {
  assetsPath: "",
  showSettings: false,
  isBlackedOut: false, // "A" toggles this — hides output without stopping playback
  randomBlackouts: false, // "B" toggles this — the output goes dark now and then, at random
  randomDark: false, // true while such a random blackout is on
  blackoutNextAt: 0, // millis() of the next switch between dark and visible
  isMasked: false, // "M" toggles this — circular mask (r = height/2), media contained within it
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
//   clip@color3.mp4  → words over this clip use the 3rd of Config.WORD_COLORS; clip@colorff00ff.mp4 → that hex colour
//   clip@full.mp4    → this file plays in full (video to its end, image/sketch until skipped), whatever the playlist says
//   Name@15s/sketch.js → flags also work in the name of a sketch folder
//   clip@12s.mp4     → 12 second segment (videos); how long an image or sketch stays (images, sketches)
//   clip_x3.mp4      → 3x VIDEO_SEGMENT_TIME.min
//   clip_LONG.mp4    → 3x VIDEO_SEGMENT_TIME.min
// ----------------------------------------------------------------------------

const flagCache = new Map();

function getFlags(filename) {
  if (!filename) return { kind: "image", weight: 1, fit: "cover", duration: null, full: false, color: null };

  let flags = flagCache.get(filename);
  if (!flags) {
    flags = parseFlags(filename);
    flagCache.set(filename, flags);
  }
  return flags;
}

// @color3 → 3rd entry of Config.WORD_COLORS; @colorff00ff → that hex colour. null when absent.
function parseColorFlag(filename) {
  const hex = filename.match(/@color-?([0-9a-f]{6})(?![0-9a-f])/i);
  if (hex) return "#" + hex[1];
  const index = parseInt((filename.match(/@color-?(\d)(?!\d)/i) || [])[1], 10);
  return index >= 1 ? Config.WORD_COLORS[index - 1] || null : null;
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
    color: parseColorFlag(filename),
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
