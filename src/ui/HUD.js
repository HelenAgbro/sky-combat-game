/**
 * Sky Combat — the in-flight readout.
 *
 * What the flight model and the fight actually report: speed, altitude, distance, kills,
 * the state of the hull, the fuel left and the coins collected, plus a reticle drawn where
 * the nose is actually pointing, a flash when something lands, and a chip for each
 * power-up that is running with the time it has left.
 *
 * The DOM is only touched when a value actually changes, so this costs nothing per frame
 * while the numbers hold still — which matters most for the power-up chips, whose timer
 * changes sixty times a second and is written once per tenth of a second.
 */
import { FLIGHT } from '../game/config.js';
import { POWER_UPS, POWER_UP_IDS } from '../pickups/powerUps.js';

/** The power-up list, reused when there is nothing to report. */
const NO_POWER_UPS = [];

export class HUD {
  #element;
  #fields;
  #warning;
  #reticle;
  #damage;
  #fuelBar;
  #powerUps;
  #chips;
  #last = {};
  #lastHull = null;
  #hitTimer = 0;

  constructor(root, { showKeyHint = true } = {}) {
    this.#element = document.createElement('div');
    this.#element.className = 'hud';

    // One chip per power-up, built from the definitions rather than from the markup, so a
    // third power-up needs no change here.
    const chips = POWER_UP_IDS.map(
      (id) => `
        <div class="hud-chip" data-powerup="${id}" style="--chip: ${POWER_UPS[id].colour}" hidden>
          <span class="hud-chip-name">${POWER_UPS[id].name}</span>
          <b class="hud-chip-time">0.0</b>
          <div class="hud-bar"><span class="hud-chip-bar"></span></div>
        </div>`,
    ).join('');

    this.#element.innerHTML = `
      <div class="hud-readout">
        <div class="hud-item"><span>Speed</span><b data-field="speed">0</b><i>km/h</i></div>
        <div class="hud-item"><span>Altitude</span><b data-field="altitude">0</b><i>m</i></div>
        <div class="hud-item"><span>Distance</span><b data-field="distance">0</b><i>m</i></div>
        <div class="hud-item"><span>Kills</span><b data-field="kills">0</b><i>score</i></div>
        <div class="hud-item hud-hull"><span>Hull</span><b data-field="hull">100</b><i>%</i></div>
        <div class="hud-item hud-fuel">
          <span>Fuel</span><b data-field="fuel">100</b><i>%</i>
          <div class="hud-bar"><span data-role="fuel-bar"></span></div>
        </div>
        <div class="hud-item hud-coins"><span>Coins</span><b data-field="coins">0</b><i>collected</i></div>
      </div>
      <p class="hud-warning" data-role="warning" hidden></p>
      <div class="hud-powerups" data-role="powerups" hidden>${chips}</div>
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
      fuel: this.#element.querySelector('[data-field="fuel"]'),
      coins: this.#element.querySelector('[data-field="coins"]'),
    };
    this.#warning = this.#element.querySelector('[data-role="warning"]');
    this.#reticle = this.#element.querySelector('[data-role="reticle"]');
    this.#damage = this.#element.querySelector('[data-role="damage"]');
    this.#fuelBar = this.#element.querySelector('[data-role="fuel-bar"]');
    this.#powerUps = this.#element.querySelector('[data-role="powerups"]');

    // An array rather than a Map: iterating a Map allocates, and this runs every frame.
    this.#chips = POWER_UP_IDS.map((id) => {
      const chip = this.#element.querySelector(`[data-powerup="${id}"]`);
      return {
        id,
        root: chip,
        time: chip.querySelector('.hud-chip-time'),
        bar: chip.querySelector('.hud-chip-bar'),
        shown: false,
        lastTime: null,
        lastWidth: null,
      };
    });

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

    const fuel = Math.max(0, Math.min(1, telemetry.fuel ?? 1));
    this.#set('fuel', String(Math.round(fuel * 100)));
    this.#updateFuel(fuel);

    this.#set('coins', String(telemetry.coins ?? 0));
    this.#updatePowerUps(telemetry.powerUps);

    this.#updateReticle(telemetry.reticle);

    const warning = this.#warningText(telemetry, hull, fuel);
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

  /**
   * The fuel bar, and the low-fuel state on the frame.
   *
   * The bar is a width, so it is only written when the rounded percentage changes — about
   * once a second, rather than sixty times.
   */
  #updateFuel(fuel) {
    const percent = Math.round(fuel * 100);
    if (this.#last.fuelPercent !== percent) {
      this.#last.fuelPercent = percent;
      this.#fuelBar.style.width = `${percent}%`;
    }

    const low = fuel <= FLIGHT.lowFuelWarning;
    if (this.#last.lowFuel !== low) {
      this.#last.lowFuel = low;
      this.#element.classList.toggle('is-low-fuel', low);
    }
  }

  /**
   * The power-up chips.
   *
   * A chip is shown while its effect runs and hidden the moment it expires: the timer *is*
   * the indicator, so there is no separate "is it still on?" state to keep in step. The
   * remaining time is written to one decimal place, which touches the DOM ten times a
   * second rather than sixty.
   */
  #updatePowerUps(powerUps) {
    const list = powerUps ?? NO_POWER_UPS;

    for (let i = 0; i < this.#chips.length; i += 1) {
      const chip = this.#chips[i];

      // A linear scan of at most two entries, rather than a Map built every frame.
      let entry = null;
      for (let j = 0; j < list.length; j += 1) {
        if (list[j].id === chip.id) {
          entry = list[j];
          break;
        }
      }

      const shown = entry !== null;
      if (chip.shown !== shown) {
        chip.shown = shown;
        chip.root.hidden = !shown;
      }
      if (!entry) continue;

      const seconds =
        entry.remaining >= 10 ? String(Math.ceil(entry.remaining)) : entry.remaining.toFixed(1);
      if (chip.lastTime !== seconds) {
        chip.lastTime = seconds;
        chip.time.textContent = seconds;
      }

      const width = `${Math.round(Math.max(0, Math.min(1, entry.progress)) * 100)}%`;
      if (chip.lastWidth !== width) {
        chip.lastWidth = width;
        chip.bar.style.width = width;
      }
    }

    const any = list.length > 0;
    if (this.#last.anyPowerUps !== any) {
      this.#last.anyPowerUps = any;
      this.#powerUps.hidden = !any;
    }
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
  #warningText(telemetry, hull, fuel) {
    if (hull <= 0) return 'Aircraft destroyed';
    if (fuel <= 0) return 'Out of fuel';
    if (hull <= telemetry.hullMax * 0.3) return 'Hull critical';
    if (fuel <= FLIGHT.lowFuelWarning) return 'Fuel low — find a canister';
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
