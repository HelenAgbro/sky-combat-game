# Coins, fuel and power-ups

What the player collects, what it costs, and what it gives back.

## What is in the air

| Thing | Where | Pooled? | Count (high tier) |
| --- | --- | --- | --- |
| Coins | `pickups/Pickups.js` | yes, one `InstancedMesh` | 64 |
| Fuel canisters | `pickups/Pickups.js` | yes, a merged model cloned per slot | 4 |
| Speed boost | `pickups/Pickups.js` | yes, as above | 2 |
| Heavy rounds | `pickups/Pickups.js` | yes, as above | 2 |

`combat/Pool.js` is reused, so a collectible is created once and then switched on and off
rather than built and thrown away. A coin is an instance of one shared disc geometry; a
canister or a crate is a merged mesh cloned once per slot, exactly as the hazard balloons
are. Collecting writes into an object that already exists.

The three supplies are drawn in the same colours as their HUD chips, and each has its own
silhouette — a drum, a chevron, a banded crate — so they are told apart by shape as well as
by colour.

## Coin patterns

A pattern is a *shape*, described as data in `pickups/pickupLayout.js` and anchored at a
point ahead of the aircraft, then expressed in the aircraft's own frame. A run of coins
therefore runs down the flight path whatever direction the player happens to be flying,
rather than down the world's Z axis.

| Pattern | Shape | Count |
| --- | --- | --- |
| `line` | straight ahead — flown through without touching the stick | 9 |
| `arc` | one gentle bow, and a slow climb | 11 |
| `column` | a vertical stack: a climb or a dive | 7 |
| `hoop` | a ring, to fly through the middle of | 12 |

Two rules keep them honest, and both are unit tested over 200 placements:

- **a pattern always appears ahead of the aircraft and inside the arena** — the altitude
  band is clamped and anything outside the soft radius is pulled back in, so a coin can
  never appear somewhere the player is not allowed to fly;
- **a pattern never repeats twice in a row**, because two identical shapes back to back read
  as one long broken pattern rather than as two.

A column that does not fit between the player and the altitude limit would be flattened
against the floor and stop reading as a column, so the coin toss for which way it goes is
overruled when the chosen way does not fit. That one was found by a test rather than by
flying.

## Fuel

Fuel is a clock the player can see, and one they can reset.

- **It burns with throttle and afterburner** — `FLIGHT.fuelBurnPerSecond`, multiplied by
  `0.45 + throttle × 0.55` and by `boostBurnMultiplier` when the burner is lit, divided by
  the airframe's own fuel rating. A Falcon at cruise is worth about a hundred seconds; flat
  out on the burner, about a third of that.
- **It is clamped to 0–1 in one place.** `AircraftController.refuel` is the only thing that
  adds fuel, and it returns what it actually took — so a canister collected with a full tank
  is a canister wasted, never a tank of 1.3.
- **Empty ends the run**, through the same `#endRun` the hull uses. The summary says "Out of
  fuel" rather than "Aircraft destroyed", because the aircraft is fine.
- **The HUD warns below `FLIGHT.lowFuelWarning`** (22%), with an amber number, an amber bar
  and a line of text.

## Power-ups

Two, and one rule each for what happens when they overlap.

| Id | Name | Lasts | Does |
| --- | --- | --- | --- |
| `speed` | Speed boost | 8 s | ×1.45 on the speed ceiling |
| `ammo` | Heavy rounds | 9 s | ×2.2 on the gun's damage, and a hotter tracer |

The overlap rules, which the brief asks to be *defined* rather than left to chance:

1. **The same kind never stacks.** Taking a second refreshes the timer to a full duration
   but never beyond it, so collecting five in a row is worth the same eight seconds as
   collecting one. A run cannot bank a minute of boost.
2. **Different kinds run independently.** Speed and heavy rounds can be active together,
   each on its own clock, and one expiring does not touch the other.

The timers live in `pickups/powerUps.js` — pure functions, timers in and timers out — so the
awkward cases (refreshing mid-effect, two at once, expiring on the exact step a timer reaches
zero) are unit tested rather than flown. `advance` reports an expiry on exactly one step, so
the expiry effect fires once.

The effects are handed to the systems that consume them every simulation step, from `Game`,
which is the one place that owns them: the flight model is told its speed multiplier and the
gun is told its damage multiplier. Neither asks, so an effect that has just run out cannot
leave either of them loaded for even one extra step.

## Where it runs, and why that makes pause work

`Pickups.update(dt, player)` is called from the game's **fixed simulation step**, not from
the render loop. So when the game is paused, no timer moves, no coin is laid out and nothing
is collected — and none of this code knows what a pause is.

## Starting clean

`Pickups.reset()` empties both pools, zeroes the counters and clears the power-up timers;
`AircraftController.reset()` restores a full tank and clears the speed boost it was granted.
`Game.start()` and `Game.toMenu()` call both. A new run therefore inherits no coins, no fuel
and no temporary effects — which is asserted directly in the unit tests and again in the
browser, through a whole run that ends on empty and then restarts.

## What is deliberately absent

- **The shop, and anything to spend coins on.** Coins are *counted* this stage, not scored:
  what they are worth is the hangar's business, and that is the next stage. `docs/COMBAT.md`
  covers the score, which is still kills alone.
- **Coin magnets, multipliers and streaks.** One coin is one coin.
- **A fuel reserve that empties over distance rather than time.** The burn is per second, and
  it already scales with throttle and boost, which is what makes flying fast a decision.
- **Power-ups that stack with themselves.** Deliberate — see the overlap rules above.

## Checking it

```bash
npm run test:unit          # the patterns, the recycle rules, the timers, the overlap cases
npm run test:acceptance    # group 11: a coin collected once, fuel, a power-up, and a restart
```

