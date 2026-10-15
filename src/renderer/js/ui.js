// Rendering: media on the canvas and the settings screen.

function renderMedia(slot) {
  const media = slot.media;
  const mediaWidth = (slot.kind === "video" ? media.elt.videoWidth : media.width) || width;
  const mediaHeight = (slot.kind === "video" ? media.elt.videoHeight : media.height) || height;

  // Masked: media is sized against the circle's bounding square (side = height).
  const bounds = App.isMasked
    ? { left: (width - height) / 2, top: 0, width: height, height }
    : { left: 0, top: 0, width, height };

  const fit = getFlags(slot.filename).fit;
  const draw = calculateDrawDimensions(mediaWidth, mediaHeight, slot.kind, fit, bounds);

  if (!App.isMasked) {
    drawMedia(slot, draw);
    return;
  }

  drawingContext.save();
  drawingContext.beginPath();
  drawingContext.arc(width / 2, height / 2, height / 2, 0, TWO_PI);
  drawingContext.clip();
  drawMedia(slot, draw);
  drawingContext.restore();
}

function drawMedia(slot, d) {
  if (slot.kind === "sketch") {
    drawingContext.drawImage(slot.media.canvas, d.x, d.y, d.width, d.height); // the sketch's off-screen canvas
  } else {
    image(slot.media, d.x, d.y, d.width, d.height);
  }
}

// "contain" fits the whole media inside the bounds (letterbox); "cover" fills
// the bounds and crops the overflow. Images (not videos or sketches) get a slight extra zoom when covering.
function calculateDrawDimensions(mediaWidth, mediaHeight, kind, fit, bounds) {
  const mediaIsWider = mediaWidth / mediaHeight > bounds.width / bounds.height;
  const matchWidth = (fit === "contain") === mediaIsWider;

  let scale = matchWidth ? bounds.width / mediaWidth : bounds.height / mediaHeight;
  if (fit === "cover" && kind === "image") scale *= Config.IMAGE_ZOOM_FACTOR;

  const drawWidth = mediaWidth * scale;
  const drawHeight = mediaHeight * scale;

  return {
    x: bounds.left + (bounds.width - drawWidth) / 2,
    y: bounds.top + (bounds.height - drawHeight) / 2,
    width: drawWidth,
    height: drawHeight,
  };
}

// Single source of truth for the button, used by both drawing and hit-testing.
function settingsButtonRect() {
  return { x: width / 2 - 150, y: height / 2 + 40, w: 300, h: 50 };
}

function renderSettingsScreen() {
  fill(30);
  rect(0, 0, width, height);

  fill(255);
  textAlign(CENTER, CENTER);
  textSize(32);
  text("Media Player Settings", width / 2, height / 2 - 100);

  textSize(20);
  if (App.assetsPath) {
    text("Current folder:", width / 2, height / 2 - 40);
    textSize(16);
    fill(150);
    text(App.assetsPath, width / 2, height / 2 - 10);
  } else {
    text("No assets folder selected", width / 2, height / 2 - 20);
  }

  const button = settingsButtonRect();
  fill(80);
  rect(button.x, button.y, button.w, button.h, 5);

  fill(255);
  textSize(18);
  text("Select Assets Folder", width / 2, button.y + button.h / 2);

  textSize(14);
  fill(180);
  text("Press 'S' or click the button to choose a folder", width / 2, height / 2 + 120);
  text("Playlists are defined in playlists.json inside that folder", width / 2, height / 2 + 145);
  text("'N' / 'X' next/previous playlist · 'L' reload · 'E' edit playlists.json", width / 2, height / 2 + 170);
  text("'A' blackout · 'M' circle mask · 'F' fullscreen · 'Y' Syphon · → skip", width / 2, height / 2 + 195);
  text("Press 'ESC' to close settings (ESC again quits the app)", width / 2, height / 2 + 220);

  if (App.remoteUrls.length) {
    fill(150);
    text(`Remote control: ${App.remoteUrls.join("   ")}`, width / 2, height / 2 + 250);
  }
}
