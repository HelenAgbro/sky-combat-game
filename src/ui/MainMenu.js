/**
 * Sky Combat — main menu.
 *
 * The entry point: it starts a flight, reports the local distance record, which aircraft and
 * which asset pipeline are in use, and is honest about the fact that the hangar, the shop and
 * the start.ng leaderboard arrive in later stages.
 */
import { formatDistance } from '../run/distance.js';

export class MainMenu {
  #root;
  #element;
  #status;
  #aircraftLine;
  #best;
  #wallet;

  constructor(root, { onStart, onHangar, onShop, onSettings } = {}) {
    this.#root = root;

    this.#element = document.createElement('div');
    this.#element.className = 'screen menu';
    this.#element.innerHTML = `
      <div class="menu-inner">
        <div class="menu-copy">
          <p class="eyebrow">start.ng · stage 8 prototype</p>
          <h1 class="wordmark">SKY <span>COMBAT</span></h1>
          <p class="tagline">Fly, fight and chase the greatest distance.</p>
          <div class="menu-actions">
            <button class="btn primary" type="button" data-action="start">Start flight</button>
            <button class="btn ghost" type="button" data-action="hangar">Hangar</button>
            <button class="btn ghost" type="button" data-action="shop">Shop</button>
            <button class="btn ghost" type="button" data-action="settings">Settings</button>
            <button class="btn ghost" type="button" data-action="perf">Performance</button>
          </div>
          <p class="menu-status"></p>
          <p class="menu-best" data-role="best">No flight recorded yet</p>
          <p class="menu-wallet muted" data-role="wallet"></p>
          <p class="menu-note muted">
            Fly, hold <b>Space</b> to fire, and watch the hull and the tank. Coins, fuel and
            power-ups arrive on their own, and the fight gets harder the further you get. The
            shop and the start.ng leaderboard follow in later stages.
          </p>
        </div>
        <p class="aircraft-line muted"></p>
      </div>
    `;

    this.#status = this.#element.querySelector('.menu-status');
    this.#aircraftLine = this.#element.querySelector('.aircraft-line');
    this.#best = this.#element.querySelector('[data-role="best"]');
    this.#wallet = this.#element.querySelector('[data-role="wallet"]');

    this.#element.querySelector('[data-action="start"]').addEventListener('click', () => onStart?.());
    this.#element.querySelector('[data-action="hangar"]').addEventListener('click', () => onHangar?.());
    this.#element.querySelector('[data-action="shop"]').addEventListener('click', () => onShop?.());
    this.#element.querySelector('[data-action="settings"]').addEventListener('click', () => onSettings?.());
    this.#element
      .querySelector('[data-action="perf"]')
      .addEventListener('click', () => this.#element.classList.toggle('show-perf'));

    this.#root.append(this.#element);
  }

  /** A short line of status under the buttons, used while the scene is preparing. */
  setStatus(text) {
    this.#status.textContent = text ?? '';
  }

  /**
   * The distance record this browser has flown.
   *
   * Shown before the flight, because that is when it is worth something: it is the number the
   * player is about to try to beat. `0` means nothing has been recorded yet, which is said
   * plainly rather than as `0 m`.
   *
   * @param {number} metres
   */
  setBest(metres) {
    const value = Number.isFinite(metres) ? metres : 0;
    this.#best.textContent =
      value > 0 ? `Best flight: ${formatDistance(value)}` : 'No flight recorded yet';
    this.#best.classList.toggle('is-record', value > 0);
  }

  /** The persistent wallet: how many coins the hangar has to spend. */
  setWallet(coins) {
    const value = Math.max(0, Math.floor(Number.isFinite(coins) ? coins : 0));
    this.#wallet.textContent = value > 0 ? `Bank: ${value.toLocaleString('en-US')} coins` : 'Bank: 0 coins';
  }

  /** Which aircraft is on screen, and whether it came from code or a packed model. */
  setAircraft(name, source) {
    const origin =
      source === 'packed'
        ? 'licensed model, packed for start.ng'
        : 'TEMPORARY airframe built in code — no licensed model available yet';
    this.#aircraftLine.textContent = `${name} · ${origin}`;
    this.#aircraftLine.classList.toggle('is-temporary', source !== 'packed');
  }

  get element() {
    return this.#element;
  }

  show() {
    this.#element.classList.remove('is-hidden');
  }

  hide() {
    this.#element.classList.add('is-hidden');
  }

  dispose() {
    this.#element.remove();
  }
}
