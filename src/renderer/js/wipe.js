// Wipes: a video (.mp4 / .mov) that is played once, from the start, over the whole output (media, words and
// colours), and then stays on its last frame until it is released (see endWipe). The controller's Wipe button
// starts the same random wipe on every player; "W" starts one on this player.
//
// A wipe can also be a p5 sketch (same format as the sketches, see sketches.js): it runs for Config.WIPE_TIME
// seconds (or the @4s of its name) and then disappears. It should draw on a transparent canvas (p.clear()) and
// use progress() (0 → 1) for its animation.
//
// With a playlist (auto-rotate): a video wipe plays, and when it has ended - the screen is covered by its last frame -
// the playlist changes underneath; the wipe is released once the new media is on screen. A sketch wipe changes it
// in its middle (progress 0.5).
//
// A held wipe is also released by picking a playlist (N, X, a playlist button), by → (next media) and by "Wipe off".

const Wipe = {
  slot: null, // { kind, media, seconds, startedAt, then, changed, held, ... } while a wipe is on screen
  token: 0, // bumped for every new wipe; stale loads compare against it
  progress: 0,
  applying: false, // true while the wipe itself changes the playlist (that must not release it)
};

// Starts a wipe. file: a wipe path (relative to the assets folder); without it a random wipe of this player's
// playlist. playlist: index of a playlist to switch to under the wipe (optional).
async function startWipe(file = null, playlist = null) {
  const files = wipeFiles();
  file = file || files[Math.floor(random(files.length))];
  if (!file) {
    log("No wipes available");
    if (playlist !== null) gotoPlaylist(playlist); // no wipe, but the change still happens
    return;
  }

  const token = ++Wipe.token;
  try {
    const slot = getFlags(file).kind === "video" ? await loadVideoWipe(file) : await loadSketchWipe(file);
    if (token !== Wipe.token) {
      disposeWipe(slot); // another wipe started meanwhile
      return;
    }
    endWipe(false); // a wipe that is still on screen (held) stays until the new one can take over
    Wipe.progress = 0;
    Object.assign(slot, { startedAt: millis(), then: playlist, changed: false, held: false });
    Wipe.slot = slot;
    if (slot.kind === "video") slot.media.elt.play().catch((error) => console.warn("Wipe play() failed:", error));
    log(`Wipe: ${file}`);
    invalidate();
  } catch (error) {
    console.error(`Wipe "${file}" could not be loaded:`, error);
    if (playlist !== null) gotoPlaylist(playlist);
  }
}

async function loadSketchWipe(file) {
  const url = buildMediaUrl(file);
  const factory = await loadSketchFactory(url);
  const media = await createSketchInstance(factory, url, { progress: () => Wipe.progress });
  return { kind: "sketch", media, seconds: getFlags(file).duration ?? Config.WIPE_TIME };
}

// Resolves when the video can play through from its start.
function loadVideoWipe(file) {
  return new Promise((resolve, reject) => {
    const video = createVideo(buildMediaUrl(file));
    video.hide();
    video.elt.muted = true;
    video.elt.preload = "auto";
    const slot = { kind: "video", media: video, seconds: 0 };
    const fail = (message) => (clearTimeout(timeout), disposeWipe(slot), reject(new Error(message)));
    const timeout = setTimeout(() => fail("took too long to load"), 10000);
    video.elt.addEventListener(
      "canplaythrough",
      () => {
        clearTimeout(timeout);
        slot.seconds = video.elt.duration || Config.WIPE_TIME;
        resolve(slot);
      },
      { once: true },
    );
    video.elt.addEventListener("error", () => fail("could not load the video"), { once: true });
  });
}

function disposeWipe(slot) {
  try {
    slot.media.remove();
  } catch (error) {
    console.warn("Error disposing wipe:", error);
  }
}

// Removes the running wipe (held or not). With `finish`, a playlist change that has not happened yet is made now.
function endWipe(finish = true) {
  const slot = Wipe.slot;
  Wipe.slot = null;
  if (!slot) return;
  disposeWipe(slot);
  if (finish && slot.then !== null && !slot.changed) changePlaylistUnderWipe(slot.then);
  invalidate();
}

// index -1: stay on the playlist (shuffle all) and go on to another file
function changePlaylistUnderWipe(index) {
  Wipe.applying = true;
  try {
    if (index === -1) advance();
    else gotoPlaylist(index);
  } finally {
    Wipe.applying = false;
  }
}

// A playlist is picked by hand: a held wipe goes (not while the wipe itself is changing the playlist).
function releaseWipe() {
  if (!Wipe.applying && Wipe.slot) endWipe(false);
}

// Called every frame from draw(): advances the wipe and paints it over the canvas.
function renderWipe() {
  const slot = Wipe.slot;
  if (!slot) return;

  const now = millis();
  const elapsed = now - slot.startedAt;
  const el = slot.kind === "video" ? slot.media.elt : null;

  if (!slot.held) {
    if (el) {
      Wipe.progress = el.duration ? Math.min(1, el.currentTime / el.duration) : 0;
      if (el.ended || elapsed > slot.seconds * 1000 + 2000) {
        // the video has ended (or got stuck): it stays on its last frame
        Wipe.progress = 1;
        slot.held = true;
        if (slot.then !== null && !slot.changed) {
          slot.changed = true;
          slot.before = Player.current;
          slot.releaseAfter = now + 400;
          slot.releaseBy = now + 4000;
          changePlaylistUnderWipe(slot.then);
        }
      }
    } else {
      Wipe.progress = Math.min(1, elapsed / (slot.seconds * 1000));
      if (!slot.changed && Wipe.progress >= 0.5) {
        slot.changed = true;
        if (slot.then !== null) changePlaylistUnderWipe(slot.then); // under cover
      }
      if (Wipe.progress >= 1) return endWipe();
    }
  } else if (slot.then !== null && ((now > slot.releaseAfter && Player.current && Player.current !== slot.before) || now > slot.releaseBy)) {
    return endWipe(false); // the new media is on screen
  }

  try {
    if (el) {
      // a video fills the output (cover), like media does
      const d = calculateDrawDimensions(el.videoWidth || width, el.videoHeight || height, "video", "cover", { left: 0, top: 0, width, height });
      drawingContext.drawImage(el, d.x, d.y, d.width, d.height);
    } else {
      slot.media.redraw();
      drawingContext.drawImage(slot.media.canvas, 0, 0, width, height);
    }
  } catch (error) {
    console.error("Wipe failed:", error);
    endWipe(false);
  }
}
