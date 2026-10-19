/**
 * Sky Combat — unit tests for the control mapping, the maths helpers and the
 * flight-area boundaries. All pure logic: no DOM, no renderer.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { AircraftController } from '../src/aircraft/AircraftController.js';
import { BOUNDS, RENDER } from '../src/game/config.js';
import { damp, headingError, radialDistance } from '../src/game/math.js';
import {
  GAMEPLAY_KEYS,
  KEY_BINDINGS,
  isTypingTarget,
  mergeControls,
  readControls,
} from '../src/systems/controls.js';

const STEP = RENDER.fixedStep;

function fly(controller, seconds, input = {}) {
  const steps = Math.round(seconds / STEP);
  for (let i = 0; i < steps; i += 1) {
    controller.setInput(input);
    controller.step(STEP);
  }
  return controller;
}

// --------------------------------------------------------------- key mapping

test('every gameplay key is bound and none are duplicated', () => {
  assert.ok(GAMEPLAY_KEYS.includes('KeyW'));
  assert.ok(GAMEPLAY_KEYS.includes('ArrowUp'));
  assert.ok(GAMEPLAY_KEYS.includes('Space'));
  assert.equal(new Set(GAMEPLAY_KEYS).size, GAMEPLAY_KEYS.length);
  for (const [action, codes] of Object.entries(KEY_BINDINGS)) {
    assert.ok(codes.length > 0, `${action} has at least one key`);
  }
});

test('W and the up arrow both raise the nose', () => {
  assert.equal(readControls(['KeyW']).pitch, 1);
  assert.equal(readControls(['ArrowUp']).pitch, 1);
  assert.equal(readControls(['KeyS']).pitch, -1);
  assert.equal(readControls(['ArrowDown']).pitch, -1);
});

test('A and D roll, and the arrows do the same', () => {
  assert.equal(readControls(['KeyA']).roll, -1);
  assert.equal(readControls(['ArrowLeft']).roll, -1);
  assert.equal(readControls(['KeyD']).roll, 1);
  assert.equal(readControls(['ArrowRight']).roll, 1);
});

test('opposing keys cancel out', () => {
  const state = readControls(['KeyW', 'ArrowDown', 'KeyA', 'KeyD']);
  assert.equal(state.pitch, 0);
  assert.equal(state.roll, 0);
});

test('shift boosts, space fires, and nothing else does', () => {
  assert.equal(readControls(['ShiftLeft']).boost, true);
  assert.equal(readControls(['ShiftRight']).boost, true);
  assert.equal(readControls(['Space']).fire, true);
  assert.equal(readControls(['KeyW']).fire, false);
  assert.equal(readControls([]).boost, false);
});

test('an empty or unknown key set is neutral', () => {
  const neutral = readControls([]);
  assert.deepEqual(
    { pitch: neutral.pitch, roll: neutral.roll, yaw: neutral.yaw, boost: neutral.boost },
    { pitch: 0, roll: 0, yaw: 0, boost: false },
  );
  assert.equal(readControls(['KeyZ']).pitch, 0);
});

test('the game ignores keys aimed at a text field', () => {
  assert.equal(isTypingTarget({ tagName: 'INPUT', type: 'text' }), true);
  assert.equal(isTypingTarget({ tagName: 'TEXTAREA' }), true);
  assert.equal(isTypingTarget({ tagName: 'SELECT' }), true);
  assert.equal(isTypingTarget({ isContentEditable: true }), true);

  // Buttons are not typing, so a focused button must not swallow the controls.
  assert.equal(isTypingTarget({ tagName: 'BUTTON' }), false);
  assert.equal(isTypingTarget({ tagName: 'INPUT', type: 'button' }), false);
  assert.equal(isTypingTarget({ tagName: 'INPUT', type: 'checkbox' }), false);
  assert.equal(isTypingTarget(null), false);
  assert.equal(isTypingTarget(undefined), false);
});

test('touch state overrides the keyboard where it is driving a channel', () => {
  const base = readControls(['KeyW', 'KeyA']);
  const merged = mergeControls(base, { roll: 1, pitch: 0 });
  assert.equal(merged.roll, 1, 'the touch stick wins on roll');
  assert.equal(merged.pitch, 0, 'and on pitch');
  assert.equal(merged.boost, base.boost, 'untouched channels keep the keyboard value');

  assert.deepEqual(mergeControls(base, null), base);
});

// -------------------------------------------------------------- maths helpers

test('damping is frame-rate independent', () => {
  const oneBigStep = damp(0, 100, 6, 0.05);
  const twoHalfSteps = damp(damp(0, 100, 6, 0.025), 100, 6, 0.025);
  const tenSmallSteps = Array.from({ length: 10 }).reduce(
    (value) => damp(value, 100, 6, 0.005),
    0,
  );

  assert.ok(Math.abs(oneBigStep - twoHalfSteps) < 1e-9);
  assert.ok(Math.abs(oneBigStep - tenSmallSteps) < 1e-9);
});

test('damping moves toward the target without overshooting', () => {
  let value = 0;
  for (let i = 0; i < 400; i += 1) value = damp(value, 100, 6, 1 / 60);
  assert.ok(value > 99 && value <= 100, `settled at ${value}`);

  assert.equal(damp(42, 100, 0, 0.1), 42, 'a rate of zero changes nothing');
  assert.equal(damp(42, 100, 6, 0), 42, 'no time passes, nothing changes');
});

test('heading error is signed, and positive means the target is to the left', () => {
  // Facing -Z. A target at -X is to the left, so the error must be positive.
  assert.ok(headingError(0, -1, -1, 0) > 0);
  assert.ok(headingError(0, -1, 1, 0) < 0);
  assert.ok(Math.abs(headingError(0, -1, 0, -1)) < 1e-9, 'aligned');
  // Directly behind is a half turn either way, and which way is arbitrary.
  assert.ok(Math.abs(Math.abs(headingError(0, -1, 0, 1)) - Math.PI) < 1e-6, 'directly behind');
});

// ----------------------------------------------------------------- boundaries

test('the aircraft cannot be flown into the sea', () => {
  const controller = new AircraftController({});
  let sawAltitudeWarning = false;

  for (let i = 0; i < 12000; i += 1) {
    controller.setInput({ pitch: -1, throttle: 1 });
    controller.step(STEP);
    if (controller.boundary === 'altitude') sawAltitudeWarning = true;
    assert.ok(controller.altitude >= BOUNDS.minAltitude - 1e-6, `altitude ${controller.altitude}`);
  }

  assert.ok(sawAltitudeWarning, 'the floor reports itself to the interface');
});

test('the aircraft cannot be flown through the ceiling', () => {
  const controller = new AircraftController({});
  let sawCeiling = false;

  for (let i = 0; i < 12000; i += 1) {
    controller.setInput({ pitch: 1, throttle: 1 });
    controller.step(STEP);
    if (controller.boundary === 'altitude' && controller.altitude > 1000) sawCeiling = true;
    assert.ok(controller.altitude <= BOUNDS.maxAltitude + 1e-6, `altitude ${controller.altitude}`);
  }

  assert.ok(sawCeiling, 'the ceiling reports itself to the interface');
});

test('the aircraft is turned back at the edge of the flight area', () => {
  const controller = new AircraftController({});
  let sawEdge = false;
  let firstEdgeStep = -1;
  let returnedInside = false;
  let furthest = 0;

  for (let i = 0; i < 20000; i += 1) {
    controller.setInput({ pitch: 0, roll: 0, throttle: 1 });
    controller.step(STEP);

    const radius = radialDistance(controller.position.x, controller.position.z);
    furthest = Math.max(furthest, radius);

    if (controller.boundary === 'edge') {
      sawEdge = true;
      if (firstEdgeStep < 0) firstEdgeStep = i;
    }
    // Having been turned around, it should come back inside the soft boundary.
    if (firstEdgeStep >= 0 && i > firstEdgeStep + 120 && radius < BOUNDS.softRadius) {
      returnedInside = true;
    }
  }

  assert.ok(sawEdge, 'flying straight out eventually reaches the boundary');
  assert.ok(furthest > BOUNDS.softRadius, 'the soft boundary is reached first');
  assert.ok(furthest <= BOUNDS.hardRadius + 1e-6, `never beyond the hard limit (${furthest})`);
  assert.ok(returnedInside, 'the boundary actually turns the aircraft back, rather than fencing it in');
});

test('the same inputs always produce the same flight', () => {
  const inputs = [
    { pitch: 0.6, roll: -0.4, throttle: 0.8, boost: true },
    { pitch: -0.2, roll: 0.9, throttle: 0.5 },
    { pitch: 0.1, roll: 0.2, throttle: 1 },
  ];
  const run = () => {
    const controller = new AircraftController({});
    for (let i = 0; i < 900; i += 1) {
      controller.setInput(inputs[Math.floor(i / 300) % inputs.length]);
      controller.step(STEP);
    }
    return controller.telemetry();
  };

  assert.deepEqual(run(), run(), 'no hidden state between runs');
});

test('a nimble aircraft banks faster than a heavy one', () => {
  const heavy = fly(new AircraftController({ attributes: { agility: 2, speed: 5, fuel: 5 } }), 3, { roll: 1 });
  const nimble = fly(new AircraftController({ attributes: { agility: 10, speed: 5, fuel: 5 } }), 3, { roll: 1 });
  assert.ok(Math.abs(nimble.bankAngle) > Math.abs(heavy.bankAngle));
});
