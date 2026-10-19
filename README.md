# Sky Combat

A 3D aerial combat arcade game for [start.ng](https://start.ng) — third-person fighter
jet flight over sweeping scenery, with coins, power-ups, fuel, enemies and a public
leaderboard ranked on distance.

**Stage 4 status: aircraft assets and visual quality.** You can fly it, and it looks
like a place now: detailed airframes with moving control surfaces, an afterburner, a
cloud layer, land, an improved sky and water with distance-faded detail. Enemies,
weapons, coins, fuel, the hangar, the shop and the start.ng integration are Stages 5–9 —
see [Stages](#stages).

> **The aircraft is temporary artwork.** No licensed model is available yet — the
> obvious sources were checked and none of them has a detailed fighter under a licence
> this project can use (the findings are in [docs/ASSETS.md](docs/ASSETS.md)) — and
> start.ng cannot serve `.glb`/`.gltf` files anyway, so the airframes are generated in
> code. They are complete, fully-modelled shapes rather than placeholder primitives, but
> they are still a stand-in, and the main menu says so. A licensed model drops in with no
> code changes.

---

## Controls

| Action | Keyboard | Touch |
| --- | --- | --- |
| Climb / dive | `W` / `S` or `↑` / `↓` | Drag the stick up / down |
| Roll and turn | `A` / `D` or `←` / `→` | Drag the stick left / right |
| Rudder (fine aiming) | `Q` / `E` | — |
| Boost | `Shift` | Boost button |
| Fire | `Space` | Fire button *(reserved for the combat stage)* |
| Pause / resume | `P` or `Escape` | Pause button |

The throttle is automatic: the aircraft holds a cruise setting and `Shift` is the
afterburner. Banking is what turns the aircraft — there is no separate turn key — and
the aircraft levels itself when you let go of the stick.

The on-screen controls appear automatically on a coarse-pointer device, or when the
page is opened with `?touch`. On a laptop with a touchscreen they appear the first time
a finger is used.

## Flight area

The aircraft is held inside a play area rather than fenced in by an invisible wall:

- a **floor** at 60 m and a **ceiling** at 1800 m, which ease the nose back up or down
  inside the last 130 m;
- a **soft edge** at 3400 m from the centre, which turns the aircraft back toward the
  middle, and a hard limit at 4200 m as the last resort.

The HUD tells you when a limit is being pushed against. Nothing teleports.

## Visual quality

Everything you can see is generated: the game ships **no image or model files at all**.

- **Aircraft.** Lofted superellipse fuselage, real NACA-style airfoil wings with sweep,
  dihedral and taper, a bubble canopy with a frame, intake duct, petal-ribbed nozzles,
  pylons with stores, wingtip missiles, ventral fins, an air-data probe and navigation
  lights. Paint is layered the way an airframe ages: repainted panels, panel lines,
  rivets, exhaust staining, gun gas, chipped paint along the panel lines, then the
  roundel and the maintenance stencils.
- **Moving surfaces.** All-moving stabilators, flaperons on the wing's trailing edge and
  a rudder per fin, each hinged where it belongs and deflected from the flight controls
  with an actuator-like damping — differential for roll, opposite for yaw.
- **Engine.** A plume and a hot core scaled by throttle, shock diamonds and a glowing
  nozzle that light up over a third of a second with the afterburner.
- **Sky.** A gradient dome with a compressed horizon, a haze band, forward scatter around
  the sun and a sun disc; the same dome becomes the environment map, so every reflection
  in the scene matches the sky behind it.
- **Atmosphere.** A cumulus layer in one instanced draw call, recycled in a ring around
  the aircraft, plus a drifting cirrus sheet high above.
- **Land.** Low-poly islands on a deterministic grid, so the same stretch of world always
  has the same land, however you got there.
- **Water.** A long swell with a fine ripple layer that fades out with distance — fine
  detail in a tiled normal map aliases into a grating when it is viewed at a grazing angle
  from 400 m up, so it is only sampled where the screen can resolve it.

**Nothing is created while flying.** The cloud field and the terrain are fixed pools that
are recycled in place, and the acceptance test measures the scene's geometry, material and
texture counts before and after eight seconds of hard flying to prove it.

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
npm run test:unit         # 57 pure-logic tests: flight model, state machine, quality tiers,
                          # cloud and island layout, control-surface signs, assets, data
npm run smoke             # opens dist/ in headless Chrome, flies, screenshots, fails on errors
npm run test:acceptance   # 9 browser checks: framing at six viewport shapes, resize, the WebGL
                          # failure path, keyboard and touch, pause, smoothness, the scene's
                          # resource budget, and cleanup
npm test                  # all three
```

`test:acceptance` is worth knowing about: it measures where the aircraft actually lands
on screen at phone, tablet, desktop and ultrawide sizes, sampling across a full weave so
every bank angle is covered. It caught the wingtips leaving the frame on a phone while
the camera offset was a fixed distance.

It also measures the aircraft's smoothness frame by frame, with the frame-rate limit
lifted, and compares how far the jet moved with how far its own frame duration required.
That check caught a shiver that was very visible on a fast display: the simulation runs
at a fixed 60 Hz, and without interpolating between steps the jet stood still for 92% of
rendered frames and then jumped.

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
  game/               Game.js (renderer, loop, scene wiring), GameState.js, config.js, math.js
  scene/              Sky.js, Clouds.js, Terrain.js, World.js, Lighting.js, Effects.js,
                      CameraController.js, cloudLayout.js, islandLayout.js
  aircraft/           AircraftFactory.js, PlayerAircraft.js, AircraftController.js, surfaces.js
  assets/             loft.js, textures.js, modelRegistry.js, base64.js, models/Fighter.js
  systems/            QualityManager.js, InputManager.js, controls.js
  ui/                 MainMenu.js, HUD.js, PauseScreen.js, TouchControls.js, Loading.js,
                      FatalPanel.js, PerfReadout.js
  data/               aircraft.js, zones.js
  styles/             main.css, screens.css, hud.css
public/               copied verbatim into dist/: startng.json, cover.png, favicon.svg, models/
assets/               source art (licensed .glb masters) — never shipped
tools/                serve, cover, pack-models, check, publish
tests/                unit, assets, content, controls, smoke, acceptance
docs/                 PLATFORM.md, ASSETS.md
dist/                 the committed, ready-to-play build
```

The layout modules (`cloudLayout.js`, `islandLayout.js`) and the surface angles
(`surfaces.js`) are deliberately pure — no Three.js, no DOM — so the recycling rules, the
hash grid and the hinge signs are unit tested in plain Node rather than eyeballed.

Two documents carry the reasoning behind the structure: **[docs/PLATFORM.md](docs/PLATFORM.md)**
for the start.ng rules the project is built against, and **[docs/ASSETS.md](docs/ASSETS.md)**
for how the aircraft are modelled and why no `.glb` file is shipped.

## Stages

| Stage | Scope | State |
| --- | --- | --- |
| 1 | Repository and environment inspection, architecture, asset strategy | done |
| 2 | Vite + Three.js, scene, lighting, procedural Falcon, chase camera, menu | done |
| 3 | Flight controls, banking, touch controls, flight area, engine glow | done |
| 4 | Aircraft assets and visual quality: airframe detail, materials, afterburner, sky, clouds, land, water | **this build** |
| 5 | Obstacles, enemies, projectiles, collisions, combat | next |
| 6 | Coins, fuel, power-ups, distance, difficulty | |
| 7 | Hangar, unlocks, weapon shop, local progression | |
| 8 | Scenery zones, audio, interface polish, optimisation | |
| 9 | start.ng identity, profile card, leaderboard | |
| 10 | Regression tests, production build, publish | |

## Licence

MIT — see [LICENSE](LICENSE).
