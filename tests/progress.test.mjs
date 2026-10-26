/**
 * Sky Combat — unit tests for the run's distance and the local record.
 *
 * Both are small and both are load-bearing: distance is the score, and the record is the only
 * thing that survives a reload. The promises checked here are the ones the stage makes — the
 * odometer does not depend on how a second is chopped into frames, a junk value in storage is
 * never a record, a refused write never breaks a run, and a record is never lowered.
 *
 *   npm run test:unit
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { advanceDistance, formatDistance } from '../src/run/distance.js';
import {
  BEST_DISTANCE_KEY,
  isRecord,
  readBestDistance,
  recordBestDistance,
} from '../src/run/progress.js';

/** A stand-in for `localStorage`: the same surface, plus the map to look inside. */
function memoryStore(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

/* ------------------------------------------------------------------- distance */

test('distance advances by speed times time', () => {
  assert.equal(advanceDistance(0, 78, 1), 78);
  assert.equal(advanceDistance(100, 50, 0.5), 125);
  assert.equal(advanceDistance(0, 0, 1), 0);
});

test('a second of flight covers the same ground at any frame rate', () => {
  const speed = 80;
  const at30 = simulate(speed, 1, 30);
  const at60 = simulate(speed, 1, 60);
  const at144 = simulate(speed, 1, 144);
  const at240 = simulate(speed, 1, 240);

  assert.ok(Math.abs(at30 - 80) < 1e-9, `30 fps: ${at30}`);
  assert.ok(Math.abs(at60 - 80) < 1e-9, `60 fps: ${at60}`);
  assert.ok(Math.abs(at144 - 80) < 1e-9, `144 fps: ${at144}`);
  assert.ok(Math.abs(at240 - 80) < 1e-9, `240 fps: ${at240}`);
  // The only difference allowed is floating-point accumulation: the rule has no frame rate in it.
  assert.ok(Math.abs(at30 - at240) < 1e-9, 'the frame rate must not change the distance');
});

/** The odometer after `seconds` at `speed`, stepped `frames` times. */
function simulate(speed, seconds, frames) {
  const dt = seconds / frames;
  let total = 0;
  for (let i = 0; i < frames; i += 1) total = advanceDistance(total, speed, dt);
  return total;
}

test('a nonsense step adds nothing, and the odometer never rewinds', () => {
  assert.equal(advanceDistance(500, Number.NaN, 1), 500);
  assert.equal(advanceDistance(500, 50, Number.NaN), 500);
  assert.equal(advanceDistance(500, 50, -1), 500, 'a negative step is not flown backwards');
  assert.equal(advanceDistance(500, -50, 1), 500, 'a negative speed is not flown backwards');
  assert.equal(advanceDistance(500, Number.POSITIVE_INFINITY, 1), 500);
  assert.equal(advanceDistance(Number.NaN, 10, 1), 10, 'a corrupted total recovers');
  assert.equal(advanceDistance(-40, 10, 1), 10);
});

test('the readout keeps metres below ten kilometres and kilometres above it', () => {
  assert.equal(formatDistance(0), '0 m');
  assert.equal(formatDistance(840.4), '840 m');
  assert.equal(formatDistance(9999), '9999 m');
  assert.equal(formatDistance(9999.6), '10.0 km', 'rounded before the unit is chosen');
  assert.equal(formatDistance(12400), '12.4 km');
  assert.equal(formatDistance(-20), '0 m');
  assert.equal(formatDistance(Number.NaN), '0 m');
});

/* -------------------------------------------------------------------- record */

test('no record is no record', () => {
  assert.equal(readBestDistance(memoryStore()), 0);
  assert.equal(readBestDistance(null), 0, 'a browser with no storage simply has no record');
});

test('a record is written once, and never lowered', () => {
  const store = memoryStore();

  assert.equal(recordBestDistance(store, 1200.4, 0), 1200, 'the record is whole metres');
  assert.equal(store.values.get(BEST_DISTANCE_KEY), '1200');
  assert.equal(recordBestDistance(store, 900, 1200), 1200, 'a shorter run does not lower it');
  assert.equal(store.values.get(BEST_DISTANCE_KEY), '1200');
  assert.equal(recordBestDistance(store, 2000, 1200), 2000);
  assert.equal(readBestDistance(store), 2000, 'and it is what the next page load sees');
});

test('junk in the store is not a record', () => {
  for (const junk of ['abc', '', '-40', 'Infinity', 'NaN', '{"metres":40}']) {
    assert.equal(readBestDistance(memoryStore({ [BEST_DISTANCE_KEY]: junk })), 0, junk);
  }
});

test('a store that throws costs the flight nothing', () => {
  const broken = {
    getItem() {
      throw new Error('blocked');
    },
    setItem() {
      throw new Error('quota');
    },
  };

  assert.equal(readBestDistance(broken), 0);
  // The write is refused, but the session still remembers what the browser would not.
  assert.equal(recordBestDistance(broken, 4321, 0), 4321);
});

test('equalling the record is not a new record, and a run of nothing is never one', () => {
  assert.equal(isRecord(1000, 0), true);
  assert.equal(isRecord(1000, 999), true);
  assert.equal(isRecord(1000, 1000), false);
  assert.equal(isRecord(1000, 1500), false);
  assert.equal(isRecord(0, 0), false);
  assert.equal(isRecord(-10, 0), false);
  assert.equal(isRecord(Number.NaN, 0), false);
});
