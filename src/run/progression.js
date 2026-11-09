/**
 * Sky Combat — local progression: the wallet, the unlocked aircraft and the selection.
 *
 * This is the number in the bank and the keys to the hangar. It outlives a run, so a
 * run that earns coins counts toward the next aircraft, and the aircraft the player
 * picked is the one the next flight flies. It lives in `localStorage` under a versioned
 * key, exactly like the distance record in `progress.js`, and it makes the same promise:
 * a missing, corrupt or refused store costs the player nothing but remembering, never a
 * broken flight.
 *
 * The rules live here, not in `Game`, so they can be unit tested in plain Node: the
 * Falcon is always available, a locked aircraft can never be selected, unlocking spends
 * the price in `data/aircraft.js`, and the stored value is sanitised before it is used.
 */
import { AIRCRAFT, DEFAULT_AIRCRAFT_ID, getAircraft } from '../data/aircraft.js';
import { resolveStorage } from './progress.js';

export const PROGRESSION_KEY = 'sky-combat.progression.v1';

/** Only ids that actually exist are trusted. Anything else reads as the Falcon. */
export function sanitiseAircraftId(value) {
  return typeof value === 'string' && AIRCRAFT.some((aircraft) => aircraft.id === value)
    ? value
    : DEFAULT_AIRCRAFT_ID;
}

/** A wallet is a whole, non-negative number and nothing else. */
function sanitiseCoins(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

/**
 * The unlocked set always contains the Falcon. Extra keys, missing keys and non-array
 * values are all quietly reduced to a valid list so a hand-edited store cannot lock the
 * player out of everything.
 */
export function sanitiseUnlocked(value) {
  if (!Array.isArray(value)) return [DEFAULT_AIRCRAFT_ID];
  const ids = new Set([DEFAULT_AIRCRAFT_ID]);
  for (const entry of value) ids.add(sanitiseAircraftId(entry));
  return [...ids];
}

/**
 * Turn whatever was stored into a safe progression snapshot.
 *
 * Accepts the parsed result of `JSON.parse`, which may be anything the browser has been
 * handed: a string, a number, an object from an older build, or `null`. Every field is
 * sanitised independently, and a selected aircraft that is not unlocked falls back to the
 * Falcon, so the game never starts with an aircraft the player has not earned.
 *
 * @param {*} raw
 * @returns {{coins:number, unlocked:string[], selected:string}}
 */
export function parseProgression(raw) {
  const object = raw && typeof raw === 'object' ? raw : {};
  const coins = sanitiseCoins(object.coins);
  const unlocked = sanitiseUnlocked(object.unlocked);
  let selected = sanitiseAircraftId(object.selected);
  if (!unlocked.includes(selected)) selected = DEFAULT_AIRCRAFT_ID;
  return { coins, unlocked, selected };
}

/** Read the persisted progression, or a safe empty one when there is no usable store. */
export function readProgression(storage = resolveStorage()) {
  try {
    const raw = storage?.getItem(PROGRESSION_KEY);
    if (raw === null || raw === undefined || raw === '') return parseProgression(null);
    return parseProgression(JSON.parse(raw));
  } catch {
    return parseProgression(null);
  }
}

/** Persist a progression snapshot. A refused write is swallowed; the session remembers. */
export function writeProgression(storage, state) {
  try {
    storage?.setItem(
      PROGRESSION_KEY,
      JSON.stringify({
        coins: state.coins,
        unlocked: state.unlocked,
        selected: state.selected,
      }),
    );
  } catch {
    // A blocked store costs the memory, not the flight.
  }
}

/**
 * The live progression for the session: the wallet, the hangar keys and the selection.
 * Mutations persist immediately; reads are answered from memory so a blocked store slows
 * nothing down.
 */
export class Progression {
  #storage;
  #unlocked = new Set();
  #coins = 0;
  #selected = DEFAULT_AIRCRAFT_ID;

  constructor(storage = resolveStorage()) {
    this.#storage = storage;
    const state = readProgression(storage);
    this.#coins = state.coins;
    this.#unlocked = new Set(state.unlocked);
    this.#selected = state.selected;
  }

  get coins() {
    return this.#coins;
  }

  get selected() {
    return this.#selected;
  }

  get unlockedIds() {
    return [...this.#unlocked];
  }

  isUnlocked(id) {
    return this.#unlocked.has(sanitiseAircraftId(id));
  }

  /** Whether the wallet covers the price of `id`. */
  canAfford(id) {
    const price = getAircraft(id).price;
    return Number.isFinite(price) && this.#coins >= price;
  }

  /**
   * Spend coins to unlock an aircraft.
   *
   * @param {string} id
   * @returns {boolean} true when the aircraft was newly unlocked
   */
  unlock(id) {
    const safe = sanitiseAircraftId(id);
    if (this.#unlocked.has(safe)) return false;

    const price = getAircraft(safe).price;
    if (!Number.isFinite(price) || price < 0 || this.#coins < price) return false;

    this.#coins -= price;
    this.#unlocked.add(safe);
    this.#persist();
    return true;
  }

  /**
   * Select an aircraft for the next flight.
   *
   * @param {string} id
   * @returns {boolean} false when the aircraft is locked; true when it is now selected
   */
  select(id) {
    const safe = sanitiseAircraftId(id);
    if (!this.#unlocked.has(safe)) return false;
    this.#selected = safe;
    this.#persist();
    return true;
  }

  /** Bank coins from a finished run. Ignores anything that is not a positive integer. */
  addCoins(amount) {
    const value = Number.isFinite(amount) && amount > 0 ? Math.floor(amount) : 0;
    if (value === 0) return this.#coins;
    this.#coins += value;
    this.#persist();
    return this.#coins;
  }

  snapshot() {
    return { coins: this.#coins, unlocked: [...this.#unlocked], selected: this.#selected };
  }

  #persist() {
    writeProgression(this.#storage, this.snapshot());
  }
}