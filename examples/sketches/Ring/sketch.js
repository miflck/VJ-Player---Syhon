// Example VJ Player sketch: put it in a folder named after the sketch,
// e.g. "Ring/sketch.js". The folder is the sketch: other files in it (images,
// data) are loaded with assetUrl() and are not played as media.
// (A single file named "Ring.sketch.js" works too.)
//
// A sketch is a p5 *instance-mode* sketch wrapped in registerSketch(). The
// canvas is the size of the player window; with the circle mask on (M) only
// the central square is visible, so keep the important part centered.
// Don't call createCanvas more than once, and don't start your own animation
// loop: the player calls draw() once per frame while the sketch is on screen.
//
// Flags in the folder (or file) name work as for other media:
//   Ring@15s/      stays on screen 15 s (default 5-20 s)
//   Ring@w3/       3x as likely to be picked
//   Ring@contain/  fit the whole canvas instead of filling the screen
// In a playlist with "full": true a sketch stays until you press → or switch playlist.

registerSketch((p, { width, height /*, assetUrl */ }) => {
  const rings = 14;

  // To use a file next to this sketch: img = p.loadImage(assetUrl("texture.png")) inside p.preload

  p.setup = () => {
    p.createCanvas(width, height);
    p.colorMode(p.HSB, 360, 100, 100, 100);
    p.noFill();
  };

  p.draw = () => {
    const t = p.frameCount / 60; // seconds on screen (frames only advance while visible)

    p.background(235, 40, 8);
    p.translate(p.width / 2, p.height / 2);
    const base = Math.min(p.width, p.height) / 2;

    for (let i = 0; i < rings; i++) {
      const k = i / rings;
      const radius = base * (0.12 + 0.88 * k) * (1 + 0.06 * Math.sin(t * 1.2 + i));

      p.stroke((200 + 120 * k + t * 20) % 360, 70, 100, 85);
      p.strokeWeight(2 + 6 * (1 - k));

      p.beginShape();
      for (let a = 0; a < p.TWO_PI; a += 0.06) {
        const n = p.noise(Math.cos(a) * 0.9 + 1, Math.sin(a) * 0.9 + 1, t * 0.4 + i * 0.15);
        const r = radius * (0.8 + 0.4 * n);
        p.vertex(r * Math.cos(a), r * Math.sin(a));
      }
      p.endShape(p.CLOSE);
    }
  };
});
