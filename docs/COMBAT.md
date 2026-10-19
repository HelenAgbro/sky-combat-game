# The fight

Sky Combat's combat: fictional arcade dogfighting — enemies that fly readable patterns, a
gun, and balloons to fly around. Nothing here models a real air force, and nothing here is a
real tactic.

## What is in the air

| Thing | Where | Pooled? | Count (high tier) |
| --- | --- | --- | --- |
| Enemy aircraft | `combat/Enemies.js` | yes, one model per slot built at start-up | 7 |
| Hazard balloons | `combat/Obstacles.js` | yes, one merged model cloned per slot | 12 |
| Player shots | `combat/Projectiles.js` | yes, one `InstancedMesh` | 64 |
| Enemy shots | `combat/Projectiles.js` | yes, one `InstancedMesh` | 48 |
| Hit and kill flashes | `combat/Impacts.js` | yes, one `InstancedMesh` | 32 |
| The director | `combat/Combat.js` | — | — |

`combat/Pool.js` is the whole of the memory story: every object is created once at
construction, the active ones are kept contiguous so iterating them is a plain loop, and
releasing one swaps the last active object into the gap. Acquiring and releasing are array
operations. **Nothing is allocated while the game is running**, which is what keeps the frame
time flat after ten minutes of fighting rather than climbing as the collector works.

## Where it runs, and why that makes pause work

`Combat.update(dt, player)` is called from the game's **fixed simulation step**, not from the
render loop. That is the entire answer to "pause all combat updates when the game is paused":
when the game is paused the step is not taken, so no enemy moves, no shot travels, no cooldown
ticks and no collision is tested — and none of the combat code knows anything about pausing.

Presentation is separate: `Combat.updateVisuals(dt, camera)` faces the impact flashes at the
camera once per rendered frame, after the camera has moved.

## Collisions

Everything is a sphere, and everything is tested against **the segment the object swept during
the step**, not against its position:

```js
sweptSphereHit(from, to, centre, radius)   // combat/collisions.js
```

This matters more than it sounds. A shot travels at 640 m/s, which is more than ten metres in
a single 60 Hz step, and an enemy's collision radius is nine metres. A point test would have
the shot in front of the target on one step and behind it on the next, and would miss most of
the shots that should have connected. The unit tests assert the tunnelling case directly: a
shot that starts fifteen metres short of a target and ends fifteen metres past it, with
neither endpoint inside it, is still caught.

| Pair | Volume | What happens |
| --- | --- | --- |
| Player shot → enemy | swept sphere | damage, a small flash, and a kill if the hull is spent |
| Enemy shot → player | swept sphere | damage, subject to the grace window |
| Player → enemy | sphere overlap | the enemy comes apart, **no kill is credited** |
| Player → hazard | sphere overlap | the hazard bursts and is released |

Ramming an enemy deliberately does not score: the player did not shoot it, and crediting it
would let a player farm the scoreboard by flying into things.

## The three rules that stop duplicates

These are the acceptance criteria that are easiest to get wrong, so they are structural rather
than hopeful:

1. **A shot that connects is released in the same call that applies the damage.** One shot,
   one hit; it cannot be found by the next enemy in the loop.
2. **A kill awards the score and removes the enemy in the same call.** A released enemy is
   inactive, and every path into the reward checks `enemy.active` first, so no sequence of
   events can score the same enemy twice. The acceptance test fires a burst that lands three
   hits on one enemy and asserts that exactly one kill was awarded.
3. **The run ends once.** `#ended` is set the first time the hull reaches zero and nothing
   after that can fire a second game over; `Game` ignores a repeat, and the state machine
   refuses a second move to RESULTS. The grace window is the other half: without it, one pass
   through one hazard would take the hull down in a handful of frames and read as an
   unexplained loss. The acceptance test asserts that one hazard takes about one hazard's
   worth off the hull, not several.

## Spawn safety

`combat/spawn.js` is pure and unit tested, because "enemies must not spawn in unavoidable
positions" is a promise the placement rules have to keep. Three rules do it:

1. nothing appears closer than 750 m (enemies) or 1,000 m (hazards), so there is always time
   to react;
2. nothing appears on the player's own flight path — every spawn is offset sideways by at
   least 80 m, so it is always something to fly around rather than something to fly into;
3. nothing is placed outside the play area, so a spawn can never be somewhere the player is
   not allowed to go.

The unit tests run 500 placements and assert all three.

Enemies are also pointed *across* the player's path rather than straight down it. A head-on
enemy closes at two hundred metres a second and gives the player nothing to aim at; one
crossing the view is a fight.

## Enemies

They do not use the flight model. They fly **patterns** — a target heading and climb from a
small function, which the enemy then turns toward at a fixed rate, banking into the turn. That
is deliberate: a pattern is readable, which is what an arcade dogfight needs, and it costs a
handful of trigonometry per enemy per step rather than a second flight simulation.

| Pattern | Behaviour |
| --- | --- |
| `patrol` | straight and level with a slow altitude change — the one to learn on |
| `weave` | a wide lateral weave: harder to lead, still entirely predictable |
| `orbit` | holds a station off the player: always in view, always moving across the frame |
| `engage` | turns in toward the player while far away, then breaks off past them |

The three enemy types (`src/data/enemies.js` — Wasp, Kite, Ember) are fictional: shapes for
the same airframe builder the player's aircraft uses, with liveries chosen to be unmistakable
at range. Each is merged down to one mesh per material (`assets/mergeStaticParts.js`) and then
cloned, so seven enemies share three sets of geometry and materials rather than costing three
hundred draw calls.

## The difficulty ramp

`combat/difficulty.js` is pure: elapsed seconds in, difficulty out. Every value is interpolated
between two numbers in `COMBAT.ramp`, so tuning the fight is editing two values rather than
hunting for a rule. Over 150 seconds the spawn interval falls from 8 s to 2.8 s, the enemy
ceiling rises from 2 to 6, they fly 44% faster and shoot 2.5× as often.

## What is deliberately absent

- **Missiles, bombs and special weapons.** The gun is the whole arsenal for now; payloads and
  the shop belong with progression.
- **Anything resembling real tactics.** Enemies do not coordinate, do not use terrain, do not
  form up and do not flee.
- **Damage to individual systems.** The hull is one number.
- **Enemy-versus-enemy collisions.** Two enemies can fly through each other.
- **Score for a collision.** Ramming wrecks the enemy and costs the player hull, and nobody
  is credited.

## Checking it

```bash
npm run test:unit          # collisions, the ramp, placement, patterns, the pool
npm run test:acceptance    # group 10: firing, hits, kills, a collision, and the frame rate
```
