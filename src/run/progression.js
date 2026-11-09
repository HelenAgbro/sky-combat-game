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
import { DEFAULT_WEAPON_ID, WEAPON_IDS, getWeapon } from '../data/weapons.js';
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

/** Only weapon ids that actually exist are trusted. Anything else reads as the standard gun. */
export function sanitiseWeaponId(value) {
  return typeof value === 'string' && WEAPON_IDS.includes(value) ? value : DEFAULT_WEAPON_ID;
}

/**
 * Whatever was stored for weapons becomes a safe loadout: the standard gun is always owned,
 * levels are clamped to each weapon's own range, locked weapons read as level 0, and a
 * selected weapon that is not owned falls back to the standard gun.
 */
export function sanitiseWeapons(value) {
  const object = value && typeof value === 'object' ? value : {};
  const unlocked = new Set([DEFAULT_WEAPON_ID]);
  if (Array.isArray(object.unlocked)) {
    for (const id of object.unlocked) unlocked.add(sanitiseWeaponId(id));
  }

  const levels = {};
  for (const id of WEAPON_IDS) {
    const max = getWeapon(id).levels.length - 1;
    const number = Number(object.levels?.[id]);
    const clamped = Number.isFinite(number) ? Math.min(max, Math.max(0, Math.floor(number))) : 0;
    levels[id] = unlocked.has(id) ? clamped : 0;
  }

  let selected = sanitiseWeaponId(object.selected);
  if (!unlocked.has(selected)) selected = DEFAULT_WEAPON_ID;

  return { unlocked: [...unlocked], levels, selected };
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
  return { coins, unlocked, selected, weapons: sanitiseWeapons(object.weapons) };
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
        weapons: state.weapons,
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
  #weaponsUnlocked = new Set();
  #coins = 0;
  #selected = DEFAULT_AIRCRAFT_ID;
  #weaponLevels = {};
  #weaponsSelected = DEFAULT_WEAPON_ID;

  constructor(storage = resolveStorage()) {
    this.#storage = storage;
    const state = readProgression(storage);
    this.#coins = state.coins;
    this.#unlocked = new Set(state.unlocked);
    this.#selected = state.selected;
    this.#weaponsUnlocked = new Set(state.weapons.unlocked);
    this.#weaponLevels = state.weapons.levels;
    this.#weaponsSelected = state.weapons.selected;
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

  get weaponSelected() {
    return this.#weaponsSelected;
  }

  get weaponUnlockedIds() {
    return [...this.#weaponsUnlocked];
  }

  isUnlocked(id) {
    return this.#unlocked.has(sanitiseAircraftId(id));
  }

  isWeaponUnlocked(id) {
    return this.#weaponsUnlocked.has(sanitiseWeaponId(id));
  }

  weaponLevel(id) {
    return this.#weaponLevels[sanitiseWeaponId(id)] ?? 0;
  }

  /** Whether the wallet covers the price of `id`. */
  canAfford(id) {
    const price = getAircraft(id).price;
    return Number.isFinite(price) && this.#coins >= price;
  }

  /**
   * Spend coins if the wallet can cover the cost. Free is always affordable; anything
   * unreadable is treated as unaffordable rather than silently drained. Returns whether the
   * deduction happened.
   *
   * @param {number} amount
   * @returns {boolean}
   */
  spendCoins(amount) {
    const cost = Number.isFinite(amount) && amount > 0 ? Math.floor(amount) : 0;
    if (cost === 0) return true;
    if (this.#coins < cost) return false;
    this.#coins -= cost;
    this.#persist();
    return true;
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
    if (!Number.isFinite(price) || price < 0) return false;
    if (!this.spendCoins(price)) return false;

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

  /** Unlock a weapon (a one-time purchase). Returns true when it was newly unlocked. */
  unlockWeapon(id) {
    const safe = sanitiseWeaponId(id);
    if (this.#weaponsUnlocked.has(safe)) return false;
    if (!this.spendCoins(getWeapon(safe).price)) return false;
    this.#weaponsUnlocked.add(safe);
    this.#weaponLevels[safe] = 0;
    this.#persist();
    return true;
  }

  /** Buy the next upgrade level for an owned weapon. Returns true when it upgraded. */
  upgradeWeapon(id) {
    const safe = sanitiseWeaponId(id);
    if (!this.#weaponsUnlocked.has(safe)) return false;

    const weapon = getWeapon(safe);
    const level = this.#weaponLevels[safe] ?? 0;
    if (level >= weapon.levels.length - 1) return false;
    if (!this.spendCoins(weapon.levels[level + 1].cost)) return false;

    this.#weaponLevels[safe] = level + 1;
    this.#persist();
    return true;
  }

  /** Select an owned weapon. Returns false when it is locked. */
  selectWeapon(id) {
    const safe = sanitiseWeaponId(id);
    if (!this.#weaponsUnlocked.has(safe)) return false;
    this.#weaponsSelected = safe;
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
    return {
      coins: this.#coins,
      unlocked: [...this.#unlocked],
      selected: this.#selected,
      weapons: {
        unlocked: [...this.#weaponsUnlocked],
        levels: { ...this.#weaponLevels },
        selected: this.#weaponsSelected,
      },
    };
  }

  /** Development helper: wipe everything back to a first launch. */
  reset() {
    this.#coins = 0;
    this.#unlocked = new Set([DEFAULT_AIRCRAFT_ID]);
    this.#selected = DEFAULT_AIRCRAFT_ID;
    this.#weaponsUnlocked = new Set([DEFAULT_WEAPON_ID]);
    this.#weaponLevels = {};
    for (const id of WEAPON_IDS) this.#weaponLevels[id] = 0;
    this.#weaponsSelected = DEFAULT_WEAPON_ID;
    this.#persist();
  }

  #persist() {
    writeProgression(this.#storage, this.snapshot());
  }
}