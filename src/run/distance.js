/**
 * Sky Combat — the distance a run has flown.
 *
 * Distance is the score the game is really about, so it is derived from the flight model and
 * from nothing else: the aircraft's own speed, integrated once per fixed simulation step.
 * Because the simulation step never varies (`RENDER.fixedStep`), a second of flight covers
 * the same ground whether the display managed 30 frames in it or 240 — the number cannot
 * depend on the frame rate, by construction rather than by tuning.
 *
 * The same rule is used by `AircraftController`, so there is one odometer in the game and
 * one place to test it. Nothing here touches the DOM or Three.js.
 */

/**
 * Metres covered in one step at `speed`.
 *
 * Nonsense in gives zero out rather than `NaN`: a `NaN` odometer would poison the results
 * screen, the local record and the difficulty ramp all at once, and one bad number is much
 * easier to notice than three.
 *
 * @param {number} total metres already flown
 * @param {number} speed metres per second
 * @param {number} dt seconds
 * @returns {number} the new total, never less than the old one
 */
export function advanceDistance(total, speed, dt) {
  const from = Number.isFinite(total) && total > 0 ? total : 0;
  const step = Number.isFinite(speed) && Number.isFinite(dt) ? Math.max(0, speed) * Math.max(0, dt) : 0;
  return from + (Number.isFinite(step) ? step : 0);
}

/**
 * Metres as the interface writes them: whole metres up to ten kilometres, then one decimal
 * of a kilometre. Rounded *before* the comparison, so 9 999.6 m reads as `10.0 km` rather
 * than as `10000 m`.
 *
 * @param {number} metres
 * @returns {string} for example `840 m`, `12.4 km`, `0 m`
 */
export function formatDistance(metres) {
  const value = Number.isFinite(metres) ? Math.max(0, metres) : 0;
  const whole = Math.round(value);
  if (whole < 10000) return `${whole} m`;
  return `${(whole / 1000).toFixed(1)} km`;
}
