// Sketch media: p5 instance-mode sketches ("*.sketch.js") that run off-screen
// and are drawn into the main canvas like a video frame, so the circle mask,
// @contain, blackout and Syphon all apply to them automatically.
//
// A sketch file calls registerSketch(factory); the factory receives the p5
// instance and { width, height, assetUrl }:
//
//   registerSketch((p, { width, height }) => {
//     p.setup = () => p.createCanvas(width, height);
//     p.draw = () => { p.background(0); p.circle(p.width / 2, p.height / 2, 100); };
//   });
//
// Sketches don't run their own animation loop: the player steps them once per
// frame (only while they are on screen), so they share one timeline.
//
// Sketch files are arbitrary JavaScript that runs inside the app. Only use
// sketches you trust.

const SETUP_TIMEOUT = 10000; // ms; covers loading assets in preload()

// Each sketch file registers against the <script> element that is running it
// (document.currentScript), so overlapping loads can't pick up each other's sketch.
const registeredFactories = new WeakMap();

function registerSketch(factory) {
  if (document.currentScript) registeredFactories.set(document.currentScript, factory);
}

// Loads the sketch file as a script and resolves with the factory it registered.
function loadSketchFactory(url) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `${url}?t=${Date.now()}`; // bypass the cache so edits show up after "L" reload

    script.onload = () => {
      script.remove();
      const factory = registeredFactories.get(script);
      if (typeof factory === "function") resolve(factory);
      else reject(new Error("the file did not call registerSketch(fn)"));
    };
    script.onerror = () => {
      script.remove();
      reject(new Error("could not load the file"));
    };

    document.head.appendChild(script);
  });
}

function sketchHost() {
  let host = document.getElementById("sketch-host");
  if (!host) {
    host = document.createElement("div");
    host.id = "sketch-host";
    host.style.cssText = "position:absolute;width:0;height:0;overflow:hidden;visibility:hidden";
    document.body.appendChild(host);
  }
  return host;
}

// Creates the p5 instance and resolves once its setup() has run. The instance
// is left paused (noLoop); stepSketch() redraws it on demand.
function createSketchInstance(factory, url) {
  return new Promise((resolve, reject) => {
    let instance = null;

    const fail = (error) => {
      clearTimeout(timer);
      try {
        if (instance) instance.remove();
      } catch (_) {}
      reject(error);
    };
    const timer = setTimeout(() => fail(new Error("setup() did not finish in time")), SETUP_TIMEOUT);

    try {
      new p5((p) => {
        instance = p;
        factory(p, {
          width: Math.round(width),
          height: Math.round(height),
          assetUrl: (name) => new URL(name, url).href, // files next to the sketch
        });

        const userSetup = p.setup;
        p.setup = () => {
          try {
            p.pixelDensity(Config.PIXEL_DENSITY); // before the sketch creates its canvas
            if (userSetup) userSetup();
            p.noLoop();
          } catch (error) {
            fail(error);
            return;
          }
          clearTimeout(timer);
          resolve(p);
        };
      }, sketchHost());
    } catch (error) {
      fail(error);
    }
  });
}

// Runs one frame of the sketch. A sketch that throws is skipped.
function stepSketch(slot) {
  if (slot.failed) return;
  try {
    slot.media.redraw();
  } catch (error) {
    console.error(`Sketch "${slot.filename}" failed:`, error);
    slot.failed = true;
    advance();
  }
}
