#!/bin/bash
# Kopiert die Master-playlists.json in die Ordner left, right und center.
SRC="/Users/michaelflueckiger/Repos/VJ-Player - Infotage/Setlist/playlists.json"
BASE="/Users/michaelflueckiger/Dropbox/02_5_HSLU"

for d in left right center; do
  if cp "$SRC" "$BASE/$d/Setlist/playlists.json"; then
    echo "OK: $d"
  else
    echo "FEHLER: $d"
  fi
done

echo
echo "Fertig. Fenster mit Enter schliessen."
read
