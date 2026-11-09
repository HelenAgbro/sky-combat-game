/**
 * Sky Combat — the aircraft hangar.
 *
 * One live screen for the four aircraft: it previews each in the 3D backdrop when the
 * player points at it, shows the 0–10 ratings the flight model actually uses, and offers
 * the two actions the rules allow — unlock a locked aircraft with coins from the wallet,
 * or select an unlocked one as the next flight's airframe.
 *
 * The hangar is a view over `Game.getHangar()`; it makes no decisions itself. `Game` owns
 * the progression and the scene, and the screen only renders what it is handed and reports
 * which button was pressed.
 */

/** The order and labels the hangar shows the ratings in. */
const ATTRIBUTES = [
  ['speed', 'Speed'],
  ['agility', 'Agility'],
  ['armour', 'Armour'],
  ['fuel', 'Fuel'],
];

export class HangarScreen {
  #root;
  #element;
  #grid;
  #wallet;
  #onPreview;
  #onSelect;
  #onUnlock;
  #onBack;

  constructor(root, { onPreview, onSelect, onUnlock, onBack } = {}) {
    this.#root = root;
    this.#onPreview = onPreview;
    this.#onSelect = onSelect;
    this.#onUnlock = onUnlock;
    this.#onBack = onBack;

    this.#element = document.createElement('div');
    this.#element.className = 'screen hangar is-hidden';
    this.#element.setAttribute('role', 'dialog');
    this.#element.setAttribute('aria-label', 'Aircraft hangar');
    this.#element.innerHTML = `
      <div class="hangar-panel">
        <p class="eyebrow">Hangar</p>
        <h2 class="hangar-title">Choose your aircraft</h2>
        <p class="hangar-wallet muted">Bank: <b data-role="wallet">0</b> coins</p>
        <div class="hangar-grid" data-role="grid"></div>
        <p class="hangar-note muted">
          Airframes are TEMPORARY — generated in code until licensed models are available.
        </p>
        <div class="hangar-actions">
          <button class="btn ghost" type="button" data-action="back">Back to menu</button>
        </div>
      </div>
    `;

    this.#grid = this.#element.querySelector('[data-role="grid"]');
    this.#wallet = this.#element.querySelector('[data-role="wallet"]');

    this.#element.querySelector('[data-action="back"]').addEventListener('click', () => this.#onBack?.());

    this.#root.append(this.#element);
  }

  get element() {
    return this.#element;
  }

  /** Draw the fleet and the wallet. Called on entry and after every unlock or selection. */
  render(items, wallet) {
    this.#wallet.textContent = String(Math.max(0, Math.floor(wallet ?? 0)));
    this.#grid.innerHTML = '';

    for (const aircraft of items) {
      this.#grid.append(this.#buildCard(aircraft, wallet ?? 0));
    }
  }

  #buildCard(aircraft, wallet) {
    const card = document.createElement('article');
    card.className = 'aircraft-card';
    card.dataset.id = aircraft.id;
    card.tabIndex = 0;
    if (aircraft.locked || !aircraft.unlocked) card.classList.add('is-locked');
    if (aircraft.selected) card.classList.add('is-selected');

    const priceText = aircraft.price === 0 ? 'Free' : `${aircraft.price.toLocaleString('en-US')} coins`;
    const affordable = aircraft.unlocked ? false : wallet >= aircraft.price;

    const bars = ATTRIBUTES.map(
      ([key, label]) => `
        <div class="aircraft-attr">
          <span>${label}</span>
          <span class="aircraft-attr-track"><i style="width: ${(aircraft.attributes[key] ?? 0) * 10}%"></i></span>
          <b>${aircraft.attributes[key] ?? 0}</b>
        </div>`,
    ).join('');

    let action = '';
    if (aircraft.unlocked) {
      action = aircraft.selected
        ? '<span class="aircraft-card-selected">Selected</span>'
        : '<button class="btn primary btn-small" type="button" data-action="select">Select</button>';
    } else {
      action = `<button class="btn ghost btn-small" type="button" data-action="unlock"${
        affordable ? '' : ' disabled'
      }>Unlock</button>`;
    }

    card.innerHTML = `
      <div class="aircraft-card-swatch" style="
        background: linear-gradient(135deg, ${aircraft.paint} 0%, ${aircraft.paint} 55%, ${aircraft.accent} 55%, ${aircraft.accent} 100%);
      "></div>
      <div class="aircraft-card-body">
        <h3>${aircraft.name}</h3>
        <p class="aircraft-card-role">${aircraft.role}</p>
        <p class="aircraft-card-tagline">${aircraft.tagline}</p>
        <div class="aircraft-card-attrs">${bars}</div>
        <div class="aircraft-card-foot">
          <span class="aircraft-card-price">${priceText}</span>
          ${action}
        </div>
      </div>
    `;

    const preview = () => this.#onPreview?.(aircraft.id);
    card.addEventListener('mouseenter', preview);
    card.addEventListener('focus', preview);

    const select = card.querySelector('[data-action="select"]');
    if (select) select.addEventListener('click', () => this.#onSelect?.(aircraft.id));

    const unlock = card.querySelector('[data-action="unlock"]');
    if (unlock) unlock.addEventListener('click', () => this.#onUnlock?.(aircraft.id));

    return card;
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