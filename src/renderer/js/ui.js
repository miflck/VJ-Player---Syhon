// Rendering: media on the canvas (the settings screen is HTML, see settings.js).

// The area media is drawn into: the whole canvas, or the circle's bounding square when masked.
function outputBounds() {
  const diameter = Math.min(width, height);
  return App.isMasked
    ? { left: (width - diameter) / 2, top: (height - diameter) / 2, width: diameter, height: diameter }
    : { left: 0, top: 0, width, height };
}

function renderMedia(slot) {
  const bounds = outputBounds();
  let draw;
  if (slot.kind !== "text") {
    const media = slot.media;
    const mediaWidth = (slot.kind === "video" ? media.elt.videoWidth : media.width) || width;
    const mediaHeight = (slot.kind === "video" ? media.elt.videoHeight : media.height) || height;
    draw = calculateDrawDimensions(mediaWidth, mediaHeight, slot.kind, getFlags(slot.filename).fit, bounds, panProgress(slot));
  }
  const paint = () => (slot.kind === "text" ? drawText(slot, bounds) : drawMedia(slot, draw));

  if (!App.isMasked) {
    paint();
    return;
  }

  drawingContext.save();
  drawingContext.beginPath();
  drawingContext.arc(width / 2, height / 2, bounds.width / 2, 0, TWO_PI);
  drawingContext.clip();
  paint();
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
// "@pan" images: 0..1 while the slow camera move runs (null = not a panning image). Linear, so it reads as a steady drift.
function panProgress(slot) {
  if (!slot || slot.kind !== "image" || slot.panStart == null || !getFlags(slot.filename).pan) return null;
  return Math.min(1, (millis() - slot.panStart) / (slot.panTime * 1000));
}

// With a pan progress, the overflowing axis is walked from its start (0) to its end (1) instead of being centred
// (and the extra image zoom is dropped: the whole picture gets seen).
function calculateDrawDimensions(mediaWidth, mediaHeight, kind, fit, bounds, pan = null) {
  const mediaIsWider = mediaWidth / mediaHeight > bounds.width / bounds.height;
  const matchWidth = (fit === "contain") === mediaIsWider;

  let scale = matchWidth ? bounds.width / mediaWidth : bounds.height / mediaHeight;
  if (fit === "cover" && kind === "image" && pan === null) scale *= Config.IMAGE_ZOOM_FACTOR;

  const drawWidth = mediaWidth * scale;
  const drawHeight = mediaHeight * scale;

  const t = fit === "cover" && pan !== null ? pan : 0.5; // 0.5 = centred
  return {
    x: bounds.left + (bounds.width - drawWidth) * t,
    y: bounds.top + (bounds.height - drawHeight) * t,
    width: drawWidth,
    height: drawHeight,
  };
}
