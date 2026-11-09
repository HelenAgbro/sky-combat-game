/**
 * Sky Combat — local settings: volume and mute.
 *
 * The one thing the interface remembers that is not progression. It lives in `localStorage`
 * under a versioned key, like the record and the progression, and makes the same promise: a
 * missing, corrupt or refused store costs the player nothing but their chosen loudness, never
 * a broken flight.
 */
import { resolveStorage } from './progress.js';

export const SETTINGS_KEY = 'sky-combat.settings.v1';
export const DEFAULT_VOLUME = 0.7;

/** A volume is 0–1, clamped. Anything unreadable reads as the default. */
function sanitiseVolume(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(1, Math.max(0, number)) : DEFAULT_VOLUME;
}

/** Whatever was stored becomes a safe pair of settings. */
export function sanitiseSettings(value) {
  const object = value && typeof value === 'object' ? value : {};
  return {
    volume: sanitiseVolume(object.volume),
    muted: object.muted === true,
  };
}

/** Read the persisted settings, or the defaults when there is no usable store. */
export function readSettings(storage = resolveStorage()) {
  try {
    const raw = storage?.getItem(SETTINGS_KEY);
    if (raw === null || raw === undefined || raw === '') return sanitiseSettings(null);
    return sanitiseSettings(JSON.parse(raw));
  } catch {
    return sanitiseSettings(null);
  }
}

/** Persist settings. A refused write is swallowed; the session remembers. */
export function writeSettings(storage, state) {
  try {
    storage?.setItem(SETTINGS_KEY, JSON.stringify({ volume: state.volume, muted: state.muted }));
  } catch {
    // A blocked store costs the memory, not the flight.
  }
}

/** The live settings for the session. Mutations persist immediately. */
export class Settings {
  #storage;
  #volume = DEFAULT_VOLUME;
  #muted = false;

  constructor(storage = resolveStorage()) {
    this.#storage = storage;
    const state = readSettings(storage);
    this.#volume = state.volume;
    this.#muted = state.muted;
  }

  get volume() {
    return this.#volume;
  }

  get muted() {
    return this.#muted;
  }

  setVolume(volume) {
    const value = Number(volume);
    if (!Number.isFinite(value)) return false;
    this.#volume = Math.min(1, Math.max(0, value));
    this.#persist();
    return true;
  }

  setMuted(muted) {
    this.#muted = Boolean(muted);
    this.#persist();
    return this.#muted;
  }

  toggleMute() {
    return this.setMuted(!this.#muted);
  }

  snapshot() {
    return { volume: this.#volume, muted: this.#muted };
  }

  #persist() {
    writeSettings(this.#storage, this.snapshot());
  }
}