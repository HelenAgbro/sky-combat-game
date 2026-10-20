/**
 * Sky Combat — where coins and supplies are placed.
 *
 * Pure, and unit tested, for the same reason `combat/spawn.js` is: "coins are laid out in
 * clear, collectible patterns" is a promise the placement rules have to keep, and it is
 * much easier to check that in plain Node than by flying around looking for one.
 *
 * A pattern is a *shape*, described as data. The shape is anchored at a point ahead of
 * the aircraft and then expressed in the aircraft's own frame — forward, right, up — so a
 * run of coins runs down the flight path whatever direction the player happens to be
 * flying, rather than down the world's Z axis.
 *
 * Nothing here imports Three.js: points are plain `{x, y, z}` objects, written into
 * arrays the caller already owns.
 */
import { BOUNDS } from '../game/config.js';
import { clamp, lerp, radialDistance } from '../game/math.js';

/** How far inside the ceiling and the floor a pickup is kept, in metres. */
const ALTITUDE_MARGIN = 90;

/**
 * The coin patterns.
 *
 * | field | meaning |
 * | --- | --- |
 * | `count` | how many coins |
 * | `spacing` | metres between coins along the flight direction |
 * | `bow` | how far the pattern bends sideways at its widest, in metres |
 * | `climb` | vertical offset per coin, as a multiple of `spacing` |
 * | `radius` | hoop radius, for the ring pattern |
 *
 * All four are readable at a glance from the cockpit: a line is flown straight through, an
 * arc asks for one gentle weave, a column asks for a climb or a dive, and a hoop is a
 * thing to fly through the middle of.
 */
export const COIN_PATTERNS = Object.freeze({
  line: Object.freeze({ count: 9, spacing: 36, bow: 0, climb: 0, radius: 0 }),
  arc: Object.freeze({ count: 11, spacing: 34, bow: 95, climb: 0.22, radius: 0 }),
  column: Object.freeze({ count: 7, spacing: 34, bow: 0, climb: 2.4, radius: 0 }),
  hoop: Object.freeze({ count: 12, spacing: 0, bow: 0, climb: 0, radius: 38 }),
});

/** The pattern ids, in a fixed order. */
export const COIN_PATTERN_IDS = Object.freeze(Object.keys(COIN_PATTERNS));

/** How far a column leans forward per coin, as a fraction of its spacing. */
const COLUMN_LEAN = 0.28;

/** The player's basis, read once per call. */
const _basis = { fx: 0, fy: 0, fz: 0, rx: 0, ry: 0, rz: 0, ux: 0, uy: 0, uz: 0 };

/**
 * Copy the aircraft's own axes out of the controller.
 *
 * `AircraftController.forward` and friends each return a fresh vector, so reading them
 * once per call rather than once per coin keeps placing a pattern allocation-free.
 */
function readBasis(player, out = _basis) {
  const forward = player.forward;
  const right = player.right;
  const up = player.up;

  out.fx = forward.x; out.fy = forward.y; out.fz = forward.z;
  out.rx = right.x; out.ry = right.y; out.rz = right.z;
  out.ux = up.x; out.uy = up.y; out.uz = up.z;
  return out;
}

/**
 * Keep a point inside the play area.
 *
 * A pickup that appeared beyond the wall the player is not allowed to cross would be a
 * coin nobody can ever collect, so the same two rules the combat spawner uses apply here:
 * the altitude band is clamped, and a point outside the soft radius is pulled back in.
 */
export function clampToPlayArea(point) {
  point.y = clamp(point.y, BOUNDS.minAltitude + ALTITUDE_MARGIN, BOUNDS.maxAltitude - ALTITUDE_MARGIN);

  const radius = radialDistance(point.x, point.z);
  if (radius > BOUNDS.softRadius) {
    const pull = BOUNDS.softRadius / radius;
    point.x *= pull;
    point.z *= pull;
  }

  return point;
}

/**
 * Lay out one coin pattern ahead of the aircraft.
 *
 * @param {() => number} random deterministic source in [0, 1)
 * @param {{position:object, forward:object, right:object, up:object}} player
 * @param {string} patternId one of `COIN_PATTERN_IDS`
 * @param {object} options the `coins` block from `PICKUPS`
 * @param {object[]} out preallocated points, at least `count` of them
 * @returns {number} how many entries of `out` are valid
 */
export function placeCoinPattern(random, player, patternId, options, out = []) {
  const pattern = COIN_PATTERNS[patternId] ?? COIN_PATTERNS.line;
  const count = Math.min(pattern.count, out.length);
  if (count === 0) return 0;

  const basis = readBasis(player);
  const anchor = anchorFrom(random, player.position, basis, options);

  // A hoop is a ring seen end-on; everything else runs away from the player.
  if (pattern.radius > 0) {
    for (let i = 0; i < count; i += 1) {
      const angle = (i / count) * Math.PI * 2;
      const lateral = Math.cos(angle) * pattern.radius;
      const vertical = Math.sin(angle) * pattern.radius;
      writePoint(out[i], anchor, basis, 0, lateral, vertical);
    }
    return count;
  }

  /*
   * A column climbs or dives, and so does an arc. Which way is a coin toss — but a pattern
   * that does not fit inside the altitude band would be flattened against the floor or the
   * ceiling and stop reading as the shape it is meant to be, so if the chosen way does not
   * fit, it goes the other way.
   */
  let climbSign = 0;
  if (pattern.climb !== 0) {
    const span = (count - 1) * pattern.spacing * pattern.climb;
    const roomUp = BOUNDS.maxAltitude - ALTITUDE_MARGIN - anchor.y;
    const roomDown = anchor.y - (BOUNDS.minAltitude + ALTITUDE_MARGIN);
    const toss = random() < 0.5 ? -1 : 1;
    const fits = toss > 0 ? roomUp >= span : roomDown >= span;
    climbSign = fits ? toss : -toss;
  }

  for (let i = 0; i < count; i += 1) {
    const t = count === 1 ? 0 : i / (count - 1);
    const forward = pattern.climb === 0 ? i * pattern.spacing : i * pattern.spacing * COLUMN_LEAN;
    // A bow bends the pattern out and back once, so it reads as one shape rather than a
    // zig-zag: sin over the whole run, not per coin.
    const lateral = pattern.bow === 0 ? 0 : Math.sin(t * Math.PI) * pattern.bow;
    const vertical = pattern.climb === 0 ? 0 : i * pattern.spacing * pattern.climb * climbSign;
    writePoint(out[i], anchor, basis, forward, lateral, vertical);
  }

  return count;
}

/**
 * The point a pattern is built from: ahead of the aircraft, with a little sideways slack
 * so the patterns are not all strung along the exact same line.
 */
export function anchorFor(random, player, options) {
  return anchorFrom(random, player.position, readBasis(player), options);
}

/** The anchor, from a basis the caller has already read. */
function anchorFrom(random, position, basis, options) {
  const distance = lerp(options.minSpawnDistance, options.maxSpawnDistance, random());
  const lateral = (random() - 0.5) * 2 * (options.lateralSpread ?? 0);

  const point = {
    x: position.x + basis.fx * distance + basis.rx * lateral,
    y: position.y + basis.fy * distance + basis.ry * lateral,
    z: position.z + basis.fz * distance + basis.rz * lateral,
  };

  return clampToPlayArea(point);
}

/** Anchor + pattern offsets, in the aircraft's own frame. */
function writePoint(point, anchor, basis, forward, lateral, vertical) {
  point.x = anchor.x + basis.fx * forward + basis.rx * lateral + basis.ux * vertical;
  point.y = anchor.y + basis.fy * forward + basis.ry * lateral + basis.uy * vertical;
  point.z = anchor.z + basis.fz * forward + basis.rz * lateral + basis.uz * vertical;
  return clampToPlayArea(point);
}

/**
 * Should a pickup be given back?
 *
 * Three reasons, the same three the combat systems use: it has been in the world long
 * enough, it is far enough away to be irrelevant, or it is behind the player and
 * therefore unreachable.
 *
 * The player's position and forward vector are passed in rather than read off the
 * controller, because `AircraftController.forward` builds a fresh vector on every access
 * and this runs once per live pickup per step.
 *
 * @param {{age:number, position:object}} entity
 * @param {{x:number,y:number,z:number}} position the aircraft
 * @param {{x:number,z:number}} forward the aircraft's heading
 * @param {object} options `lifespan`, `despawnRange`, `despawnBehind`
 */
export function shouldRecycle(entity, position, forward, options) {
  if (entity.age > options.lifespan) return true;

  const dx = entity.position.x - position.x;
  const dy = entity.position.y - position.y;
  const dz = entity.position.z - position.z;
  if (dx * dx + dy * dy + dz * dz > options.despawnRange * options.despawnRange) return true;

  return dx * forward.x + dz * forward.z < -options.despawnBehind;
}

/**
 * The nearest pickup of a set to a point, or `-1`.
 *
 * Used by the tests to assert that a pattern is laid out where the player can reach it
 * without duplicating the pattern maths.
 */
export function nearestIndex(points, count, to) {
  let best = -1;
  let bestDistance = Infinity;

  for (let i = 0; i < count; i += 1) {
    const dx = points[i].x - to.x;
    const dy = points[i].y - to.y;
    const dz = points[i].z - to.z;
    const distance = dx * dx + dy * dy + dz * dz;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  }

  return best;
}
