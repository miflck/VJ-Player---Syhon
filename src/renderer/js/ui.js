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
    draw = calculateDrawDimensions(mediaWidth, mediaHeight, slot.kind, getFlags(slot.filename).fit, bounds);
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
