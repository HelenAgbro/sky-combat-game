/**
 * Sky Combat — the weapon shop.
 *
 * One live screen for the four weapons: what they do, how far they have been upgraded, what
 * the next step costs, and the two actions the rules allow — unlock a locked weapon, or buy
 * the next upgrade level. Equipping is a tap on an owned weapon's card.
 *
 * The shop makes no decisions itself: `Game` owns the wallet and the upgrades. This screen
 * renders `Game.getShop()` and reports which button was pressed, then shows the outcome.
 */

const KIND_LABELS = Object.freeze({
  standard: 'Cannon',
  spread: 'Spread',
  laser: 'Laser',
  homing: 'Missiles',
});

export class WeaponShopScreen {
  #root;
  #element;
  #grid;
  #wallet;
  #message;
  #messageTimer = null;
  #onSelect;
  #onPurchase;
  #onBack;

  constructor(root, { onSelect, onPurchase, onBack } = {}) {
    this.#root = root;
    this.#onSelect = onSelect;
    this.#onPurchase = onPurchase;
    this.#onBack = onBack;

    this.#element = document.createElement('div');
    this.#element.className = 'screen shop is-hidden';
    this.#element.setAttribute('role', 'dialog');
    this.#element.setAttribute('aria-label', 'Weapon shop');
    this.#element.innerHTML = `
      <div class="shop-panel">
        <p class="eyebrow">Weapon shop</p>
        <h2 class="shop-title">Choose your weapon</h2>
        <p class="shop-wallet muted">Bank: <b data-role="wallet">0</b> coins</p>
        <p class="shop-message" data-role="message" hidden></p>
        <div class="shop-grid" data-role="grid"></div>
        <div class="shop-actions">
          <button class="btn ghost" type="button" data-action="back">Back to menu</button>
        </div>
      </div>
    `;

    this.#grid = this.#element.querySelector('[data-role="grid"]');
    this.#wallet = this.#element.querySelector('[data-role="wallet"]');
    this.#message = this.#element.querySelector('[data-role="message"]');

    this.#element.querySelector('[data-action="back"]').addEventListener('click', () => this.#onBack?.());

    this.#root.append(this.#element);
  }

  get element() {
    return this.#element;
  }

  /** Draw the arsenal and the wallet. Called on entry and after every purchase or equip. */
  render(items, wallet) {
    this.#wallet.textContent = String(Math.max(0, Math.floor(wallet ?? 0)));
    this.#grid.innerHTML = '';

    for (const weapon of items) {
      this.#grid.append(this.#buildCard(weapon));
    }
  }

  /** Show a short success or failure message. Cleared automatically. */
  flash(text, kind = 'ok') {
    clearTimeout(this.#messageTimer);
    this.#message.textContent = text ?? '';
    this.#message.hidden = !text;
    this.#message.classList.toggle('is-error', kind === 'error');
    this.#message.classList.toggle('is-ok', kind === 'ok');
    if (text) this.#messageTimer = setTimeout(() => this.flash(''), 2200);
  }

  #buildCard(weapon) {
    const card = document.createElement('article');
    card.className = 'weapon-card';
    card.dataset.id = weapon.id;
    card.tabIndex = 0;
    if (!weapon.unlocked) card.classList.add('is-locked');
    if (weapon.selected) card.classList.add('is-selected');

    const kindLabel = KIND_LABELS[weapon.kind] ?? weapon.kind;
    const pips = Array.from({ length: weapon.maxLevel + 1 }, (_, index) => {
      const filled = index <= weapon.level;
      return `<i class="${filled ? 'is-filled' : ''}"></i>`;
    }).join('');

    let action;
    if (!weapon.unlocked) {
      action = `<button class="btn ghost btn-small" type="button" data-action="purchase"${
        weapon.canAfford ? '' : ' disabled'
      }>Unlock · ${weapon.price.toLocaleString('en-US')}</button>`;
    } else if (!weapon.atMax) {
      action = `<button class="btn primary btn-small" type="button" data-action="purchase"${
        weapon.canAfford ? '' : ' disabled'
      }>Upgrade · ${weapon.nextCost.toLocaleString('en-US')}</button>`;
    } else {
      action = '<span class="weapon-card-max">Max level</span>';
    }

    let equip;
    if (weapon.selected) {
      equip = '<span class="weapon-card-selected">Equipped</span>';
    } else if (weapon.unlocked) {
      equip = '<button class="btn ghost btn-small" type="button" data-action="select">Equip</button>';
    } else {
      equip = '';
    }

    card.innerHTML = `
      <div class="weapon-card-head">
        <span class="weapon-kind" style="--weapon-colour: ${weapon.colour}">${kindLabel}</span>
        <h3>${weapon.name}</h3>
      </div>
      <p class="weapon-card-desc">${weapon.description}</p>
      <div class="weapon-level">
        <span class="muted">Level ${weapon.level}/${weapon.maxLevel}</span>
        <span class="weapon-pips">${pips}</span>
      </div>
      <div class="weapon-card-foot">
        ${action}
        ${equip}
      </div>
    `;

    const select = card.querySelector('[data-action="select"]');
    if (select) select.addEventListener('click', () => this.#onSelect?.(weapon.id));

    const purchase = card.querySelector('[data-action="purchase"]');
    if (purchase) purchase.addEventListener('click', () => this.#onPurchase?.(weapon.id));

    return card;
  }

  show() {
    this.#element.classList.remove('is-hidden');
  }

  hide() {
    this.#element.classList.add('is-hidden');
  }

  dispose() {
    clearTimeout(this.#messageTimer);
    this.#element.remove();
  }
}