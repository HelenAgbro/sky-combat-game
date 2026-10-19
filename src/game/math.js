/**
 * Sky Combat — small numeric helpers shared by the flight model and the camera.
 *
 * Pure functions only, so they are unit tested directly. Keeping the damping here
 * matters: it is the one piece of motion maths that has to behave identically at
 * 30, 60, 144 or 240 frames a second.
 */

/**
 * Clamp a value into a range.
 *
 * A `NaN` is clamped to the minimum rather than passed through. A NaN reaching a
 * transform makes the object disappear from the scene entirely, which is a far worse
 * failure than a wrong-but-finite value — and one bad number in an input would
 * otherwise be enough to cause it.
 */
export function clamp(value, min, max) {
  if (Number.isNaN(value)) return min;
  return value < min ? min : value > max ? max : value;
}

/**
 * Frame-rate independent exponential damping: move `current` toward `target` at
 * `rate` per second. The result depends only on elapsed time, never on how many
 * frames that time was split into — `damp(damp(a, b, k, dt/2), b, k, dt/2)` equals
 * `damp(a, b, k, dt)`.
 */
export function damp(current, target, rate, dt) {
  return current + (target - current) * (1 - Math.exp(-rate * dt));
}

/**
 * Signed angle from one heading to another, in the horizontal plane, in radians.
 * Positive means the target lies to the left, which is the direction a positive
 * rotation about the world's up axis turns the nose.
 */
export function headingError(fromX, fromZ, toX, toZ) {
  const cross = fromZ * toX - fromX * toZ;
  const dot = fromX * toX + fromZ * toZ;
  return Math.atan2(cross, dot);
}

/** Shortest distance from a point to a circle of `radius` centred on the origin, in the XZ plane. */
export function radialDistance(x, z) {
  return Math.hypot(x, z);
}

/** The signed shortest angle from one heading to another, in (−π, π]. */
export function shortestAngle(from, to) {
  let difference = (to - from) % (Math.PI * 2);
  if (difference > Math.PI) difference -= Math.PI * 2;
  if (difference <= -Math.PI) difference += Math.PI * 2;
  return difference;
}

/** Linear interpolation, clamped at both ends. */
export function lerp(from, to, t) {
  return from + (to - from) * clamp(t, 0, 1);
}

/**
 * A small deterministic PRNG (xorshift32), returning values in [0, 1).
 *
 * Every generated thing in this game — paint, panel lines, clouds, islands — is
 * driven from this, so a build looks identical on every machine and every run. It
 * lives here rather than in the texture factory so the cloud and island layout
 * modules can use it without importing anything that touches the DOM.
 */
export function createSeededRandom(seed = 1) {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) % 100000) / 100000;
  };
}
