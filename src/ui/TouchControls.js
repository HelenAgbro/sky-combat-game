/**
 * Sky Combat — on-screen flight controls for touch devices.
 *
 * A floating stick on the left half of the screen plus large buttons on the right.
 * The stick appears wherever the thumb lands, so the player never has to look down
 * to find it. Every pointer event is captured and its default suppressed, so a drag
 * never scrolls the page, pulls to refresh or zooms.
 *
 * The controls own their own state and report it through `onChange`; they know
 * nothing about the flight model.
 */
import { TOUCH } from '../game/config.js';
import { clamp } from '../game/math.js';

/** Show the controls on a device whose main pointer is coarse, or when asked to. */
export function shouldShowTouchControls(search = window.location.search) {
  const forced = new URLSearchParams(search).has('touch');
  const coarse = window.matchMedia?.('(pointer: coarse)')?.matches ?? false;
  return forced || coarse;
}

/** Rescale past the dead zone so control resumes smoothly from zero. */
function applyDeadZone(value) {
  const zone = TOUCH.deadZone;
  if (Math.abs(value) <= zone) return 0;
  return Math.sign(value) * ((Math.abs(value) - zone) / (1 - zone));
}

function preventDefault(event) {
  event.preventDefault();
}

/**
 * Capture a pointer so a finger that slides off a control still reports its release.
 * Wrapped because a synthetic pointer (as used by the acceptance test) has no real
 * capture target and would throw.
 */
function capturePointer(element, pointerId) {
  try {
    element?.setPointerCapture?.(pointerId);
  } catch {
    /* nothing to capture: the pointer is already gone, or it is synthetic */
  }
}

export class TouchControls {
  #element;
  #zone;
  #base;
  #knob;
  #pauseButton;
  #buttons = new Map();
  #onChange;
  #onPause;

  /** Pointer currently steering, and where the stick was placed. */
  #stickPointer = null;
  #origin = { x: 0, y: 0 };
  #axes = { pitch: 0, roll: 0 };
  #fire = false;
  #boost = false;

  constructor(root, { onChange, onPause } = {}) {
    this.#onChange = onChange;
    this.#onPause = onPause;

    this.#element = document.createElement('div');
    this.#element.className = 'touch';
    this.#element.innerHTML = `
      <div class="touch-zone" data-role="stick">
        <div class="touch-base" data-role="base">
          <div class="touch-knob" data-role="knob"></div>
        </div>
      </div>
      <div class="touch-actions">
        <button class="touch-btn touch-boost" type="button" data-role="boost">Boost</button>
        <button class="touch-btn touch-fire" type="button" data-role="fire">Fire</button>
      </div>
      <button class="touch-pause" type="button" data-role="pause" aria-label="Pause">❚❚</button>
    `;

    this.#zone = this.#element.querySelector('[data-role="stick"]');
    this.#base = this.#element.querySelector('[data-role="base"]');
    this.#knob = this.#element.querySelector('[data-role="knob"]');
    this.#pauseButton = this.#element.querySelector('[data-role="pause"]');

    for (const role of ['boost', 'fire']) {
      this.#buttons.set(role, this.#element.querySelector(`[data-role="${role}"]`));
    }

    root.append(this.#element);
  }

  get element() {
    return this.#element;
  }

  /** The control state to hand to the InputManager. */
  read() {
    return {
      pitch: this.#axes.pitch,
      roll: this.#axes.roll,
      boost: this.#boost,
      fire: this.#fire,
    };
  }

  show() {
    this.#element.classList.add('is-visible');
  }

  hide() {
    this.#element.classList.remove('is-visible');
  }

  attach() {
    this.#zone.addEventListener('pointerdown', this.#onStickDown);
    this.#zone.addEventListener('pointermove', this.#onStickMove);
    this.#zone.addEventListener('pointerup', this.#onStickUp);
    this.#zone.addEventListener('pointercancel', this.#onStickUp);
    this.#zone.addEventListener('contextmenu', preventDefault);

    for (const [role, button] of this.#buttons) {
      button.addEventListener('pointerdown', (event) => this.#pressButton(role, event));
      button.addEventListener('pointerup', (event) => this.#releaseButton(role, event));
      button.addEventListener('pointercancel', (event) => this.#releaseButton(role, event));
      button.addEventListener('contextmenu', preventDefault);
    }

    this.#pauseButton.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      this.#onPause?.();
    });
  }

  dispose() {
    this.#resetStick();
    this.#element.remove();
    this.#buttons.clear();
  }

  #emit() {
    this.#onChange?.(this.read());
  }

  #resetStick() {
    this.#stickPointer = null;
    this.#axes.pitch = 0;
    this.#axes.roll = 0;
    this.#base.classList.remove('is-active');
    this.#knob.style.transform = 'translate(-50%, -50%)';
    this.#emit();
  }

  #onStickDown = (event) => {
    event.preventDefault();
    if (this.#stickPointer !== null) return; // one finger steers

    this.#stickPointer = event.pointerId;
    this.#origin = { x: event.clientX, y: event.clientY };
    this.#base.style.left = `${event.clientX}px`;
    this.#base.style.top = `${event.clientY}px`;
    this.#base.classList.add('is-active');
    capturePointer(this.#zone, event.pointerId);
  };

  #onStickMove = (event) => {
    if (event.pointerId !== this.#stickPointer) return;
    event.preventDefault();

    const dx = event.clientX - this.#origin.x;
    const dy = event.clientY - this.#origin.y;

    // Drag up to climb, right to roll right. The dead zone stops a resting thumb
    // steering, and travel is capped at full deflection.
    this.#axes.roll = applyDeadZone(clamp(dx / TOUCH.stickTravel, -1, 1));
    this.#axes.pitch = applyDeadZone(clamp(-dy / TOUCH.stickTravel, -1, 1));

    const travel = TOUCH.stickTravel;
    const knobX = clamp(dx, -travel, travel);
    const knobY = clamp(dy, -travel, travel);
    this.#knob.style.transform = `translate(calc(-50% + ${knobX}px), calc(-50% + ${knobY}px))`;

    this.#emit();
  };

  #onStickUp = (event) => {
    if (event.pointerId !== this.#stickPointer) return;
    event.preventDefault();
    this.#resetStick();
  };

  #pressButton(role, event) {
    event.preventDefault();
    // Capture so a finger sliding off the button still reports its release.
    capturePointer(event.currentTarget, event.pointerId);
    this.#buttons.get(role)?.classList.add('is-pressed');
    this.#setFlag(role, true);
  }

  #releaseButton(role, event) {
    event.preventDefault();
    this.#buttons.get(role)?.classList.remove('is-pressed');
    this.#setFlag(role, false);
  }

  #setFlag(role, value) {
    if (role === 'fire') this.#fire = value;
    if (role === 'boost') this.#boost = value;
    this.#emit();
  }
}
