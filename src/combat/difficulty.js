/**
 * Sky Combat — the difficulty ramp.
 *
 * Pure: metres flown in, difficulty out. Every value is interpolated between the two numbers
 * in `COMBAT.ramp`, so tuning the fight is editing two values rather than hunting for a rule.
 *
 * Three decisions make the ramp *fair* rather than merely increasing:
 *
 * 1. **It runs on distance, not on the clock.** Flying straight for a minute should not be as
 *    hard as fighting through a minute, and a player who circles to repair has not earned a
 *    harder sky. Distance is also the number the run is scored by, so the ramp visibly tracks
 *    the thing the player is being asked to do.
 * 2. **It starts with a grace distance.** The opening kilometre is the *easiest* setting, held
 *    flat, so a new player learns the controls against the fight they were taught on.
 * 3. **It is eased, not linear.** A linear ramp arrives at its hardest setting at full speed
 *    and joins the grace with a crease. Smoothstep leaves the opening flat, eases in, and
 *    settles at the top, so no metre is meaningfully harder than the one before it.
 */
import { COMBAT } from '../game/config.js';
import { clamp, lerp } from '../game/math.js';

/** Interpolate between a `[from, to]` pair. */
export function rampBetween(range, t) {
  return lerp(range[0], range[1], clamp(t, 0, 1));
}

/**
 * Smoothstep: 0 at 0, 1 at 1, and flat at both ends.
 *
 * Flat at the ends is the point — it is what turns the grace distance into a seamless join
 * and stops the last few metres of the ramp from arriving as a step.
 */
export function easeLevel(t) {
  const x = clamp(Number.isFinite(t) ? t : 0, 0, 1);
  return x * x * (3 - 2 * x);
}

/**
 * How far through the ramp a run is, 0–1, *after* the grace distance.
 *
 * Kept separate from `difficultyAt` because the two answer different questions: this one is
 * "how much of the climb is left", the other is "what are the settings right now".
 */
export function rampProgress(distance, config = COMBAT) {
  const ramp = config?.ramp ?? COMBAT.ramp;
  const metres = Number.isFinite(distance) ? Math.max(0, distance) : 0;
  const grace = Number.isFinite(ramp.grace) ? Math.max(0, ramp.grace) : 0;
  const span = Number.isFinite(ramp.distance) && ramp.distance > 0 ? ramp.distance : 1;
  return clamp((metres - grace) / span, 0, 1);
}

/**
 * How hard the fight is after `distance` metres.
 *
 * @param {number} distance metres flown this run
 * @param {object} [config]
 * @returns {{progress:number, level:number, spawnInterval:number, maxAlive:number,
 *   speed:number, fireRate:number, obstacleInterval:number}}
 *   `progress` is the raw position on the ramp; `level` is the eased position, which is what
 *   every setting is interpolated by.
 */
export function difficultyAt(distance, config = COMBAT) {
  const ramp = config?.ramp ?? COMBAT.ramp;
  const progress = rampProgress(distance, config);
  const level = easeLevel(progress);

  return {
    progress,
    level,
    spawnInterval: rampBetween(ramp.spawnInterval, level),
    maxAlive: Math.round(rampBetween(ramp.maxAlive, level)),
    speed: rampBetween(ramp.speed, level),
    fireRate: rampBetween(ramp.fireRate, level),
    obstacleInterval: rampBetween(ramp.obstacleInterval, level),
  };
}

