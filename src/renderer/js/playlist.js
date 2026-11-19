// Playlist state: loading playlists.json (via the main process), switching
// between playlists and picking random files.

const Playlist = {
  lists: {}, // { [name]: { files: string[], full: boolean, words: string[], wordOptions: object } }
  order: [], // ["Kong", "Space", ...] — cycling order
  index: 0,
  name: "",
  files: [], // media files in the *currently active* playlist
  texts: {}, // contents of the text pages (.txt files) in the active playlist, by file path
  bag: [], // files still to come in the current random round, see refillBag
  lastPicked: null, // never picked twice in a row (when the playlist has more than one file)
  full: false, // true → play videos in full, show images indefinitely
  explicitFull: false, // "full": true was written in playlists.json (a sequential playlist is full for videos only)
  sequential: false, // true → files play one after another in name order (implies full)
  seqIndex: 0, // next file to play when sequential
  hold: false, // true → sequential, but each video stops on its last frame until next is called
  shuffleAll: false, // true → one random pool made of the files of every playlist (see activateShuffleAll)
  timing: null, // { images, videos } [min, max] of the active playlist, or null (see timeRange)
  scene: false, // true → the active playlist is a scene (see syncScene)
  fullFiles: new Set(), // files that belong to a "full" playlist (only used while shuffleAll is on)
};

// Files with @left / @right in their name only play on that side (see playerSide in main.js). Files without the tag
// play on both; a player that does not know its side plays everything.
function playsHere(file) {
  const side = App.side;
  const tag = (file.match(/@(left|right)\b/i) || [])[1];
  return !side || !tag || tag.toLowerCase() === side;
}

// Fetches playlists.json. Returns false (and opens settings) if there are none.
async function loadPlaylists() {
  const data = await window.electronAPI.getMediaFiles();
  Playlist.lists = (data && data.playlists) || {};
  Playlist.order = (data && data.order) || [];

  log(`Loaded ${Playlist.order.length} playlist(s):`, Playlist.order);

  if (Playlist.order.length === 0) {
    console.warn("No playlists found. Check playlists.json in your assets folder.");
    Playlist.files = [];
    Playlist.name = "";
    setWords([]);
    openSettings();
    return false;
  }
  return true;
}

// Points Playlist.files at the playlist for the given index (no playback change).
function activatePlaylist(index) {
  if (Playlist.shuffleAll) return activateShuffleAll(index);
  const name = Playlist.order[index];
  const list = Playlist.lists[name] || { files: [], full: false };
  Playlist.index = index;
  Playlist.name = name;
  Playlist.files = (list.files || []).filter(playsHere);
  Playlist.texts = list.texts || {};
  Playlist.fullFiles = new Set();
  Playlist.scene = !!list.scene;
  Playlist.timing = list.timing || null;
  Playlist.hold = !!list.hold || App.manual; // manual mode: every playlist is a hold playlist
  Playlist.sequential = !!list.sequential || Playlist.hold;
  Playlist.full = !!list.full || Playlist.sequential;
  Playlist.explicitFull = !!list.full;
  Playlist.seqIndex = 0;
  if (Playlist.sequential) Playlist.files = [...Playlist.files].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  Playlist.lastPicked = null;
  Playlist.bag = [];
  setWords(list.words || [], list.wordOptions); // the previous playlist's words disappear immediately
  log(`Active playlist: "${name}" (${Playlist.files.length} file(s))${Playlist.full ? " [full playback]" : ""}`);
}

// "Shuffle all": the files, texts and words of every playlist form one pool that is played in random
// order. Files of "full" playlists keep playing in full; sequential / hold are ignored.
function activateShuffleAll(index) {
  const lists = randomIndices().map((i) => Playlist.lists[Playlist.order[i]] || {});
  Playlist.index = index;
  Playlist.name = "Shuffle all";
  Playlist.files = [...new Set(lists.flatMap((l) => l.files || []))].filter(playsHere);
  Playlist.texts = Object.assign({}, ...lists.map((l) => l.texts || {}));
  Playlist.fullFiles = new Set(lists.filter((l) => l.full || l.sequential || l.hold).flatMap((l) => l.files || []));
  Playlist.scene = false;
  Playlist.timing = null; // per-playlist timing does not apply to the mixed pool
  Playlist.hold = false;
  Playlist.sequential = false;
  Playlist.full = false;
  Playlist.explicitFull = false;
  Playlist.seqIndex = 0;
  Playlist.lastPicked = null;
  Playlist.bag = [];
  setWords(lists.flatMap((l) => l.words || []));
  log(`Active playlist: shuffle all (${Playlist.files.length} file(s) from ${lists.length} playlist(s))`);
}

// "T": manual mode. Everything is sequential: every playlist plays its files in name order, nothing moves on by
// itself (pictures stay, videos stop on their last frame, text pages stay) and the random effects are off
// (shuffle all, random blackouts, random colours, flat colour). Next media / Next playlist click through.
// The effects are remembered and put back when manual mode is left.
function toggleManual() {
  App.manual = !App.manual;
  if (App.manual) {
    App.savedManual = { shuffleAll: Playlist.shuffleAll, randomColors: App.randomColors, randomBlackouts: App.randomBlackouts, colorFill: !!App.colorFill };
    Playlist.shuffleAll = false;
    if (App.randomColors) toggleRandomColors();
    if (App.randomBlackouts) toggleRandomBlackouts();
    if (App.colorFill) toggleColorFill();
  } else if (App.savedManual) {
    const saved = App.savedManual;
    App.savedManual = null;
    Playlist.shuffleAll = saved.shuffleAll && !(Playlist.scene);
    if (saved.randomColors !== App.randomColors) toggleRandomColors();
    if (saved.randomBlackouts !== App.randomBlackouts) toggleRandomBlackouts();
    if (saved.colorFill !== !!App.colorFill) toggleColorFill();
  }
  releaseWipe();
  activatePlaylist(Playlist.index);
  syncScene();
  restartPlayback();
}

// Indices of the playlists with "includeInAutoplay": true in playlists.json. This is the list used by auto-rotate,
// "shuffle all" and "random spread".
function autoplayIndices() {
  return Playlist.order.map((name, i) => (Playlist.lists[name] && Playlist.lists[name].includeInAutoplay ? i : -1)).filter((i) => i >= 0);
}

// Playlists that take part in "shuffle all" and "random spread": the autoplay list. If no playlist has the flag
// (yet), every playlist except those with "excludeFromRandom": true, so the buttons keep working.
function randomIndices() {
  const flagged = autoplayIndices();
  if (flagged.length) return flagged;
  const all = Playlist.order.map((_, i) => i);
  const picked = all.filter((i) => (Playlist.lists[Playlist.order[i]] || {}).excludeFromRandom !== true);
  return picked.length ? picked : all;
}

// "R": shuffle all on / off. Off returns to the playlist that was selected before.
function toggleShuffleAll() {
  if (!Playlist.order.length || App.manual) return; // not in manual mode
  releaseWipe();
  Playlist.shuffleAll = !Playlist.shuffleAll;
  activatePlaylist(Playlist.index);
  restartPlayback();
}

async function startPlaylists() {
  if (!(await loadPlaylists())) return;
  activatePlaylist(0);
  syncScene();
  restartPlayback();
}

// Re-reads playlists.json, staying on the same playlist by name if it still exists.
async function reloadPlaylists() {
  const previousName = Playlist.name;
  if (!(await loadPlaylists())) return;

  const sameIndex = Playlist.order.indexOf(previousName);
  activatePlaylist(sameIndex >= 0 ? sameIndex : 0);
  syncScene();
  restartPlayback();
}

// Cycles to the next (direction=1) or previous (direction=-1) playlist and jumps straight into playing it.
// Only the playlists of the autoplay list take part (randomIndices: "includeInAutoplay": true); from a playlist that
// is not in it, the first (or last) of them comes. Playlists picked by hand (buttons) are not limited.
function switchPlaylist(direction) {
  if (Playlist.order.length === 0) return;
  const pool = randomIndices();

  releaseWipe();
  Playlist.shuffleAll = false; // picking a playlist leaves shuffle all
  const next =
    direction > 0
      ? pool.find((i) => i > Playlist.index) ?? pool[0]
      : [...pool].reverse().find((i) => i < Playlist.index) ?? pool[pool.length - 1];
  activatePlaylist(next);
  syncScene();
  restartPlayback();
}

// Jumps straight to the playlist with the given index. For a scene playlist this is the same
// as the scene button: clicking the active scene again leaves the scene (see syncScene).
function gotoPlaylist(index) {
  if (!Number.isInteger(index) || index < 0 || index >= Playlist.order.length) return;
  releaseWipe();
  if (App.scene === index && Playlist.index === index) return leaveScene();
  Playlist.shuffleAll = false; // picking a playlist leaves shuffle all
  activatePlaylist(index);
  syncScene();
  restartPlayback();
}

// Seconds a picture or a video segment lasts: the playlist's own "images" / "videos" time if it has one,
// otherwise the setting (Config). kind is "images" or "videos". Returns a random value in [min, max].
function timeRange(kind) {
  const own = Playlist.timing && Playlist.timing[kind];
  const range = own ? { min: own[0], max: own[1] } : kind === "images" ? Config.IMAGE_DISPLAY_TIME : Config.VIDEO_SEGMENT_TIME;
  return random(range.min, range.max);
}

// The longest time of a picture: the max of the playlist's "images" time, or of the setting (Config).
function maxImageTime() {
  const own = Playlist.timing && Playlist.timing.images;
  return own ? own[1] : Config.IMAGE_DISPLAY_TIME.max;
}

// Does a picture or sketch go on by itself after its time? Not in "hold" and "full" playlists and not with @full.
// A "sequential" playlist does (it plays in order and shows each picture for the longest picture time).
function imageAdvancesByItself(filename) {
  if (getFlags(filename).full || Playlist.fullFiles.has(filename)) return false;
  return !(Playlist.hold || Playlist.explicitFull);
}

// Indices of the playlists marked "scene": true in playlists.json (for the controller's scene list).
function sceneIndices() {
  return Playlist.order.map((name, i) => (Playlist.lists[name] && Playlist.lists[name].scene ? i : -1)).filter((i) => i >= 0);
}

// Scenes: a playlist with "scene": true switches the random effects off (random colours, random
// blackouts, flat colour) while it is the active playlist, so only the sketch/media shows. The
// effects each player had are remembered and put back when the scene is left — by clicking the
// scene again, or by moving to a playlist that is not a scene.
function syncScene() {
  if (Playlist.scene && !Playlist.shuffleAll) enterScene(Playlist.index);
  else if (App.scene !== null) leaveScene();
}

function enterScene(index) {
  if (App.scene === null) {
    App.savedEffects = { randomColors: App.randomColors, randomBlackouts: App.randomBlackouts, colorFill: !!App.colorFill };
  }
  App.scene = index;
  if (App.randomColors) toggleRandomColors();
  if (App.randomBlackouts) toggleRandomBlackouts();
  if (App.colorFill) toggleColorFill();
}

// Puts the remembered effects back. The player stays on the playlist.
function leaveScene() {
  const saved = App.savedEffects;
  App.scene = null;
  App.savedEffects = null;
  if (!saved) return;
  if (saved.randomColors !== App.randomColors) toggleRandomColors();
  if (saved.randomBlackouts !== App.randomBlackouts) toggleRandomBlackouts();
  if (saved.colorFill !== !!App.colorFill) toggleColorFill();
}

// The wipes (transition sketches) of the active playlist; a playlist without any (and "shuffle all")
// uses those of every playlist.
function wipeFiles() {
  const own = Playlist.shuffleAll ? [] : (Playlist.lists[Playlist.name] || {}).wipes || [];
  if (own.length) return own;
  return [...new Set(Object.values(Playlist.lists).flatMap((l) => l.wipes || []))];
}

// Picks one file at random, biased by each file's @w weight flag.
function pickRandomFile() {
  if (Playlist.sequential && Playlist.files.length) {
    const file = Playlist.files[Playlist.seqIndex % Playlist.files.length];
    Playlist.seqIndex = (Playlist.seqIndex + 1) % Playlist.files.length;
    return file;
  }
  if (Playlist.files.length <= 1) return Playlist.files[0] || null;

  if (!Playlist.bag.length) Playlist.bag = refillBag();
  // Take the next file of the round that no other player is showing; if they all are, just the next one
  let at = Playlist.bag.length - 1;
  while (at > 0 && RemotePeers.has(Playlist.bag[at])) at--;
  if (RemotePeers.has(Playlist.bag[at])) at = Playlist.bag.length - 1;
  const [picked] = Playlist.bag.splice(at, 1);
  Playlist.lastPicked = picked;
  return picked;
}

// A shuffled round: every file once before any file comes again. A file's @w weight is the
// number of copies in the round (@w3 = 3 times per round, @w0.2 = in one round out of five).
// The first file is never the one that was picked last.
function refillBag() {
  const bag = [];
  for (const file of Playlist.files) {
    const weight = getFlags(file).weight;
    const copies = Math.floor(weight) + (random() < weight - Math.floor(weight) ? 1 : 0);
    for (let i = 0; i < copies; i++) bag.push(file);
  }
  if (!bag.length) bag.push(random(Playlist.files));

  // Draw the round in random order, never the same file twice in a row (also across rounds),
  // unless only copies of one file are left. Playback takes from the end of the array.
  const order = [];
  let previous = Playlist.lastPicked;
  while (bag.length) {
    const options = bag.filter((f) => f !== previous);
    const file = random(options.length ? options : bag);
    bag.splice(bag.indexOf(file), 1);
    order.push(file);
    previous = file;
  }
  return order.reverse();
}

// Full playback = whole video / image or sketch stays until skipped. Set for a
// whole playlist ("full": true) or for single files with an @full filename flag.
function isFullPlayback(filename) {
  return Playlist.full || Playlist.fullFiles.has(filename) || getFlags(filename).full;
}
