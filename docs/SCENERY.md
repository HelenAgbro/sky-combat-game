# The world

How Sky Combat builds a place to fly through, and how a second place would be added.

## The problem

The player flies in a straight line for minutes at a time at 140 m/s. That rules out the
obvious approaches:

- **A finite world** runs out. At 140 m/s a 10 km map is gone in seventy seconds.
- **A world that follows the player** — moving the scenery with the aircraft — makes
  everything appear to stand still, which is worse than running out.
- **Spawning and destroying scenery as the player moves** accumulates garbage. It works
  beautifully for a minute and then the frame time starts climbing as the collector works,
  which is exactly the failure the brief asks to avoid.

## The approach: a fixed pool on a deterministic grid

Nothing in the world is ever created or destroyed while the game is running. Every piece of
scenery is a member of a fixed pool, and the world is a *grid of cells* that the pool is
re-pointed at as the aircraft crosses from one cell into the next.

```
                  the world, as a grid of 2,600 m cells
        ┌─────┬─────┬─────┬─────┬─────┐
        │     │  ▓  │     │  ▓  │     │      ▓ = a cell that holds land
        ├─────┼─────┼─────┼─────┼─────┤
        │  ▓  │     │  ▓  │     │  ▓  │      Whether a cell holds land is decided by
        ├─────┼─────┼─────┼─────┼─────┤      hashing its coordinates — so the same
        │     │  ▓  │ [▓] │  ▓  │     │      stretch of world always has the same land,
        ├─────┼─────┼─────┼─────┼─────┤      however the player got there, and nothing
        │  ▓  │     │  ▓  │     │  ▓  │      has to be stored to remember it.
        ├─────┼─────┼─────┼─────┼─────┤
        │     │  ▓  │     │  ▓  │     │      [▓] = the cell the aircraft is in
        └─────┴─────┴─────┴─────┴─────┘
```

`scene/islandLayout.js` does the hashing and the placement; `scene/Terrain.js` owns the
pool. Crossing a cell boundary re-points fourteen meshes at fourteen cells and costs about
a hundred microseconds — it happens roughly every thirty seconds at cruise speed.

The clouds work the same way with a ring instead of a grid: `scene/cloudLayout.js` places
them in a 900–5,400 m annulus around the aircraft, and a cloud that drifts outside it is
moved to a new spot ahead of the player. `scene/Clouds.js` draws the whole field as one
`InstancedMesh`, so thirty clouds cost one draw call.

**Nothing accumulates.** The acceptance test flies for eight seconds and then compares the
scene's geometry, material and texture counts against the counts before it started; they
have to be identical.

## What the world is made of

| Layer | Where it lives | What it costs |
| --- | --- | --- |
| Sky, sun, environment map | `scene/Sky.js` | 1 draw call, one shader |
| Distant horizon band | `scene/DistantRidge.js` | 1 draw call, one generated texture |
| Cumulus and cirrus | `scene/Clouds.js` | 2 draw calls |
| Land | `scene/Terrain.js` | 6–14 draw calls, no shadow casting |
| Water | `scene/World.js` | 1 draw call, two texture samples per pixel |
| Hazards | `combat/Obstacles.js` | 3 draw calls per hazard, up to 12 |
| Enemies | `combat/Enemies.js` | 5 draw calls per enemy, up to 7 |
| Shots and impacts | `combat/Projectiles.js`, `combat/Impacts.js` | 3 draw calls in total |

### The horizon band

A cylinder 8.5 km out, carrying a generated silhouette of layered ridges, following the
camera so it never gets closer. It is deliberately **not** fogged — at 8.5 km the fog would
swallow it whole — so the haze is baked into the texture's layer opacities and the band is
tinted per zone. That is what turns the horizon from a flat line where the water meets the
sky into somewhere with land beyond it, for one draw call.

## Scenery kinds

A zone *names* a kind; the kind carries the numbers. `scene/scenery.js` holds them, and
`scene/Terrain.js` turns them into a heightfield: height, footprint, how many summits, how
full the profile is, how jagged the outline, and the colour bands by height.

| Kind | Built? | Art-directed? | Notes |
| --- | --- | --- | --- |
| `islands` | yes | **yes** — the coastal zone, and the one that has been flown and reviewed | Low islands: a beach, grass, a rocky crown. 190 m at the summit |
| `mountains` | yes | no | Ridges with three summits and a much fuller profile. 1,250 m at the summit |
| `none` | yes | yes | Open water in every direction, for a zone with no land at all |

The ridge kinds are the same idea for the horizon band: `none`, `coast`, `peaks` and
`dunes`.

`mountains` exists to prove the architecture holds a second, very different kind. It is
implemented and unit tested — asserted to be more than three times taller than the island
kind, and to face upward — but it has **not** been art-directed. Saying so is more useful
than pretending otherwise.

## Adding a zone

Adding a sixth zone is data:

1. add an entry to `src/data/zones.js` with its palette, atmosphere, exposure, a `scenery`
   kind and a `ridge` kind;
2. that is all. `ZoneDirector` picks it up, and `scene/Sky.js`, `scene/World.js`,
   `scene/Lighting.js`, `scene/Clouds.js`, `scene/Terrain.js` and `scene/DistantRidge.js`
   already know how to dress themselves for it.

A new *kind* — a volcanic archipelago, say — is one entry in `scene/scenery.js`.

## Transitions

`scene/ZoneDirector.js` owns which zone is on show. `Game.setZone(id, { seconds })`, or
`window.__sky.setZone(...)` from the console, starts a cross-fade, and every module is handed
a **blended** zone each frame, so the sky, the water, the fog, the light, the clouds and the
land move together rather than snapping one at a time.

Two things are handled specially:

- **The environment map** is rebuilt six times across a transition rather than every frame.
  A PMREM render per frame would cost more than the whole scene, and the eye reads the
  colour change rather than the reflection.
- **Geometry cannot be interpolated**, so the scenery kinds flip at the midpoint, where the
  two descriptions are least alike. The terrain and the horizon band notice the new kind and
  rebuild themselves. `scene/zoneBlend.js` is the pure maths, and the unit tests assert that
  a blend is entirely the source zone at 0, entirely the destination at 1, and between the
  two in the middle.

Only the coastal zone is polished. The other four have complete palettes and scenery kinds
and can be switched to today — the acceptance test flies a full transition to the storm zone
and back — but they have not been art-directed, and the brief for this stage was explicitly
not to build them all yet.

## What is deliberately absent

- **Terrain collision.** The land is scenery around the edges of the play area, low enough
  that the aircraft's normal altitude band clears it — but a determined dive to the floor
  can pass through an island. Making the terrain part of the level design, with collision,
  is a job for the zone work rather than for the world generator.
- **Streamed tiles.** Everything is generated in code, so there is nothing to load and a
  transition is a cross-fade rather than a streamed tile set.
- **Volumetric clouds and cloud shadows.** One shadow pass, not two.
- **Water displacement and shoreline foam.** A flat surface with two normal layers is the
  right cost for a game played at 400 m.

## Checking it

```bash
npm run test:unit          # the grid, the hash, the ring and the blend maths
npm run test:acceptance    # group 8: the resource budget; group 9: a full zone transition
```
