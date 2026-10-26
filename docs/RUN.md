# The run

A *run* is one flight, from the start button to the summary. This document covers its life:
which state it is in, how distance is measured, how the fight gets harder, what a pause holds,
what has to happen exactly once at the end, what a replay puts back, and the one number that
outlives it all.

## States

`game/GameState.js` is a small state machine with no DOM and no Three.js in it, so the same
rules apply to the interface, the scene and the tests. Only these moves are legal; anything
else is refused (and reported), never thrown.

| State | Called | What runs |
| --- | --- | --- |
| `menu` | Menu | The scripted demo sortie is the backdrop; the loop renders. |
| `flying` | Playing | The aircraft, the fight, the pickups, the clocks, the fuel. |
| `paused` | Paused | Rendering only. Every simulation step is skipped. |
| `results` | Game over | The wreck glides on with the controls centred. No rules run. |
| `loading`, `error`, `boot` | — | Start-up and the WebGL failure panel. |

```
menu ──start──► flying ──pause──► paused
  ▲               │  ▲               │
  │               │  └────resume─────┘
  │               │
  └──toMenu───────┴──endRun──► results ──start──► flying
                                 └──toMenu──► menu
```

`FLYING` is the brief's *playing* and `RESULTS` is *game over*; the names are the ones the code
already used, and renaming them would have churned every caller for no gain.

## Distance

The odometer is `AircraftController.distance`, advanced by `run/distance.js`:

```
distance += speed × dt      once per fixed simulation step
```

It is the flight model's own speed, integrated on the **fixed 60 Hz step**, so the same second
of flight covers the same ground whether the display managed 30 frames in it or 240. The rule is
a function — `advanceDistance` — rather than an inline `+=`, so the unit tests can prove that
(1 s at 80 m/s is 80 m at 30, 60, 144 and 240 fps) and so that nonsense in gives zero out
instead of `NaN`. A `NaN` odometer would poison the panel, the record and the ramp at once.

**The run's distance stops when the run does.** While the summary is up the wreck keeps flying,
and its odometer keeps climbing; so `Game` freezes a copy of the run at the instant it ends
(`#freezeRun`) and every reading — the panel, the record, the telemetry — comes from that copy.
Otherwise the distance on screen would quietly grow while the player read it.

The readout is shared by the HUD, the menu and the summary (`formatDistance`): whole metres up
to ten kilometres, then one decimal of a kilometre.

## The local record

`run/progress.js` keeps the best distance in `localStorage` under
`sky-combat.bestDistance.v1`:

- **only the end of a run writes it**, and only when the run beats it — never on replay, never
  on a pause;
- it is **never lowered**, and equalling it is not a record;
- a missing store (private mode, blocked storage, no origin) costs the player nothing: reads
  answer `0`, writes are swallowed, and the session still remembers what the browser would not;
- junk in the key (`"abc"`, `"-40"`, `"Infinity"`, a half-written value) is read as *no record*,
  so it cannot put `NaN` on a panel or make every run look like a record.

It is shown where it is worth something: the menu says what to beat, the HUD turns the distance
into the accent colour once the run passes it, and the summary prints it next to the run's own
distance with a **New best distance** chip when it falls. `localStorage` is per browser and per
device; the shared leaderboard is a start.ng feature (Stage 10), not this.

## The difficulty ramp

`combat/difficulty.js` is pure: metres in, settings out. Two numbers in `COMBAT.ramp` describe
the whole curve — `grace` (1 200 m) and `distance` (12 000 m) — and each setting is a `[from, to]`
pair interpolated by an **eased** position on it.

| Setting | Start | Top |
| --- | --- | --- |
| Seconds between enemies | 8 | 2.8 |
| Enemies alive (ceiling) | 2 | 6 |
| Enemy speed multiplier | 0.8 | 1.15 |
| Enemy fire-rate multiplier | 0.4 | 1 |
| Seconds between balloons | 3.4 | 2.2 |

Three decisions make it fair rather than merely steeper:

1. **Distance, not the clock.** Circling for a minute does not earn a harder sky, and the ramp
   is driven by the same number the score is.
2. **A flat opening.** The first 1 200 m hold the easiest setting exactly, so a new player
   learns the controls against the fight they were taught on.
3. **Easing (smoothstep), not linear.** Linear joins the opening with a crease and arrives at
   its hardest setting at full speed. Smoothstep is flat at both ends, so neighbours on the ramp
   differ by almost nothing; the unit test walks the ramp in 20 m steps and fails if any step
   jumps or if the level ever eases back.

The hazards ramp with the fight — the cadence is handed to `Obstacles.update` by `Combat` rather
than read from a second timer, so there is only one answer to "how busy is the sky".

## Pause

`Game.pause()` is only legal from `FLYING`; asking from the menu or the summary answers `false`
without touching the state machine, so a stray key press cannot print a refused transition or
interrupt a summary being read. (After `#endRun`, `Combat.finish()` has already closed the fight
too, so there is no "one frame of danger" window either.)

While paused the simulation is skipped entirely — the accumulator keeps no time to make up, so
resuming does not fast-forward. What that holds still, all at once:

- the aircraft and its fuel;
- the run's power-up clocks (the boost stays at 4.98 s, then continues from 4.98 s);
- enemy movement, spawn timers, balloons and every projectile;
- the run's distance and elapsed time.

What keeps going is the **rendering**: the scene, the clouds, the camera and the pause screen
itself. That is what makes a pause look like a pause rather than a freeze, and it is why pause
never needs a second animation loop.

## Game over

Everything that ends a run goes through one door, `Game.#endRun`, and the first line refuses a
second call. That is what makes "one run, one game over" a property of the code rather than a
hope: `Combat` sets its own `ended` flag before emitting, the state machine refuses a second
move to `RESULTS`, and `#endRun` only accepts `FLYING`.

The order is deliberate:

1. **Stop the fight** — `Combat.finish()`, even when fuel caused the ending and the hull never
   saw it. Nothing spawns, fires or takes damage after this.
2. **Freeze the run** — distance, elapsed, coins, kills, score, shots, accuracy, hull and fuel
   are copied once, and the local record is banked from the frozen distance.
3. **End the effects** — the power-up clocks are cleared and applied through the same
   state-to-effects path a live flight uses, so `speedScale` returns to 1 and the gun unloads.
   A boost cannot outlive the aircraft.
4. **Move the state** to `RESULTS` and **report once** with the frozen numbers.

The rules stop there; the wreck glides on with the controls centred so the camera has something
to follow. Enemy aircraft, balloons, pickups and shots hold their last position — the summary is
a still life, not a second simulation.

The summary reports distance, the local best, enemies defeated, coins, score, time, shots fired
and accuracy, and its title says which ending happened: **Out of fuel** or **Aircraft
destroyed**. The reason travels with it (`reason: 'fuel' | 'gunfire' | ...`) for the tests.

## Replay

**Fly again** calls `Game.start()`, which resets everything a run owns:

| Reset | Kept |
| --- | --- |
| Aircraft position, attitude, speed, fuel, `speedScale`, odometer, elapsed | The local best distance |
| Every enemy, balloon, shot, impact (back to their pools) | The menu's aircraft line, the quality tier, the scene |
| Coins, power-up slots and clocks, pickups in the air | The event listeners |
| The fight's hull, kills, score, shots, accuracy, grace, level | |
| The frozen summary (so the new run reports its own numbers) | |

Two things are protected structurally rather than by memory: `Game.#run()` starts the animation
loop only once (`started`), and `start()` rewires nothing — the `destroyed`, `frame` and state
listeners are attached once at boot, so a replay cannot stack a second loop or a second summary.
The acceptance check counts the `destroyed` listeners before and after a replay and fails if the
number changed.

## What is deliberately absent

- **Hangar, shop and leaderboard.** The summary carries the three buttons, disabled and labelled,
  because a placeholder that looks live is worse than one that says it is not ready. They arrive
  in Stages 8 and 10.
- **A server-side record.** The best distance is local. start.ng identity and the shared
  leaderboard are Stage 10.
- **Continues, extra lives, or a score multiplier.** One run, one ending.

## Testing

```bash
npm run test:unit          # distance, the ramp's fairness, the record, the run state
npm run test:acceptance    # group 12: the whole lifecycle in a real browser
```

The unit tests hold the arithmetic: distance at 30/60/144/240 fps, a nonsense step adding
nothing, `formatDistance` at both edges, the first 1 200 m being flat, every 20 m step of the
ramp being a nudge and never a jump, the record never being lowered, and a store that throws
costing the flight nothing.

Group 12 holds the behaviour: distance grows at the rate the aircraft is flying, 7.2 km of
distance puts the ramp at half-way after 2.6 s of flight (so it cannot be on the clock), pause
holds the distance, the fuel, the elapsed time, the boost clock and the enemy count, one run
produces exactly one game-over report even with a hazard in the same step, the summary's
distance does not drift while the wreck coasts, the record is written and shown, **Fly again**
starts at zero with no enemies, shots, power-ups or inherited effects and no extra listener,
and the record survives a page reload and a worse run.

