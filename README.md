# Sky Combat

A 3D aerial combat arcade game for [start.ng](https://start.ng) — third-person fighter
jet flight over sweeping scenery, with coins, power-ups, fuel, enemies and a public
leaderboard ranked on distance.

**Stage 2 status: foundations.** The world, the aircraft, the lighting, the camera and
the interface are in place and the project builds, tests and publishes. Player flight
controls, enemies, weapons, the hangar, the shop and the start.ng integration are
Stages 3–9 — see [Stages](#stages).

---

## Requirements

- **Node.js 20.19+ or 22.12+** (developed on 22.23) and npm
- A browser with WebGL2 (Chrome, Edge, Firefox, Safari)
- Nothing else. Three.js is the only runtime dependency and it is bundled locally.

## Quick start

```bash
npm install          # install dev tooling and Three.js
npm run dev          # Vite dev server at http://127.0.0.1:5173
```

## Building

```bash
npm run build        # writes the ready-to-play game into dist/
npm run serve        # serves dist/ at http://127.0.0.1:5173
```

`dist/` is **committed on purpose**: start.ng never runs a build command, so the built
game has to be in the repository. After every change, run `npm run build` and commit
the result.

## Testing

```bash
npm run test:unit    # pure logic: flight model, state machine, quality tiers, assets, data
npm run smoke        # opens dist/ in headless Chrome, flies, screenshots, fails on errors
npm test             # both
```

The smoke test writes `menu.png`, `flight.png`, `aircraft.png` and `console.log` to
`test-results/`, which is useful for reviewing a visual change without launching a
browser by hand.

## Tools

| Command | What it does |
| --- | --- |
| `npm run cover` | Renders `cover.png` (1600×1000) from the real game scene and copies it into `dist/` |
| `npm run models` | Packs any `assets/*.glb` into `public/models/*.json` for the game to load |
| `npm run models:probe` | Writes a tiny synthetic model, to verify the packed-model path works |
| `npm run startng:check` | Asks start.ng whether this repository would go live (`POST /games/check`) |
| `npm run startng:publish` | Publishes to start.ng (`POST /games/publish`) |

## Publishing

1. `npm run build` and commit `dist/`.
2. `git push` — start.ng watches the branch and updates the live game within a minute or two.
3. The first time only: `npm run startng:check`, fix anything it reports, then
   `npm run startng:publish` and open the `approve_url` it prints.

The game is published as **`sky-combat`** and plays at <https://sky-combat.start.ng>.

## Project structure

```
src/
  index.html          the page (the Vite entry — there is deliberately none at the repo root)
  main.js             boot: WebGL probe, loading screen, menu, automation surface
  game/               Game.js (renderer, loop, scene wiring), GameState.js, config.js
  scene/              Sky.js, Lighting.js, World.js, CameraController.js
  aircraft/           AircraftFactory.js, PlayerAircraft.js, AircraftController.js
  assets/             loft.js, textures.js, modelRegistry.js, base64.js, models/Fighter.js
  systems/            QualityManager.js
  ui/                 MainMenu.js, Loading.js, FatalPanel.js, PerfReadout.js
  data/               aircraft.js, zones.js
  styles/             main.css, screens.css
public/               copied verbatim into dist/: startng.json, cover.png, favicon.svg, models/
assets/               source art (licensed .glb masters) — never shipped
tools/                serve, cover, pack-models, check, publish
tests/                unit.test.mjs, assets.test.mjs, content.test.mjs, smoke.mjs
docs/                 PLATFORM.md, ASSETS.md
dist/                 the committed, ready-to-play build
```

Two documents carry the reasoning behind the structure: **[docs/PLATFORM.md](docs/PLATFORM.md)**
for the start.ng rules the project is built against, and **[docs/ASSETS.md](docs/ASSETS.md)**
for how the aircraft are modelled and why no `.glb` file is shipped.

## Stages

| Stage | Scope | State |
| --- | --- | --- |
| 1 | Repository and environment inspection, architecture, asset strategy | done |
| 2 | Vite + Three.js, scene, lighting, procedural Falcon, chase camera, menu | **this build** |
| 3 | Flight controls, banking, touch controls | next |
| 4 | Visual upgrade: scenery, materials, effects | |
| 5 | Obstacles, enemies, projectiles, collisions, combat | |
| 6 | Coins, fuel, power-ups, distance, difficulty | |
| 7 | Hangar, unlocks, weapon shop, local progression | |
| 8 | Scenery zones, audio, interface polish, optimisation | |
| 9 | start.ng identity, profile card, leaderboard | |
| 10 | Regression tests, production build, publish | |

## Licence

MIT — see [LICENSE](LICENSE).
