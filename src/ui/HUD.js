/**
 * Sky Combat — the in-flight readout.
 *
 * Stage 3 keeps this to what the flight model actually reports: speed, altitude,
 * distance and a warning when the aircraft is against the edge of the play area.
 * Fuel, coins, ammo and the reticle arrive with the systems that produce them.
 *
 * The DOM is only touched when a value actually changes, so this costs nothing per
 * frame while the numbers hold still.
 */
export class HUD {
  #element;
  #fields;
  #warning;
  #last = {};

  constructor(root, { showKeyHint = true } = {}) {
    this.#element = document.createElement('div');
    this.#element.className = 'hud';
    this.#element.innerHTML = `
      <div class="hud-readout">
        <div class="hud-item"><span>Speed</span><b data-field="speed">0</b><i>km/h</i></div>
        <div class="hud-item"><span>Altitude</span><b data-field="altitude">0</b><i>m</i></div>
        <div class="hud-item"><span>Distance</span><b data-field="distance">0</b><i>m</i></div>
      </div>
      <p class="hud-warning" data-role="warning" hidden></p>
      ${showKeyHint ? '<p class="hud-hint">W A S D or arrows to fly · Shift to boost · P to pause</p>' : ''}
    `;

    this.#fields = {
      speed: this.#element.querySelector('[data-field="speed"]'),
      altitude: this.#element.querySelector('[data-field="altitude"]'),
      distance: this.#element.querySelector('[data-field="distance"]'),
    };
    this.#warning = this.#element.querySelector('[data-role="warning"]');
    root.append(this.#element);
  }

  #set(field, value) {
    if (this.#last[field] === value) return;
    this.#last[field] = value;
    this.#fields[field].textContent = value;
  }

  /** @param {object} telemetry from `Game.telemetry()` */
  update(telemetry) {
    this.#set('speed', Math.round(telemetry.speed * 3.6).toString());
    this.#set('altitude', Math.round(telemetry.altitude).toString());

    const metres = Math.round(telemetry.distance);
    this.#set('distance', metres >= 10000 ? `${(metres / 1000).toFixed(1)} km` : `${metres}`);

    const warning = this.#warningText(telemetry);
    if (this.#last.warning !== warning) {
      this.#last.warning = warning;
      this.#warning.textContent = warning ?? '';
      this.#warning.hidden = !warning;
    }
  }

  /** What, if anything, the player needs to be told about the flight area. */
  #warningText(telemetry) {
    if (telemetry.boundary === 'edge') return 'Edge of the combat area — turning back';
    if (telemetry.boundary === 'altitude') {
      return telemetry.altitude < 200 ? 'Low altitude — pull up' : 'Ceiling reached — level off';
    }
    return null;
  }

  show() {
    this.#element.classList.add('is-visible');
  }

  hide() {
    this.#element.classList.remove('is-visible');
  }

  dispose() {
    this.#element.remove();
  }
}
