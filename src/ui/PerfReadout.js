/**
 * Sky Combat — a small performance readout.
 *
 * The brief asks for measured performance rather than promised frame rates, so
 * this shows the live numbers (frame time, frame rate, quality tier, render scale
 * and draw calls) and can be toggled from the menu or with `?perf` in the address.
 * It is a diagnostic, not part of the game's look.
 */
export class PerfReadout {
  #element;
  #values;
  #samples = [];
  #visible = false;

  constructor(root) {
    this.#element = document.createElement('div');
    this.#element.className = 'perf';
    this.#element.setAttribute('aria-hidden', 'true');
    this.#element.innerHTML = '<span class="perf-fps">–</span><span class="perf-detail"></span>';
    this.#values = {
      fps: this.#element.querySelector('.perf-fps'),
      detail: this.#element.querySelector('.perf-detail'),
    };
    root.append(this.#element);
  }

  toggle(force = null) {
    this.#visible = force ?? !this.#visible;
    this.#element.classList.toggle('is-visible', this.#visible);
  }

  get visible() {
    return this.#visible;
  }

  /** Feed one frame's telemetry. */
  update(telemetry) {
    this.#samples.push(telemetry.frameMs);
    if (this.#samples.length > 45) this.#samples.shift();
    if (!this.#visible || this.#samples.length < 5) return;

    const average = this.#samples.reduce((sum, value) => sum + value, 0) / this.#samples.length;
    this.#values.fps.textContent = `${Math.round(1000 / average)} fps`;
    this.#values.detail.textContent = `${average.toFixed(1)} ms · ${telemetry.tier} · scale ${telemetry.renderScale.toFixed(2)} · ${telemetry.modelSource}`;
  }

  dispose() {
    this.#element.remove();
  }
}
