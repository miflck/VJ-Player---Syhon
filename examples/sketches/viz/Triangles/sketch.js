// Triangles: a grid of triangles. Each one turns by a third of a circle after
// its own pause, so the shape lands back on itself and the grid looks like a
// pattern that is slowly re-sorting.
// Colors: deep blue, white, teal.

registerSketch((p, { width, height }) => {
  const n = 8;
  const BG = "#0f1c2e", A = "#f4f4f4", B = "#2ec4b6";
  let tris = [];

  p.setup = () => {
    p.createCanvas(width, height);
    p.noStroke();
    for (let i = 0; i < n * n; i++) tris.push({ angle: 0, target: 0, next: p.random(0, 5) });
  };

  p.draw = () => {
    const t = p.frameCount / 60;
    const cell = (Math.min(p.width, p.height) * 0.84) / n;
    const r = cell * 0.42;
    p.background(BG);
    p.translate((p.width - cell * n) / 2, (p.height - cell * n) / 2);

    tris.forEach((tri, i) => {
      if (t > tri.next) {
        tri.target += p.TWO_PI / 3 * p.random([1, 1, 2]); // turn by 120° or 240°
        tri.next = t + p.random(1.5, 6);
      }
      tri.angle += (tri.target - tri.angle) * 0.07;

      const col = i % n, row = Math.floor(i / n);
      p.push();
      p.translate(col * cell + cell / 2, row * cell + cell / 2);
      p.rotate(tri.angle - p.HALF_PI);
      p.fill((col + row) % 2 ? A : B);
      p.triangle(r, 0, -r / 2, r * 0.866, -r / 2, -r * 0.866);
      p.pop();
    });
  };
});
