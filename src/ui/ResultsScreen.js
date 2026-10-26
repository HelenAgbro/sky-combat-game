/**
 * Sky Combat — the end of a run.
 *
 * Shown once the aircraft has been destroyed or the tank has run dry. It reports what the run
 * actually produced — distance flown, coins, enemies defeated, time in the air, and how many of
 * the shots fired connected — rather than a score alone, so a short accurate run reads
 * differently from a long wasteful one.
 *
 * It is shown exactly once per run: the state machine refuses a second move to RESULTS, and
 * `Game` refuses a second ending, so a burst of collisions in one frame cannot stack two
 * summaries.
 *
 * The hangar, the shop and the start.ng leaderboard are navigation *placeholders*: they are in
 * place, labelled, and disabled, because a button that looks live and does nothing is worse
 * than one that says it is not ready. The distance record is the one piece of progression that
 * genuinely exists at this stage.
 */
import { formatDistance } from '../run/distance.js';

export class ResultsScreen {
  #element;
  #fields;
  #title;
  #record;

  constructor(root, { onRestart, onMenu } = {}) {
    this.#element = document.createElement('div');
    this.#element.className = 'screen results is-hidden';
    this.#element.setAttribute('role', 'dialog');
    this.#element.setAttribute('aria-label', 'Flight results');
    this.#element.innerHTML = `
      <div class="panel">
        <p class="eyebrow">Flight ended</p>
        <h2 class="results-title">Aircraft destroyed</h2>
        <p class="results-record" data-role="record" hidden>New best distance</p>
        <div class="results-grid">
          <div class="result"><span>Distance</span><b data-field="distance">0 m</b></div>
          <div class="result"><span>Best</span><b data-field="best">0 m</b></div>
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
        <div class="results-actions results-actions-secondary">
          <button class="btn ghost" type="button" data-action="hangar" disabled title="The hangar opens in stage 8">Hangar</button>
          <button class="btn ghost" type="button" data-action="shop" disabled title="The shop opens in stage 8">Shop</button>
          <button class="btn ghost" type="button" data-action="leaderboard" disabled title="The start.ng leaderboard opens in stage 10">Leaderboard</button>
        </div>
        <p class="muted results-note">Hangar, shop and the start.ng leaderboard arrive in later stages.</p>
      </div>
    `;

    this.#fields = {
      distance: this.#element.querySelector('[data-field="distance"]'),
      best: this.#element.querySelector('[data-field="best"]'),
      kills: this.#element.querySelector('[data-field="kills"]'),
      coins: this.#element.querySelector('[data-field="coins"]'),
      score: this.#element.querySelector('[data-field="score"]'),
      time: this.#element.querySelector('[data-field="time"]'),
      shots: this.#element.querySelector('[data-field="shots"]'),
      accuracy: this.#element.querySelector('[data-field="accuracy"]'),
    };

    this.#title = this.#element.querySelector('.results-title');
    this.#record = this.#element.querySelector('[data-role="record"]');

    this.#element.querySelector('[data-action="again"]').addEventListener('click', () => onRestart?.());
    this.#element.querySelector('[data-action="menu"]').addEventListener('click', () => onMenu?.());

    root.append(this.#element);
  }

  get element() {
    return this.#element;
  }

  /** Fill in a finished run. @param {object} telemetry from `Game.telemetry()` */
  show(telemetry) {
    // The title says what actually happened. An empty tank is not a destroyed aircraft, and
    // saying so is the difference between a loss the player understands and one they don't.
    this.#title.textContent =
      telemetry.reason === 'fuel' ? 'Out of fuel' : 'Aircraft destroyed';

    this.#fields.distance.textContent = formatDistance(telemetry.distance ?? 0);
    this.#fields.best.textContent = formatDistance(telemetry.bestDistance ?? 0);
    this.#record.hidden = !telemetry.newBest;

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
