# VJ Player

A fullscreen Electron app that plays through folders of videos and images
in random order — like a screensaver / VJ tool. Media is organized into
**playlists** (one per folder, typically one per song/set), and you can
weight individual clips so some show up more often than others. On macOS the
output can also be sent to other apps (MadMapper, Resolume, …) over
[Syphon](https://syphon.github.io/).

## Requirements

- [Node.js](https://nodejs.org/) 18 or later (includes npm)
- For Syphon output: macOS on Apple Silicon (the bundled Syphon framework is
  arm64) and the Xcode command line tools (`xcode-select --install`)

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Start the app:

   ```bash
   npm start
   ```

3. *(macOS, only if you want Syphon)* Build the native addon once:

   ```bash
   npm run build:syphon
   ```

4. On first launch you'll see the settings screen. Click **Choose folder…**
   and pick the folder containing your media. (Press `S` to open the settings
   screen again later.)

That's it — the app will generate a starter `playlists.json` inside your
assets folder automatically (see below), and start playing.

## Project files

```
.
├── package.json
├── binding.gyp               Build config for the Syphon addon (node-gyp)
├── src/
│   ├── main/
│   │   ├── main.js           Electron main process: window, playlist scanning, IPC
│   │   ├── remote.js         Remote control: hosts the hub, connects this player to it
│   │   ├── cli.js            Command-line options (override config.json)
│   │   └── preload.js        Exposes a safe electronAPI to the renderer (incl. Syphon)
│   ├── server/
│   │   ├── hub.js            socket.io hub: relays commands to players, state to controllers
│   │   └── cli.js            Standalone hub (npm run hub)
│   ├── controller/
│   │   └── index.html        Remote control web page (served by the hub)
│   └── renderer/
│       ├── index.html        Host page, loads p5.js + the scripts below
│       ├── style.css         Fullscreen canvas styling
│       └── js/
│           ├── config.js     Config, app state, filename flags
│           ├── playlist.js   playlists.json handling, random picking
│           ├── sketches.js   p5 sketch files as media
│           ├── player.js     Media loading, playback, transitions
│           ├── ui.js         Canvas rendering
│           ├── settings.js   Settings panel (assets folder, host/client)
│           ├── syphon.js     Syphon output (macOS, key "Y")
│           ├── remote.js     Remote commands in, player state out
│           └── sketch.js     p5 setup/draw, init, keyboard/mouse input
├── native/                   Syphon native addon source (syphon_addon.mm)
├── frameworks/               Syphon.framework
├── test/                     Hub and command-line tests (npm test)
├── examples/                 Example playlists.json, config.json (remote control) and sketches
└── README.md
```

## Playlists

Playlists are defined by a `playlists.json` file that lives **inside your
assets folder** (not in the app folder). Each entry needs a `name` and
either a `folder`, an explicit `files` list, or both:

```json
[
  { "name": "Kong", "folder": "kong" },
  { "name": "Intro", "files": ["intro/clip1.mp4", "intro/clip2.mp4"] },
  { "name": "Everything", "folder": "." }
]
```

- `folder` — a path relative to your assets folder. Scanned recursively
  for media files (`.mp4`, `.mov`, `.jpg`, `.jpeg`, `.png`, `.gif`, `.webp`)
  and p5 sketches (`*.sketch.js`, see below).
- `files` — an explicit list of file paths, relative to your assets folder.
- `full` — optional boolean. See "Playing one file in full" below.
- If both `folder` and `files` are given on one entry, they're combined.
- If `playlists.json` doesn't exist yet, one is generated automatically:
  one playlist per top-level subfolder in your assets folder, or a single
  `"All"` playlist if there are no subfolders.
- Missing files/folders are skipped with a console warning rather than
  crashing the app.

Copy `examples/playlists.example.json` into your assets folder as `playlists.json`
and edit it to match your own folder structure, or press `E` in the app to
open it directly in your default editor (it'll be created for you if it
doesn't exist yet).

### Weighting random picks

A file is never picked twice in a row (unless it is the only one in the
playlist). Within a playlist, add `@w<number>` to a filename to make it show up more
or less often than the default weight of `1`:

```
clip1.mp4          → weight 1 (default)
clip2@w5.mp4       → weight 5   (5× more likely to be picked)
clip3@w0.2.mp4     → weight 0.2 (rarely picked)
```

### Custom clip duration

Independent of weighting, you can also control how long a video clip plays
once it's picked, using filename flags:

```
clip@15s.mp4     → play for exactly 15 seconds
clip_x3.mp4      → play for 3× the default minimum segment time
clip_LONG.mp4    → play for 3× the default minimum segment time
```

Flags can be combined, e.g. `clip@w5@15s.mp4` is picked 5× as often _and_
always plays for 15 seconds. If the segment is longer than the video itself,
the video loops.

Otherwise the segment length is random (2–15 s) and placed randomly inside
the video. Image display time is random too (5–20 s). These ranges live in
`Config` in `src/renderer/js/config.js`.

### Playing one file in full, or showing an image indefinitely

Add `"full": true` to a playlist entry in `playlists.json` to opt that
whole playlist out of the normal random-segment / timed-image behavior:

```json
{ "name": "Intro", "files": ["intro.mp4"], "full": true },
{ "name": "Logo", "files": ["logo.png"], "full": true }
```

- Videos in a `full` playlist play from 0 to their natural end — no random
  start point, no segment cutoff, and any `@Ns`/`_x3`/`_LONG` filename flags
  are ignored.
- Images in a `full` playlist are shown indefinitely — no auto-advance
  timer at all.

To do this for single files inside a normal playlist, add `@full` to the file
or sketch folder name, e.g. `intro@full.mp4` or `Dusk@full/sketch.js`. Only
those files play in full; the rest of the playlist keeps its random segments
and timers.

This is the easiest way to add a single "play the whole clip" video or a
"just show this" image: give it its own playlist entry with `"full": true`.
If it's the only file in that playlist, a full video will simply restart
from 0 every time it finishes, and a full image will just sit there until
you switch playlists (`N`/`X`) or press `→` to force a change.

### Fit mode: fill-and-crop vs fit-to-screen

By default, media fills the whole screen — like CSS `background-size:
cover` — cropping whatever doesn't match the screen's aspect ratio. Add
`@contain` to a filename to fit that file entirely on screen instead
(letterboxed with black bars, like CSS `object-fit: contain`, nothing
cropped):

```
logo@contain.png   → shown in full, letterboxed if the aspect doesn't match
clip.mp4           → default: fills the screen, cropped if needed
```

This can be combined with the other flags, e.g. `clip@contain@w5.mp4` fits
the whole clip on screen _and_ makes it 5× as likely to be picked. To show a
logo indefinitely, put `logo@contain.png` in a playlist with `"full": true`.

### Sketches

A folder named after the sketch that contains a `sketch.js` is run as a p5
sketch instead of being played as a video or image (a single file named
`Name.sketch.js` works too). It is picked, weighted, timed and masked like
any other file, and it is included in the Syphon output.

```
Sketches/            ← a playlist folder
├── Ring/
│   ├── sketch.js    ← the sketch
│   └── texture.png  ← belongs to the sketch, not played as an image
└── Waves@15s/
    └── sketch.js
```

See `examples/sketches/Ring/sketch.js`.

A playlist can hold one sketch or many. With several (and `"full"` off) they
play in random order like any other files, and can be mixed with videos and
images. In a folder that has its own `sketch.js`, images and videos are not
played (they are the sketch's assets), but sketches inside it, in
sub-folders or as `*.sketch.js` files, still are.

```js
registerSketch((p, { width, height, assetUrl }) => {
  p.setup = () => p.createCanvas(width, height);
  p.draw = () => {
    p.background(0);
    p.circle(p.width / 2, p.height / 2, 100);
  };
});
```

- Sketches use p5's **instance mode**: use `p.circle(...)`, `p.noise(...)`
  and so on, with the `p.` prefix. `width` / `height` is the size of the
  player window; with the circle mask on (`M`) only the central square shows.
- Don't start your own loop and call `createCanvas` once. The player calls
  `draw()` once per frame, only while the sketch is on screen, so
  `p.frameCount` counts frames since the sketch appeared.
- `assetUrl("file.png")` gives the URL of a file next to `sketch.js`, e.g. for
  `p.loadImage(assetUrl("file.png"))` in `p.preload`.
- Like images, a sketch stays 5–20 s, or the time given by `@15s` in its
  file name. In a `"full": true` playlist it stays until you press `→` or switch.
- `@w`, `@contain` and `@15s` flags work as for other media, in the folder
  name (`Waves@15s/sketch.js`) or the file name.
- A sketch that fails to load, takes more than 10 s to set up, or throws in
  `draw()` is skipped. The error is in the console.
- Sketches are JavaScript that runs inside the app with full access to its
  API. Only use sketches you trust. After editing one, press `L` to reload.

### Circle mask

Press `M` to toggle a circular mask over the output: a circle with
`radius = screen height / 2` (so its diameter equals the screen height),
centered on screen. Whatever's playing is clipped to that circle — nothing
outside it is drawn (the rest of the canvas stays black) — and sized
against the circle's bounding square using the file's normal fit flag:
default (`cover`) fills and crops to the circle, `@contain` letterboxes
inside it instead.

This applies on top of whatever's currently playing, live — it doesn't
change per-file, and combines with blackout (`A`) if you want to fade
between a full circle and nothing.

## Syphon output (macOS)

Press `Y` to publish the canvas — exactly what you see, including the circle
mask and blackout — as a Syphon server named **VJ Player**. Pick it in your
Syphon client (Syphon Simple Client, MadMapper, Resolume, VDMX, …). Press `Y`
again to stop. Syphon is off at launch.

- The addon must be built once: `npm run build:syphon` (needs the Xcode
  command line tools).
- The output is always **1920×1080**, whatever the size of the window. The
  window shows it scaled to fit (black bars if the window isn't 16:9) and opens
  at half size, 960×540. The size is `OUTPUT_WIDTH` / `OUTPUT_HEIGHT` in
  `src/renderer/js/config.js`; sketches and the circle mask use the same size.
  `PIXEL_DENSITY` there is `1`; `2` would double the Syphon readback size.
- The canvas is only read back while a client is connected, so Syphon costs
  almost nothing when nobody is listening.
- The server is called "VJ Player" (or "VJ Player 2" for `--instance=2`, see
  below). Clients list it as "*app name* – *server name*". When started with
  `npm start` the app name is "Electron Helper"; in a packaged build it comes
  from the product name ("VJ Player Helper (Renderer)").
- Syphon cannot be sandboxed, so it does not work in a Mac App Store build.

## Remote control

The app runs a small [socket.io](https://socket.io/) hub and serves a
controller page. Open it from any phone, tablet or computer on the same
network. The address is shown in the settings screen (press `S`) and in the
console, for example `http://192.168.2.8:3000`.

The page has buttons for **Next media**, **Previous / Next playlist** (and
each playlist by name), **Blackout**, **Circle mask**, **Syphon**,
**Fullscreen** and **Reload**. Its keyboard shortcuts are the same as in the
player. It also shows what each connected player is playing.

```
controller ──command──▶ hub ──command──▶ every player
controller ◀──players── hub ◀───state─── every player
```

A command is `{ "key": "n" }` (same as pressing that key) or
`{ "playlist": 2 }` (jump to that playlist). Allowed keys: `n x → a m l f y`.
`E`, `S`, `Esc` and `Backspace` can't be sent remotely. Any socket.io client
can act as a controller, e.g. from another app:

```js
const socket = io("http://192.168.2.8:3000", { auth: { role: "controller" } });
socket.emit("command", { key: "arrowright" });
```

**Host or client.** Press `S` and use the **Host / Client** buttons under
*Remote control*. *Host* runs the hub and the controller page in this app;
*Client* connects to a hub elsewhere, so you type its address (e.g.
`http://192.168.1.20:3000`) and click **Apply**. It switches immediately, no
restart, and the choice is saved in `config.json`. The panel shows whether the hub
is running or the connection is up. (The same can be set with `--host` /
`--hub=<url>`, or by hand in `config.json`, see below.)

**Several players.** Every player connected to the hub receives every
command. To run the hub on one machine and players on others, set the hub
address on the other machines (see below), or run a hub without a player
window with `npm run hub` (`--port 3000 --token secret`).

**Settings** go in the `remote` object of `config.json` in the app's userData
folder (macOS: `~/Library/Application Support/VJ Player/config.json`). All
keys are optional:

```json
{
  "assetsPath": "...",
  "remote": {
    "enabled": true,
    "host": true,
    "port": 3000,
    "url": "",
    "token": "",
    "name": "Stage left"
  }
}
```

- `enabled`: `false` turns remote control off completely.
- `host`: run the hub in this app. Set `false` on players that only connect to
  another machine's hub.
- `url`: the hub to connect to, e.g. `"http://192.168.2.8:3000"`. Empty means
  this app's own hub.
- `token`: a shared secret. When set, controllers and players must send it; open
  the page as `http://…:3000/?token=secret`.
- `name`: how this player is listed in the controller (default: the computer's name).

**Examples.** Copy one into the userData folder as `config.json` (or merge its
`remote` part into your existing file) and restart the app:

- `examples/config.host.example.json`: this machine runs the hub (and the
  controller page) and plays. Use it on the main machine.
- `examples/config.client.example.json`: this machine only plays and connects
  to a hub elsewhere. Change `url` to the hub's address, e.g. the main machine's
  `http://<ip>:3000` or a cloud hub's `https://…`. Use the same `token` on the
  hub and on every player.

The assets folder is not part of these files; the app asks for it on first launch
and saves it next to the `remote` settings.

**Security.** The hub listens on all network interfaces so other devices can
reach it, and without a token anyone on the same network can control the
player. Use a token on shared networks, or set `"enabled": false`.

## Running several copies

Start more than one copy with `--instance=<name>`, e.g. to feed two Syphon
canvases to MadMapper. Each instance gets its own settings folder (macOS:
`~/Library/Application Support/VJ Player <name>/config.json`, so its own assets
folder and playlists), its own Syphon server ("VJ Player <name>"), its own window
title and its own Dock icon.

```bash
npm start -- --instance=1
npm start -- --instance=2

# packaged app (a second launch needs -n)
open -n -a "VJ Player" --args --instance=1
open -n -a "VJ Player" --args --instance=2
```

Start instance 1 first. It hosts the remote-control hub; the others find the
port taken and join that hub, so one controller page drives all instances at
once (they appear with names like "my-mac 1", "my-mac 2"). Commands go to every
instance; separate steering is not implemented. Set `"name"` in each instance's
`remote` settings to change how it is listed.

You can also set most things on the command line instead of editing files, see
"Command-line options" below.

Extra settings for `config.json` (all optional):

```json
{
  "syphon": { "name": "Left screen" },
  "window": { "width": 960, "height": 540, "x": 0, "y": 0 }
}
```

`window` is the size of the visible content area; it only changes how large the
output is shown, not the Syphon size.

## Command-line options

Options given when starting the app beat `config.json` for that launch. They are
never written back to the file, so one app can be started in different roles from
a script. The order of priority is: command line, then `config.json`, then the
built-in defaults.

| Option | Meaning |
| --- | --- |
| `--instance=<name>` | run as a separate instance with its own settings, Syphon name and window title |
| `--hub=<url>` | connect to the hub at that address, and don't host one (client) |
| `--host` | run the hub here (the default); `--hub` wins if both are given |
| `--port=<n>` | hub port when hosting |
| `--name=<text>` | how this player is listed in the controller |
| `--syphon-name=<text>` | Syphon server name |
| `--assets=<folder>` | assets folder for this launch (not saved) |
| `--window=<W>x<H>` | visible window size, e.g. `960x540` |

```bash
# main machine: hosts the hub, plays, own Syphon name
npm start -- --instance=1 --host --name="Left" --syphon-name="Left Out"

# second player (same Mac or another one): joins the hub
npm start -- --instance=2 --hub=http://192.168.1.20:3000 --name="Right" --syphon-name="Right Out"

# packaged app; the options follow --args
open -n -a "VJ Player" --args --instance=2 --hub=http://192.168.1.20:3000
```

Put the lines you use into a small shell script, one per setup. Values with spaces
need quotes, e.g. `--name="Right screen"`. There is no token option; for a shared
network set `"token"` in `config.json` (see Remote control).

## Keyboard controls

| Key         | Action                                                  |
| ----------- | ------------------------------------------------------- |
| `S`         | Open / close the settings screen                        |
| `Esc`       | Close settings; if none are open, quit the app          |
| `N`         | Next playlist                                           |
| `X`         | Previous playlist                                       |
| `→` (Right) | Skip to another random file in this playlist            |
| `A`         | Toggle blackout (hide output without stopping playback) |
| `M`         | Toggle circle mask (see below)                          |
| `L`         | Reload `playlists.json` (pick up edits live)            |
| `E`         | Open `playlists.json` in your default editor            |
| `F`         | Toggle fullscreen                                       |
| `Y`         | Toggle Syphon output (macOS)                            |
| `Backspace` | Reload the app                                          |

## Building a distributable app

This project uses [electron-builder](https://www.electron.build/) to
package a standalone app:

```bash
npm run build:syphon   # macOS: compile the Syphon addon first
npm run dist:mac       # .app + .dmg
npm run dist           # build for your current OS
npm run dist:win
npm run dist:linux
```

Output goes to the `release/` folder (`release/mac-arm64/VJ Player.app` and
the `.dmg`). For just the `.app`, which builds faster, run
`npx electron-builder --mac --dir`.

The Syphon addon is macOS only; Windows and Linux builds work without it
(`Y` just logs that Syphon is unavailable). Builds are signed if a Developer
ID certificate is in your keychain; notarization is not set up. Change
`appId` in `package.json` before distributing, and add a `build/icon.icns`
if you want your own app icon. You'll need to run the build on (or
cross-compile for) the target OS — see the electron-builder docs for
cross-platform build requirements.

## Notes

- Your assets folder and `playlists.json` are **not** part of this repo —
  keep your media wherever you like and just point the app at it via the
  settings screen.
- Set `DEBUG = true` in `src/renderer/js/config.js` for verbose console logging.
- The app remembers your last-selected assets folder between launches
  (stored in Electron's userData config, not in this project).
