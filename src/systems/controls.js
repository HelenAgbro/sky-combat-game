/**
 * Sky Combat — the control mapping.
 *
 * Deliberately free of the DOM: this file turns a set of held key names into the
 * abstract control state the flight model consumes, so the mapping can be unit
 * tested and later made remappable without touching the event plumbing.
 */

/**
 * Which keys drive which control.
 *
 * Pitch is `+1` to raise the nose and `-1` to lower it, roll is `+1` to the right,
 * and yaw is the rudder, `+1` to the right. W/A/S/D and the arrow keys do the same
 * thing, so a player can use whichever they reach for first.
 */
export const KEY_BINDINGS = Object.freeze({
  climb: ['KeyW', 'ArrowUp'],
  dive: ['KeyS', 'ArrowDown'],
  rollLeft: ['KeyA', 'ArrowLeft'],
  rollRight: ['KeyD', 'ArrowRight'],
  yawLeft: ['KeyQ'],
  yawRight: ['KeyE'],
  boost: ['ShiftLeft', 'ShiftRight'],
  fire: ['Space'],
  pause: ['KeyP', 'Escape'],
});

/** Keys whose browser default (scrolling, quick-find) must be suppressed while playing. */
export const GAMEPLAY_KEYS = Object.freeze([
  ...new Set(Object.values(KEY_BINDINGS).flat()),
]);

export const NEUTRAL_CONTROLS = Object.freeze({
  pitch: 0,
  roll: 0,
  yaw: 0,
  throttle: 0.72,
  boost: false,
  fire: false,
});

const held = (pressed, action) => KEY_BINDINGS[action].some((code) => pressed.has(code));

/**
 * Turn the set of currently-held key codes into a control state.
 * @param {Set<string>|Iterable<string>} pressed
 * @returns {{pitch:number, roll:number, yaw:number, throttle:number, boost:boolean, fire:boolean}}
 */
export function readControls(pressed) {
  const keys = pressed instanceof Set ? pressed : new Set(pressed);

  return {
    pitch: (held(keys, 'climb') ? 1 : 0) - (held(keys, 'dive') ? 1 : 0),
    roll: (held(keys, 'rollRight') ? 1 : 0) - (held(keys, 'rollLeft') ? 1 : 0),
    yaw: (held(keys, 'yawRight') ? 1 : 0) - (held(keys, 'yawLeft') ? 1 : 0),
    throttle: NEUTRAL_CONTROLS.throttle,
    boost: held(keys, 'boost'),
    fire: held(keys, 'fire'),
  };
}

/**
 * True when the event came from somewhere the player is typing, so the game must
 * keep its hands off. Without this, pressing "W" in a future name field would also
 * pitch the aircraft.
 */
export function isTypingTarget(target) {
  if (!target || typeof target !== 'object') return false;
  if (target.isContentEditable) return true;
  const tag = typeof target.tagName === 'string' ? target.tagName.toLowerCase() : '';
  if (tag === 'textarea' || tag === 'select') return true;
  if (tag === 'input') {
    const type = String(target.type ?? 'text').toLowerCase();
    // Buttons and checkboxes are not typing; text-like inputs are.
    return !['button', 'checkbox', 'radio', 'range', 'submit', 'reset', 'file'].includes(type);
  }
  return false;
}

/** Merge control sources, later sources winning where they are actively driving a channel. */
export function mergeControls(base, override) {
  if (!override) return base;
  return {
    pitch: override.pitch ?? base.pitch,
    roll: override.roll ?? base.roll,
    yaw: override.yaw ?? base.yaw,
    throttle: override.throttle ?? base.throttle,
    boost: override.boost ?? base.boost,
    fire: override.fire ?? base.fire,
  };
}
