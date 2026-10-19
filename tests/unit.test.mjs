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
import { CAMERA, DEMO_FLIGHT, FLIGHT, RENDER, WORLD } from '../src/game/config.js';
import { GameState, STATES } from '../src/game/GameState.js';
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
  assert.ok(WORLD.wrapRadius > 0);
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
    assert.ok(Number.isFinite(value), `${key} is finite (${value})`);
  }
  assert.ok(Math.abs(controller.position.x) <= WORLD.wrapRadius + 1e-6);
  assert.ok(Math.abs(controller.position.z) <= WORLD.wrapRadius + 1e-6);
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
