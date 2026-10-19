/**
 * Sky Combat — unit tests for the engine core: configuration, the state machine,
 * quality selection and the flight model. Everything here is pure — no DOM and no
 * renderer — so it runs in plain Node.
 *
 *   npm run test:unit
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { AircraftController, scaleFromAttributes } from '../src/aircraft/AircraftController.js';
import { SURFACE_LIMITS, SURFACE_RATE, surfaceAngles } from '../src/aircraft/surfaces.js';
import { BOUNDS, CAMERA, DEMO_FLIGHT, FLIGHT, RENDER, WORLD } from '../src/game/config.js';
import { GameState, STATES } from '../src/game/GameState.js';
import { createSeededRandom, radialDistance } from '../src/game/math.js';
import {
  CLOUD_FIELD,
  headingOf,
  placeCloud,
  seedClouds,
  shouldRecycle,
} from '../src/scene/cloudLayout.js';
import {
  ISLAND_FIELD,
  cellHash,
  islandForCell,
  islandsAround,
} from '../src/scene/islandLayout.js';
import { PRESETS, TIERS, pickTier } from '../src/systems/QualityManager.js';

const STEP = RENDER.fixedStep;

/** Run the controller for `seconds` with a fixed input. */
function fly(controller, seconds, input = {}) {
  const steps = Math.round(seconds / STEP);
  for (let i = 0; i < steps; i += 1) {
    controller.setInput(input);
    controller.step(STEP);
  }
  return controller;
}

test('config keeps its invariants', () => {
  assert.ok(FLIGHT.minSpeed < FLIGHT.cruiseSpeed);
  assert.ok(FLIGHT.cruiseSpeed < FLIGHT.maxSpeed);
  assert.ok(FLIGHT.maxSpeed < FLIGHT.boostSpeed);
  assert.ok(FLIGHT.boostMultiplier > 1);
  assert.ok(FLIGHT.fuelBurnPerSecond > 0);
  assert.ok(RENDER.fixedStep > 0 && RENDER.fixedStep <= 0.05);
  assert.ok(RENDER.maxSubSteps >= 1);
  assert.ok(DEMO_FLIGHT.throttle > 0 && DEMO_FLIGHT.throttle <= 1);
  assert.ok(CAMERA.offset.z > 0, 'the camera sits behind the aircraft');
  assert.ok(CAMERA.offset.y > 0, 'the camera sits above the aircraft');
  assert.ok(BOUNDS.minAltitude > 0 && BOUNDS.maxAltitude > BOUNDS.minAltitude);
  assert.ok(BOUNDS.softRadius < BOUNDS.hardRadius, 'the soft boundary sits inside the hard one');
  assert.ok(WORLD.seaSize > BOUNDS.hardRadius * 2, 'the world is larger than the play area');
});

test('GameState allows the documented transitions', () => {
  const state = new GameState(STATES.BOOT);
  assert.equal(state.current, STATES.BOOT);

  assert.equal(state.set(STATES.LOADING), true);
  assert.equal(state.set(STATES.MENU), true);
  assert.equal(state.set(STATES.FLYING), true);
  assert.equal(state.set(STATES.PAUSED), true);
  assert.equal(state.set(STATES.FLYING), true);
  assert.equal(state.set(STATES.RESULTS), true);
  assert.equal(state.set(STATES.MENU), true);
  assert.equal(state.previous, STATES.RESULTS);
});

test('GameState refuses an illegal transition instead of throwing', () => {
  const state = new GameState(STATES.BOOT);
  assert.equal(state.can(STATES.FLYING), false);
  assert.equal(state.set(STATES.FLYING), false);
  assert.equal(state.current, STATES.BOOT);
});

test('GameState notifies listeners and survives a broken one', () => {
  const state = new GameState(STATES.BOOT);
  const seen = [];
  state.on(() => {
    throw new Error('this listener is broken');
  });
  state.on((next, previous) => seen.push([previous, next]));

  state.set(STATES.LOADING);
  assert.deepEqual(seen, [[STATES.BOOT, STATES.LOADING]]);
});

test('pickTier scales from a low-end phone to a fast desktop', () => {
  // Nothing to work with: no WebGL2 at all.
  assert.equal(pickTier({ webgl2: false, isMobile: true, cores: 2, memory: 2 }), 'low');

  // An entry-level phone: two cores and a small texture limit.
  assert.equal(
    pickTier({ webgl2: true, isMobile: true, cores: 2, memory: 2, maxTextureSize: 2048 }),
    'low',
  );

  // A typical mid-range phone can carry the medium preset; the adaptive scaler
  // and the render-scale floor are what keep it smooth.
  assert.equal(
    pickTier({ webgl2: true, isMobile: true, cores: 4, memory: 4, maxTextureSize: 4096 }),
    'medium',
  );

  // A high-end phone still stops short of the desktop preset.
  assert.equal(
    pickTier({ webgl2: true, isMobile: true, cores: 8, memory: 8, maxTextureSize: 8192 }),
    'medium',
  );

  // A modern desktop gets everything.
  assert.equal(
    pickTier({ webgl2: true, isMobile: false, cores: 8, memory: 8, maxTextureSize: 8192 }),
    'high',
  );
  assert.equal(
    pickTier({ webgl2: true, isMobile: false, cores: 16, memory: 16, maxTextureSize: 16384 }),
    'high',
  );
});

test('every quality tier is complete and ordered', () => {
  assert.deepEqual(TIERS, ['low', 'medium', 'high']);
  for (const tier of TIERS) {
    const preset = PRESETS[tier];
    assert.ok(preset, `${tier} has a preset`);
    assert.equal(typeof preset.shadows, 'boolean');
    assert.ok(preset.shadowMapSize > 0);
    assert.ok(Array.isArray(preset.renderScaleRange) && preset.renderScaleRange.length === 2);
    assert.ok(preset.renderScaleRange[0] <= preset.renderScaleRange[1]);
  }
  assert.equal(PRESETS.low.shadows, false, 'the lowest tier turns shadows off');
  assert.ok(PRESETS.high.shadowMapSize > PRESETS.medium.shadowMapSize);
});

test('hangar ratings map to multipliers in the documented range', () => {
  const weak = scaleFromAttributes({ speed: 0, agility: 0, fuel: 0 });
  const strong = scaleFromAttributes({ speed: 10, agility: 10, fuel: 10 });

  assert.ok(weak.speed < strong.speed);
  assert.ok(weak.agility < strong.agility);
  assert.ok(weak.fuel < strong.fuel);
  assert.ok(weak.speed > 0.8 && strong.speed < 1.25);
  assert.ok(weak.agility > 0.75 && strong.agility < 1.35);
});

test('the aircraft starts airborne, at cruise, with a full tank', () => {
  const controller = new AircraftController({ attributes: { speed: 5, agility: 5, fuel: 5 } });
  assert.equal(controller.altitude, FLIGHT.startAltitude);
  assert.equal(controller.speed, FLIGHT.cruiseSpeed);
  assert.equal(controller.fuel, 1);
  assert.equal(controller.distance, 0);
});

test('throttle drives the airspeed up and down', () => {
  const fast = fly(new AircraftController({}), 4, { throttle: 1 });
  const slow = fly(new AircraftController({}), 4, { throttle: 0 });

  assert.ok(fast.speed > FLIGHT.cruiseSpeed, 'full throttle accelerates');
  assert.ok(slow.speed < FLIGHT.cruiseSpeed, 'idle decelerates');
  assert.ok(fast.speed <= FLIGHT.maxSpeed * 1.3, 'speed stays inside the model ceiling');
  assert.ok(slow.speed >= FLIGHT.minSpeed * 0.9, 'speed never falls below the stall floor');
});

test('boost raises the ceiling and costs extra fuel', () => {
  const normal = fly(new AircraftController({}), 5, { throttle: 1, boost: false });
  const boosted = fly(new AircraftController({}), 5, { throttle: 1, boost: true });

  assert.ok(boosted.speed > normal.speed);
  assert.ok(boosted.fuel < normal.fuel);
});

test('pitch input raises the nose', () => {
  const controller = fly(new AircraftController({}), 1, { pitch: 1, throttle: 0.7 });
  assert.ok(controller.forward.y > 0.1, 'the nose points upward after pitching up');
});

test('roll input banks the aircraft, and it levels itself again', () => {
  const controller = new AircraftController({});
  fly(controller, 1, { roll: 1 });
  const banked = controller.bankAngle;
  assert.ok(banked < -0.15, `expected a right bank, got ${banked}`);

  fly(controller, 3, { roll: 0 });
  assert.ok(Math.abs(controller.bankAngle) < Math.abs(banked) * 0.5, 'the aircraft levels out');
});

test('a banked aircraft turns', () => {
  const controller = new AircraftController({});
  const startHeading = Math.atan2(controller.forward.x, -controller.forward.z);
  fly(controller, 4, { roll: 0.8, pitch: 0, throttle: 0.8 });
  const endHeading = Math.atan2(controller.forward.x, -controller.forward.z);

  assert.notEqual(startHeading, endHeading);
  assert.ok(Math.abs(controller.bankAngle) > 0.2, 'it is still banked');
});

test('fuel burns down and distance accumulates', () => {
  const controller = fly(new AircraftController({}), 10, { throttle: 0.8 });
  assert.ok(controller.fuel < 1, 'fuel was used');
  assert.ok(controller.fuel > 0.5, 'ten seconds is not a whole tank');
  assert.ok(controller.distance > 400, `expected real distance, got ${controller.distance}`);
});

test('the flight model stays finite and inside the world', () => {
  const controller = new AircraftController({});
  const inputs = [
    { pitch: 1, roll: 1, throttle: 1, boost: true },
    { pitch: -1, roll: -1, throttle: 0, boost: false },
    { pitch: 0.3, roll: 0.9, throttle: 0.5, boost: true },
    { pitch: -0.7, roll: 0, throttle: 1, boost: false },
  ];

  for (let i = 0; i < 4000; i += 1) {
    controller.setInput(inputs[Math.floor(i / 1000) % inputs.length]);
    controller.step(STEP);
  }

  for (const [key, value] of Object.entries(controller.telemetry())) {
    // `boundary` is a label rather than a number.
    if (typeof value !== 'number') continue;
    assert.ok(Number.isFinite(value), `${key} is finite (${value})`);
  }
  assert.ok(radialDistance(controller.position.x, controller.position.z) <= BOUNDS.hardRadius + 1e-6);
  assert.ok(controller.altitude >= BOUNDS.minAltitude - 1e-6);
  assert.ok(controller.altitude <= BOUNDS.maxAltitude + 1e-6);
  assert.ok(controller.fuel >= 0 && controller.fuel <= 1);
});

test('reset returns the aircraft to its starting state', () => {
  const controller = fly(new AircraftController({}), 6, { throttle: 1, pitch: 0.5 });
  controller.reset();
  assert.equal(controller.altitude, FLIGHT.startAltitude);
  assert.equal(controller.speed, FLIGHT.cruiseSpeed);
  assert.equal(controller.fuel, 1);
  assert.equal(controller.distance, 0);
  assert.equal(controller.bankAngle, 0);
});

/* ------------------------------------------------------------------ cloud field */

test('clouds are placed in the ring ahead of the aircraft', () => {
  const random = createSeededRandom(7);
  const focus = { x: 0, z: 0 };
  const forward = { x: 0, z: -1 };
  const cloud = {};

  for (let i = 0; i < 200; i += 1) {
    placeCloud(random, focus, forward, CLOUD_FIELD, cloud);
    const distance = Math.hypot(cloud.x - focus.x, cloud.z - focus.z);
    assert.ok(distance >= CLOUD_FIELD.innerRadius - 1e-6, `too close: ${distance}`);
    assert.ok(distance <= CLOUD_FIELD.outerRadius + 1e-6, `too far: ${distance}`);
    assert.ok(cloud.y >= CLOUD_FIELD.minAltitude && cloud.y <= CLOUD_FIELD.maxAltitude);
    assert.ok(cloud.scale >= CLOUD_FIELD.minScale && cloud.scale <= CLOUD_FIELD.maxScale);
    assert.ok(cloud.brightness > 0 && cloud.brightness <= 1);
    assert.ok(cloud.coverage >= 0 && cloud.coverage < 1);
    assert.ok(cloud.z < focus.z, 'seeded ahead of the aircraft, not behind it');
  }
});

test('a cloud is recycled only once it leaves the ring', () => {
  const random = createSeededRandom(3);
  const cloud = placeCloud(random, { x: 0, z: 0 }, { x: 0, z: -1 }, CLOUD_FIELD, {});
  assert.equal(shouldRecycle(cloud, { x: 0, z: 0 }, CLOUD_FIELD), false);

  // Fly past it, a full diameter further on: now it is behind and out of range.
  assert.equal(shouldRecycle(cloud, { x: 0, z: CLOUD_FIELD.outerRadius * 2 }, CLOUD_FIELD), true);
});

test('the cloud field is deterministic and stays in the ring for a whole sortie', () => {
  const field = (seed) =>
    seedClouds(createSeededRandom(seed), { x: 0, z: 0 }, { x: 0, z: -1 }, 24, CLOUD_FIELD, []);

  assert.deepEqual(field(11), field(11), 'the same seed gives the same sky');

  // Fly 40 km, recycling exactly as the scene does, and check nothing was left behind
  // and nothing was ever created.
  const clouds = field(11);
  const focus = { x: 0, z: 0 };
  const forward = { x: 0, z: -1 };
  const random = createSeededRandom(11);
  const before = clouds.length;

  for (let step = 0; step < 400; step += 1) {
    focus.z -= 100;
    for (const cloud of clouds) {
      if (shouldRecycle(cloud, focus, CLOUD_FIELD)) {
        placeCloud(random, focus, forward, CLOUD_FIELD, cloud);
      }
      assert.ok(Math.hypot(cloud.x - focus.x, cloud.z - focus.z) <= CLOUD_FIELD.outerRadius + 1e-6);
    }
  }

  assert.equal(clouds.length, before, 'the field is recycled, never grown');
});

test('headingOf matches the heading convention used everywhere else', () => {
  assert.ok(Math.abs(headingOf({ x: 0, z: -1 })) < 1e-9, 'zero heading points along -Z');
  assert.ok(Math.abs(headingOf({ x: 1, z: 0 }) - Math.PI / 2) < 1e-9);
  assert.ok(Math.abs(headingOf({ x: -1, z: 0 }) + Math.PI / 2) < 1e-9);
});

/* ----------------------------------------------------------------- island field */

test('islands stay inside their own cell, with room for their neighbours', () => {
  const half = ISLAND_FIELD.gridSize * 0.32;
  let present = 0;

  for (let cx = -6; cx <= 6; cx += 1) {
    for (let cz = -6; cz <= 6; cz += 1) {
      const island = islandForCell(cx, cz, ISLAND_FIELD, {});
      if (!island.present) continue;
      present += 1;
      assert.ok(Math.abs(island.x - cx * ISLAND_FIELD.gridSize) <= half);
      assert.ok(Math.abs(island.z - cz * ISLAND_FIELD.gridSize) <= half);
      assert.ok(island.scale > 0.7 && island.scale < 1.9);
      assert.ok(Number.isInteger(island.shape) && island.shape >= 0 && island.shape < 8);
      assert.ok(Number.isFinite(island.rotation));
    }
  }

  assert.ok(present > 20, `the field is dense enough to see land (${present} islands)`);
});

test('the island hash is deterministic and well scattered', () => {
  assert.equal(cellHash(3, -5, 99), cellHash(3, -5, 99));
  assert.notEqual(cellHash(3, -5, 99), cellHash(-5, 3, 99));
  assert.notEqual(cellHash(3, -5, 99), cellHash(4, -5, 99));

  // A hash that only returned a few values would make the land form visible bands.
  const buckets = new Set();
  for (let i = 0; i < 400; i += 1) buckets.add(Math.floor(cellHash(i, i * 3, 1) * 20));
  assert.ok(buckets.size >= 18, `the hash spreads across its range (${buckets.size}/20 buckets)`);
});

test('the terrain returns the nearest islands, nearest first, and never overruns its pool', () => {
  const out = Array.from({ length: ISLAND_FIELD.maxIslands }, () => ({}));
  const count = islandsAround({ x: 0, z: 0 }, ISLAND_FIELD, out);

  assert.ok(count > 0 && count <= ISLAND_FIELD.maxIslands, `count ${count}`);
  for (let i = 1; i < count; i += 1) {
    assert.ok(out[i].distance >= out[i - 1].distance, 'nearest first');
  }

  const again = Array.from({ length: ISLAND_FIELD.maxIslands }, () => ({}));
  assert.equal(islandsAround({ x: 0, z: 0 }, ISLAND_FIELD, again), count);
  assert.deepEqual(again.slice(0, count), out.slice(0, count), 'the same place has the same land');

  const small = Array.from({ length: 3 }, () => ({}));
  assert.equal(islandsAround({ x: 0, z: 0 }, ISLAND_FIELD, small, 3), 3, 'the pool caps the result');
  assert.equal(islandsAround({ x: 0, z: 0 }, ISLAND_FIELD, [], 0), 0, 'no slots is not an error');

  // Moving one cell changes the set, but the world does not reshuffle: land that was
  // visible is still visible.
  const moved = Array.from({ length: ISLAND_FIELD.maxIslands }, () => ({}));
  const movedCount = islandsAround({ x: ISLAND_FIELD.gridSize, z: 0 }, ISLAND_FIELD, moved);
  const before = new Set(out.slice(0, count).map((island) => `${island.cx},${island.cz}`));
  const kept = moved.slice(0, movedCount).filter((island) => before.has(`${island.cx},${island.cz}`));
  assert.ok(kept.length > 0, 'the land persists as the aircraft moves');
});
/* -------------------------------------------------------------- control surfaces */

test('control surfaces deflect the way a pilot expects', () => {
  assert.deepEqual(surfaceAngles({}), { stabilator: 0, flaperon: 0, rudder: 0 });
  assert.deepEqual(surfaceAngles(undefined), { stabilator: 0, flaperon: 0, rudder: 0 });

  // A rotation about the local +X axis drops a trailing edge, so nose-up raises it.
  assert.ok(surfaceAngles({ pitch: 1 }).stabilator < 0, 'nose up raises the stabilator');
  assert.ok(surfaceAngles({ pitch: -1 }).stabilator > 0, 'nose down drops it');

  // The caller applies the differential: the right flaperon rises, the left drops.
  const right = surfaceAngles({ roll: 1 });
  assert.ok(right.flaperon > 0);
  assert.ok(-right.flaperon < 0, 'the opposite side goes the other way');

  assert.ok(surfaceAngles({ yaw: 1 }).rudder < 0, 'yawing right swings the rudder left');

  // Clamped, not unbounded, and never NaN.
  const hard = surfaceAngles({ pitch: 12, roll: -40, yaw: 3 });
  assert.ok(Math.abs(hard.stabilator) <= SURFACE_LIMITS.stabilator + 1e-9);
  assert.ok(Math.abs(hard.flaperon) <= SURFACE_LIMITS.flaperon + 1e-9);
  assert.ok(Math.abs(hard.rudder) <= SURFACE_LIMITS.rudder + 1e-9);
  for (const value of Object.values(surfaceAngles({ pitch: NaN, roll: NaN }))) {
    assert.ok(Number.isFinite(value));
  }
  assert.ok(SURFACE_RATE > 0, 'the surfaces have a real deflection rate');
});

test('the rudder turns the aircraft the way the control mapping promises', () => {
  /*
   * Regression. `systems/controls.js` documents yaw as "+1 to the right" and binds it
   * to E. With the sign the other way round — which is how Stage 3 shipped — holding E
   * turned the nose left. The controller's own basis is what decides this, so it is
   * asserted here rather than trusted.
   */
  const right = fly(new AircraftController({}), 2, { yaw: 1, throttle: 0.6 });
  assert.ok(right.forward.x > 0.1, `yaw right should move the nose toward +X, got ${right.forward.x}`);

  const left = fly(new AircraftController({}), 2, { yaw: -1, throttle: 0.6 });
  assert.ok(left.forward.x < -0.1, `yaw left should move the nose toward -X, got ${left.forward.x}`);
});

/* ------------------------------------------------------------------- quality tiers */

test('quality tiers spend more on the scene as they go up', () => {
  for (let i = 1; i < TIERS.length; i += 1) {
    const lower = PRESETS[TIERS[i - 1]];
    const higher = PRESETS[TIERS[i]];
    assert.ok(higher.clouds >= lower.clouds, `${TIERS[i]} has at least as many clouds`);
    assert.ok(higher.islands >= lower.islands, `${TIERS[i]} has at least as much land`);
    assert.ok(higher.paintTextureSize >= lower.paintTextureSize, `${TIERS[i]} paints bigger maps`);
    assert.ok(higher.cloudTextureSize >= lower.cloudTextureSize, `${TIERS[i]} has bigger cards`);
    assert.ok(higher.shadowMapSize >= lower.shadowMapSize);
    assert.ok(higher.anisotropy >= lower.anisotropy);
  }

  for (const tier of TIERS) {
    const preset = PRESETS[tier];
    assert.ok(
      preset.islands <= ISLAND_FIELD.maxIslands,
      `${tier} asks for more islands than the pool holds`,
    );
    assert.ok(Number.isInteger(preset.clouds) && preset.clouds >= 0);
    assert.ok([128, 256, 512, 1024].includes(preset.paintTextureSize), `${tier} paint map size`);
    assert.ok([128, 256, 512].includes(preset.cloudTextureSize), `${tier} cloud card size`);
    assert.equal(typeof preset.waterDetail, 'boolean');
  }
});


