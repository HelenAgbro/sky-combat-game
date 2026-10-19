/**
 * Sky Combat — control-surface deflection.
 *
 * Pure: control input in, hinge angles out. The signs are the ones a pilot would
 * expect — pull back and the stabilators' trailing edges go up, bank right and the
 * right flaperon rises while the left one drops — and they are asserted by the unit
 * tests, so a change to the airframe cannot silently reverse them.
 *
 * A rotation about the local +X axis takes a trailing edge downward, which is why
 * nose-up and nose-right both need a negative angle.
 */
import { clamp } from '../game/math.js';

/** Full-deflection angles, in radians. */
export const SURFACE_LIMITS = Object.freeze({
  /** All-moving tailplane. */
  stabilator: 0.36,
  /** Trailing-edge flap used as an aileron. */
  flaperon: 0.42,
  rudder: 0.3,
});

/**
 * Negate without producing `-0`. A negative zero compares unequal to zero under strict
 * equality and serialises as `-0` in telemetry, so it is worth not creating.
 */
const negate = (value) => (value === 0 ? 0 : -value);

/**
 * @param {{pitch?:number, roll?:number, yaw?:number}} input −1…1 per axis
 * @param {object} [limits]
 * @returns {{stabilator:number, flaperon:number, rudder:number}} radians
 */
export function surfaceAngles(input, limits = SURFACE_LIMITS) {
  const pitch = clamp(input?.pitch ?? 0, -1, 1);
  const roll = clamp(input?.roll ?? 0, -1, 1);
  const yaw = clamp(input?.yaw ?? 0, -1, 1);

  return {
    stabilator: negate(pitch) * limits.stabilator,
    flaperon: roll * limits.flaperon,
    rudder: negate(yaw) * limits.rudder,
  };
}

/** How quickly a surface reaches its commanded deflection, per second. */
export const SURFACE_RATE = 9;
