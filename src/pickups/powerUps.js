/**
 * Sky Combat — temporary power-ups.
 *
 * Two kinds, and one rule each for what happens when they overlap. Everything here is
 * pure: timers in, timers out. No renderer, no DOM, so the awkward cases — picking the
 * same one up twice, two different ones at once, expiring on the exact step it reaches
 * zero — are unit tested rather than flown.
 *
 * The two overlap rules, which the brief asks to be *defined* rather than left to chance:
 *
 * 1. **The same kind never stacks.** Taking a second one refreshes the timer to a full
 *    duration, but never beyond it. Collecting five in a row gives you the same ten
 *    seconds as collecting one, so a run cannot bank a minute of boost.
 * 2. **Different kinds run independently.** Speed and heavy rounds can be active
 *    together, each on its own clock, and one expiring does not touch the other.
 */

/** The power-ups, and the numbers that make each one worth collecting. */
export const POWER_UPS = Object.freeze({
  speed: Object.freeze({
    id: 'speed',
    /** Shown on the HUD chip. */
    name: 'Speed boost',
    /** Seconds one pickup lasts. */
    duration: 8,
    /** Multiplier on the aircraft's speed ceiling while it runs. */
    speedMultiplier: 1.45,
    /** Chip colour. */
    colour: '#6fd8ef',
  }),

  ammo: Object.freeze({
    id: 'ammo',
    name: 'Heavy rounds',
    duration: 9,
    /** Multiplier on the gun's damage while it runs. */
    damageMultiplier: 2.2,
    colour: '#f0b429',
  }),
});

/** Every power-up id, in a fixed order so the HUD chips never shuffle. */
export const POWER_UP_IDS = Object.freeze(Object.keys(POWER_UPS));

/**
 * A fresh set of timers: everything inactive.
 *
 * A new run starts from this, which is what stops a run inheriting the last one's
 * temporary effects.
 */
export function createPowerUpState() {
  const state = {};
  for (const id of POWER_UP_IDS) state[id] = 0;
  return state;
}

/**
 * Start a power-up, or refresh one that is already running.
 *
 * @param {object} state timers, from `createPowerUpState`
 * @param {string} id
 * @returns {{id:string, definition:object, remaining:number, refreshed:boolean}|null}
 *   `null` for an unknown id, so a typo is a no-op rather than a crash.
 */
export function activate(state, id) {
  const definition = POWER_UPS[id];
  if (!definition || !(id in state)) return null;

  const refreshed = state[id] > 0;
  // Rule 1: refresh, never stack. `max` is the whole of it.
  state[id] = Math.max(state[id], definition.duration);
  return { id, definition, remaining: state[id], refreshed };
}

/**
 * Advance every timer by one step.
 *
 * @param {object} state
 * @param {number} dt seconds
 * @param {string[]} [expired] written into and returned, so the caller can play the
 *   expiry effect without allocating
 * @returns {string[]} the ids that ran out on *this* step, so an effect fires once
 */
export function advance(state, dt, expired = []) {
  expired.length = 0;

  for (const id of POWER_UP_IDS) {
    if (state[id] <= 0) {
      // Snap to zero: a timer that is already spent must not go negative and later
      // read as "active" through a floating-point crumb.
      state[id] = 0;
      continue;
    }

    state[id] = Math.max(0, state[id] - dt);
    if (state[id] === 0) expired.push(id);
  }

  return expired;
}

export function isActive(state, id) {
  return (state[id] ?? 0) > 0;
}

export function remaining(state, id) {
  return Math.max(0, state[id] ?? 0);
}

/**
 * What is running right now, as the systems that consume it need it.
 *
 * Both multipliers are 1 when nothing is active, so the caller can apply them
 * unconditionally. Written into `out` — this is read once per simulation step, and
 * allocating a fresh object there is exactly the kind of per-frame garbage the pooling
 * everywhere else exists to avoid.
 */
export function effectsOf(state, out = {}) {
  out.speedMultiplier = isActive(state, 'speed') ? POWER_UPS.speed.speedMultiplier : 1;
  out.damageMultiplier = isActive(state, 'ammo') ? POWER_UPS.ammo.damageMultiplier : 1;
  return out;
}

/** Preallocated, because this is read once per frame by the HUD. */
const _list = POWER_UP_IDS.map((id) => ({ id, name: '', remaining: 0, duration: 0, progress: 0, colour: '' }));

/**
 * The active power-ups, for the HUD and for telemetry.
 *
 * Written into a reused array, so reading it every frame allocates nothing. The
 * returned array is only valid until the next call — copy it if you need to keep it.
 */
export function activeList(state, out = _list) {
  out.length = 0;

  for (const id of POWER_UP_IDS) {
    if (!isActive(state, id)) continue;
    const definition = POWER_UPS[id];
    const left = remaining(state, id);
    const entry = _entryFor(out, out.length, id);
    entry.name = definition.name;
    entry.remaining = left;
    entry.duration = definition.duration;
    entry.progress = left / definition.duration;
    entry.colour = definition.colour;
    out.push(entry);
  }

  return out;
}

/** Reuse the slot objects, so a frame with power-ups running allocates nothing. */
function _entryFor(out, index, id) {
  const existing = out[index];
  if (existing && existing.id === id) return existing;
  return { id, name: '', remaining: 0, duration: 0, progress: 0, colour: '' };
}

/** Clear every timer. Used when a run ends, and when a new one begins. */
export function resetPowerUps(state) {
  for (const id of POWER_UP_IDS) state[id] = 0;
  return state;
}
