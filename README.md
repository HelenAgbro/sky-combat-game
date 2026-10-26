# Sky Combat

A 3D aerial combat arcade game for [start.ng](https://start.ng) — third-person fighter
jet flight over sweeping scenery, with coins, power-ups, fuel, enemies and a public
leaderboard ranked on distance.

**Stage 7 status: the run has resources.** You can fly it, the world is continuous, there are
enemies to shoot and balloons to fly around, and now coins to collect, a tank that empties
and power-ups that run on a clock. The hangar, the shop and the start.ng integration are
Stages 8–10 — see [Stages](#stages).

> **The aircraft is temporary artwork.** No licensed model is available yet — the obvious
> sources were checked and none of them has a detailed fighter under a licence this project
> can use (the findings are in [docs/ASSETS.md](docs/ASSETS.md)) — and start.ng cannot serve
> `.glb`/`.gltf` files anyway, so the airframes are generated in code. They are complete,
> fully-modelled shapes rather than placeholder primitives, but they are still a stand-in,
> and the main menu says so. A licensed model drops in with no code changes.

---

## Controls

| Action | Keyboard | Touch |
| --- | --- | --- |
| Climb / dive | `W` / `S` or `↑` / `↓` | Drag the stick up / down |
| Roll and turn | `A` / `D` or `←` / `→` | Drag the stick left / right |
| Rudder (fine aiming) | `Q` / `E` | — |
| Fire | `Space` | Fire button |
| Boost | `Shift` | Boost button |
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

## The fight

Fictional arcade dogfighting. There are three enemy aircraft (Wasp, Kite and Ember), a gun,
and tethered balloons to fly around. Nothing here models a real air force.

- **Enemies** fly readable patterns — patrol, weave, orbit and engage — rather than a flight
  model, and they are always placed *off* your flight path so every one is avoidable. They
  arrive more often, fly faster and shoot more as the run goes on.
- **The gun** fires at its own cadence while you hold it, and inherits your own speed, so
  flying fast makes it hit harder. The reticle is drawn where the nose actually points, not
  in the middle of the frame.
- **Hazards** are balloons drifting in your altitude band. Flying into one bursts it and
  takes a third of your hull.
- **The run ends** when the hull reaches zero or the tank runs dry, and the summary reports
  distance, kills, coins, score, time, shots fired and accuracy — with a title that says
  which of the two happened.

**Nothing is allocated while the fight runs.** Enemies, hazards, shots and hit flashes are
all fixed pools created at start-up, and a shot or an enemy that is done is handed straight
back. `docs/COMBAT.md` has the details, including the three rules that make a duplicate score
event structurally impossible.

## Coins, fuel and power-ups

What the run collects, all of it pooled on the same recycled-grid principle as the fight.

- **Coins** arrive in patterns — a line, a shallow arc, a slalom of four to seven, 46 m
  apart — centred ahead of the aircraft and allowed to sit *on* the flight line, because
  they are a reward rather than something to dodge. A coin is released in the same call that
  credits it, so collecting one twice is structurally impossible rather than merely unlikely.
- **Fuel** burns faster with the throttle open and far faster on boost: a full tank is about
  111 s at full throttle and 247 s at idle. It is clamped to `0…1` in both directions, shown
  as a bar that turns amber below a quarter, and an empty tank ends the run — calling the
  same "end it once" path a hull loss uses.
- **Power-ups** fill two slots: a **speed boost** (×1.3 ceiling, 12 s) and **heavy rounds**
  (×2.2 damage and a visibly longer, colder tracer, 10 s). Collecting the same one again
  refreshes it to full rather than stacking; different ones run their own clocks. The HUD
  shows a chip per effect with its countdown, and the chip leaves with the effect because the
  chip only ever reads the state.

Both canisters and orbs stand under a coloured beacon, so they can be found from the far end
of their 2.2 km spawn range: amber for fuel, the power-up's own colour for an orb.

Every fixed step the game sets the aircraft and the gun to match the power-up clocks, instead
of switching effects on from one event and off from another — so a missed event cannot leave
a boost running or the gun loaded after a run has ended. A new run inherits none of it.

`docs/PICKUPS.md` has the numbers, the pooling budgets and the exact rules.

## The world

The world is continuous in every direction and never accumulates scenery: it is a grid of
cells with a fixed pool of landforms re-pointed at them as you fly, and a ring of clouds
recycled the same way. `docs/SCENERY.md` explains the whole system, including how a second
scenery zone would be added — it is data, not code.

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
npm run test:unit         # 106 pure-logic tests: flight model, state machine, quality tiers,
                          # cloud and island layout, zone blending, collisions, the difficulty
                          # ramp, spawn placement, enemy patterns, the object pool, fuel, the
                          # power-up clocks, coin patterns, pickups, assets, data
npm run smoke             # opens dist/ in headless Chrome, flies, screenshots, fails on errors
npm run test:acceptance   # 12 browser checks: framing at six viewport shapes, resize, the WebGL
                          # failure path, keyboard and touch, pause, smoothness, the scene's
                          # resource budget, a full zone transition, the fight, and the run's
                          # coins, fuel and power-ups
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
  main.js             boot: WebGL probe, loading screen, menu, results, automation surface
  game/               Game.js (renderer, loop, scene wiring), GameState.js, config.js, math.js
  scene/              Sky.js, Clouds.js, Terrain.js, DistantRidge.js, World.js, Lighting.js,
                      Effects.js, CameraController.js, ZoneDirector.js, zoneBlend.js,
                      scenery.js, cloudLayout.js, islandLayout.js
  aircraft/           AircraftFactory.js, PlayerAircraft.js, AircraftController.js, surfaces.js
  combat/             Combat.js, Enemies.js, Obstacles.js, Projectiles.js, Impacts.js, Pool.js,
                      collisions.js, difficulty.js, motion.js, spawn.js
  run/                RunState.js, Pickups.js, powerups.js (timers), fuel.js (burn rules),
                      pickupLayout.js (coin patterns)
  assets/             loft.js, textures.js, mergeStaticParts.js, modelRegistry.js, base64.js,
                      models/Fighter.js
  systems/            QualityManager.js, InputManager.js, controls.js
  ui/                 MainMenu.js, HUD.js, PauseScreen.js, ResultsScreen.js, TouchControls.js,
                      Loading.js, FatalPanel.js, PerfReadout.js
  data/               aircraft.js, enemies.js, zones.js, powerups.js
  styles/             main.css, screens.css, hud.css
public/               copied verbatim into dist/: startng.json, cover.png, favicon.svg, models/
assets/               source art (licensed .glb masters) — never shipped
tools/                serve, cover, pack-models, check, publish
tests/                unit, combat, assets, content, controls, smoke, acceptance
docs/                 PLATFORM.md, ASSETS.md, SCENERY.md, COMBAT.md
dist/                 the committed, ready-to-play build
```

The layout modules (`cloudLayout.js`, `islandLayout.js`), the zone blend (`zoneBlend.js`), the
surface angles (`surfaces.js`), the fuel rules, the power-up timers, the coin patterns and
everything under `combat/` that is not a Three.js object are deliberately pure — no renderer,
no DOM — so the recycling rules, the hash grid, the hinge signs, the collision maths, the
difficulty ramp, the spawn placement, the burn rate, the pattern shapes and the expiry of a
buff are unit tested in plain Node rather than eyeballed.

Five documents carry the reasoning: **[docs/PLATFORM.md](docs/PLATFORM.md)** for the start.ng
rules the project is built against, **[docs/ASSETS.md](docs/ASSETS.md)** for how the aircraft
are modelled and why no `.glb` is shipped, **[docs/SCENERY.md](docs/SCENERY.md)** for the
continuous world, **[docs/COMBAT.md](docs/COMBAT.md)** for the fight, and
**[docs/PICKUPS.md](docs/PICKUPS.md)** for coins, fuel and power-ups.

## Stages

| Stage | Scope | State |
| --- | --- | --- |
| 1 | Repository and environment inspection, architecture, asset strategy | done |
| 2 | Vite + Three.js, scene, lighting, procedural Falcon, chase camera, menu | done |
| 3 | Flight controls, banking, touch controls, flight area, engine glow | done |
| 4 | Aircraft assets and visual quality: airframe detail, materials, afterburner, sky, clouds, land, water | done |
| 5 | Environment generation and scenery zones: distant terrain, kinds, transitions | **done, one zone polished** |
| 6 | Enemies, projectiles, obstacles and combat | done |
| 7 | Coins, fuel, power-ups, distance, difficulty | **this build** |
| 8 | Hangar, unlocks, weapon shop, local progression | next |
| 9 | Scenery zones art pass, audio, interface polish, optimisation | |
| 10 | start.ng identity, profile card, leaderboard, publish | |

## Licence

MIT — see [LICENSE](LICENSE).
