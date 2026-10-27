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
  sequential: false, // true → files play one after another in name order (implies full)
  seqIndex: 0, // next file to play when sequential
  hold: false, // true → sequential, but each video stops on its last frame until next is called
  shuffleAll: false, // true → one random pool made of the files of every playlist (see activateShuffleAll)
  fullFiles: new Set(), // files that belong to a "full" playlist (only used while shuffleAll is on)
};

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
  Playlist.files = list.files || [];
  Playlist.texts = list.texts || {};
  Playlist.fullFiles = new Set();
  Playlist.hold = !!list.hold;
  Playlist.sequential = !!list.sequential || Playlist.hold;
  Playlist.full = !!list.full || Playlist.sequential;
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
  const lists = Playlist.order.map((name) => Playlist.lists[name] || {});
  Playlist.index = index;
  Playlist.name = "Shuffle all";
  Playlist.files = [...new Set(lists.flatMap((l) => l.files || []))];
  Playlist.texts = Object.assign({}, ...lists.map((l) => l.texts || {}));
  Playlist.fullFiles = new Set(lists.filter((l) => l.full || l.sequential || l.hold).flatMap((l) => l.files || []));
  Playlist.hold = false;
  Playlist.sequential = false;
  Playlist.full = false;
  Playlist.seqIndex = 0;
  Playlist.lastPicked = null;
  Playlist.bag = [];
  setWords(lists.flatMap((l) => l.words || []));
  log(`Active playlist: shuffle all (${Playlist.files.length} file(s) from ${lists.length} playlist(s))`);
}

// "R": shuffle all on / off. Off returns to the playlist that was selected before.
function toggleShuffleAll() {
  if (!Playlist.order.length) return;
  Playlist.shuffleAll = !Playlist.shuffleAll;
  activatePlaylist(Playlist.index);
  restartPlayback();
}

async function startPlaylists() {
  if (!(await loadPlaylists())) return;
  activatePlaylist(0);
  restartPlayback();
}

// Re-reads playlists.json, staying on the same playlist by name if it still exists.
async function reloadPlaylists() {
  const previousName = Playlist.name;
  if (!(await loadPlaylists())) return;

  const sameIndex = Playlist.order.indexOf(previousName);
  activatePlaylist(sameIndex >= 0 ? sameIndex : 0);
  restartPlayback();
}

// Cycles to the next (direction=1) or previous (direction=-1) playlist and
// jumps straight into playing it.
function switchPlaylist(direction) {
  const count = Playlist.order.length;
  if (count === 0) return;

  Playlist.shuffleAll = false; // picking a playlist leaves shuffle all
  activatePlaylist((Playlist.index + direction + count) % count);
  restartPlayback();
}

// Jumps straight to the playlist with the given index.
function gotoPlaylist(index) {
  if (!Number.isInteger(index) || index < 0 || index >= Playlist.order.length) return;
  Playlist.shuffleAll = false; // picking a playlist leaves shuffle all
  activatePlaylist(index);
  restartPlayback();
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
