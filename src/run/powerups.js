/**
 * Sky Combat — the power-up timers.
 *
 * Two things can be active at once, one per slot, and the whole state is a plain object of
 * numbers so it can be simulated headlessly and asserted in the unit tests.
 *
 * The rules, stated once so nothing downstream has to guess:
 *
 * - **One slot per power-up.** Collecting the same power-up again while it is running
 *   *refreshes* it to its full duration; it never stacks and never runs past full. Two of
 *   the same thing in a row is therefore worth exactly one full duration from the moment
 *   of the second pickup, which is the behaviour a player expects and the easiest to
 *   explain.
 * - **Different power-ups overlap independently.** Boost and heavy rounds run their own
 *   clocks, so collecting one never shortens the other.
 * - **Expiry is exact.** A slot reports `active: false` the moment `remaining` reaches
 *   zero, and `remaining` is never negative, so an effect cannot linger a frame past its
 *   time or be read as active with no time left on it.
 * - **A run owns its timers.** `reset` clears both slots; nothing survives into the next
 *   flight.
 */
import { POWERUP_IDS } from '../data/powerups.js';

/**
 * @typedef {{id:string, remaining:number, duration:number, active:boolean}} PowerupSlot
 */

/**
 * A fresh, all-clear state.
 *
 * Both slots are allocated once and mutated in place afterwards, so the HUD can hold on to
 * a slot object and the game never allocates while it runs.
 */
export function createPowerupState() {
  const state = { slots: [], byId: Object.create(null) };
  for (const id of POWERUP_IDS) {
    const slot = { id, remaining: 0, duration: 0, active: false };
    state.slots.push(slot);
    state.byId[id] = slot;
  }
  return state;
}

/** The slot for an id, or null for an id that is not a power-up. */
export function powerupSlot(state, id) {
  return state.byId[id] ?? null;
}

export function isActive(state, id) {
  const slot = powerupSlot(state, id);
  return Boolean(slot?.active);
}

/** Seconds left, or 0. */
export function remaining(state, id) {
  return powerupSlot(state, id)?.remaining ?? 0;
}

/**
 * Start or refresh a power-up.
 *
 * @param {object} state from `createPowerupState`
 * @param {string} id
 * @param {number} duration seconds
 * @returns {'activated'|'refreshed'|'ignored'} what actually happened
 */
export function activate(state, id, duration) {
  const slot = powerupSlot(state, id);
  if (!slot || !(duration > 0)) return 'ignored';

  const wasActive = slot.active;
  slot.remaining = Math.max(0, duration);
  slot.duration = Math.max(0, duration);
  slot.active = true;
  return wasActive ? 'refreshed' : 'activated';
}

/**
 * Advance every slot by one step.
 *
 * @param {object} state
 * @param {number} dt seconds
 * @param {string[]} [expired] collected into and returned: the ids that ran out this step
 */
export function advance(state, dt, expired = []) {
  expired.length = 0;
  if (!(dt > 0)) return expired;

  for (let i = 0; i < state.slots.length; i += 1) {
    const slot = state.slots[i];
    if (!slot.active) continue;
    slot.remaining -= dt;
    if (slot.remaining <= 0) {
      // Zeroed rather than left slightly negative: a negative remainder would read as time
      // owed to the player if the slot were ever restarted without a full duration.
      slot.remaining = 0;
      slot.active = false;
      expired.push(slot.id);
    }
  }
  return expired;
}

/** Clear every slot. Called when a run starts, so nothing is inherited. */
export function reset(state) {
  for (let i = 0; i < state.slots.length; i += 1) {
    const slot = state.slots[i];
    slot.remaining = 0;
    slot.duration = 0;
    slot.active = false;
  }
}

/** How far through its duration a slot is, 0–1. Zero when inactive. */
export function progress(slot) {
  if (!slot?.active || slot.duration <= 0) return 0;
  return Math.min(1, Math.max(0, slot.remaining / slot.duration));
}
