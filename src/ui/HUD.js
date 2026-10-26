/**
 * Sky Combat — the in-flight readout.
 *
 * What the flight model, the fight and the run actually report: speed, altitude, distance,
 * coins, kills and the state of the hull and the fuel, plus a reticle drawn where the nose is
 * actually pointing, a flash when something lands, and a chip per running power-up with its
 * countdown.
 *
 * The DOM is only touched when a value actually changes, so this costs nothing per frame
 * while the numbers hold still. A power-up chip is created when the effect starts and removed
 * when it ends — the same object for the whole duration, so the countdown costs one width.
 */
import { getPowerup } from '../data/powerups.js';
import { RUN } from '../game/config.js';
import { formatDistance } from '../run/distance.js';

export class HUD {
  #element;
  #fields;
  #warning;
  #reticle;
  #damage;
  #fuelBar;
  #fuelFill;
  #powers;
  #chips = new Map();
  #last = {};
  #lastHull = null;
  #hitTimer = 0;
  #coinTimer = 0;

  constructor(root, { showKeyHint = true } = {}) {
    this.#element = document.createElement('div');
    this.#element.className = 'hud';
    this.#element.innerHTML = `
      <div class="hud-readout">
        <div class="hud-item"><span>Speed</span><b data-field="speed">0</b><i>km/h</i></div>
        <div class="hud-item"><span>Altitude</span><b data-field="altitude">0</b><i>m</i></div>
        <div class="hud-item hud-distance" data-role="distance"><span>Distance</span><b data-field="distance">0 m</b></div>
        <div class="hud-item hud-coins" data-role="coins"><span>Coins</span><b data-field="coins">0</b><i>collected</i></div>
        <div class="hud-item"><span>Kills</span><b data-field="kills">0</b><i>score</i></div>
        <div class="hud-item hud-hull"><span>Hull</span><b data-field="hull">100</b><i>%</i></div>
        <div class="hud-fuel" data-role="fuel">
          <span>Fuel</span>
          <span class="hud-fuel-track"><i data-role="fuel-fill"></i></span>
          <b data-field="fuel">100</b><i>%</i>
        </div>
      </div>
      <div class="hud-powers" data-role="powers"></div>
      <p class="hud-warning" data-role="warning" hidden></p>
      <div class="hud-reticle" data-role="reticle" aria-hidden="true"></div>
      <div class="hud-damage" data-role="damage" aria-hidden="true"></div>
      ${showKeyHint ? '<p class="hud-hint">W A S D or arrows to fly · Shift to boost · Space to fire · P to pause</p>' : ''}
    `;

    this.#fields = {
      speed: this.#element.querySelector('[data-field="speed"]'),
      altitude: this.#element.querySelector('[data-field="altitude"]'),
      distance: this.#element.querySelector('[data-field="distance"]'),
      coins: this.#element.querySelector('[data-field="coins"]'),
      kills: this.#element.querySelector('[data-field="kills"]'),
      hull: this.#element.querySelector('[data-field="hull"]'),
      fuel: this.#element.querySelector('[data-field="fuel"]'),
    };
    this.#warning = this.#element.querySelector('[data-role="warning"]');
    this.#reticle = this.#element.querySelector('[data-role="reticle"]');
    this.#damage = this.#element.querySelector('[data-role="damage"]');
    this.#fuelBar = this.#element.querySelector('[data-role="fuel"]');
    this.#fuelFill = this.#element.querySelector('[data-role="fuel-fill"]');
    this.#powers = this.#element.querySelector('[data-role="powers"]');
    this.#distanceItem = this.#element.querySelector('[data-role="distance"]');
    this.#coinPulseTarget = this.#element.querySelector('[data-role="coins"]');
    root.append(this.#element);
  }

  #coinPulseTarget;
  #distanceItem;


  #set(field, value) {
    if (this.#last[field] === value) return;
    this.#last[field] = value;
    this.#fields[field].textContent = value;
  }

  /** @param {object} telemetry from `Game.telemetry()` */
  update(telemetry) {
    this.#set('speed', Math.round(telemetry.speed * 3.6).toString());
    this.#set('altitude', Math.round(telemetry.altitude).toString());

    const metres = telemetry.distance ?? 0;
    this.#set('distance', formatDistance(metres));

    // Past the local record, the number turns into the accent colour: the one moment in a run
    // where a glance at the readout means something beyond "how far have I got".
    const record = (telemetry.bestDistance ?? 0) > 0 && metres > telemetry.bestDistance;
    if (this.#last.record !== record) {
      this.#last.record = record;
      this.#distanceItem.classList.toggle('is-record', record);
    }

    this.#set('kills', String(telemetry.kills ?? 0));

    const coins = String(telemetry.coins ?? 0);
    if (this.#last.coins !== undefined && this.#last.coins !== coins) this.#pulseCoins();
    this.#set('coins', coins);

    const hull = Math.max(0, Math.round(telemetry.hull ?? telemetry.hullMax ?? 100));
    this.#set('hull', String(hull));
    this.#updateHull(hull, telemetry.hullMax ?? 100);

    this.#updateFuel(telemetry.fuel ?? 1);
    this.#updatePowers(telemetry.powerups);
    this.#updateReticle(telemetry.reticle);

    const warning = this.#warningText(telemetry, hull);
    if (this.#last.warning !== warning) {
      this.#last.warning = warning;
      this.#warning.textContent = warning ?? '';
      this.#warning.hidden = !warning;
    }
  }

  /**
   * The fuel bar.
   *
   * Written only when the whole percent changes, which is a handful of times a second at
   * most, and never as a per-frame layout thrash.
   */
  #updateFuel(fuel) {
    const percent = Math.max(0, Math.min(100, Math.round(fuel * 100)));
    if (this.#last.fuelPercent !== percent) {
      this.#last.fuelPercent = percent;
      this.#fields.fuel.textContent = String(percent);
      this.#fuelFill.style.width = `${percent}%`;
    }

    const low = fuel <= RUN.fuel.lowWarning;
    if (this.#last.fuelLow !== low) {
      this.#last.fuelLow = low;
      this.#fuelBar.classList.toggle('is-low', low);
    }
  }

  /**
   * A chip per running power-up, with its countdown.
   *
   * The chip is built on activation and removed on expiry, so the element that shows "Boost
   * 9.4" is the same element for the whole nine seconds. Nothing is created while a chip is
   * merely counting down, and an effect that ends while the game is paused or a run is
   * restarted takes its chip with it, because the HUD only ever reads the state.
   */
  #updatePowers(slots) {
    if (!slots) return;

    for (let i = 0; i < slots.length; i += 1) {
      const slot = slots[i];
      const chip = this.#chips.get(slot.id) ?? null;

      if (!slot.active) {
        if (chip) {
          chip.element.remove();
          this.#chips.delete(slot.id);
          delete this.#last[`power:${slot.id}`];
        }
        continue;
      }

      const entry = chip ?? this.#createChip(slot.id);
      const tenths = Math.ceil(slot.remaining * 10) / 10;
      if (this.#last[`power:${slot.id}`] === tenths) continue;
      this.#last[`power:${slot.id}`] = tenths;

      entry.time.textContent = tenths.toFixed(1);
      const fraction = slot.duration > 0 ? Math.max(0, Math.min(1, slot.remaining / slot.duration)) : 0;
      entry.fill.style.width = `${(fraction * 100).toFixed(1)}%`;
    }
  }

  #createChip(id) {
    const powerup = getPowerup(id);
    const element = document.createElement('div');
    element.className = 'hud-power';
    element.dataset.power = id;
    element.style.setProperty('--power-colour', powerup?.colour ?? '#ffffff');
    element.innerHTML = `
      <span class="hud-power-label">${powerup?.short ?? id}</span>
      <span class="hud-power-time">0.0</span>
      <span class="hud-power-track"><i></i></span>
    `;
    this.#powers.append(element);

    const entry = {
      element,
      time: element.querySelector('.hud-power-time'),
      fill: element.querySelector('.hud-power-track i'),
    };
    this.#chips.set(id, entry);
    return entry;
  }

  /** A quick flash on the coin counter, so a pickup is felt as well as counted. */
  #pulseCoins() {
    this.#coinPulseTarget.classList.remove('is-pulse');
    // Reading a layout property restarts the animation without a second class or a frame's
    // wait; without it two coins a few frames apart pulse only once.
    void this.#coinPulseTarget.offsetWidth;
    this.#coinPulseTarget.classList.add('is-pulse');
    clearTimeout(this.#coinTimer);
    this.#coinTimer = setTimeout(() => this.#coinPulseTarget.classList.remove('is-pulse'), 320);
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

    const fuel = telemetry.fuel ?? 1;
    if (fuel <= 0) return 'Out of fuel';
    if (hull <= telemetry.hullMax * 0.3) return 'Hull critical';
    if (fuel <= RUN.fuel.lowWarning) return 'Fuel low — find a canister';

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
    clearTimeout(this.#hitTimer);
    clearTimeout(this.#coinTimer);
    this.#chips.clear();
    this.#element.remove();
  }
}
