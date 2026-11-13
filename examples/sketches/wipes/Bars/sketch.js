// Bars wipe: black bars slide in from the left, cover the screen at progress 0.5, then slide out to the right.
// Use it as a template: draw on a transparent canvas and cover the output at progress() = 0.5.

registerSketch((p, { width, height, progress }) => {
  const bars = 8;

  p.setup = () => {
    p.createCanvas(width, height);
    p.noStroke();
  };

  p.draw = () => {
    p.clear();
    p.fill(0);
    const t = progress();
    for (let i = 0; i < bars; i++) {
      const delay = (i / bars) * 0.3; // the bars follow each other
      const local = p.constrain((t - delay) / 0.7, 0, 1); // 0..1 for this bar
      const x0 = local < 0.5 ? 0 : p.map(local, 0.5, 1, 0, p.width); // leaves to the right
      const x1 = local < 0.5 ? p.map(local, 0, 0.5, 0, p.width) : p.width; // arrives from the left
      p.rect(x0, (i * p.height) / bars, x1 - x0 + 1, p.height / bars + 1);
    }
  };
});
