/**
 * Sky Combat — the end of a run.
 *
 * Shown once the aircraft has been destroyed, or once the tank runs dry. It reports what
 * the run actually produced — distance flown, aircraft destroyed, coins collected, time in
 * the air, and how many of the shots fired connected — rather than a score alone, so a
 * short accurate run reads differently from a long wasteful one.
 *
 * It is shown exactly once per run: the state machine refuses a second move to RESULTS, and
 * `Game` ignores a repeat, so a burst of collisions in one frame cannot stack two summaries.
 */

/** How the run ended, as a heading. */
const TITLES = Object.freeze({
  hull: 'Aircraft destroyed',
  fuel: 'Out of fuel',
});

export class ResultsScreen {
  #element;
  #fields;
  #title;

  constructor(root, { onRestart, onMenu } = {}) {
    this.#element = document.createElement('div');
    this.#element.className = 'screen results is-hidden';
    this.#element.setAttribute('role', 'dialog');
    this.#element.setAttribute('aria-label', 'Flight results');
    this.#element.innerHTML = `
      <div class="panel">
        <p class="eyebrow">Flight ended</p>
        <h2 class="results-title" data-role="title">Aircraft destroyed</h2>
        <div class="results-grid">
          <div class="result"><span>Distance</span><b data-field="distance">0</b></div>
          <div class="result"><span>Destroyed</span><b data-field="kills">0</b></div>
          <div class="result"><span>Coins</span><b data-field="coins">0</b></div>
          <div class="result"><span>Score</span><b data-field="score">0</b></div>
          <div class="result"><span>Time</span><b data-field="time">0:00</b></div>
          <div class="result"><span>Shots fired</span><b data-field="shots">0</b></div>
          <div class="result"><span>Accuracy</span><b data-field="accuracy">0%</b></div>
        </div>
        <div class="results-actions">
          <button class="btn primary" type="button" data-action="again">Fly again</button>
          <button class="btn ghost" type="button" data-action="menu">Main menu</button>
        </div>
      </div>
    `;

    this.#title = this.#element.querySelector('[data-role="title"]');
    this.#fields = {
      distance: this.#element.querySelector('[data-field="distance"]'),
      kills: this.#element.querySelector('[data-field="kills"]'),
      coins: this.#element.querySelector('[data-field="coins"]'),
      score: this.#element.querySelector('[data-field="score"]'),
      time: this.#element.querySelector('[data-field="time"]'),
      shots: this.#element.querySelector('[data-field="shots"]'),
      accuracy: this.#element.querySelector('[data-field="accuracy"]'),
    };

    this.#element.querySelector('[data-action="again"]').addEventListener('click', () => onRestart?.());
    this.#element.querySelector('[data-action="menu"]').addEventListener('click', () => onMenu?.());

    root.append(this.#element);
  }

  get element() {
    return this.#element;
  }

  /** Fill in a finished run. @param {object} telemetry from `Game.telemetry()` */
  show(telemetry) {
    // The run can end two ways now, and "Aircraft destroyed" would be a lie when the tank
    // simply ran dry.
    this.#title.textContent = TITLES[telemetry.reason] ?? TITLES.hull;

    const metres = telemetry.distance ?? 0;
    this.#fields.distance.textContent =
      metres >= 10000 ? `${(metres / 1000).toFixed(1)} km` : `${Math.round(metres)} m`;

    this.#fields.kills.textContent = String(telemetry.kills ?? 0);
    this.#fields.coins.textContent = String(telemetry.coins ?? 0);
    this.#fields.score.textContent = String(Math.round(telemetry.score ?? 0));

    const seconds = Math.max(0, Math.round(telemetry.elapsed ?? 0));
    this.#fields.time.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

    this.#fields.shots.textContent = String(telemetry.shotsFired ?? 0);
    this.#fields.accuracy.textContent = `${Math.round((telemetry.accuracy ?? 0) * 100)}%`;

    this.#element.classList.remove('is-hidden');
  }

  hide() {
    this.#element.classList.add('is-hidden');
  }

  dispose() {
    this.#element.remove();
  }
}
