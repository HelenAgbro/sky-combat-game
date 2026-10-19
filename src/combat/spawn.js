/**
 * Sky Combat — where enemies and hazards are allowed to appear.
 *
 * Pure, and unit tested, because "enemies must not spawn in unavoidable positions" is a
 * promise the placement rules have to keep rather than a hope. Three rules do it:
 *
 * 1. nothing appears closer than `minSpawnDistance`, so there is always time to react;
 * 2. nothing appears on the player's own flight path — every spawn is offset sideways by
 *    at least `minLateralOffset`, so it is always something to fly around rather than
 *    something to fly into;
 * 3. nothing is placed outside the play area, so a spawn can never be somewhere the
 *    player is not allowed to go.
 */
import { BOUNDS } from '../game/config.js';
import { clamp, lerp, radialDistance } from '../game/math.js';

/** How far inside the ceiling and floor a spawn is kept, in metres. */
const ALTITUDE_MARGIN = 90;

/**
 * Pick a point ahead of the player.
 *
 * @param {() => number} random deterministic source in [0, 1)
 * @param {{position:object, forward:object, right:object}} player
 * @param {object} options the `enemies` or `obstacles` block from `COMBAT`
 * @param {object} [out] written into and returned, so callers never allocate
 */
export function chooseSpawnPoint(random, player, options, out = {}) {
  const distance = lerp(options.minSpawnDistance, options.maxSpawnDistance, random());
  const side = random() < 0.5 ? -1 : 1;
  const lateral = side * lerp(options.minLateralOffset, options.maxLateralOffset, random());

  // Enemies are placed a minimum distance off the flight path in either direction;
  // hazards are placed anywhere in a band around the player's altitude, which is a
  // signed range. Both express the same idea — never dead ahead — differently.
  const vertical = options.signedAltitude
    ? lerp(options.minAltitudeOffset, options.maxAltitudeOffset, random())
    : (random() < 0.5 ? -1 : 1) * lerp(options.minVerticalOffset, options.maxVerticalOffset, random());

  const { position, forward, right } = player;
  let x = position.x + forward.x * distance + right.x * lateral;
  let z = position.z + forward.z * distance + right.z * lateral;
  const y = clamp(
    position.y + vertical,
    BOUNDS.minAltitude + ALTITUDE_MARGIN,
    BOUNDS.maxAltitude - ALTITUDE_MARGIN,
  );

  // Rule 3: pull the spawn back inside the arena rather than letting it appear beyond
  // the wall the player is not allowed to cross.
  const radius = radialDistance(x, z);
  if (radius > BOUNDS.softRadius) {
    const pull = BOUNDS.softRadius / radius;
    x *= pull;
    z *= pull;
  }

  out.x = x;
  out.y = y;
  out.z = z;
  return out;
}

/**
 * How far ahead of the player a point is, along the player's own heading, and how far
 * to the side of it. Exposed so the tests can assert the placement rules directly
 * rather than inferring them from `chooseSpawnPoint`'s output.
 */
export function spawnOffsets(point, player) {
  const dx = point.x - player.position.x;
  const dz = point.z - player.position.z;
  return {
    ahead: dx * player.forward.x + dz * player.forward.z,
    lateral: Math.abs(dx * player.right.x + dz * player.right.z),
    vertical: Math.abs(point.y - player.position.y),
  };
}

/** Does a point satisfy the two rules that matter for safety? */
export function isSpawnLegal(point, player, options) {
  const { ahead, lateral } = spawnOffsets(point, player);
  if (ahead < options.minSpawnDistance - 1e-6) return false;
  if (lateral < options.minLateralOffset - 1e-6) return false;
  if (point.y < BOUNDS.minAltitude || point.y > BOUNDS.maxAltitude) return false;
  if (radialDistance(point.x, point.z) > BOUNDS.softRadius + 1e-6) return false;
  return true;
}
