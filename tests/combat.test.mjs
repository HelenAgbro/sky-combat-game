/**
 * Sky Combat — unit tests for the combat systems and the zone blend.
 *
 * Everything here is pure: collision maths, the difficulty ramp, placement rules, the enemy
 * motion helpers, the object pool and the zone blend. No renderer, no DOM, so it runs in
 * plain Node — and it is where "enemies never spawn somewhere unavoidable" and "a shot
 * cannot tunnel through a target" are checked rather than hoped for.
 *
 *   npm run test:unit
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { Vector3 } from 'three';

import { Pool } from '../src/combat/Pool.js';
import { closestApproach, spheresOverlap, sweptSphereHit } from '../src/combat/collisions.js';
import { difficultyAt, rampBetween } from '../src/combat/difficulty.js';
import { PATTERNS, bearingTo, orientationFrom, steerAngle } from '../src/combat/motion.js';
import { chooseSpawnPoint, isSpawnLegal, spawnOffsets } from '../src/combat/spawn.js';
import { ENEMIES } from '../src/data/enemies.js';
import { ZONES, getZone } from '../src/data/zones.js';
import { COMBAT } from '../src/game/config.js';
import { createSeededRandom, shortestAngle } from '../src/game/math.js';
import { blendHex, blendNumber, blendZones, parseHex, toHex } from '../src/scene/zoneBlend.js';

/** A player heading along -Z at 420 m, which is where a run starts. */
function player({ x = 0, y = 420, z = 0 } = {}) {
  return {
    position: { x, y, z },
    forward: { x: 0, y: 0, z: -1 },
    right: { x: 1, y: 0, z: 0 },
  };
}

/* ------------------------------------------------------------------- collisions */

test('a fast shot cannot tunnel through a target', () => {
  /*
   * The case that matters. A shot travelling 640 m/s covers 10.7 m in one 60 Hz step, and
   * a nine-metre aircraft is smaller than that. Here the shot starts 15 m short of the
   * target and ends 15 m past it: neither end of the step is inside the target, so a point
   * test at either end misses it entirely. Only the swept test catches it.
   */
  const from = { x: 0, y: 0, z: 0 };
  const to = { x: 0, y: 0, z: -30 };
  const target = { x: 0, y: 0, z: -15 };
  const radius = 9;

  assert.ok(
    Math.hypot(from.x - target.x, from.y - target.y, from.z - target.z) > radius,
    'the shot starts outside the target',
  );
  assert.ok(
    Math.hypot(to.x - target.x, to.y - target.y, to.z - target.z) > radius,
    'and ends outside it, so a point test at either end would miss',
  );
  assert.equal(sweptSphereHit(from, to, target, radius).hit, true, 'the swept segment still catches it');

  const result = sweptSphereHit(from, to, target, radius);
  assert.ok(result.t > 0 && result.t < 1, `contact is inside the step (t=${result.t})`);
});

test('a shot that misses is reported as a miss', () => {
  const from = { x: 0, y: 0, z: 0 };
  const to = { x: 0, y: 0, z: -20 };

  assert.equal(sweptSphereHit(from, to, { x: 40, y: 0, z: -10 }, 9).hit, false);
  // A target behind the shot is not hit.
  assert.equal(sweptSphereHit(from, to, { x: 0, y: 0, z: 10 }, 9).hit, false);
  // Nor is one the segment stops just short of.
  assert.equal(sweptSphereHit(from, to, { x: 0, y: 0, z: -40 }, 9).hit, false);
});

test('a target already inside the radius is hit at the start of the step', () => {
  const result = sweptSphereHit({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -10 }, { x: 0, y: 0, z: -2 }, 5);
  assert.equal(result.hit, true);
  assert.equal(result.t, 0);
});

test('the closest approach is measured against the segment, not the infinite line', () => {
  const a = closestApproach({ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, { x: 5, y: 3, z: 0 });
  assert.ok(Math.abs(a - 3) < 1e-9);

  // Beyond the end of the segment, the nearest point is the end.
  const b = closestApproach({ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, { x: 14, y: 0, z: 0 });
  assert.ok(Math.abs(b - 4) < 1e-9);
});

test('two spheres overlap only when they are close enough', () => {
  assert.equal(spheresOverlap({ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, 5, 5), true);
  assert.equal(spheresOverlap({ x: 0, y: 0, z: 0 }, { x: 10.1, y: 0, z: 0 }, 5, 5), false);
  assert.equal(spheresOverlap({ x: 0, y: 0, z: 0 }, { x: 0, y: 20, z: 0 }, 5, 5), false);
});

/* ------------------------------------------------------------------- difficulty */

test('the difficulty ramp climbs from the first value to the second and stops', () => {
  assert.equal(rampBetween([2, 8], 0), 2);
  assert.equal(rampBetween([2, 8], 1), 8);
  assert.equal(rampBetween([2, 8], 0.5), 5);
  assert.equal(rampBetween([2, 8], -3), 2, 'clamped below');
  assert.equal(rampBetween([2, 8], 4), 8, 'clamped above');

  const start = difficultyAt(0);
  const middle = difficultyAt(COMBAT.ramp.seconds / 2);
  const end = difficultyAt(COMBAT.ramp.seconds);
  const late = difficultyAt(COMBAT.ramp.seconds * 10);

  assert.equal(start.level, 0);
  assert.equal(end.level, 1);
  assert.equal(late.level, 1, 'the ramp does not keep going');

  assert.ok(start.spawnInterval > middle.spawnInterval, 'enemies arrive sooner');
  assert.ok(middle.spawnInterval > end.spawnInterval);
  assert.ok(start.maxAlive <= middle.maxAlive, 'and in greater numbers');
  assert.ok(middle.maxAlive <= end.maxAlive);
  assert.ok(start.speed <= end.speed);
  assert.ok(start.fireRate <= end.fireRate);
  assert.ok(Number.isInteger(end.maxAlive));
});


/* ------------------------------------------------------------------- placement */

test('nothing is ever spawned on the player’s own flight path', () => {
  const random = createSeededRandom(4242);
  const subject = player();
  const options = COMBAT.enemies;

  for (let i = 0; i < 500; i += 1) {
    const point = chooseSpawnPoint(random, subject, options, {});
    const { ahead, lateral } = spawnOffsets(point, subject);

    assert.ok(ahead >= options.minSpawnDistance - 1e-6, `spawned too close (${ahead.toFixed(0)} m ahead)`);
    assert.ok(
      lateral >= options.minLateralOffset - 1e-6,
      `spawned dead ahead (${lateral.toFixed(0)} m off the line)`,
    );
    assert.ok(point.y >= 60 && point.y <= 1800, `spawned outside the altitude band (${point.y.toFixed(0)} m)`);
    assert.ok(isSpawnLegal(point, subject, options), 'and the rule check agrees');
  }
});

test('a spawn near the edge of the arena is pulled back inside it', () => {
  const random = createSeededRandom(77);
  const subject = player({ x: 3300, z: 0 });
  const point = chooseSpawnPoint(random, subject, COMBAT.enemies, {});
  assert.ok(Math.hypot(point.x, point.z) <= 3400 + 1e-6, 'inside the boundary the player cannot cross');
});

test('hazards are placed on both sides of the flight path, not only above it', () => {
  const random = createSeededRandom(9);
  const subject = player();
  let above = 0;
  let below = 0;

  for (let i = 0; i < 300; i += 1) {
    const point = chooseSpawnPoint(random, subject, COMBAT.obstacles, {});
    if (point.y > subject.position.y) above += 1;
    else below += 1;
  }

  assert.ok(above > 40, `some hazards sit above the player (${above})`);
  assert.ok(below > 40, `and some below (${below})`);
});

test('every enemy type is complete, and flies a pattern that exists', () => {
  for (const enemy of ENEMIES) {
    assert.ok(PATTERNS[enemy.pattern], `${enemy.id} names a real pattern`);
    assert.ok(enemy.speed > 40 && enemy.speed < 220, `${enemy.id} flies at ${enemy.speed} m/s`);
    assert.ok(enemy.turnRate > 0 && enemy.turnRate < 3);
    assert.ok(enemy.shape?.wing && enemy.shape?.fins, `${enemy.id} has a complete shape`);
    assert.ok(enemy.livery?.paint && enemy.livery?.accent && enemy.livery?.dark && enemy.livery?.glass);
  }
});

/* ---------------------------------------------------------------------- motion */

test('orientationFrom follows the heading convention used everywhere else', () => {
  const nose = new Vector3(0, 0, -1);
  const forward = (heading, climb) => nose.clone().applyQuaternion(orientationFrom(heading, climb));

  const level = forward(0, 0);
  assert.ok(Math.abs(level.x) < 1e-9 && Math.abs(level.y) < 1e-9, 'heading 0 is level');
  assert.ok(Math.abs(level.z + 1) < 1e-9, 'and points along -Z');

  const east = forward(Math.PI / 2, 0);
  assert.ok(Math.abs(east.x - 1) < 1e-9, 'heading +pi/2 points along +X');

  const climbing = forward(0, 0.4);
  assert.ok(Math.abs(climbing.y - Math.sin(0.4)) < 1e-9, 'a positive climb raises the nose');
  assert.ok(Math.abs(climbing.z + Math.cos(0.4)) < 1e-9);
});

test('steering turns toward a heading by a bounded amount and never overshoots', () => {
  assert.ok(Math.abs(steerAngle(0, 1, 1, 0.1) - 0.1) < 1e-9, 'a slow turn takes one step');
  assert.ok(Math.abs(steerAngle(0, 0.05, 1, 0.1) - 0.05) < 1e-9, 'and stops on the target');

  // A turn across the wrap-around takes the short way round.
  const wrapped = steerAngle(3.0, -3.0, 1, 0.5);
  assert.ok(wrapped > 3.0, `it goes the short way (${wrapped})`);

  assert.ok(Math.abs(shortestAngle(0, Math.PI) - Math.PI) < 1e-9);
  // The antipode is reported as +pi rather than -pi: the range is (-pi, pi].
  assert.ok(Math.abs(Math.abs(shortestAngle(0, -Math.PI)) - Math.PI) < 1e-9);
});

test('the patterns are readable: patrol holds a line, engage turns in', () => {
  const out = { heading: 0, climb: 0, speed: 1 };
  const subject = player({ x: 0, y: 420, z: -900 });
  const context = { position: subject.position, forward: subject.forward };
  const enemy = { position: { x: 0, y: 420, z: 0 }, baseHeading: 0.5, age: 1.7, phase: 0.3 };

  PATTERNS.patrol(enemy, context, out);
  assert.equal(out.heading, 0.5, 'a patrol holds the heading it started on');
  assert.ok(Math.abs(out.climb) < 0.2, 'with only a gentle altitude change');

  PATTERNS.engage(enemy, context, out);
  const bearing = bearingTo(enemy.position, subject.position, {});
  assert.ok(
    Math.abs(shortestAngle(out.heading, bearing.heading)) < 1e-9,
    'an engaging enemy turns toward the player while it is far away',
  );
  assert.ok(out.speed > 1, 'and closes');

  PATTERNS.orbit(enemy, context, out);
  assert.ok(Number.isFinite(out.heading) && Number.isFinite(out.climb));

  PATTERNS.weave(enemy, context, out);
  assert.ok(Number.isFinite(out.heading) && Number.isFinite(out.climb));
});


/* ------------------------------------------------------------------------ pool */

test('the pool recycles objects and never grows', () => {
  let created = 0;
  const pool = new Pool({
    capacity: 4,
    create: () => {
      created += 1;
      return { id: created };
    },
  });

  assert.equal(created, 4, 'everything is created up front');
  assert.equal(pool.freeCount, 4);
  assert.equal(pool.activeCount, 0);

  const taken = [pool.acquire(), pool.acquire(), pool.acquire()];
  assert.equal(pool.activeCount, 3);
  assert.equal(pool.freeCount, 1);

  // The active list stays contiguous, so iterating it is a plain loop.
  assert.deepEqual(pool.active, taken);

  // Releasing one swaps the last into the gap rather than leaving a hole.
  pool.release(taken[1]);
  assert.equal(pool.activeCount, 2);
  assert.equal(pool.active.includes(taken[1]), false);
  assert.equal(taken[1].active, false);

  // Releasing twice is harmless.
  pool.release(taken[1]);
  assert.equal(pool.activeCount, 2);

  // Exhausting the pool returns null rather than allocating.
  assert.ok(pool.acquire());
  assert.ok(pool.acquire());
  assert.equal(pool.acquire(), null, 'a full pool hands back nothing');
  assert.equal(created, 4, 'and still never grew');

  pool.releaseAll();
  assert.equal(pool.activeCount, 0);
  assert.equal(pool.freeCount, 4);
  assert.equal(created, 4);
});

test('iterating the pool backwards is safe while releasing', () => {
  const pool = new Pool({ capacity: 5, create: (i) => ({ id: i }) });
  for (let i = 0; i < 5; i += 1) pool.acquire();

  const seen = [];
  pool.forEachActive((item) => {
    seen.push(item.id);
    pool.release(item);
  });

  assert.equal(seen.length, 5, 'every active object was visited exactly once');
  assert.equal(new Set(seen).size, 5);
  assert.equal(pool.activeCount, 0);
});

/* ------------------------------------------------------------------ zone blend */

test('hex colours round-trip and blend', () => {
  assert.deepEqual(parseHex('#1d5da8'), [29, 93, 168]);
  assert.equal(toHex([29, 93, 168]), '#1d5da8');
  assert.equal(toHex([-20, 300, 5]), '#00ff05', 'clamped and padded');
  assert.equal(blendHex('#000000', '#ffffff', 0), '#000000');
  assert.equal(blendHex('#000000', '#ffffff', 1), '#ffffff');
  assert.equal(blendHex('#000000', '#ffffff', 0.5), '#808080');
  assert.equal(blendNumber(10, 20, 0.25), 12.5);
});

test('a blend of two zones is one zone at each end and half of both in the middle', () => {
  const coastal = getZone('coastal');
  const storm = getZone('storm');

  const start = blendZones(coastal, storm, 0);
  const end = blendZones(coastal, storm, 1);
  const middle = blendZones(coastal, storm, 0.5);

  assert.equal(start.sky.zenith, coastal.sky.zenith);
  assert.equal(end.sky.zenith, storm.sky.zenith);
  assert.ok(Math.abs(start.fog.near - coastal.fog.near) < 1e-9);
  assert.ok(Math.abs(end.fog.near - storm.fog.near) < 1e-9);

  // The middle is between the two, not equal to either.
  const a = parseHex(coastal.fog.color);
  const b = parseHex(storm.fog.color);
  const m = parseHex(middle.fog.color);
  for (let i = 0; i < 3; i += 1) {
    assert.ok(m[i] >= Math.min(a[i], b[i]) && m[i] <= Math.max(a[i], b[i]), 'the blend stays between');
  }

  // The identity follows the destination once past halfway.
  assert.equal(start.id, 'coastal');
  assert.equal(middle.id, 'storm');
});

test('the scenery kind flips at the midpoint, because geometry cannot be blended', () => {
  const coastal = getZone('coastal');
  const mountain = getZone('mountain');

  assert.equal(blendZones(coastal, mountain, 0.49).scenery.terrain, 'islands');
  assert.equal(blendZones(coastal, mountain, 0.51).scenery.terrain, 'mountains');
  assert.equal(blendZones(coastal, mountain, 0.49).ridge.kind, 'coast');
  assert.equal(blendZones(coastal, mountain, 0.51).ridge.kind, 'peaks');
});

test('every zone names a scenery kind and a ridge kind', () => {
  for (const zone of ZONES) {
    assert.ok(zone.scenery?.terrain, `${zone.id} names a terrain kind`);
    assert.ok(zone.ridge?.kind, `${zone.id} names a ridge kind`);
    assert.ok(zone.ridge.color && typeof zone.ridge.opacity === 'number');
    assert.ok(zone.exposure > 0);
  }
});
