// Dots: a grid of circles. Every dot eases to a new size after its own random
// pause, so the grid keeps changing without ever resetting.
// Colors: navy, off-white, coral.

registerSketch((p, { width, height }) => {
  const n = 9;
  const BG = "#0b1b3a", DOT = "#f1f1ee", ACCENT = "#ff5a36";
  let dots = [];

  p.setup = () => {
    p.createCanvas(width, height);
    p.noStroke();
    for (let i = 0; i < n * n; i++) dots.push({ size: p.random(), target: p.random(), next: p.random(0, 4), hot: false });
  };

  p.draw = () => {
    const t = p.frameCount / 60;
    const cell = (Math.min(p.width, p.height) * 0.8) / n;
    p.background(BG);
    p.translate((p.width - cell * n) / 2, (p.height - cell * n) / 2);

    dots.forEach((d, i) => {
      if (t > d.next) {
        d.target = p.random([0.08, 0.3, 0.55, 1]); // a few clear sizes read better than a continuum
        d.hot = p.random() < 0.12;
        d.next = t + p.random(1.5, 5);
      }
      d.size += (d.target - d.size) * 0.05; // ease towards the target

      p.fill(d.hot ? ACCENT : DOT);
      p.circle((i % n) * cell + cell / 2, Math.floor(i / n) * cell + cell / 2, d.size * cell * 0.95);
    });
  };
});
