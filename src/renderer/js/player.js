// Media loading, playback and transitions.
//
// Media is tracked as "slots": { media, filename, kind }, kind = "video" | "image" | "sketch".
//   pending → being preloaded;  next → fully loaded, ready to play;  current → on screen.

const Player = {
  current: null,
  next: null,
  pending: null,
  wantsPromote: false, // promote the next item to current as soon as it is ready
  loadFailures: 0, // consecutive preload failures (caps the retry loop)
  loadToken: 0, // bumped when pending loads are discarded; stale callbacks compare against it
  playToken: 0, // bumped when current media is stopped; stale playback callbacks compare against it
  timer: null,
};

// ============================================================================
// LOADING
// ============================================================================

function preload() {
  if (!Playlist.files.length || Player.pending) return;

  const filename = pickRandomFile();
  const slot = { media: null, filename, kind: getFlags(filename).kind };
  const token = Player.loadToken;

  log(`Preloading: ${filename}`);
  Player.pending = slot;

  if (slot.kind === "video") {
    loadVideo(slot, token);
  } else if (slot.kind === "sketch") {
    loadSketch(slot, token);
  } else {
    loadImage(
      buildMediaUrl(filename),
      (image) => {
        slot.media = image;
        handleLoaded(slot, token);
      },
      (error) => {
        console.error("Image load failed:", error);
        handleLoadFailed(slot, token);
      },
    );
  }
}

async function loadSketch(slot, token) {
  try {
    const url = buildMediaUrl(slot.filename);
    const factory = await loadSketchFactory(url);
    const instance = await createSketchInstance(factory, url);

    if (token !== Player.loadToken) {
      instance.remove(); // discarded while loading
      return;
    }
    slot.media = instance;
    handleLoaded(slot, token);
  } catch (error) {
    console.error(`Sketch "${slot.filename}" could not be loaded:`, error);
    handleLoadFailed(slot, token);
  }
}

function loadVideo(slot, token) {
  const video = createVideo(buildMediaUrl(slot.filename));
  video.hide();
  video.elt.muted = true;
  slot.media = video;

  video.elt.addEventListener("loadedmetadata", () => prepareVideo(slot, token), { once: true });
  video.elt.addEventListener("error", () => handleLoadFailed(slot, token), { once: true });
}

// Decides what part of the video will play and seeks there *before* the video
// becomes `next`, so the first frame is already decoded when the transition
// happens (no black/frozen gap while the browser fetches from the seek point).
async function prepareVideo(slot, token) {
  const video = slot.media;
  const el = video.elt;
  const duration = el.duration;

  if (!Number.isFinite(duration) || duration <= 0) {
    console.error("Video has no usable duration; skipping:", slot.filename);
    handleLoadFailed(slot, token);
    return;
  }

  // Playlist marked "full" → whole video from 0 to its natural end.
  // Otherwise a random segment; if the segment is longer than the video, loop it.
  let start = 0;
  let segment = duration;
  let loop = false;

  if (!isFullPlayback(slot.filename)) {
    segment = getFlags(slot.filename).duration ?? random(Config.VIDEO_SEGMENT_TIME.min, Config.VIDEO_SEGMENT_TIME.max);
    loop = segment > duration;
    start = loop ? 0 : random(0, duration - segment);
  }

  log(`Video: duration=${duration.toFixed(2)}s start=${start.toFixed(2)}s segment=${segment.toFixed(2)}s loop=${loop}`);

  video.volume(Config.VIDEO_VOLUME);
  el.loop = loop;
  slot.segment = segment;

  await seekTo(el, start);
  handleLoaded(slot, token);
}

// `next` only ever holds media that is fully loaded and ready to play.
function handleLoaded(slot, token) {
  if (token !== Player.loadToken) return; // discarded while loading

  log("Media loaded:", slot.filename);
  Player.pending = null;
  Player.loadFailures = 0;
  Player.next = slot;

  if (Player.wantsPromote) advance();
}

// A preload failed (bad file, decode error...). Free the loading slot and try
// another random file, giving up after a few consecutive failures.
function handleLoadFailed(slot, token) {
  if (token !== Player.loadToken) return; // discarded, already cleaned up

  disposeMedia(slot);
  Player.pending = null;

  if (++Player.loadFailures > Config.PRELOAD_RETRY_LIMIT) {
    console.error("Too many consecutive preload failures; giving up until the next user action.");
    return;
  }

  setTimeout(() => {
    if (token === Player.loadToken) preload();
  }, Config.PRELOAD_RETRY_DELAY);
}

function disposeMedia(slot) {
  if (!slot || slot.kind === "image" || !slot.media) return; // images need no cleanup
  try {
    slot.media.remove(); // video: detaches the element; sketch: removes the p5 instance
  } catch (error) {
    console.warn("Error disposing media:", error);
  }
}

// Throws away everything loaded or loading for the previous playlist and
// starts playing from the (new) active playlist. Bumping loadToken turns
// callbacks of in-flight loads into no-ops.
function restartPlayback() {
  Player.loadToken++;
  disposeMedia(Player.pending);
  disposeMedia(Player.next);
  Player.pending = null;
  Player.next = null;
  Player.loadFailures = 0;
  clearTimer();

  Player.wantsPromote = true;
  preload();
}

// ============================================================================
// TRANSITIONS
// ============================================================================

// Promotes the preloaded item to current and starts preloading the one after.
// If nothing is ready yet, remembers the request and promotes on load.
function advance() {
  if (!Player.next) {
    log("Next media not ready; promoting it as soon as it has loaded");
    Player.wantsPromote = true;
    Player.loadFailures = 0; // user action → allow retries again
    preload();
    return;
  }

  Player.wantsPromote = false;
  stopCurrent();

  Player.current = Player.next;
  Player.next = null;

  if (Player.current.kind === "video") {
    playVideo(Player.current);
  } else if (!isFullPlayback(Player.current.filename)) {
    // Images and sketches. "full" playlists show them indefinitely; the user has to move on manually.
    const flagged = getFlags(Player.current.filename).duration;
    scheduleAdvance(flagged ?? random(Config.IMAGE_DISPLAY_TIME.min, Config.IMAGE_DISPLAY_TIME.max));
  }

  preload();
  invalidate();
}

function stopCurrent() {
  Player.playToken++; // invalidates callbacks belonging to the media being stopped
  clearTimer();

  disposeMedia(Player.current);
  Player.current = null;
}

function scheduleAdvance(seconds) {
  clearTimer();
  log(`Advancing in ${seconds.toFixed(1)}s`);
  Player.timer = setTimeout(advance, seconds * 1000);
}

function clearTimer() {
  clearTimeout(Player.timer);
  Player.timer = null;
}

// ============================================================================
// VIDEO PLAYBACK
// ============================================================================

// The video was already seeked to its start point while preloading (prepareVideo).
function playVideo(slot) {
  const token = Player.playToken;
  const el = slot.media.elt;

  el.addEventListener(
    "error",
    () => {
      if (token === Player.playToken) advance();
    },
    { once: true },
  );

  el.play().catch((error) => console.warn("play() failed:", error));
  scheduleAdvance(slot.segment);
}

// Resolves once the seek has completed (or after a 2s safety timeout).
function seekTo(el, time) {
  if (Math.abs(el.currentTime - time) < 0.01) return Promise.resolve();

  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timeout);
      el.removeEventListener("seeked", done);
      resolve();
    };
    const timeout = setTimeout(done, 2000);
    el.addEventListener("seeked", done);
    el.currentTime = time;
  });
}
