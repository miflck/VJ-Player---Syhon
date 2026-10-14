// Wipe: every second another layer is stacked on, each one narrower and
// brighter than the one before, like a stepped wedge. After ten layers the
// whole thing turns a quarter and starts again.
// Colors: near-black, dark red, bright red.

registerSketch((p, { width, height }) => {
  const layers = 10;
  const BG = "#0b0b0e", DARK = "#3b0d12", BRIGHT = "#ff4a3d";

  p.setup = () => {
    p.createCanvas(width, height);
    p.noStroke();
  };

  p.draw = () => {
    const t = p.frameCount / 60; // seconds on screen
    const cycle = Math.floor(t / layers);
    const shown = Math.floor(t % layers) + 1; // layers visible right now (1..10)
    const s = Math.min(p.width, p.height) * 0.86;

    p.background(BG);
    p.translate(p.width / 2, p.height / 2);
    p.rotate(cycle * p.HALF_PI); // each round starts from another side

    for (let i = 0; i < shown; i++) {
      const w = s * (1 - i / layers); // 100% ... 10% of the square
      // the newest layer slides out to its width during its first moments
      const grow = i === shown - 1 ? p.constrain((t % 1) * 4, 0, 1) : 1;
      const prev = s * (1 - (i - 1) / layers);
      const drawn = i === 0 ? w : p.lerp(prev, w, grow);

      p.fill(p.lerpColor(p.color(DARK), p.color(BRIGHT), i / (layers - 1)));
      p.rect(-s / 2, -s / 2, drawn, s);
    }
  };
});
