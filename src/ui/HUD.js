/**
 * Sky Combat — the in-flight readout.
 *
 * What the flight model and the fight actually report: speed, altitude, distance, kills and
 * the state of the hull, plus a reticle drawn where the nose is actually pointing and a
 * flash when something lands.
 *
 * The DOM is only touched when a value actually changes, so this costs nothing per frame
 * while the numbers hold still.
 */
export class HUD {
  #element;
  #fields;
  #warning;
  #reticle;
  #damage;
  #last = {};
  #lastHull = null;
  #hitTimer = 0;

  constructor(root, { showKeyHint = true } = {}) {
    this.#element = document.createElement('div');
    this.#element.className = 'hud';
    this.#element.innerHTML = `
      <div class="hud-readout">
        <div class="hud-item"><span>Speed</span><b data-field="speed">0</b><i>km/h</i></div>
        <div class="hud-item"><span>Altitude</span><b data-field="altitude">0</b><i>m</i></div>
        <div class="hud-item"><span>Distance</span><b data-field="distance">0</b><i>m</i></div>
        <div class="hud-item"><span>Kills</span><b data-field="kills">0</b><i>score</i></div>
        <div class="hud-item hud-hull"><span>Hull</span><b data-field="hull">100</b><i>%</i></div>
      </div>
      <p class="hud-warning" data-role="warning" hidden></p>
      <div class="hud-reticle" data-role="reticle" aria-hidden="true"></div>
      <div class="hud-damage" data-role="damage" aria-hidden="true"></div>
      ${showKeyHint ? '<p class="hud-hint">W A S D or arrows to fly · Shift to boost · Space to fire · P to pause</p>' : ''}
    `;

    this.#fields = {
      speed: this.#element.querySelector('[data-field="speed"]'),
      altitude: this.#element.querySelector('[data-field="altitude"]'),
      distance: this.#element.querySelector('[data-field="distance"]'),
      kills: this.#element.querySelector('[data-field="kills"]'),
      hull: this.#element.querySelector('[data-field="hull"]'),
    };
    this.#warning = this.#element.querySelector('[data-role="warning"]');
    this.#reticle = this.#element.querySelector('[data-role="reticle"]');
    this.#damage = this.#element.querySelector('[data-role="damage"]');
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
    this.#set('kills', String(telemetry.kills ?? 0));

    const hull = Math.max(0, Math.round(telemetry.hull ?? telemetry.hullMax ?? 100));
    this.#set('hull', String(hull));
    this.#updateHull(hull, telemetry.hullMax ?? 100);

    this.#updateReticle(telemetry.reticle);

    const warning = this.#warningText(telemetry, hull);
    if (this.#last.warning !== warning) {
      this.#last.warning = warning;
      this.#warning.textContent = warning ?? '';
      this.#warning.hidden = !warning;
    }
  }

  /**
   * Flash when the hull drops, and hold a red edge on the frame while it is low.
   *
   * The flash is a class rather than an animation so it restarts cleanly on every hit, and
   * the timer is cleared rather than stacked — two hits a tenth of a second apart should
   * read as two hits, not as one long one.
   */
  #updateHull(hull, max) {
    const critical = hull <= max * 0.3;
    this.#element.classList.toggle('is-critical', critical);

    if (this.#lastHull === null) {
      this.#lastHull = hull;
      return;
    }
    if (hull >= this.#lastHull) {
      this.#lastHull = hull;
      return;
    }

    this.#lastHull = hull;
    this.#damage.classList.add('is-hit');
    clearTimeout(this.#hitTimer);
    this.#hitTimer = setTimeout(() => this.#damage.classList.remove('is-hit'), 220);
  }

  /** Draw the reticle where the nose points, not in the middle of the frame. */
  #updateReticle(reticle) {
    if (!reticle) return;
    if (this.#last.reticleX !== undefined && Math.abs(this.#last.reticleX - reticle.x) < 0.08
      && Math.abs(this.#last.reticleY - reticle.y) < 0.08) {
      return;
    }
    this.#last.reticleX = reticle.x;
    this.#last.reticleY = reticle.y;
    this.#reticle.style.left = `${reticle.x}%`;
    this.#reticle.style.top = `${reticle.y}%`;
  }

  /** What, if anything, the player needs to be told about. */
  #warningText(telemetry, hull) {
    if (hull <= 0) return 'Aircraft destroyed';
    if (hull <= telemetry.hullMax * 0.3) return 'Hull critical';
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
