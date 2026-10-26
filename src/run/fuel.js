/**
 * Sky Combat — the fuel rules.
 *
 * Pure, and unit tested, because fuel is the one resource that can end a run on its own.
 * Three promises live here rather than being spread through the flight model:
 *
 * 1. fuel is always inside `[0, 1]` — never negative, never over a full tank;
 * 2. it burns faster with the throttle open, and much faster on boost;
 * 3. reaching zero is the flight model's only input to losing a run, so it has to be
 *    exact rather than approximately zero.
 */
import { clamp } from '../game/math.js';

/** A full tank, and the floor a run ends at. Fractions, not litres. */
export const FUEL_MAX = 1;
export const FUEL_MIN = 0;

/** Below this the player is told, and the HUD bar turns amber. */
export const FUEL_LOW = 0.25;

/**
 * Burn rate for one second of flight, as a fraction of a tank.
 *
 * Idle burns 45% of the reference rate and full throttle all of it, so opening the
 * throttle costs something without being punishing; boost multiplies that again. `scale`
 * is the airframe's own fuel rating, so a thirsty aircraft genuinely empties sooner.
 *
 * @param {{throttle?:number, boost?:boolean}} input
 * @param {object} [config] the `FLIGHT` block
 * @param {number} [scale=1] the airframe's fuel multiplier
 */
export function fuelBurnRate(input = {}, config, scale = 1) {
  const { fuelBurnPerSecond = 0, boostBurnMultiplier = 1 } = config ?? {};
  const throttle = clamp(input.throttle ?? 0.6, 0, 1);
  const load = 0.45 + throttle * 0.55;
  const multiplier = input.boost ? boostBurnMultiplier : 1;
  return (fuelBurnPerSecond * load * multiplier) / Math.max(1e-6, scale);
}

/**
 * One step of burn.
 *
 * @param {number} fuel current level, 0–1
 * @param {number} dt seconds
 * @param {{throttle?:number, boost?:boolean}} input
 * @param {object} [config] the `FLIGHT` block
 * @param {number} [scale=1]
 * @returns {number} the new level, clamped
 */
export function burnFuel(fuel, dt, input, config, scale = 1) {
  return clampFuel(fuel - fuelBurnRate(input, config, scale) * Math.max(0, dt));
}

/**
 * Put fuel back, never above a full tank.
 *
 * Clamping matters as much upward as downward: a canister collected at 95% must not leave
 * the aircraft holding 120% and quietly make the next few seconds of burn invisible.
 */
export function addFuel(fuel, amount) {
  return clampFuel(fuel + Math.max(0, amount));
}

/** Clamp into the allowed range, treating anything unreadable as empty. */
export function clampFuel(fuel) {
  const value = Number.isFinite(fuel) ? fuel : FUEL_MIN;
  return clamp(value, FUEL_MIN, FUEL_MAX);
}

/** True when the tank is empty. A run ends here, once. */
export function isFuelEmpty(fuel) {
  return clampFuel(fuel) <= FUEL_MIN;
}

/** True when the player should be warned. */
export function isFuelLow(fuel, threshold = FUEL_LOW) {
  return clampFuel(fuel) <= threshold;
}

/** How long a full tank lasts at a given burn rate, in seconds. Useful for tuning. */
export function fuelRangeSeconds(input, config, scale = 1) {
  const rate = fuelBurnRate(input, config, scale);
  return rate > 0 ? FUEL_MAX / rate : Infinity;
}
