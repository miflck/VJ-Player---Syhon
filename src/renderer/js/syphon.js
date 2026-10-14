// Syphon output (macOS): publishes the p5 canvas — exactly what is on screen,
// including circle mask and blackout — as the Syphon server "VJ Player".
// Toggle with "Y". The native side lives in preload.js / native/syphon_addon.mm.

const SyphonOut = {
  enabled: false,
  serverName: "VJ Player",
  stillInterval: 500, // ms; while nothing changes on screen, republish this often so late-joining clients get a frame
  lastPublish: 0,
};

function toggleSyphon() {
  if (SyphonOut.enabled) {
    SyphonOut.enabled = false;
    window.electronAPI.syphonStop();
    console.log("Syphon OFF");
    return;
  }

  if (!window.electronAPI.syphonStart(SyphonOut.serverName)) {
    console.warn("Syphon unavailable (macOS only; build the addon with `npm run build:syphon`)");
    return;
  }
  SyphonOut.enabled = true;
  console.log(`Syphon ON: "${SyphonOut.serverName}"`);
}

// Call at the end of draw(). `redrawn` = the canvas content changed this frame.
function publishSyphon(redrawn) {
  if (!SyphonOut.enabled) return;

  const now = millis();
  if (!redrawn && now - SyphonOut.lastPublish < SyphonOut.stillInterval) return;

  // The expensive part is the canvas readback, so skip it while nobody is connected.
  if (!window.electronAPI.syphonHasClients()) return;

  SyphonOut.lastPublish = now;
  const canvas = drawingContext.canvas;
  const pixels = drawingContext.getImageData(0, 0, canvas.width, canvas.height).data;
  window.electronAPI.syphonPublish(pixels, canvas.width, canvas.height, true);
}
