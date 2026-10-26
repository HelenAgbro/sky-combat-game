# Coins, fuel and power-ups

What the run collects, and the rules that keep collecting it fair. The numbers are in
`src/game/config.js` (`RUN`); this file explains what they mean and why.

## Coins

Coins are placed as **patterns**, not singles: a line, a shallow arc or a gentle slalom of
four to seven coins, 46 m apart, centred on a point 560–1500 m ahead of the aircraft.
The shape is written by `writePattern` in `src/run/pickupLayout.js`, which is pure and unit
tested — a line really is a line, an arc climbs no more than half a spacing, and a slalom
never wanders further than one spacing sideways.

Unlike enemies and hazards, coins are allowed to sit **on** the flight line
(`minLateralOffset: 0`). They are a reward for flying well, not something to dodge, so the
one thing that would make them unfair — being placed behind you — is exactly what
`chooseSpawnPoint` rules out.

A whole pattern is placed or none of it is: if the pool cannot fit every coin, the placement
is skipped and the 3 s cooldown tries again. A line that stops halfway reads as a bug.

**A coin is collected once.** Two things make that structural rather than careful:

1. collecting a coin releases it *in the same call* that reports the credit, so the code
   that credits the run and the code that finds the next overlap cannot disagree;
2. a released coin is inactive before the loop's next iteration, so a second test in the
   same step cannot find it, and its slot cannot come back until the pool hands it out.

The unit tests check both halves, and the acceptance suite flies an aircraft through a coin
and then offers the same coin twice in one step.

Coins are **not** added to the combat score. They are a separate currency, because Stage 8
spends them.

## Fuel

Fuel is part of the flight model (`AircraftController.fuel`), and the rules live in
`src/run/fuel.js`:

- **Configurable burn**: `FLIGHT.fuelBurnPerSecond` at full throttle, scaled by an idle
  factor of 0.45, multiplied by `boostBurnMultiplier` on the afterburner, and divided by the
  airframe's own fuel rating. A full tank is about 111 s at full throttle, 247 s at idle and
  around 131 s at cruise.
- **Clamped both ways**: fuel never goes below 0 and never above 1. The upper clamp matters
  as much as the lower one — a canister collected at 95% must not leave the aircraft holding
  120% and make the next few seconds of burn invisible.
- **Zero ends the run.** `Game` checks the tank after the aircraft has moved each step and
  calls the same `#endRun` the hull loss uses. That method refuses a second ending, so a
  collision and an empty tank in the same step cannot produce two summaries.

The HUD shows a bar and a percentage, which turn amber below 25% (`RUN.fuel.lowWarning`),
and the warning line says *Fuel low — find a canister*.

Canisters put back 25% of a tank each and arrive every 13 s from 14 s into a run, placed
700–2200 m ahead. They are the only pickup that can save a run rather than improve it, so
they are placed no more than 170 m off the line.

## Power-ups

Two slots, one per effect. Both are in `src/data/powerups.js`; the durations and magnitudes
are in `RUN.powerups`.

| Power-up | Effect | Duration |
| --- | --- | --- |
| Boost | The speed ceiling is multiplied by 1.3 | 12 s |
| Heavy rounds | Gun damage × 2.2, and the tracer is drawn 1.7× longer in a colder colour | 10 s |

The tracer change is deliberate: a power-up the player cannot see is a power-up they will not
notice. The muzzle flash is bigger and colder too, and every round keeps the power it was
**fired** with, so an expiring buff does not retroactively weaken shots already in the air.

**Overlapping power-ups have defined behaviour**, stated once in `src/run/powerups.js`:

- collecting the **same** power-up again refreshes it to its full duration — it never stacks
  and never runs past full;
- **different** power-ups run their own clocks and never shorten each other.

**Expiry is exact.** A slot goes inactive the moment `remaining` reaches zero, `remaining` is
never negative, and the chip leaves the HUD in the same frame.

**A new run inherits nothing.** `RunState.reset()` clears both slots, `AircraftController`
puts its speed scale back to 1, and the gun is unloaded, all inside `Game.start()`.

### The effects follow the state

Nothing is switched on by one event and off by another. Every fixed step, `Game` reads the
power-up state and sets the aircraft's speed scale and the gun's ammunition to match
(`#applyPowerups`). A missed event therefore cannot leave a boost running or the gun loaded,
and a timer that expires mid-frame is reflected in that frame. This is why the HUD only ever
reads the state, too: a chip cannot outlive the effect it describes.

`Game` also emits `powerup`, `refuelled` and `ammo` when something happens, for anything that
wants to react to it later (audio, achievements). Nothing the game does depends on them —
that is the point: the effects are already right without a listener.

## Pooling

Pickups are pooled like everything else in a run, and their capacity follows the quality
tier (`coins`, `fuel`, `powerups` in `src/systems/QualityManager.js`), capped by `RUN`:

| Pool | Low | Medium | High | Ceiling |
| --- | --- | --- | --- | --- |
| Coins | 24 | 36 | 48 | 48 |
| Canisters | 4 | 6 | 8 | 8 |
| Orbs | 2 | 4 | 6 | 6 |

Every coin in the sky is one instance of a single `InstancedMesh` — one draw call — and the
coins are billboarded to the camera with a slow roll so they read as tokens from any angle.
Canisters and orbs are cloned merged meshes: an orb is two draw calls (a lit shape and an
additive halo). Collection flashes borrow the fight's impact pool rather than owning one.

Both canisters and orbs also carry a **beacon**: a soft column of their own colour standing
110 m above them. They are spawned up to 2.2 km away, where a seven-metre canister is a few
pixels wide, and a coloured column is the cheapest thing that reads at that distance. It is
blended normally rather than additively — additive against a bright sky washes out to white
and loses the colour that says *fuel* or *heavy rounds*.

The model of a pickup is placed from its `position` every step, so what is drawn and what can
be collected can never drift apart.

## Checking it

```bash
npm run test:unit        # fuel, power-up timers, patterns, pooling, double collection
npm run test:acceptance  # group 11: a coin flown through, fuel burned and refilled,
                         # an empty tank ending the run, a power-up starting and expiring,
                         # the HUD, and a restart that inherits nothing
```
