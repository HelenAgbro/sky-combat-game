/**
 * Sky Combat — the pause screen.
 *
 * Shown while the simulation is held. The scene keeps rendering behind it, which is
 * what makes a pause feel like a pause rather than a freeze, and it is the reason
 * pause never needs a second animation loop.
 */
export class PauseScreen {
  #element;

  constructor(root, { onResume, onRestart, onMenu } = {}) {
    this.#element = document.createElement('div');
    this.#element.className = 'screen pause is-hidden';
    this.#element.setAttribute('role', 'dialog');
    this.#element.setAttribute('aria-label', 'Paused');
    this.#element.innerHTML = `
      <div class="panel">
        <p class="eyebrow">Flight held</p>
        <h2 class="pause-title">Paused</h2>
        <div class="pause-actions">
          <button class="btn primary" type="button" data-action="resume">Resume</button>
          <button class="btn ghost" type="button" data-action="restart">Restart</button>
          <button class="btn ghost" type="button" data-action="menu">Main menu</button>
        </div>
        <p class="muted pause-note">P or Escape resumes. W A S D and the arrow keys fly.</p>
      </div>
    `;

    this.#element.querySelector('[data-action="resume"]').addEventListener('click', () => onResume?.());
    this.#element.querySelector('[data-action="restart"]').addEventListener('click', () => onRestart?.());
    this.#element.querySelector('[data-action="menu"]').addEventListener('click', () => onMenu?.());

    root.append(this.#element);
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
