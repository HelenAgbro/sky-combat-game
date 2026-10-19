/**
 * Sky Combat — the failure panel.
 *
 * Shown when the 3D view cannot start, which in practice means the browser could
 * not create a WebGL context. The brief asks for a graceful path here, so the
 * player gets a plain explanation and a way to retry rather than a blank canvas.
 */
export class FatalPanel {
  #element;

  constructor(root, { title = "Can't start the 3D view", message, detail = null } = {}) {
    this.#element = document.createElement('div');
    this.#element.className = 'screen fatal';
    this.#element.setAttribute('role', 'alert');
    this.#element.innerHTML = `
      <div class="panel">
        <h2 class="fatal-title"></h2>
        <p class="fatal-message"></p>
        <p class="fatal-detail muted"></p>
        <button class="btn primary" type="button">Try again</button>
      </div>
    `;

    this.#element.querySelector('.fatal-title').textContent = title;
    this.#element.querySelector('.fatal-message').textContent =
      message ??
      'Your browser could not create a WebGL context, which Sky Combat needs to draw the world.';
    const detailElement = this.#element.querySelector('.fatal-detail');
    if (detail) {
      detailElement.textContent = detail;
    } else {
      detailElement.remove();
    }

    this.#element.querySelector('button').addEventListener('click', () => window.location.reload());
    root.append(this.#element);
  }

  dispose() {
    this.#element.remove();
  }
}
