/**
 * Sky Combat — the power-ups.
 *
 * Data only: what each one is called, what it looks like and what it does. The timers live
 * in `run/powerups.js` and the numbers live in `RUN.powerups`, so a new power-up is a row
 * here plus a case in whatever reads it — not a new system.
 *
 * `id` is the key used everywhere: the run state, the HUD chip, the pickup and the effect.
 */

/** The two kinds of power-up the aircraft can carry at once. */
export const POWERUPS = Object.freeze({
  boost: {
    id: 'boost',
    label: 'Boost',
    /** Shown on the HUD chip. Kept to one word so the chip stays narrow. */
    short: 'Boost',
    colour: '#8fe3ff',
    /** What the pickup in the world looks like. */
    pickup: '#8fe3ff',
    description: 'Speed boost',
  },
  special: {
    id: 'special',
    label: 'Heavy rounds',
    short: 'Heavy',
    colour: '#ffb3e6',
    pickup: '#ffb3e6',
    description: 'Special ammunition',
  },
});

/** Every id, in a fixed order, so the HUD and the tests agree on it. */
export const POWERUP_IDS = Object.freeze(['boost', 'special']);

/** Look one up, falling back to null rather than throwing on a typo. */
export function getPowerup(id) {
  return Object.hasOwn(POWERUPS, id) ? POWERUPS[id] : null;
}
