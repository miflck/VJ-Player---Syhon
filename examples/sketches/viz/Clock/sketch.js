// Clock: a pie that counts down a random time between 3 and 40 seconds. The
// red wedge drops once a second, the teal wedge runs smoothly inside it. When
// the time is up it refills and picks a new duration.
// Colors: near-black, red, teal.

registerSketch((p, { width, height }) => {
  const BG = "#0e0e10", RED = "#e8452c", TEAL = "#64c8c8";
  let startTime = 0;
  let duration = 12; // seconds

  p.setup = () => {
    p.createCanvas(width, height);
    p.noStroke();
  };

  p.draw = () => {
    const t = p.frameCount / 60;
    let remaining = startTime + duration - t;

    if (remaining <= 0) {
      startTime = t;
      duration = p.random(3, 40);
      remaining = duration;
    }

    const d = Math.min(p.width, p.height) * 0.86;
    const cx = p.width / 2;
    const cy = p.height / 2;

    p.background(BG);

    // stepped: whole seconds left
    p.fill(RED);
    const stepped = p.map(Math.ceil(remaining), 0, duration, 0, p.TWO_PI);
    p.arc(cx, cy, d, d, -p.HALF_PI, stepped - p.HALF_PI, p.PIE);

    // smooth: exact time left
    p.fill(TEAL);
    const smooth = p.map(remaining, 0, duration, 0, p.TWO_PI);
    p.arc(cx, cy, d * 0.8, d * 0.8, -p.HALF_PI, smooth - p.HALF_PI, p.PIE);
  };
});
