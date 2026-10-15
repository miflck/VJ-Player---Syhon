// Word layer: the words of a playlist's word list ("words.txt" or "*.words.txt"
// in its folder) appear one at a time, centred, over the media, fade in and out, and
// follow their own random timeline, independent of the clips underneath.
// Drawn into the main canvas, so blackout and Syphon apply; the circle mask does not.
// setWords() is called whenever a playlist is activated, so switching playlists
// removes the old words at once.

const Words = {
  list: [],
  text: null, // the word currently on screen (or fading), null during a pause
  last: null, // never the same word twice in a row (when there are several)
  x: 0,
  y: 0,
  size: 0,
  start: 0, // millis() when the current word began fading in
  hold: 0, // ms fully visible
  nextAt: 0, // millis() when the next word starts
};

function setWords(list) {
  Words.list = Array.isArray(list) ? list : [];
  Words.text = null;
  Words.last = null;
  Words.nextAt = millis() + random(Config.WORD_GAP.min, Config.WORD_GAP.max) * 1000;
  invalidate();
}

// Advances the word timeline: starts the next word when its time has come and
// removes the current one once it has faded out. Call once per frame.
function updateWords() {
  if (!Words.list.length) return;
  const now = millis();

  if (Words.text) {
    const end = Words.start + Config.WORD_FADE * 2000 + Words.hold;
    if (now >= end) {
      Words.text = null;
      Words.nextAt = now + random(Config.WORD_GAP.min, Config.WORD_GAP.max) * 1000;
      invalidate(); // one last redraw without the word
    }
  } else if (now >= Words.nextAt) {
    startWord(now);
  }
}

function startWord(now) {
  const candidates = Words.list.length > 1 ? Words.list.filter((w) => w !== Words.last) : Words.list;
  const text = candidates[Math.floor(random(candidates.length))];

  Words.text = text;
  Words.last = text;
  Words.size = height * Config.WORD_SIZE;
  Words.x = width / 2;
  Words.y = height / 2;
  Words.start = now;
  Words.hold = random(Config.WORD_HOLD.min, Config.WORD_HOLD.max) * 1000;
}

function renderWords() {
  if (!Words.text) return;

  const fade = Config.WORD_FADE * 1000;
  const t = millis() - Words.start;
  const alpha = Math.max(0, Math.min(1, t / fade, (fade * 2 + Words.hold - t) / fade));

  push();
  textFont("Helvetica, Arial, sans-serif");
  textStyle(BOLD);
  textAlign(CENTER, CENTER);
  textSize(Words.size);

  // Long phrases shrink to stay inside the central square
  const maxWidth = Math.min(width, height) * 0.9;
  const w = textWidth(Words.text);
  if (w > maxWidth) textSize((Words.size * maxWidth) / w);

  drawingContext.shadowColor = `rgba(0, 0, 0, ${0.6 * alpha})`;
  drawingContext.shadowBlur = Words.size * 0.3;
  noStroke();
  fill(255, alpha * 255);
  text(Words.text, Words.x, Words.y);
  pop();
}
