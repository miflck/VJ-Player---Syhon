// Settings panel (HTML, see index.html). Opened with "S" or automatically when no
// assets folder / playlists are found. Chooses the assets folder and whether this
// copy is the remote-control host or a client of another hub.

const byId = (id) => document.getElementById(id);

let remoteMode = "host"; // what the Host/Client buttons currently show

function openSettings() {
  App.showSettings = true;
  byId("settings").hidden = false;
  refreshSettings();
  invalidate();
}

function closeSettings() {
  App.showSettings = false;
  byId("settings").hidden = true;
  if (document.activeElement) document.activeElement.blur(); // so keys go to the player again
  invalidate();
}

function toggleSettings() {
  if (App.showSettings) closeSettings();
  else openSettings();
}

// True while typing in the panel, so player keys (n, x, a, ...) are not triggered.
function isTypingInSettings() {
  const el = document.activeElement;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA");
}

async function refreshSettings() {
  byId("settings-assets").textContent = App.assetsPath || "No folder selected";
  if (!byId("output-width").value) {
    byId("output-width").value = Config.OUTPUT_WIDTH;
    byId("output-height").value = Config.OUTPUT_HEIGHT;
  }

  const info = await window.electronAPI.getRemoteInfo();
  setRemoteMode(info.mode);
  if (document.activeElement !== byId("hub-url")) byId("hub-url").value = info.url || "";
  showRemoteStatus(info);
}

function setRemoteMode(mode) {
  remoteMode = mode;
  byId("mode-host").setAttribute("aria-pressed", String(mode === "host"));
  byId("mode-client").setAttribute("aria-pressed", String(mode === "client"));
  byId("url-row").style.display = mode === "client" ? "" : "none";
  byId("mode-hint").textContent =
    mode === "host"
      ? "This copy runs the hub and the controller page, and plays."
      : "This copy only plays and connects to a hub running somewhere else.";
}

function showRemoteStatus(info) {
  const status = byId("remote-status");
  status.className = "status";

  const off = !info.enabled;
  ["mode-host", "mode-client", "hub-url", "remote-apply"].forEach((id) => (byId(id).disabled = off));
  if (off) {
    status.textContent = 'Remote control is turned off ("enabled": false in config.json).';
    return;
  }

  if (info.mode === "host") {
    if (info.hosting) {
      status.className = "status ok";
      status.textContent = `Hub running. Controller page: ${info.urls.join("   ") || `http://localhost:${info.port}`}`;
    } else {
      status.textContent = info.connected
        ? `Port ${info.port} was taken, so this copy joined the hub already running there.`
        : info.error
          ? `Could not start the hub: ${info.error}`
          : "Starting…";
    }
  } else if (info.connected) {
    status.className = "status ok";
    status.textContent = `Connected to ${info.url}`;
  } else {
    status.textContent = info.url ? `Not connected to ${info.url} (retrying)` : "No hub address set.";
  }
}

async function applyRemoteSettings() {
  const status = byId("remote-status");
  status.className = "status";
  status.textContent = "Applying…";

  const result = await window.electronAPI.setRemoteSettings({ mode: remoteMode, url: byId("hub-url").value });
  if (!result.ok) {
    status.className = "status error";
    status.textContent = result.error;
    return;
  }

  showRemoteStatus(result.info);
  // the connection to a hub is made in the background: look again shortly
  setTimeout(refreshSettings, 1500);
  setTimeout(refreshSettings, 4000);
}

byId("settings-choose").addEventListener("click", () => selectAssetsFolder()); // defined in sketch.js, which loads later
byId("mode-host").addEventListener("click", () => setRemoteMode("host"));
byId("mode-client").addEventListener("click", () => {
  setRemoteMode("client");
  byId("hub-url").focus();
});
byId("remote-apply").addEventListener("click", applyRemoteSettings);
byId("hub-url").addEventListener("keydown", (event) => {
  if (event.key === "Enter") applyRemoteSettings();
});

async function applyOutputSize() {
  const status = byId("output-status");
  const width = Number(byId("output-width").value);
  const height = Number(byId("output-height").value);
  const result = await window.electronAPI.setOutputSize({ width, height });
  status.className = result.ok ? "status ok" : "status error";
  status.textContent = result.ok
    ? width === Config.OUTPUT_WIDTH && height === Config.OUTPUT_HEIGHT
      ? "Saved."
      : `Saved ${width}×${height}. Restart the player to use it.`
    : result.error;
}

byId("output-apply").addEventListener("click", applyOutputSize);

byId("launch-instance").addEventListener("click", async () => {
  const status = byId("launch-status");
  const result = await window.electronAPI.launchInstance();
  status.className = result.ok ? "status ok" : "status error";
  status.textContent = result.ok ? `Started ${result.name}.` : result.error;
});
