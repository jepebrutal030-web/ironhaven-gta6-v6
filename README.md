# IRONHAVEN — Make GTA 6

[![make.fun](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01)
[![rank](https://make.fun/badge/gta6-01/jepebrutal030-web/ironhaven-gta6-v6/rank.svg)](https://make.fun/bounty/gta6-01)
[![reward](https://make.fun/badge/gta6-01/jepebrutal030-web/ironhaven-gta6-v6/reward.svg)](https://make.fun/bounty/gta6-01)

An open-world crime game in the spirit of GTA 6, built from scratch for
[make.fun/bounty/gta6-01](https://make.fun/bounty/gta6-01). Every city block,
character, vehicle, name, story beat, sound and texture is original — nothing
from Rockstar Games. It plays offline in a desktop browser from static files,
with keyboard and mouse, and no network request.

## The game

A 392×392 m city: downtown glass towers, residential streets, and a harbor
with a sea to the east. Walk it or drive it.

- **5 story missions** — Homecoming ($300), Pickup ($500), Getaway ($700),
  Shakedown ($1,000), Harbor Job ($1,500) — ending in a free-roam finale.
- **8 car models, 22 traffic cars, 36 pedestrians, 14 stealable parked cars**
  including the golden Manta at the harbor.
- **Wanted 0–5** with police cruisers that chase and ram, foot cops that run
  you down and arrest you (BUSTED), and WASTED when your health runs out.
- **Combat** — aim-corrected pistol shooting, reload, hitmarkers, and rival
  gunmen on the Shakedown job.
- **HUD** — health, money, wanted stars, objective + distance, speedometer,
  ammo, crosshair, damage vignette, and a live 2D minimap.
- **Start screen, pause menu, autosave** (localStorage), and a synthesized
  WebAudio soundtrack (~100 BPM, A minor) with sound effects. No audio files.

## Controls

WASD move / drive · mouse look (click to lock) · Shift sprint / boost ·
E enter / exit car · left-click shoot · R reload · Space jump / handbrake ·
P pause & save · M mute.

## Play it

Open `game/index.html` in a desktop browser (three.js is vendored under
`game/vendor/three/` as minified builds, the import map points at them,
nothing is fetched). Or serve the folder:

```sh
cd game && python3 -m http.server 8080   # then open http://localhost:8080/
```

## Build the dossier

```sh
MAKEFUN_OUTPUT_DIR=/tmp/out1 node main.ts   # writes /tmp/out1/dossier.json
```

## Tech

Three.js 0.187 (vendored, minified), procedural canvas textures, PCF shadows,
ACES tone mapping. The city, the articulated humanoids, the detailed cars and
the music are all generated in code — no downloaded assets.
