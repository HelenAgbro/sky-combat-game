/**
 * Sky Combat — unit tests for coins, fuel and power-ups.
 *
 * The pure halves run in plain Node: the coin patterns and the recycling rules, the
 * power-up timers and the awkward overlap cases. The last few build a real `Pickups` and a
 * real `AircraftController` — neither needs a renderer — so "a coin can only be collected
 * once" and "a new run inherits nothing" are tested against the code that actually runs
 * rather than against a copy of its rules.
 *
 *   npm run test:unit
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { AircraftController } from '../src/aircraft/AircraftController.js';
import { BOUNDS, FLIGHT, PICKUPS, RENDER } from '../src/game/config.js';
import { createSeededRandom, radialDistance } from '../src/game/math.js';
import { Pickups } from '../src/pickups/Pickups.js';
import {
  COIN_PATTERNS,
  COIN_PATTERN_IDS,
  anchorFor,
  clampToPlayArea,
  placeCoinPattern,
  shouldRecycle,
} from '../src/pickups/pickupLayout.js';
import {
  POWER_UPS,
  POWER_UP_IDS,
  activate,
  activeList,
  advance,
  createPowerUpState,
  effectsOf,
  isActive,
  remaining,
  resetPowerUps,
} from '../src/pickups/powerUps.js';

const STEP = RENDER.fixedStep;
const COINS = PICKUPS.coins;

/** A player at the start of a run, as the layout functions see one. */
const PLAYER = {
  position: { x: 0, y: FLIGHT.startAltitude, z: 0 },
  forward: { x: 0, y: 0, z: -1 },
  right: { x: 1, y: 0, z: 0 },
  up: { x: 0, y: 1, z: 0 },
};

/** Room for the largest pattern, so a placement never runs out of slots. */
const points = (n = 16) => Array.from({ length: n }, () => ({ x: 0, y: 0, z: 0 }));

/** How far ahead of the aircraft a point is, along the aircraft's own heading. */
function aheadOf(point, player = PLAYER) {
  const dx = point.x - player.position.x;
  const dz = point.z - player.position.z;
  return dx * player.forward.x + dz * player.forward.z;
}

/* ------------------------------------------------------------------ the patterns */

test('every coin pattern is complete and lays out the coins it promises', () => {
  for (const id of COIN_PATTERN_IDS) {
    const pattern = COIN_PATTERNS[id];
    const out = points();
    const count = placeCoinPattern(createSeededRandom(3), PLAYER, id, COINS, out);

    assert.equal(count, pattern.count, `${id} places its full count`);
    for (let i = 0; i < count; i += 1) {
      assert.ok(
        Number.isFinite(out[i].x) && Number.isFinite(out[i].y) && Number.isFinite(out[i].z),
        `${id} coin ${i} is a real point`,
      );
    }
  }
});

test('a pattern is laid out ahead of the aircraft and inside the play area', () => {
  const random = createSeededRandom(1234);
  const out = points();

  for (let run = 0; run < 200; run += 1) {
    const id = COIN_PATTERN_IDS[run % COIN_PATTERN_IDS.length];
    const count = placeCoinPattern(random, PLAYER, id, COINS, out);

    for (let i = 0; i < count; i += 1) {
      const point = out[i];
      assert.ok(aheadOf(point) > 0, `${id} coin ${i} is ahead of the aircraft`);
      assert.ok(
        point.y >= BOUNDS.minAltitude && point.y <= BOUNDS.maxAltitude,
        `${id} coin ${i} is inside the altitude band`,
      );
      assert.ok(
        radialDistance(point.x, point.z) <= BOUNDS.softRadius + 1e-6,
        `${id} coin ${i} is inside the area the player may fly in`,
      );
    }
  }
});

test('the same seed lays out the same pattern', () => {
  const first = points();
  const second = points();

  const countA = placeCoinPattern(createSeededRandom(77), PLAYER, 'arc', COINS, first);
  const countB = placeCoinPattern(createSeededRandom(77), PLAYER, 'arc', COINS, second);

  assert.equal(countA, countB);
  for (let i = 0; i < countA; i += 1) assert.deepEqual(first[i], second[i]);
});

test('a line is straight, and a hoop is a ring around its anchor', () => {
  // The anchor is drawn from the same two random numbers in both cases, so a fresh
  // generator of the same seed lands the pattern in exactly the same place.
  const line = points();
  const lineCount = placeCoinPattern(createSeededRandom(11), PLAYER, 'line', COINS, line);
  assert.equal(lineCount, COIN_PATTERNS.line.count);

  for (let i = 0; i < lineCount; i += 1) {
    // A line has no bow and no climb: every coin shares the anchor's own line, so the
    // pattern is straight. It is not the player's line — the anchor is given a little
    // sideways slack on purpose, so a run of coins is something to steer a few degrees
    // toward rather than something that happens to you.
    assert.ok(Math.abs(line[i].x - line[0].x) < 1e-6, 'a line does not wander sideways');
    assert.ok(Math.abs(line[i].y - line[0].y) < 1e-6, 'a line does not climb');
  }
  for (let i = 1; i < lineCount; i += 1) {
    assert.ok(aheadOf(line[i]) > aheadOf(line[i - 1]), 'a line runs away from the player');
  }

  const hoop = points();
  const centre = anchorFor(createSeededRandom(11), PLAYER, COINS);
  const hoopCount = placeCoinPattern(createSeededRandom(11), PLAYER, 'hoop', COINS, hoop);

  for (let i = 0; i < hoopCount; i += 1) {
    const distance = Math.hypot(hoop[i].x - centre.x, hoop[i].y - centre.y, hoop[i].z - centre.z);
    assert.ok(
      Math.abs(distance - COIN_PATTERNS.hoop.radius) < 1e-6,
      'every coin of a hoop is one radius from the middle',
    );
  }
});

test('a column climbs or dives, and never does both in one pattern', () => {
  const random = createSeededRandom(4242);
  const out = points();

  for (let run = 0; run < 40; run += 1) {
    const count = placeCoinPattern(random, PLAYER, 'column', COINS, out);
    const first = out[0].y - PLAYER.position.y;
    const last = out[count - 1].y - PLAYER.position.y;

    assert.ok(Math.abs(first) < 1e-6, 'a column starts level with the player');
    assert.ok(Math.abs(last) > 1, 'a column ends somewhere else');
    for (let i = 1; i < count; i += 1) {
      const step = out[i].y - out[i - 1].y;
      assert.ok(step * last > 0, 'every step of a column goes the same way');
    }
  }
});

test('clamping keeps a pickup inside the area the player may fly in', () => {
  const high = clampToPlayArea({ x: 0, y: BOUNDS.maxAltitude + 500, z: 0 });
  assert.ok(high.y < BOUNDS.maxAltitude);

  const low = clampToPlayArea({ x: 0, y: BOUNDS.minAltitude - 500, z: 0 });
  assert.ok(low.y > BOUNDS.minAltitude);

  const far = clampToPlayArea({ x: BOUNDS.softRadius * 3, y: 400, z: 0 });
  assert.ok(radialDistance(far.x, far.z) <= BOUNDS.softRadius + 1e-6, 'a point outside is pulled back in');
});

test('a pickup is given back when it is old, far away, or behind', () => {
  const position = { x: 0, y: 400, z: 0 };
  const forward = { x: 0, z: -1 };
  const at = (z) => ({ x: 0, y: 400, z });

  assert.equal(shouldRecycle({ age: 0, position: at(-100) }, position, forward, COINS), false);
  assert.equal(
    shouldRecycle({ age: COINS.lifespan + 1, position: at(-100) }, position, forward, COINS),
    true,
    'too old',
  );
  assert.equal(
    shouldRecycle({ age: 0, position: at(-(COINS.despawnRange + 10)) }, position, forward, COINS),
    true,
    'too far away to matter',
  );
  assert.equal(
    shouldRecycle({ age: 0, position: at(COINS.despawnBehind + 10) }, position, forward, COINS),
    true,
    'behind the player, so unreachable',
  );
});

/* -------------------------------------------------------------------- power-ups */

test('every power-up is complete, and a fresh set has nothing running', () => {
  assert.ok(POWER_UP_IDS.length >= 2, 'there is more than one power-up to find');
  for (const id of POWER_UP_IDS) {
    const definition = POWER_UPS[id];
    assert.equal(definition.id, id);
    assert.ok(definition.duration > 0, `${id} lasts for a while`);
    assert.ok(definition.name.length > 0, `${id} has a name for the HUD chip`);
    assert.ok(/^#[0-9a-f]{6}$/i.test(definition.colour), `${id} has a chip colour`);
  }

  const state = createPowerUpState();
  for (const id of POWER_UP_IDS) assert.equal(isActive(state, id), false);
  assert.equal(effectsOf(state).speedMultiplier, 1);
  assert.equal(effectsOf(state).damageMultiplier, 1);
});

test('a power-up starts at its full duration, and an unknown id is a no-op', () => {
  const state = createPowerUpState();
  const started = activate(state, 'speed');

  assert.equal(started.refreshed, false, 'it was not already running');
  assert.equal(remaining(state, 'speed'), POWER_UPS.speed.duration);
  assert.equal(activate(state, 'not-a-power-up'), null, 'a typo does not throw');
  assert.equal(isActive(state, 'not-a-power-up'), false);
});

test('the same power-up never stacks: a second one refreshes rather than extends', () => {
  const state = createPowerUpState();
  activate(state, 'speed');

  // Three seconds in, take another.
  advance(state, 3);
  const before = remaining(state, 'speed');
  const again = activate(state, 'speed');

  assert.equal(again.refreshed, true, 'it topped up something already running');
  assert.equal(remaining(state, 'speed'), POWER_UPS.speed.duration);
  assert.ok(
    remaining(state, 'speed') < before + POWER_UPS.speed.duration,
    'two of the same do not add up into a bank',
  );
});

test('two different power-ups run at once, each on its own clock', () => {
  const state = createPowerUpState();
  activate(state, 'speed');
  advance(state, 4);
  activate(state, 'ammo');

  assert.equal(remaining(state, 'speed'), POWER_UPS.speed.duration - 4);
  assert.equal(remaining(state, 'ammo'), POWER_UPS.ammo.duration);

  const effects = effectsOf(state);
  assert.equal(effects.speedMultiplier, POWER_UPS.speed.speedMultiplier);
  assert.equal(effects.damageMultiplier, POWER_UPS.ammo.damageMultiplier);

  // The short one running out must not touch the long one.
  const expired = advance(state, POWER_UPS.speed.duration - 4);
  assert.deepEqual(expired, ['speed']);
  assert.equal(isActive(state, 'speed'), false);
  assert.equal(isActive(state, 'ammo'), true, 'the other is untouched');
  assert.equal(effectsOf(state).damageMultiplier, POWER_UPS.ammo.damageMultiplier);
});

test('a power-up expires exactly once, and its timer never goes negative', () => {
  const state = createPowerUpState();
  activate(state, 'ammo');

  const expired = [];
  let expiries = 0;
  const steps = Math.round((POWER_UPS.ammo.duration + 1) / STEP);

  for (let i = 0; i < steps; i += 1) {
    advance(state, STEP, expired);
    expiries += expired.length;
    assert.ok(remaining(state, 'ammo') >= 0, 'a timer never goes negative');
  }

  assert.equal(expiries, 1, 'the expiry was reported on exactly one step');
  assert.equal(isActive(state, 'ammo'), false);
});

test('resetting clears every timer, so a new run starts with nothing running', () => {
  const state = createPowerUpState();
  activate(state, 'speed');
  activate(state, 'ammo');
  resetPowerUps(state);

  for (const id of POWER_UP_IDS) assert.equal(remaining(state, id), 0);
  assert.equal(effectsOf(state).speedMultiplier, 1);
  assert.equal(effectsOf(state).damageMultiplier, 1);
});

test('the active list reports what is running, with the time left', () => {
  const state = createPowerUpState();
  activate(state, 'speed');
  advance(state, 2);

  const list = activeList(state);
  assert.equal(list.length, 1);
  assert.equal(list[0].id, 'speed');
  assert.equal(list[0].name, POWER_UPS.speed.name);
  assert.equal(list[0].remaining, POWER_UPS.speed.duration - 2);
  assert.equal(list[0].duration, POWER_UPS.speed.duration);
  assert.ok(list[0].progress > 0 && list[0].progress < 1, 'part way through');

  assert.equal(activeList(createPowerUpState()).length, 0, 'nothing running reports nothing');
});

test('a column laid out from the floor still climbs, rather than being flattened', () => {
  // A dive from just above the floor would have its tail pinned to the altitude limit,
  // which stops it reading as a column. The pattern goes the way there is room for.
  const low = { ...PLAYER, position: { x: 0, y: BOUNDS.minAltitude + 5, z: 0 } };
  const out = points();
  const random = createSeededRandom(9);

  for (let run = 0; run < 20; run += 1) {
    const count = placeCoinPattern(random, low, 'column', COINS, out);
    const steps = [];
    for (let i = 1; i < count; i += 1) steps.push(out[i].y - out[i - 1].y);

    for (const step of steps) assert.ok(Math.abs(step) > 1, 'no step was clamped flat');
    assert.ok(
      steps.every((step) => step * steps[0] > 0),
      'the whole column still goes one way',
    );
  }
});

/* ------------------------------------------------------------------------- fuel */

test('refuelling tops up the tank, and clamps at full', () => {
  const controller = new AircraftController({});
  controller.fuel = 0.5;

  const taken = controller.refuel(PICKUPS.fuel.refill);
  assert.ok(taken > 0, 'fuel was taken on');
  assert.ok(Math.abs(controller.fuel - Math.min(1, 0.5 + PICKUPS.fuel.refill)) < 1e-9);

  controller.fuel = 1;
  assert.equal(controller.refuel(PICKUPS.fuel.refill), 0, 'a full tank takes nothing on');
  assert.equal(controller.fuel, 1, 'and never overflows');
});

test('fuel burns down, stays in range, and does empty', () => {
  const controller = new AircraftController({});
  // Long enough to empty a full tank at full throttle with the afterburner lit.
  const steps = Math.round(2 / FLIGHT.fuelBurnPerSecond / STEP);

  for (let i = 0; i < steps; i += 1) {
    controller.setInput({ throttle: 1, boost: true });
    controller.step(STEP);
    assert.ok(controller.fuel >= 0 && controller.fuel <= 1, 'fuel stays in its range');
  }

  assert.equal(controller.fuel, 0, 'a full tank flown flat out empties');
});

test('a new run starts with a full tank and no boost left over', () => {
  const controller = new AircraftController({});
  controller.fuel = 0.1;
  controller.speedBoost = 2;
  controller.reset();

  assert.equal(controller.fuel, 1);
  assert.equal(controller.speedBoost, 1);
});

test('a speed boost raises the speed the aircraft settles at', () => {
  const plain = new AircraftController({});
  const boosted = new AircraftController({});
  boosted.speedBoost = POWER_UPS.speed.speedMultiplier;

  for (const controller of [plain, boosted]) {
    for (let i = 0; i < 600; i += 1) {
      controller.setInput({ throttle: 0.6 });
      controller.step(STEP);
    }
  }

  assert.ok(boosted.speed > plain.speed * 1.1, 'the boost is worth having');
});

/* ------------------------------------------------------------- the real system */

/**
 * A real `Pickups` on a real `AircraftController`.
 *
 * Neither needs a renderer — Three.js only touches the GPU when something is drawn — so the
 * collection rules are tested against the code that actually runs in the game rather than
 * against a restatement of them.
 */
function makePickups() {
  return new Pickups({ preset: { coins: 64, supplies: 8 }, seed: 4242 });
}

/** Park the aircraft at a fixed point, so a pickup can be placed on its nose. */
function parkedPlayer() {
  const player = new AircraftController({});
  player.position.set(0, 400, 0);
  return player;
}

/** Place a supply exactly on the aircraft, so it is collected on the next step. */
function dropOn(pickups, kind, player) {
  const supply = pickups.spawnSupply(kind, player);
  assert.ok(supply, `a ${kind} supply was placed`);
  supply.position.copy(player.position);
  supply.anchorY = supply.position.y;
  return supply;
}

test('a coin is collected exactly once, however long the aircraft sits on it', () => {
  const pickups = makePickups();
  const player = parkedPlayer();

  assert.ok(pickups.placeCoin(player.position), 'a coin was placed on the nose');

  // Ten steps with the coin exactly where the aircraft is.
  for (let i = 0; i < 10; i += 1) pickups.update(STEP, player);

  assert.equal(pickups.coins, 1, 'one coin was counted, not ten');
  assert.equal(pickups.telemetry().coinsActive, 1, 'and it is still popping');

  // Once the pop is over the coin goes back to the pool, and the count still does not move.
  const popSteps = Math.ceil(PICKUPS.coins.collectTime / STEP) + 2;
  for (let i = 0; i < popSteps; i += 1) pickups.update(STEP, player);

  assert.equal(pickups.coins, 1, 'the same coin was not counted again');
  assert.equal(pickups.telemetry().coinsActive, 0, 'the coin was given back to the pool');
});

test('a coin pattern is laid out as the run goes on, and never exceeds the pool', () => {
  const pickups = makePickups();
  const player = parkedPlayer();

  // Long enough for several patterns. The aircraft is parked, so nothing is collected.
  const steps = Math.round(PICKUPS.coins.interval * 4 / STEP);
  for (let i = 0; i < steps; i += 1) pickups.update(STEP, player);

  const telemetry = pickups.telemetry();
  assert.ok(telemetry.coinsActive > 0, 'coins were laid out');
  assert.ok(
    telemetry.coinsActive <= telemetry.coinCapacity,
    'the coin field never exceeds the pool it draws from',
  );
});

test('a fuel canister refuels the aircraft, and a full tank wastes one', () => {
  const pickups = makePickups();
  const player = parkedPlayer();
  player.fuel = 0.4;

  dropOn(pickups, 'fuel', player);
  pickups.update(STEP, player);

  assert.ok(
    Math.abs(player.fuel - (0.4 + PICKUPS.fuel.refill)) < 1e-9,
    'the tank was topped up by one canister',
  );
  assert.equal(pickups.telemetry().fuelPickups, 1);

  player.fuel = 1;
  dropOn(pickups, 'fuel', player);
  pickups.update(STEP, player);

  assert.equal(player.fuel, 1, 'a canister taken with a full tank does not overflow it');
});

test('a power-up starts when it is collected, and expires on its own', () => {
  const pickups = makePickups();
  const player = parkedPlayer();

  dropOn(pickups, 'speed', player);
  pickups.update(STEP, player);

  assert.equal(isActive(pickups.powerUps, 'speed'), true, 'the effect started');
  assert.equal(pickups.effects.speedMultiplier, POWER_UPS.speed.speedMultiplier);
  assert.equal(pickups.telemetry().powerPickups, 1);
  assert.equal(pickups.telemetry().powerUps.length, 1, 'the HUD is told what is running');

  const steps = Math.ceil(POWER_UPS.speed.duration / STEP) + 2;
  for (let i = 0; i < steps; i += 1) pickups.update(STEP, player);

  assert.equal(isActive(pickups.powerUps, 'speed'), false, 'it ran out');
  assert.equal(pickups.effects.speedMultiplier, 1, 'and the effect went with it');
  assert.equal(pickups.telemetry().powerUps.length, 0);
});

test('two of the same power-up refresh rather than bank', () => {
  const pickups = makePickups();
  const player = parkedPlayer();

  dropOn(pickups, 'ammo', player);
  pickups.update(STEP, player);

  // Two seconds later, a second one.
  for (let i = 0; i < Math.round(2 / STEP); i += 1) pickups.update(STEP, player);
  const before = remaining(pickups.powerUps, 'ammo');

  dropOn(pickups, 'ammo', player);
  pickups.update(STEP, player);

  assert.equal(remaining(pickups.powerUps, 'ammo'), POWER_UPS.ammo.duration, 'back to full');
  assert.ok(
    remaining(pickups.powerUps, 'ammo') < before + POWER_UPS.ammo.duration,
    'refreshed, not banked: two of the same never add up',
  );
});

test('a new run inherits no coins and no power-ups', () => {
  const pickups = makePickups();
  const player = parkedPlayer();

  pickups.placeCoin(player.position);
  dropOn(pickups, 'ammo', player);
  for (let i = 0; i < 3; i += 1) pickups.update(STEP, player);

  assert.ok(pickups.coins > 0, 'a coin was collected');
  assert.equal(isActive(pickups.powerUps, 'ammo'), true, 'and a power-up was running');

  pickups.reset();
  player.reset();

  assert.equal(pickups.coins, 0, 'the coin count starts again');
  assert.equal(isActive(pickups.powerUps, 'ammo'), false, 'nothing is left running');
  assert.equal(pickups.effects.damageMultiplier, 1);
  assert.equal(pickups.telemetry().coinsActive, 0, 'the coins went back to the pool');
  assert.equal(pickups.telemetry().suppliesActive, 0, 'and so did the supplies');
  assert.equal(pickups.telemetry().fuelPickups, 0);
  assert.equal(player.fuel, 1, 'a full tank');
  assert.equal(player.speedBoost, 1, 'and no boost carried over');
});

