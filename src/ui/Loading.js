/**
 * Sky Combat — the loading screen.
 *
 * Shown from the moment the page starts until the scene is built. The airframe
 * and its textures are generated in the browser, which takes a moment on a slow
 * device, so progress is reported in named steps rather than as a fake bar.
 */
export class Loading {
  #root;
  #element;
  #message;
  #bar;

  constructor(root) {
    this.#root = root;

    this.#element = document.createElement('div');
    this.#element.className = 'screen loading';
    this.#element.setAttribute('role', 'status');
    this.#element.setAttribute('aria-live', 'polite');
    this.#element.innerHTML = `
      <div class="panel loading-panel">
        <h1 class="wordmark">SKY <span>COMBAT</span></h1>
        <p class="loading-message"></p>
        <div class="progress"><i></i></div>
      </div>
    `;

    this.#message = this.#element.querySelector('.loading-message');
    this.#bar = this.#element.querySelector('.progress i');
    this.#root.append(this.#element);
  }

  /** Report the current step and how far along it is (0–1). */
  set(text, fraction = null) {
    this.#message.textContent = text;
    if (fraction !== null) {
      this.#bar.style.width = `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%`;
    }
  }

  hide() {
    this.#element.classList.add('is-hidden');
  }

  dispose() {
    this.#element.remove();
  }
}
