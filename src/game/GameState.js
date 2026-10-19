/**
 * Sky Combat — application state machine.
 *
 * A tiny, dependency-free state machine. It is the single source of truth for
 * which screen is active, and it is deliberately free of DOM and Three.js so the
 * UI, the scene and the unit tests can all rely on the same rules.
 */

export const STATES = Object.freeze({
  BOOT: 'boot',
  LOADING: 'loading',
  MENU: 'menu',
  FLYING: 'flying',
  PAUSED: 'paused',
  RESULTS: 'results',
  ERROR: 'error',
});

/** Every legal transition. Anything not listed here is refused. */
const TRANSITIONS = Object.freeze({
  [STATES.BOOT]: [STATES.LOADING, STATES.ERROR],
  [STATES.LOADING]: [STATES.MENU, STATES.ERROR],
  [STATES.MENU]: [STATES.FLYING, STATES.ERROR],
  [STATES.FLYING]: [STATES.PAUSED, STATES.RESULTS, STATES.MENU, STATES.ERROR],
  [STATES.PAUSED]: [STATES.FLYING, STATES.MENU, STATES.ERROR],
  [STATES.RESULTS]: [STATES.MENU, STATES.FLYING, STATES.ERROR],
  [STATES.ERROR]: [STATES.MENU],
});

export class GameState {
  #current;
  #previous;
  #listeners = new Set();

  constructor(initial = STATES.BOOT) {
    this.#current = initial;
    this.#previous = null;
  }

  get current() {
    return this.#current;
  }

  get previous() {
    return this.#previous;
  }

  /** True when `next` is a legal move from the current state. */
  can(next) {
    return (TRANSITIONS[this.#current] ?? []).includes(next);
  }

  /**
   * Move to `next`. Returns true when the move happened. Illegal moves are
   * refused (and reported) rather than throwing, so a stray button press can
   * never break the game.
   */
  set(next) {
    if (next === this.#current) return true;
    if (!this.can(next)) {
      console.warn(`[SkyCombat] refused state change: ${this.#current} -> ${next}`);
      return false;
    }
    this.#previous = this.#current;
    this.#current = next;
    this.#emit();
    return true;
  }

  is(...states) {
    return states.includes(this.#current);
  }

  /** Subscribe to changes. Returns an unsubscribe function. */
  on(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #emit() {
    for (const listener of this.#listeners) {
      try {
        listener(this.#current, this.#previous);
      } catch (error) {
        console.error('[SkyCombat] state listener failed', error);
      }
    }
  }
}
