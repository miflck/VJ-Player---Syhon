# VJ Player teilbar machen (macOS)

Damit Studierende die `.dmg` herunterladen und den VJ Player ohne Fehlermeldung
öffnen können, muss die App **signiert** und **notarisiert** sein. Diese Notiz
hält fest, was beim OSC Hub den Unterschied gemacht hat, wie der VJ Player im
Vergleich dasteht und was zu tun ist.

Stand: 29.10.2026

**Umgesetzt (29.10.):** Schritte 1 und 2. Die Entitlements liegen in
`buildResources/entitlements.mac.plist`, und `package.json` signiert jetzt mit
der Developer ID und Hardened Runtime (`"notarize": false`). Der Build von `main`
ist gültig signiert, inklusive `Syphon.framework` und `syphon_addon.node`, und
startet. **Offen:** Notarisierung (Schritt 3). Bis dahin müssen Studierende
beim ersten Start «Trotzdem öffnen» wählen.

## Was wir beim OSC Hub gelernt haben

Der OSC Hub (`Repos/dda-stuff/OSC Communication/OSC-Hub`) liess sich erst
teilen, als er mit dem Developer-ID-Zertifikat signiert war. Vorher stand in
`package.json` `"identity": null`, und macOS hat die App auf fremden Macs
blockiert («beschädigt» / «kann nicht geöffnet werden»).

Die Konfiguration, die funktioniert hat:

```json
"mac": {
  "identity": "Michael Flueckiger (FFUZS5J5U2)",
  "hardenedRuntime": true,
  "gatekeeperAssess": false,
  "entitlements": "build/entitlements.mac.plist",
  "entitlementsInherit": "build/entitlements.mac.plist",
  "notarize": false,
  "target": [{ "target": "dmg", "arch": ["x64", "arm64"] }]
}
```

Die drei wichtigen Punkte:

1. **Developer-ID-Zertifikat** (Apple Developer Program). Damit signiert
   electron-builder die App.
2. **Hardened Runtime und Entitlements.** Electron braucht `allow-jit` und
   `allow-unsigned-executable-memory`. Native Module brauchen zusätzlich
   `disable-library-validation`. Fehlt das, startet die signierte App oft
   gar nicht.
3. **Architekturen** für die Macs, auf denen die App laufen soll.

**Was beim OSC Hub noch fehlt:** Er ist nicht notarisiert
(`spctl`: `rejected, source=Unnotarized Developer ID`). Studierende müssen
deshalb beim ersten Start unter *Systemeinstellungen → Datenschutz & Sicherheit*
auf «Trotzdem öffnen» klicken. Ab macOS 15 hilft Rechtsklick → «Öffnen» nicht
mehr. Mit Notarisierung entfällt dieser Schritt.

## Vergleich: VJ Player heute

| Punkt | OSC Hub | VJ Player |
|---|---|---|
| Signatur | Developer ID ✅ | nur **ad-hoc** ❌ (`Signature=adhoc`, `TeamIdentifier=not set`) |
| Hardened Runtime | ✅ | ❌ nicht gesetzt |
| Entitlements | ✅ `build/entitlements.mac.plist` | ❌ keine |
| Notarisierung | ❌ (abgeschaltet) | ❌ |
| Architekturen | x64 + arm64 | nur **arm64** (Syphon-Addon und `Syphon.framework` sind nur arm64) |
| Native Teile | `serialport` | eigenes Addon `syphon_addon.node` + `Syphon.framework` (extern gebaut, ad-hoc signiert) |
| Externe Programme | – | `ffmpeg` aus Homebrew für die MP4-Konvertierung |
| Netzwerk | WebSocket/UDP lokal | socket.io-Hub auf `0.0.0.0` (LAN) |

Das Zertifikat `Developer ID Application: Michael Flueckiger (FFUZS5J5U2)`
liegt gültig im Schlüsselbund. Der Build in `release/mac-arm64` vom 28.10.
ist trotzdem nur ad-hoc signiert, und `codesign --verify` meldet *code has no
resources but signature indicates they must be present*. Dieser Build ist so
nicht teilbar.

## Was zu tun ist

### 1. Entitlements-Datei anlegen, aber **nicht** in `build/`

Achtung, das ist anders als beim OSC Hub: Im VJ Player ist `build/` der
Ausgabeordner von `node-gyp` (`npm run build:syphon` = `node-gyp rebuild`
löscht und erzeugt ihn neu), und er steht in `.gitignore`. Eine Entitlements-
Datei (oder ein Icon) dort würde verschwinden. Darum einen eigenen Ordner
verwenden, z. B. `buildResources/entitlements.mac.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>com.apple.security.cs.allow-jit</key>
    <true/>
    <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
    <true/>
    <key>com.apple.security.cs.disable-library-validation</key>
    <true/>
  </dict>
</plist>
```

`disable-library-validation` ist hier wichtig, weil `syphon_addon.node` und
`Syphon.framework` zur Laufzeit geladen werden. Kamera- oder Mikrofon-
Entitlements braucht der VJ Player nicht: Die Aufnahme läuft über
`MediaRecorder` auf dem eigenen Fenster.

### 2. `package.json` ergänzen

```json
"build": {
  "appId": "ch.michaelflueckiger.vjplayer",
  "directories": {
    "output": "release",
    "buildResources": "buildResources"
  },
  "mac": {
    "category": "public.app-category.entertainment",
    "target": [{ "target": "dmg", "arch": ["arm64"] }],
    "identity": "Michael Flueckiger (FFUZS5J5U2)",
    "hardenedRuntime": true,
    "gatekeeperAssess": false,
    "entitlements": "buildResources/entitlements.mac.plist",
    "entitlementsInherit": "buildResources/entitlements.mac.plist",
    "notarize": true,
    "extendInfo": {
      "NSLocalNetworkUsageDescription": "Der VJ Player verbindet sich mit dem Controller und anderen Playern im lokalen Netzwerk."
    },
    "extraFiles": [{ "from": "frameworks", "to": "Frameworks" }]
  }
}
```

- `buildResources` umstellen, damit electron-builder nicht in den
  node-gyp-Ordner `build/` schaut. Ein eigenes Icon kommt dann als
  `buildResources/icon.icns` dazu.
- `NSLocalNetworkUsageDescription`: Seit macOS 15 fragt das System, bevor eine
  App Geräte im lokalen Netz erreichen darf (Hub ↔ Player ↔ Controller). Ohne
  diesen Text erscheint keine sinnvolle Abfrage, und die Verbindung kann
  stillschweigend scheitern.
- `appId` wurde bereits von `com.example…` auf `ch.michaelflueckiger.vjplayer`
  geändert (noch nicht committet). Gut so, die ID sollte danach gleich bleiben.

### 3. Notarisierung einrichten

electron-builder 26 notarisiert selbst, wenn `"notarize": true` gesetzt ist und
diese Umgebungsvariablen vorhanden sind:

```bash
export APPLE_ID="deine-apple-id@…"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"   # auf appleid.apple.com erstellen
export APPLE_TEAM_ID="FFUZS5J5U2"
```

Die Zugangsdaten nie ins Repo schreiben. Wenn sie in einer `.env` liegen, diese
in `.gitignore` aufnehmen (das ist im VJ Player noch nicht der Fall).

### 4. Sauber neu bauen

```bash
rm -rf release
npm run build:syphon
npm run dist:mac
```

Die Notarisierung dauert einige Minuten (Upload zu Apple).

### 5. Prüfen, bevor du teilst

```bash
codesign --verify --deep --strict --verbose=2 "release/mac-arm64/VJ Player.app"
spctl -a -vv "release/mac-arm64/VJ Player.app"
xcrun stapler validate "release/VJ Player-1.0.0-arm64.dmg"
```

Erwartet: `spctl` meldet `accepted` und `source=Notarized Developer ID`.
Am besten danach die `.dmg` auf einem **anderen** Mac aus dem Internet laden
(AirDrop/Mail/Download) und öffnen. Erst dann sieht man, was Studierende sehen.

## Offene Punkte / Einschränkungen

- **Nur Apple Silicon.** Syphon-Addon und Framework sind arm64-only. Wer einen
  Intel-Mac hat, kann die App nicht starten. Für Intel müsste das Addon
  zusätzlich für x64 gebaut werden (in `binding.gyp` `ARCHS` erweitern), und
  `Syphon.framework` müsste x64 enthalten. Klären, ob das nötig ist.
- **Social-Export / ffmpeg:** Der Social-Export ist nur im Branch
  `social-export` und kommt nicht in die geteilte App. Gebaut wird von `main`.
- **Firewall-Abfrage:** Beim Start des Hubs fragt macOS evtl., ob eingehende
  Verbindungen erlaubt sein sollen. Mit signierter App wird die Antwort
  gespeichert. Ohne Signatur kommt die Abfrage bei jedem Build erneut.
- **Windows/Linux:** Die Konfiguration oben betrifft nur macOS. Unsignierte
  Windows-Builds zeigen eine SmartScreen-Warnung («Weitere Informationen →
  Trotzdem ausführen»).
