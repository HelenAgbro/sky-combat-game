/**
 * Sky Combat — what the current run has collected.
 *
 * The coins in the wallet and the power-ups on the clock, in one place, because both are
 * per-run: a new flight starts with none of either. Fuel is deliberately *not* here — it
 * belongs to the flight model (`AircraftController.fuel`), which is where it is burned, and
 * duplicating it would give the game two numbers that could disagree.
 *
 * The state is reset once per run and mutated in place, and `snapshot()` returns objects
 * that stay the same objects, so the HUD can hold a reference and read it every frame
 * without anything being allocated.
 */
import { RUN } from '../game/config.js';
import {
  activate,
  advance,
  createPowerupState,
  isActive,
  progress,
  reset as resetPowerups,
} from './powerups.js';

export class RunState {
  #coins = 0;
  #powerups = createPowerupState();
  /** Reused by `update`, so expiry costs nothing. */
  #expired = [];
  /** The object `snapshot()` hands out. Filled in once, mutated after that. */
  #snapshot = { coins: 0, powerups: null, powerupRemaining: 0 };

  constructor(configuration = RUN) {
    this.config = configuration;
    this.#snapshot.powerups = this.#powerups.slots;
  }

  /** Coins collected this run. */
  get coins() {
    return this.#coins;
  }

  /** The live power-up slots: `[{ id, remaining, duration, active }]`, fixed in length. */
  get powerups() {
    return this.#powerups.slots;
  }

  /**
   * Credit coins.
   *
   * Answers with the new total, which is what lets a caller report a collection and a
   * count in one breath rather than reading the count afterwards and hoping nothing else
   * changed in between.
   */
  addCoins(count = 1) {
    const value = Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;
    this.#coins += value;
    return this.#coins;
  }

  /**
   * Start or refresh a power-up.
   *
   * `duration` defaults to the configured one for the type. Returns what happened, so the
   * caller can flash the HUD on a fresh pickup and stay quiet on a refresh.
   */
  activatePowerup(id, duration = this.durationFor(id)) {
    return activate(this.#powerups, id, duration);
  }

  durationFor(id) {
    return this.config?.powerups?.duration?.[id] ?? 0;
  }

  isActive(id) {
    return isActive(this.#powerups, id);
  }

  remaining(id) {
    const slot = this.#powerups.byId[id];
    return slot?.remaining ?? 0;
  }

  /** How far through its duration a power-up is, 0–1. */
  progress(id) {
    return progress(this.#powerups.byId[id]);
  }

  /**
   * Advance the clocks by one fixed step.
   *
   * @param {number} dt seconds
   * @returns {string[]} the power-ups that expired this step (reused, do not keep)
   */
  update(dt) {
    return advance(this.#powerups, dt, this.#expired);
  }

  /** Clear everything a run owns. Called by `Game.start()`, never by a pause. */
  reset() {
    this.#coins = 0;
    resetPowerups(this.#powerups);
  }

  /**
   * End the clocks without forgetting the run.
   *
   * A run ends with its effects over, but the coins and the kills it earned are the run's
   * record and have to stay readable for the summary, so this stops the timers and leaves
   * the wallet alone.
   */
  clearPowerups() {
    resetPowerups(this.#powerups);
  }

  /** A stable view for telemetry. Same objects every call. */
  snapshot() {
    this.#snapshot.coins = this.#coins;
    this.#snapshot.powerupRemaining = this.#powerups.slots.reduce(
      (most, slot) => (slot.active ? Math.max(most, slot.remaining) : most),
      0,
    );
    return this.#snapshot;
  }
}
