/**
 * Sky Combat — main menu.
 *
 * Stage 2's entry point: it starts the demonstration sortie, reports which
 * aircraft and which asset pipeline are in use, and is honest about the fact that
 * player flight controls and the rest of the game arrive in later stages.
 */
export class MainMenu {
  #root;
  #element;
  #status;
  #aircraftLine;

  constructor(root, { onStart } = {}) {
    this.#root = root;

    this.#element = document.createElement('div');
    this.#element.className = 'screen menu';
    this.#element.innerHTML = `
      <div class="menu-inner">
        <div class="menu-copy">
          <p class="eyebrow">start.ng · stage 2 prototype</p>
          <h1 class="wordmark">SKY <span>COMBAT</span></h1>
          <p class="tagline">Fly, fight and chase the greatest distance.</p>
          <div class="menu-actions">
            <button class="btn primary" type="button" data-action="start">Start flight</button>
            <button class="btn ghost" type="button" data-action="perf">Performance</button>
          </div>
          <p class="menu-status"></p>
          <p class="menu-note muted">
            This build demonstrates the world, the aircraft, the lighting and the camera.
            Flight controls, enemies, weapons and the start.ng leaderboard follow in later stages.
          </p>
        </div>
        <p class="aircraft-line muted"></p>
      </div>
    `;

    this.#status = this.#element.querySelector('.menu-status');
    this.#aircraftLine = this.#element.querySelector('.aircraft-line');

    this.#element.querySelector('[data-action="start"]').addEventListener('click', () => onStart?.());
    this.#element
      .querySelector('[data-action="perf"]')
      .addEventListener('click', () => this.#element.classList.toggle('show-perf'));

    this.#root.append(this.#element);
  }

  /** A short line of status under the buttons, used while the scene is preparing. */
  setStatus(text) {
    this.#status.textContent = text ?? '';
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
