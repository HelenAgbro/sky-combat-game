/**
 * Sky Combat — small numeric helpers shared by the flight model and the camera.
 *
 * Pure functions only, so they are unit tested directly. Keeping the damping here
 * matters: it is the one piece of motion maths that has to behave identically at
 * 30, 60, 144 or 240 frames a second.
 */

/** Clamp a value into a range. */
export function clamp(value, min, max) {
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
