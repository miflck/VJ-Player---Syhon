// Playlist state: loading playlists.json (via the main process), switching
// between playlists and picking random files.

const Playlist = {
  lists: {}, // { [name]: { files: string[], full: boolean, words: string[] } }
  order: [], // ["Kong", "Space", ...] — cycling order
  index: 0,
  name: "",
  files: [], // media files in the *currently active* playlist
  lastPicked: null, // never picked twice in a row (when the playlist has more than one file)
  full: false, // true → play videos in full, show images indefinitely
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
  const name = Playlist.order[index];
  const list = Playlist.lists[name] || { files: [], full: false };
  Playlist.index = index;
  Playlist.name = name;
  Playlist.files = list.files || [];
  Playlist.full = !!list.full;
  Playlist.lastPicked = null;
  setWords(list.words || []); // the previous playlist's words disappear immediately
  log(`Active playlist: "${name}" (${Playlist.files.length} file(s))${Playlist.full ? " [full playback]" : ""}`);
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

  activatePlaylist((Playlist.index + direction + count) % count);
  restartPlayback();
}

// Jumps straight to the playlist with the given index.
function gotoPlaylist(index) {
  if (!Number.isInteger(index) || index < 0 || index >= Playlist.order.length) return;
  activatePlaylist(index);
  restartPlayback();
}

// Picks one file at random, biased by each file's @w weight flag.
function pickRandomFile() {
  if (Playlist.files.length <= 1) return Playlist.files[0] || null;

  const files = Playlist.files.filter((f) => f !== Playlist.lastPicked);
  const weights = files.map((f) => getFlags(f).weight);
  let r = random(weights.reduce((sum, w) => sum + w, 0));

  let picked = files[files.length - 1]; // floating point fallback
  for (let i = 0; i < files.length; i++) {
    r -= weights[i];
    if (r <= 0) {
      picked = files[i];
      break;
    }
  }

  Playlist.lastPicked = picked;
  return picked;
}

// Full playback = whole video / image or sketch stays until skipped. Set for a
// whole playlist ("full": true) or for single files with an @full filename flag.
function isFullPlayback(filename) {
  return Playlist.full || getFlags(filename).full;
}
