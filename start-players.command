#!/bin/bash
# Oeffnet die ersten beiden Player (links und rechts, je eine Bildschirmhaelfte, Fullscreen).
# Player 1 = die normale Instanz, Player 2 = --instance=2. Beide mit 960x1080 Output.
#
# Nimmt die installierte App ("VJ Player" in /Applications), sonst die Entwicklungsversion
# aus diesem Ordner (npm start).

APP="/Applications/VJ Player.app"
DIR="$(cd "$(dirname "$0")" && pwd)"
ARGS="--output=960x1080"

start() { # $1 = Seite, $2 = Name, $3... = weitere Optionen
  local side="$1" name="$2"; shift 2
  if [ -d "$APP" ]; then
    open -n -a "$APP" --args "$@" $ARGS --fullscreen="$side" --name="$name"
  else
    (cd "$DIR" && nohup npx electron . "$@" $ARGS --fullscreen="$side" --name="$name" >/dev/null 2>&1 &)
  fi
}

start left  left
sleep 3
start right right --instance=2

echo "Player links und rechts gestartet. Fenster mit Enter schliessen."
read
