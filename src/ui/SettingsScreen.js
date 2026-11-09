/**
 * Sky Combat — the settings screen.
 *
 * A small, honest panel: one volume slider and one mute toggle. It makes no decisions — it
 * reports changes to the caller, which owns the `Settings` store, and only reflects the state
 * it is handed back.
 */
export class SettingsScreen {
  #root;
  #element;
  #volume;
  #volumeValue;
  #mute;
  #onVolume;
  #onToggleMute;
  #onBack;

  constructor(root, { onVolume, onToggleMute, onBack } = {}) {
    this.#root = root;
    this.#onVolume = onVolume;
    this.#onToggleMute = onToggleMute;
    this.#onBack = onBack;

    this.#element = document.createElement('div');
    this.#element.className = 'screen settings is-hidden';
    this.#element.setAttribute('role', 'dialog');
    this.#element.setAttribute('aria-label', 'Settings');
    this.#element.innerHTML = `
      <div class="panel">
        <p class="eyebrow">Settings</p>
        <h2 class="settings-title">Sound</h2>
        <div class="settings-row">
          <span class="settings-label">Volume</span>
          <input type="range" min="0" max="100" step="1" data-role="volume" aria-label="Volume">
          <b data-role="volume-value">70%</b>
        </div>
        <div class="settings-row">
          <span class="settings-label">Audio</span>
          <button class="btn ghost btn-small" type="button" data-action="mute">Mute</button>
        </div>
        <div class="settings-actions">
          <button class="btn primary" type="button" data-action="back">Back</button>
        </div>
      </div>
    `;

    this.#volume = this.#element.querySelector('[data-role="volume"]');
    this.#volumeValue = this.#element.querySelector('[data-role="volume-value"]');
    this.#mute = this.#element.querySelector('[data-action="mute"]');

    this.#volume.addEventListener('input', () => this.#onVolume?.(Number(this.#volume.value) / 100));
    this.#mute.addEventListener('click', () => this.#onToggleMute?.());
    this.#element.querySelector('[data-action="back"]').addEventListener('click', () => this.#onBack?.());

    this.#root.append(this.#element);
  }

  get element() {
    return this.#element;
  }

  /** Reflect the settings store. Called on entry and after every change. */
  render({ volume = 0.7, muted = false } = {}) {
    const percent = Math.round(Math.min(1, Math.max(0, volume)) * 100);
    this.#volume.value = String(percent);
    this.#volumeValue.textContent = `${percent}%`;
    this.#mute.textContent = muted ? 'Unmute' : 'Mute';
    this.#mute.classList.toggle('is-on', muted);
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