/**
 * Sky Combat — local progression: the best distance this browser has flown.
 *
 * The record is the only thing that outlives a run. It lives in `localStorage`, which is
 * worth exactly what it promises: it is per browser, it is not a leaderboard, and it can be
 * missing entirely (private mode, storage disabled, a page with no origin). Every read and
 * write here therefore answers a number and never throws — a blocked storage must cost the
 * player nothing more than not remembering, never a broken flight.
 *
 * The key is versioned. A future format can read the old value, migrate it, and write the
 * new key without the two colliding.
 */

export const BEST_DISTANCE_KEY = 'sky-combat.bestDistance.v1';

/** Used to prove the store really works before it is trusted. */
const PROBE_KEY = 'sky-combat.probe';

/**
 * The browser's key/value store, or `null` when there isn't a usable one.
 *
 * `globalThis.localStorage` can throw on *access* (a blocked third-party frame) as well as on
 * use (private mode with no quota), so the reference itself is inside the `try`. Writing a
 * probe catches the second case: a store that hands out an object but refuses every write is
 * worse than no store, because it fails at the moment the record is set rather than here.
 *
 * @returns {Storage|null}
 */
export function resolveStorage() {
  try {
    const storage = globalThis.localStorage;
    if (!storage) return null;
    storage.setItem(PROBE_KEY, '1');
    storage.removeItem(PROBE_KEY);
    return storage;
  } catch {
    return null;
  }
}

/**
 * The stored record, in metres.
 *
 * Anything that is not a positive finite number is treated as "no record yet": a hand-edited
 * key, a half-written value, or a number from an older build must not put `NaN` on a results
 * screen or make every run look like a record.
 *
 * @param {Storage|null} [storage]
 * @returns {number} 0 when there is no record
 */
export function readBestDistance(storage = resolveStorage()) {
  try {
    const raw = storage?.getItem(BEST_DISTANCE_KEY);
    if (raw === null || raw === undefined || raw === '') return 0;
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

/**
 * Whether `metres` beats `best`.
 *
 * Strictly greater, so equalling the record is not a new record, and positive, so a run that
 * never left the ground cannot set one.
 */
export function isRecord(metres, best) {
  const previous = Number.isFinite(best) && best > 0 ? best : 0;
  return Number.isFinite(metres) && metres > 0 && metres > previous;
}

/**
 * Keep `metres` if it is a record, and answer the best distance known afterwards.
 *
 * The new value is only written when it improves, so the store is touched once per record
 * rather than once per run. If the write is refused (quota, permissions) the answer is still
 * the new best: the session may remember what the browser would not, and the next run is
 * compared against it.
 *
 * @param {Storage|null} storage
 * @param {number} metres the finished run's distance
 * @param {number} [previous] the best already known, when the caller caches it
 * @returns {number} the best distance after this run
 */
export function recordBestDistance(storage, metres, previous = readBestDistance(storage)) {
  const best = Number.isFinite(previous) && previous > 0 ? previous : 0;
  if (!isRecord(metres, best)) return best;

  const rounded = Math.round(metres);
  try {
    storage?.setItem(BEST_DISTANCE_KEY, String(rounded));
  } catch {
    // A refused write costs the player the memory, not the run.
  }
  return rounded;
}
