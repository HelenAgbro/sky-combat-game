/**
 * Sky Combat — the difficulty ramp.
 *
 * Pure: elapsed seconds in, difficulty out. Every value is interpolated between the two
 * numbers in `COMBAT.ramp`, so tuning the fight is editing two values rather than
 * hunting for a rule.
 */
import { COMBAT } from '../game/config.js';
import { clamp, lerp } from '../game/math.js';

/** Interpolate between a `[from, to]` pair. */
export function rampBetween(range, t) {
  return lerp(range[0], range[1], t);
}

/**
 * How hard the fight is `elapsed` seconds into a run.
 *
 * @param {number} elapsed seconds since the run began
 * @param {object} [config]
 * @returns {{level:number, spawnInterval:number, maxAlive:number, speed:number, fireRate:number}}
 *   `level` is 0 at the start of a run and 1 once the ramp is complete.
 */
export function difficultyAt(elapsed, config = COMBAT) {
  const level = clamp(elapsed / config.ramp.seconds, 0, 1);

  return {
    level,
    spawnInterval: rampBetween(config.ramp.spawnInterval, level),
    maxAlive: Math.round(rampBetween(config.ramp.maxAlive, level)),
    speed: rampBetween(config.ramp.speed, level),
    fireRate: rampBetween(config.ramp.fireRate, level),
  };
}
