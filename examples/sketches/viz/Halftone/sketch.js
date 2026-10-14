// Halftone: a raster of dots whose size follows a wave that rolls out from a
// slowly wandering centre, like a printed screen that is breathing.
// Colors: dark blue, yellow, pink for the biggest dots.

registerSketch((p, { width, height }) => {
  const n = 26;
  const BG = "#12263a", DOT = "#ffd23f", ACCENT = "#ee4266";

  p.setup = () => {
    p.createCanvas(width, height);
    p.noStroke();
  };

  p.draw = () => {
    const t = p.frameCount / 60;
    const s = Math.min(p.width, p.height) * 0.86;
    const cell = s / n;
    p.background(BG);
    p.translate((p.width - s) / 2, (p.height - s) / 2);

    // wave origin drifts around the middle of the grid
    const cx = n / 2 + Math.sin(t * 0.31) * n * 0.25;
    const cy = n / 2 + Math.cos(t * 0.23) * n * 0.25;

    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        const v = 0.5 + 0.5 * Math.sin(d * 0.55 - t * 1.6); // 0..1
        p.fill(v > 0.92 ? ACCENT : DOT);
        p.circle(x * cell + cell / 2, y * cell + cell / 2, cell * (0.08 + 0.9 * v));
      }
    }
  };
});
