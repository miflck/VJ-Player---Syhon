// Wipes: a p5 sketch (same format as the sketches, see sketches.js) that is drawn over the whole output for
// Config.WIPE_TIME seconds, on top of media, words and colours. The sketch should draw on a transparent
// canvas (p.clear()), or simply be an ordinary sketch with its own background, which then shows for that time and use progress() (0 → 1) for its animation: the output should be covered at 0.5, because
// that is when the playlist changes (when the wipe comes with a playlist, see startWipe).
//
//   registerSketch((p, { width, height, progress }) => {
//     p.setup = () => p.createCanvas(width, height);
//     p.draw = () => { p.clear(); p.fill(0); p.rect(0, 0, p.width * Math.sin(progress() * Math.PI), p.height); };
//   });

const Wipe = {
  slot: null, // { media, startedAt, then, changed } while a wipe is running
  token: 0, // bumped for every new wipe; stale loads compare against it
  progress: 0,
};

// Starts a wipe. file: a wipe sketch path (relative to the assets folder); without it a random wipe of this
// player's playlist. playlist: index of a playlist to switch to in the middle of the wipe (optional).
async function startWipe(file = null, playlist = null) {
  const files = wipeFiles();
  file = file || files[Math.floor(random(files.length))];
  if (!file) {
    log("No wipes available");
    if (playlist !== null) gotoPlaylist(playlist); // no wipe, but the change still happens
    return;
  }

  const token = ++Wipe.token;
  endWipe(false);
  try {
    const url = buildMediaUrl(file);
    const factory = await loadSketchFactory(url);
    const instance = await createSketchInstance(factory, url, { progress: () => Wipe.progress });
    if (token !== Wipe.token) {
      instance.remove(); // another wipe started meanwhile
      return;
    }
    Wipe.progress = 0;
    Wipe.slot = { media: instance, startedAt: millis(), then: playlist, changed: false, seconds: getFlags(file).duration ?? Config.WIPE_TIME }; // @4s in the name sets the time
    invalidate();
  } catch (error) {
    console.error(`Wipe "${file}" could not be loaded:`, error);
    if (playlist !== null) gotoPlaylist(playlist);
  }
}

// Removes the running wipe; with `finish`, a pending playlist change that has not happened yet is made now.
function endWipe(finish = true) {
  const slot = Wipe.slot;
  Wipe.slot = null;
  if (!slot) return;
  try {
    slot.media.remove();
  } catch (error) {
    console.warn("Error disposing wipe:", error);
  }
  if (finish && slot.then !== null && !slot.changed) gotoPlaylist(slot.then);
  invalidate();
}

// Called every frame from draw(): advances the wipe and paints it over the canvas.
function renderWipe() {
  const slot = Wipe.slot;
  if (!slot) return;

  Wipe.progress = Math.min(1, (millis() - slot.startedAt) / (slot.seconds * 1000));

  if (!slot.changed && Wipe.progress >= 0.5) {
    slot.changed = true;
    if (slot.then !== null) gotoPlaylist(slot.then); // under cover
  }
  if (Wipe.progress >= 1) return endWipe();

  try {
    slot.media.redraw();
    drawingContext.drawImage(slot.media.canvas, 0, 0, width, height);
  } catch (error) {
    console.error("Wipe failed:", error);
    endWipe();
  }
}
