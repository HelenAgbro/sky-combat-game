/**
 * Sky Combat — unit tests for the run's resources: fuel, power-ups, coin patterns and the
 * pickups themselves.
 *
 * Everything here is either pure or needs nothing but the maths in `three`, so it runs in
 * plain Node. It is where the promises the stage makes are checked rather than hoped for:
 * fuel is clamped and can end a run, a power-up refreshes instead of stacking and expires
 * exactly, a coin pattern is a shape you can fly, and collecting a coin twice is impossible
 * because the coin is gone before its collection is counted.
 *
 *   npm run test:unit
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { POWERUP_IDS } from '../src/data/powerups.js';
import { FLIGHT, RUN } from '../src/game/config.js';
import { Pickups } from '../src/run/Pickups.js';
import { RunState } from '../src/run/RunState.js';
import {
  FUEL_MAX,
  addFuel,
  burnFuel,
  clampFuel,
  fuelBurnRate,
  fuelRangeSeconds,
  isFuelEmpty,
  isFuelLow,
} from '../src/run/fuel.js';
import {
  MAX_PATTERN_COINS,
  choosePattern,
  patternLength,
  writePattern,
} from '../src/run/pickupLayout.js';
import {
  activate,
  advance,
  createPowerupState,
  isActive,
  progress,
  remaining,
  reset as resetPowerups,
} from '../src/run/powerups.js';

/** A player heading along -Z at 420 m, which is where a run starts. */
function player({ x = 0, y = 420, z = 0 } = {}) {
  return {
    position: { x, y, z },
    forward: { x: 0, y: 0, z: -1 },
    right: { x: 1, y: 0, z: 0 },
  };
}

/* ------------------------------------------------------------------------ fuel */

test('fuel is always inside its range, however it is read', () => {
  assert.equal(clampFuel(0.5), 0.5);
  assert.equal(clampFuel(-3), 0, 'a negative tank is empty, not owed');
  assert.equal(clampFuel(4), FUEL_MAX, 'a tank cannot be over full');
  assert.equal(clampFuel(Number.NaN), 0, 'an unreadable value is empty, never full');
  assert.equal(clampFuel(undefined), 0);
});

test('a full tank put back into a full tank stays a full tank', () => {
  /*
   * The case that matters in play: collecting a canister at 95% must not leave the aircraft
   * holding 120% and make the next few seconds of burn invisible.
   */
  assert.equal(addFuel(0.95, RUN.fuel.amount), FUEL_MAX);
  assert.equal(addFuel(0.5, RUN.fuel.amount), 0.75);
  assert.equal(addFuel(0.5, -1), 0.5, 'a negative amount is ignored rather than burning fuel');
  assert.equal(addFuel(0, RUN.fuel.amount), 0.25);
});

test('burning fuel lowers it and never goes below empty', () => {
  const oneSecond = burnFuel(1, 1, { throttle: 1 }, FLIGHT);
  assert.ok(oneSecond < 1, 'one second of flight costs fuel');
  assert.ok(oneSecond > 0.99, 'but only a little of it');

  const emptied = burnFuel(0.001, 60, { throttle: 1, boost: true }, FLIGHT);
  assert.equal(emptied, 0, 'an empty tank is exactly empty after a long step');
  assert.ok(!Number.isNaN(emptied));
});

test('opening the throttle, and boosting, both cost more fuel', () => {
  const idle = fuelBurnRate({ throttle: 0 }, FLIGHT);
  const cruise = fuelBurnRate({ throttle: 0.6 }, FLIGHT);
  const full = fuelBurnRate({ throttle: 1 }, FLIGHT);
  const boost = fuelBurnRate({ throttle: 1, boost: true }, FLIGHT);

  assert.ok(idle < cruise, 'cruise burns more than idle');
  assert.ok(cruise < full, 'full throttle burns more than cruise');
  assert.ok(full < boost, 'boost burns more than full throttle');
  assert.ok(Math.abs(boost - full * FLIGHT.boostBurnMultiplier) < 1e-9);
});

test('a thirsty airframe empties sooner than a frugal one', () => {
  const frugal = fuelBurnRate({ throttle: 1 }, FLIGHT, 1.35);
  const thirsty = fuelBurnRate({ throttle: 1 }, FLIGHT, 0.85);
  assert.ok(thirsty > frugal, 'the fuel rating divides the burn rate');

  const duration = fuelRangeSeconds({ throttle: 1 }, FLIGHT);
  assert.ok(duration > 60, `a full tank should last minutes, not seconds (${duration.toFixed(0)} s)`);
});

test('an empty tank is empty, and low fuel is low', () => {
  assert.equal(isFuelEmpty(0), true);
  assert.equal(isFuelEmpty(-0.2), true);
  assert.equal(isFuelEmpty(0.0001), false);
  assert.equal(isFuelLow(RUN.fuel.lowWarning), true, 'the warning threshold counts as low');
  assert.equal(isFuelLow(RUN.fuel.lowWarning + 0.01), false);
});

/* ------------------------------------------------------------------- power-ups */

test('a power-up activates, then refreshes instead of stacking', () => {
  const state = createPowerupState();
  assert.equal(isActive(state, 'boost'), false, 'nothing is running at the start');

  assert.equal(activate(state, 'boost', 12), 'activated');
  advance(state, 5);
  assert.equal(remaining(state, 'boost'), 7);

  // A second pickup while it is running is worth one full duration from now, not 19 s.
  assert.equal(activate(state, 'boost', 12), 'refreshed');
  assert.equal(remaining(state, 'boost'), 12, 'a refresh never exceeds a full duration');
  assert.equal(state.byId.boost.duration, 12, 'and the bar is measured against a full duration');
});

test('different power-ups overlap independently', () => {
  const state = createPowerupState();
  activate(state, 'boost', 12);
  activate(state, 'special', 10);

  advance(state, 9);
  assert.equal(isActive(state, 'special'), true);
  assert.equal(isActive(state, 'boost'), true);

  advance(state, 1.5);
  assert.equal(isActive(state, 'special'), false, 'the shorter one expires first');
  assert.equal(isActive(state, 'boost'), true, 'and does not take the other with it');
  assert.equal(remaining(state, 'boost'), 1.5);
});

test('an expiring power-up reports itself exactly once, at exactly zero', () => {
  const state = createPowerupState();
  const expired = [];
  activate(state, 'special', 2);

  assert.deepEqual(advance(state, 1, expired), [], 'nothing expires early');
  assert.deepEqual(advance(state, 1, expired), ['special'], 'it expires on the second');
  assert.equal(remaining(state, 'special'), 0, 'and never reports a negative remainder');
  assert.equal(isActive(state, 'special'), false);

  assert.deepEqual(advance(state, 1, expired), [], 'and does not expire again');
  assert.equal(expired.length, 0);
});

test('an unknown power-up is ignored rather than throwing', () => {
  const state = createPowerupState();
  assert.equal(activate(state, 'teleport', 5), 'ignored');
  assert.equal(activate(state, 'boost', 0), 'ignored', 'a zero duration is not an effect');

  for (const id of POWERUP_IDS) assert.equal(isActive(state, id), false);
  assert.equal(remaining(state, 'teleport'), 0, 'and an unknown id has no clock');
});

test('a run clears its timers, so nothing is inherited', () => {
  const state = createPowerupState();
  activate(state, 'boost', 12);
  activate(state, 'special', 10);

  resetPowerups(state);
  for (const id of POWERUP_IDS) {
    assert.equal(isActive(state, id), false, `${id} does not survive a reset`);
    assert.equal(remaining(state, id), 0);
  }
});

test('progress runs from one to zero over the duration', () => {
  const state = createPowerupState();
  activate(state, 'boost', 10);
  assert.equal(progress(state.byId.boost), 1);

  advance(state, 5);
  assert.equal(progress(state.byId.boost), 0.5);

  advance(state, 5);
  assert.equal(progress(state.byId.boost), 0, 'an expired slot reports no progress');
});

/* -------------------------------------------------------------- coin patterns */

test('a line of coins is a line, centred on the point that was placed', () => {
  const out = new Float32Array(MAX_PATTERN_COINS * 3);
  const count = writePattern('line', 5, 40, out);
  assert.equal(count, 5);

  const along = [];
  for (let i = 0; i < count; i += 1) {
    along.push(out[i * 3]);
    assert.equal(out[i * 3 + 1], 0, 'a line does not wander sideways');
    assert.equal(out[i * 3 + 2], 0, 'and does not climb');
  }

  assert.deepEqual(along, [-80, -40, 0, 40, 80], 'evenly spaced either side of the centre');
  const mean = along.reduce((sum, value) => sum + value, 0) / along.length;
  assert.ok(Math.abs(mean) < 1e-9, 'the pattern mean is the placement point');

  assert.equal(patternLength(count, 40), 160);
});

test('an arc climbs and comes back down', () => {
  const out = new Float32Array(MAX_PATTERN_COINS * 3);
  const count = writePattern('arc', 6, 50, out);

  const heights = [];
  for (let i = 0; i < count; i += 1) heights.push(out[i * 3 + 2]);

  assert.ok(heights[0] < 1e-9 && heights[count - 1] < 1e-9, 'the ends sit on the flight path');
  const peak = Math.max(...heights);
  assert.ok(peak > 20 && peak < 50, `the climb is gentle enough to follow (${peak.toFixed(1)} m)`);
  // An even number of coins has two equal middle steps, so either side of the centre is fine.
  const middle = (count - 1) / 2;
  assert.ok(Math.abs(heights.indexOf(peak) - middle) <= 0.5, 'and the peak is in the middle');
});

test('a slalom stays inside one pattern footprint', () => {
  const out = new Float32Array(MAX_PATTERN_COINS * 3);
  const count = writePattern('slalom', 7, 40, out);

  let widest = 0;
  for (let i = 0; i < count; i += 1) widest = Math.max(widest, Math.abs(out[i * 3 + 1]));

  // Never wider than the spacing: a single placement cannot stretch across the sky.
  assert.ok(widest <= 40 + 1e-6, `widest ${widest.toFixed(1)} m`);
  assert.ok(widest > 20, 'but it does weave');
  assert.equal(out[1], 0, 'starting on the centre line');
});

test('a pattern is clamped to what the buffer can hold', () => {
  const out = new Float32Array(MAX_PATTERN_COINS * 3);
  assert.equal(writePattern('line', 99, 10, out), MAX_PATTERN_COINS);
  assert.equal(writePattern('line', 0, 10, out), 1, 'never zero coins');
});

test('a chosen pattern is always one that is configured, within its length', () => {
  let seed = 12345;
  const random = () => {
    seed = (seed * 16807 + 11) % 2147483647;
    return seed / 2147483647;
  };

  for (let i = 0; i < 200; i += 1) {
    const choice = choosePattern(random, RUN.coins);
    assert.ok(RUN.coins.patterns.includes(choice.kind), `${choice.kind} is configured`);
    assert.ok(
      choice.count >= RUN.coins.perPattern[0] && choice.count <= RUN.coins.perPattern[1],
      `${choice.count} is within the configured range`,
    );
  }
});

/* --------------------------------------------------------------------- pickups */

test('coins are laid out ahead of the aircraft, as a whole pattern', () => {
  const pickups = new Pickups({ preset: {}, config: RUN });
  pickups.spawnCoins(player());

  const placed = pickups.coinPool.activeCount;
  assert.ok(placed >= RUN.coins.perPattern[0], `a full pattern is placed (${placed})`);
  assert.ok(placed <= RUN.coins.perPattern[1]);

  for (const coin of pickups.coinPool.active) {
    assert.ok(-coin.position.z > 0, 'every coin is in front of the aircraft, not behind it');
    assert.ok(coin.position.y > 0, 'and in the air');
  }

  pickups.dispose();
});

test('a partial pattern is never placed', () => {
  // A pool that can hold four coins cannot take a pattern of six, so nothing goes in at all.
  const pickups = new Pickups({ preset: { coins: 4 }, config: RUN });
  assert.equal(pickups.spawnCoins(player()), 0);
  assert.equal(pickups.coinPool.activeCount, 0);
  pickups.dispose();
});

test('a coin is collected once, and only once', () => {
  const pickups = new Pickups({ preset: {}, config: RUN });
  pickups.spawnCoins(player());

  const coin = pickups.coinPool.active[0];
  const before = pickups.coinPool.activeCount;
  const onTop = {
    position: { x: coin.position.x, y: coin.position.y, z: coin.position.z },
    forward: { x: 0, y: 0, z: -1 },
    right: { x: 1, y: 0, z: 0 },
  };

  const first = pickups.collect(onTop);
  assert.equal(first.coins, RUN.coins.value, 'the coin is credited');
  assert.equal(pickups.coinPool.activeCount, before - 1, 'and released in the same call');

  // The same step, run again: the coin is gone, so nothing is credited a second time.
  assert.equal(pickups.collect(onTop).coins, 0, 'collecting the same coin twice is impossible');

  pickups.dispose();
});

test('nothing is collected from far away', () => {
  const pickups = new Pickups({ preset: {}, config: RUN });
  pickups.spawnCoins(player());

  const far = player({ z: 500 });
  assert.equal(pickups.collect(far).coins, 0);
  assert.ok(pickups.coinPool.activeCount > 0, 'the coins are still there');
  pickups.dispose();
});

test('a canister adds the configured fuel, and an orb names its power-up', () => {
  const pickups = new Pickups({ preset: {}, config: RUN });

  const canister = pickups.spawnFuel(player());
  const orb = pickups.spawnPower(player(), 'boost');
  assert.ok(canister && orb, 'both were placed');

  // Pickups are placed off the flight line, so put both in front of the aircraft to collect
  // them in one pass: the point is what collecting reports, not where they happened to land.
  const spot = { x: 12, y: 400, z: -80 };
  canister.position.set(spot.x, spot.y, spot.z);
  orb.position.set(spot.x, spot.y, spot.z);

  const onSpot = {
    position: spot,
    forward: { x: 0, y: 0, z: -1 },
    right: { x: 1, y: 0, z: 0 },
  };
  const taken = pickups.collect(onSpot);
  assert.ok(Math.abs(taken.fuel - RUN.fuel.amount) < 1e-9, 'a canister returns its fuel');
  assert.deepEqual([...taken.power], ['boost'], 'an orb names the power-up it holds');

  // Released in the same call, so the orb cannot start a second effect.
  assert.equal(pickups.collect(onSpot).power.length, 0);
  pickups.dispose();
});

test('a power-up orb can carry any configured power-up', () => {
  const pickups = new Pickups({ preset: {}, config: RUN });
  for (const id of POWERUP_IDS) {
    const orb = pickups.spawnPower(player(), id);
    assert.equal(orb.id, id);
    pickups.releasePower(orb);
  }
  pickups.dispose();
});

test('resetting a run empties the sky', () => {
  const pickups = new Pickups({ preset: {}, config: RUN });
  pickups.spawnCoins(player());
  pickups.spawnFuel(player());
  pickups.spawnPower(player(), 'special');
  assert.ok(pickups.coinsActive + pickups.fuelActive + pickups.powerActive > 0);

  pickups.reset();
  assert.equal(pickups.coinsActive, 0);
  assert.equal(pickups.fuelActive, 0);
  assert.equal(pickups.powerActive, 0);
  pickups.dispose();
});

/* -------------------------------------------------------------------- run state */

test('coins are counted, and a negative credit is ignored', () => {
  const run = new RunState(RUN);
  assert.equal(run.coins, 0);

  assert.equal(run.addCoins(3), 3);
  assert.equal(run.addCoins(-5), 3, 'a run cannot be charged coins by a bug');
  assert.equal(run.addCoins(2.9), 5, 'and a fractional credit is floored');

  run.reset();
  assert.equal(run.coins, 0, 'a new run starts with none');
});

test('the run owns the power-up clocks, and clears them', () => {
  const run = new RunState(RUN);

  assert.equal(run.activatePowerup('boost'), 'activated');
  assert.equal(run.remaining('boost'), RUN.powerups.duration.boost, 'the configured duration');

  run.update(RUN.powerups.duration.boost);
  assert.equal(run.isActive('boost'), false, 'it expires on time');

  run.activatePowerup('special');
  run.reset();
  assert.equal(run.isActive('special'), false, 'and a new run inherits nothing');
});

test('the telemetry snapshot is the same object every frame', () => {
  /*
   * The HUD reads this object every frame. If it were rebuilt, a power-up chip would be a new
   * object every 16 ms and the countdown would never compare equal.
   */
  const run = new RunState(RUN);
  const first = run.snapshot();
  run.addCoins(2);
  const second = run.snapshot();

  assert.equal(first, second, 'the snapshot is reused');
  assert.equal(second.coins, 2, 'and reflects the current run');
  assert.equal(second.powerups, run.powerups, 'the slots are the live ones');

  run.activatePowerup('special');
  run.snapshot();
  assert.equal(second.powerupRemaining, RUN.powerups.duration.special);
});


