// Word layer: the words of a playlist's word list ("words.txt" or "*.words.txt"
// in its folder) appear one at a time, centred, over the media, fade in and out, and
// follow their own random timeline, independent of the clips underneath.
// Drawn into the main canvas, so blackout and Syphon apply; the circle mask does not.
// setWords() is called whenever a playlist is activated, so switching playlists
// removes the old words at once.

// Timing can be set per playlist in playlists.json, e.g.
//   { "name": "X", "folder": "X", "words": { "fade": 0.2, "hold": [1, 2], "gap": [10, 30], "size": 0.15 } }
// "hold" and "gap" are [min, max] seconds (a single number means fixed). Anything left out uses Config.WORD_*.

const Words = {
  opts: null, // resolved timing of the active playlist, see resolveWordOptions
  list: [],
  text: null, // the word currently on screen (or fading), null during a pause
  last: null, // never the same word twice in a row (when there are several)
  color: null, // colour of the current word, picked from Config.WORD_COLORS
  x: 0,
  y: 0,
  size: 0,
  start: 0, // millis() when the current word began fading in
  typeTime: 0, // ms the letters take to appear one by one
  hold: 0, // ms fully visible
  nextAt: 0, // millis() when the next word starts
};

// Custom font from src/renderer/fonts/ (Config.WORD_FONT_FILE); falls back to Helvetica until loaded or on error.
const WORD_FALLBACK_FONT = "Helvetica, Arial, sans-serif";
let wordFont = WORD_FALLBACK_FONT;
if (Config.WORD_FONT_FILE) {
  const face = new FontFace("WordFont", `url("fonts/${encodeURIComponent(Config.WORD_FONT_FILE)}")`);
  face
    .load()
    .then((f) => {
      document.fonts.add(f);
      wordFont = "WordFont"; // plain family name: p5 may quote the whole string, so no fallback list here
      invalidate();
    })
    .catch((err) => console.error(`Word font "${Config.WORD_FONT_FILE}" failed to load:`, err));
}

function toRange(value, fallback) {
  if (typeof value === "number" && value >= 0) return { min: value, max: value };
  if (Array.isArray(value) && value.length === 2 && value.every((n) => typeof n === "number" && n >= 0)) {
    return { min: Math.min(...value), max: Math.max(...value) };
  }
  return fallback;
}

function resolveWordOptions(o = {}) {
  const num = (v, fallback) => (typeof v === "number" && v >= 0 ? v : fallback);
  return {
    fade: num(o.fade, Config.WORD_FADE),
    hold: toRange(o.hold, Config.WORD_HOLD),
    gap: toRange(o.gap, Config.WORD_GAP),
    size: num(o.size, Config.WORD_SIZE),
  };
}

function setWords(list, options) {
  Words.opts = resolveWordOptions(options);
  Words.list = Array.isArray(list) ? list : [];
  Words.text = null;
  Words.last = null;
  Words.nextAt = millis() + random(Words.opts.gap.min, Words.opts.gap.max) * 1000;
  invalidate();
}

// Advances the word timeline: starts the next word when its time has come and
// removes the current one once it has faded out. Call once per frame.
function updateWords() {
  if (!Words.list.length) return;
  const now = millis();

  if (Words.text) {
    const end = Words.start + Words.typeTime + Words.hold + Words.opts.fade * 1000;
    if (now >= end) {
      Words.text = null;
      Words.nextAt = now + random(Words.opts.gap.min, Words.opts.gap.max) * 1000;
      invalidate(); // one last redraw without the word
    }
  } else if (now >= Words.nextAt) {
    startWord(now);
  }
}

function startWord(now) {
  const candidates = Words.list.length > 1 ? Words.list.filter((w) => w !== Words.last) : Words.list;
  const text = candidates[Math.floor(random(candidates.length))];

  const colors = Config.WORD_COLORS.length > 1 ? Config.WORD_COLORS.filter((c) => c !== Words.color) : Config.WORD_COLORS;
  const forced = Player.current && getFlags(Player.current.filename).color; // @color flag of the clip on screen
  Words.color = forced || colors[Math.floor(random(colors.length))];
  Words.text = text;
  Words.last = text;
  Words.size = height * Words.opts.size;
  Words.x = width / 2;
  Words.y = height / 2;
  Words.start = now;
  Words.typeTime = text.replace(/\s/g, "").length * Config.WORD_LETTER_DELAY * 1000;
  Words.hold = random(Words.opts.hold.min, Words.opts.hold.max) * 1000;
}

function renderWords() {
  if (!Words.text) return;

  const fade = Words.opts.fade * 1000;
  const t = millis() - Words.start;
  // The whole word fades out at the end; letters appear one after another before that
  const outAlpha = Math.max(0, Math.min(1, (Words.typeTime + Words.hold + fade - t) / fade));
  const letterDelay = Config.WORD_LETTER_DELAY * 1000;
  const letterFade = Math.min(fade, 120);

  push();
  textFont(wordFont);
  textStyle(wordFont === WORD_FALLBACK_FONT && Config.WORD_FONT_WEIGHT === "bold" ? BOLD : NORMAL);
  textAlign(CENTER, CENTER);
  textSize(Words.size);

  // One word per line, capitals; long phrases shrink to stay inside the central square
  const lines = Words.text.toUpperCase().split(/\s+/);
  const maxWidth = Math.min(width, height) * 0.9;
  const w = Math.max(...lines.map((l) => textWidth(l)));
  if (w > maxWidth) textSize((Words.size * maxWidth) / w);
  textLeading(textSize() * Config.WORD_LEADING);

  if (Config.WORD_SHADOW) {
    drawingContext.shadowColor = `rgba(0, 0, 0, ${0.6 * outAlpha})`;
    drawingContext.shadowBlur = Words.size * 0.3;
  }
  noStroke();
  const c = color(Words.color);
  textAlign(LEFT, CENTER);
  const leading = textSize() * Config.WORD_LEADING;
  let index = 0; // running letter number across all lines
  lines.forEach((line, row) => {
    const y = Words.y + (row - (lines.length - 1) / 2) * leading;
    const x0 = Words.x - textWidth(line) / 2;
    for (let i = 0; i < line.length; i++, index++) {
      const a = letterFade > 0 ? Math.max(0, Math.min(1, (t - index * letterDelay) / letterFade)) : t >= index * letterDelay ? 1 : 0;
      if (a <= 0) continue;
      fill(red(c), green(c), blue(c), a * outAlpha * 255);
      text(line[i], x0 + textWidth(line.slice(0, i)), y);
    }
  });
  pop();
}
