// Remote control. The socket.io connection lives in the main process; this page
// receives commands from it and reports its state back.
//
// A command is { key: "n" } (same as pressing that key) or { playlist: 2 }.

const REMOTE_KEYS = new Set(["n", "x", "arrowright", "a", "b", "c", "d", "m", "l", "f", "y", "r"]); // never e, s, escape, backspace

let lastRemoteState = "";
const RemotePeers = new Set(); // files the other players show or have ready (from the hub); empty without a hub


function initRemote() {
  if (!window.electronAPI.onRemoteCommand) return;

  window.electronAPI.onRemoteCommand(handleRemoteCommand);
  window.electronAPI.onRemotePeers((files) => {
    RemotePeers.clear();
    if (Array.isArray(files)) files.forEach((f) => typeof f === "string" && RemotePeers.add(f));
  });
  setInterval(publishRemoteState, 1000);
}

function handleRemoteCommand(command) {
  if (!command) return;

  if (typeof command.key === "string" && REMOTE_KEYS.has(command.key)) {
    KEY_ACTIONS[command.key]();
  } else if (Number.isInteger(command.playlist)) {
    gotoPlaylist(command.playlist);
  } else {
    return;
  }
  invalidate();
  publishRemoteState(); // so controllers see the effect without waiting for the next tick
}

// Sends the state to the hub, only when it changed.
function publishRemoteState() {
  const state = JSON.stringify({
    playlists: Playlist.order,
    playlist: Playlist.index,
    shuffleAll: Playlist.shuffleAll,
    file: Player.current ? Player.current.filename : null,
    next: Player.next ? Player.next.filename : null,
    kind: Player.current ? Player.current.kind : null,
    blackout: App.isBlackedOut,
    colorFill: !!App.colorFill,
    randomColors: App.randomColors,
    randomBlackouts: App.randomBlackouts,
    mask: App.isMasked,
    syphon: SyphonOut.enabled,
  });
  if (state === lastRemoteState) return;

  lastRemoteState = state;
  window.electronAPI.sendRemoteState(JSON.parse(state));
}
