/**
 * Sky Combat — keyboard input.
 *
 * A thin DOM wrapper around the pure mapping in `controls.js`. It owns the
 * listeners, suppresses the browser's own use of the gameplay keys (arrow-key
 * scrolling, space-page-down), ignores keys aimed at a text field, and exposes one
 * merged control state to the simulation. Touch controls push their state in
 * through `setTouchState`, so the simulation has a single input source.
 */
import {
  GAMEPLAY_KEYS,
  KEY_BINDINGS,
  isTypingTarget,
  mergeControls,
  readControls,
} from './controls.js';

export class InputManager {
  #pressed = new Set();
  #touch = null;
  #listeners = new Map();
  #target;
  #element;
  #attached = false;

  /**
   * @param {{target?: EventTarget, element?: HTMLElement}} [options]
   *   `target` receives the key events (the window by default); `element` is only
   *   used to blur a focused control so the game gets the keys back.
   */
  constructor({ target = window, element = document.body } = {}) {
    this.#target = target;
    this.#element = element;
  }

  /** The merged control state for this frame. */
  read() {
    return mergeControls(readControls(this.#pressed), this.#touch);
  }

  /** Replace the state contributed by the touch controls. */
  setTouchState(state) {
    this.#touch = state;
  }

  clearTouchState() {
    this.#touch = null;
  }

  /** Which keys are held right now. Used by the acceptance test. */
  get pressedKeys() {
    return [...this.#pressed];
  }

  on(event, listener) {
    if (!this.#listeners.has(event)) this.#listeners.set(event, new Set());
    this.#listeners.get(event).add(listener);
    return () => this.#listeners.get(event)?.delete(listener);
  }

  #emit(event) {
    for (const listener of this.#listeners.get(event) ?? []) {
      try {
        listener();
      } catch (error) {
        console.error(`[SkyCombat] input listener for "${event}" failed`, error);
      }
    }
  }

  attach() {
    if (this.#attached) return;
    this.#attached = true;
    this.#target.addEventListener('keydown', this.#onKeyDown);
    this.#target.addEventListener('keyup', this.#onKeyUp);
    this.#target.addEventListener('blur', this.#onBlur);
    document.addEventListener('visibilitychange', this.#onBlur);
  }

  detach() {
    if (!this.#attached) return;
    this.#attached = false;
    this.#target.removeEventListener('keydown', this.#onKeyDown);
    this.#target.removeEventListener('keyup', this.#onKeyUp);
    this.#target.removeEventListener('blur', this.#onBlur);
    document.removeEventListener('visibilitychange', this.#onBlur);
    this.#pressed.clear();
  }

  dispose() {
    this.detach();
    this.#listeners.clear();
    this.#touch = null;
  }

  #onKeyDown = (event) => {
    // Never take a key that belongs to a field the player is typing in.
    if (isTypingTarget(event.target) || isTypingTarget(document.activeElement)) return;

    const code = event.code;
    const isGameplayKey = GAMEPLAY_KEYS.includes(code);

    // Stop the browser scrolling the page with the arrow keys or the space bar.
    if (isGameplayKey) event.preventDefault();

    // Auto-repeat must not re-trigger a one-shot action such as pause.
    if (event.repeat) return;

    this.#pressed.add(code);

    if (KEY_BINDINGS.pause.includes(code)) {
      // Give the keys back to the game: a focused button would otherwise keep the
      // space bar and the arrow keys for itself.
      this.#element?.blur?.();
      this.#emit('pause');
    }
  };

  #onKeyUp = (event) => {
    this.#pressed.delete(event.code);
  };

  /**
   * A key held while the window loses focus never reports its release, so the
   * aircraft would keep turning. Forget everything when focus goes away.
   */
  #onBlur = () => {
    this.#pressed.clear();
  };
}
