// Text pages: a .txt file in a playlist folder is shown as long text, left-aligned
// ragged-right over the whole canvas, on a coloured background. Text taller than the
// canvas scrolls slowly (Config.TEXT_SCROLL_*) and is shown to its end before the
// next file comes; shorter text stays for Config.TEXT_DISPLAY_TIME (or @15s in the file name).
// Font size, colours and margins are in Config (TEXT_*), the font is the word layer's.

let lastTextBackground = null;

function loadText(slot, token) {
  const text = (Playlist.texts[slot.filename] || "").replace(/\s+$/, "");
  if (!text) {
    console.warn(`Text file "${slot.filename}" is empty or could not be read`);
    handleLoadFailed(slot, token);
    return;
  }

  const forced = getFlags(slot.filename).bg;
  const colors = Config.TEXT_BACKGROUNDS.length > 1 ? Config.TEXT_BACKGROUNDS.filter((c) => c !== lastTextBackground) : Config.TEXT_BACKGROUNDS;
  slot.text = text;
  slot.background = forced || colors[Math.floor(random(colors.length))];
  lastTextBackground = slot.background;
  const flagged = getFlags(slot.filename).duration;
  slot.hold = (flagged ?? random(Config.TEXT_DISPLAY_TIME.min, Config.TEXT_DISPLAY_TIME.max)) * 1000; // only used when nothing scrolls
  slot.media = {}; // nothing to dispose
  handleLoaded(slot, token);
}

// Word-wraps the text into lines and works out how long the page stays. Cached until the
// font or the area changes.
function layoutText(slot, bounds) {
  const key = `${wordFont}|${bounds.width}|${bounds.height}`;
  if (slot.layout && slot.layout.key === key) return slot.layout;

  const size = bounds.height * Config.TEXT_SIZE;
  const margin = bounds.height * Config.TEXT_MARGIN;
  const maxWidth = bounds.width - 2 * margin;
  const lines = [];

  push();
  textFont(wordFont);
  textStyle(wordFont === WORD_FALLBACK_FONT && Config.WORD_FONT_WEIGHT === "bold" ? BOLD : NORMAL);
  textSize(size);
  for (const paragraph of slot.text.split(/\r?\n/)) {
    if (!paragraph.trim()) {
      lines.push(""); // blank line stays blank
      continue;
    }
    let line = "";
    for (const word of paragraph.trim().split(/\s+/)) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && textWidth(candidate) > maxWidth) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    lines.push(line);
  }
  pop();

  const leading = size * Config.TEXT_LEADING;
  const distance = Math.max(0, lines.length * leading + 2 * margin - bounds.height); // how far the text has to move up
  const pause = Config.TEXT_SCROLL_PAUSE * 1000;
  const speed = bounds.height * Config.TEXT_SCROLL_SPEED; // pixels per second

  slot.layout = {
    key,
    lines,
    size,
    leading,
    margin,
    distance,
    pause,
    speed,
    duration: distance > 0 ? pause + (distance / speed) * 1000 + pause : slot.hold,
  };
  return slot.layout;
}

// Moves on once the page has been shown completely. Call once per frame.
function updateText() {
  const slot = Player.current;
  if (!slot || slot.kind !== "text" || slot.finished) return;

  const layout = layoutText(slot, outputBounds());
  if (millis() - slot.startedAt >= layout.duration) {
    slot.finished = true; // advance() may have to wait for the next file; don't ask twice
    advance();
  }
}

function drawText(slot, bounds) {
  const layout = layoutText(slot, bounds);
  const elapsed = millis() - slot.startedAt;
  const scrolled = layout.distance > 0 ? Math.max(0, Math.min(layout.distance, ((elapsed - layout.pause) / 1000) * layout.speed)) : 0;

  push();
  noStroke();
  fill(slot.background);
  rect(bounds.left, bounds.top, bounds.width, bounds.height);

  drawingContext.save();
  drawingContext.beginPath();
  drawingContext.rect(bounds.left, bounds.top, bounds.width, bounds.height);
  drawingContext.clip();

  textFont(wordFont);
  textStyle(wordFont === WORD_FALLBACK_FONT && Config.WORD_FONT_WEIGHT === "bold" ? BOLD : NORMAL);
  textSize(layout.size);
  textAlign(LEFT, TOP);
  fill(Config.TEXT_COLOR);

  const x = bounds.left + layout.margin;
  layout.lines.forEach((line, i) => {
    const y = bounds.top + layout.margin + i * layout.leading - scrolled;
    if (line && y + layout.leading > bounds.top && y < bounds.top + bounds.height) text(line, x, y);
  });

  drawingContext.restore();
  pop();
}
