# Random Media Player

A fullscreen Electron app that plays through folders of videos and images
in random order — like a screensaver / VJ tool. Media is organized into
**playlists** (one per folder, typically one per song/set), and you can
weight individual clips so some show up more often than others.

## Requirements

- [Node.js](https://nodejs.org/) 18 or later (includes npm)

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Start the app:

   ```bash
   npm start
   ```

3. On first launch you'll see the settings screen. Click **Select Assets
   Folder** (or press `S`) and pick the folder containing your media.

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
│   │   └── preload.js        Exposes a safe electronAPI to the renderer (incl. Syphon)
│   └── renderer/
│       ├── index.html        Host page, loads p5.js + the scripts below
│       ├── style.css         Fullscreen canvas styling
│       └── js/
│           ├── config.js     Config, app state, filename flags
│           ├── playlist.js   playlists.json handling, random picking
│           ├── player.js     Media loading, playback, transitions
│           ├── ui.js         Canvas rendering, settings screen
│           ├── syphon.js     Syphon output (macOS, key "Y")
│           └── sketch.js     p5 setup/draw, init, keyboard/mouse input
├── native/                   Syphon native addon source (syphon_addon.mm)
├── frameworks/               Syphon.framework
├── examples/                 Example playlists.json files
├── docs/
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
  for media files (`.mp4`, `.mov`, `.jpg`, `.jpeg`, `.png`, `.gif`, `.webp`).
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

Within a playlist, add `@w<number>` to a filename to make it show up more
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
always plays for 15 seconds.

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

This is the easiest way to add a single "play the whole clip" video or a
"just show this" image: give it its own playlist entry with `"full": true`.
If it's the only file in that playlist, a full video will simply restart
from 0 every time it finishes, and a full image will just sit there until
you switch playlists (`N`/`X`) or press `→`/`A` to force a change.

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

This can be combined with the other flags, e.g. `logo@contain@full.png`
fits the whole logo on screen _and_ shows it indefinitely.

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

## Keyboard controls

| Key         | Action                                                  |
| ----------- | ------------------------------------------------------- |
| `S`         | Open settings / choose assets folder                    |
| `Esc`       | Close settings                                          |
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
npm run dist        # build for your current OS
npm run dist:mac
npm run dist:win
npm run dist:linux
```

Output goes to the `release/` folder. You'll need to run the build on (or
cross-compile for) the target OS — see the electron-builder docs for
cross-platform build requirements.

## Notes

- Your assets folder and `playlists.json` are **not** part of this repo —
  keep your media wherever you like and just point the app at it via the
  settings screen.
- The app remembers your last-selected assets folder between launches
  (stored in Electron's userData config, not in this project).
