// Circle wipe: a white circle grows from the centre until it covers the screen (progress 0.5), then shrinks away again.

registerSketch((p, { width, height, progress }) => {
  p.setup = () => {
    p.createCanvas(width, height);
    p.noStroke();
  };

  p.draw = () => {
    p.clear();
    p.fill(255);
    const full = Math.hypot(p.width, p.height); // diameter that covers the corners
    const t = progress();
    p.circle(p.width / 2, p.height / 2, full * Math.sin(t * Math.PI) ** 0.7);
  };
});
