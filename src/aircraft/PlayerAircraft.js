/**
 * Sky Combat — the player's aircraft.
 *
 * Ties the flight model to the rendered model. The simulation runs on a fixed step,
 * so the rendered transform is interpolated between the last two simulation states
 * with `sync(alpha)`; without that, a display refreshing faster than 60 Hz shows the
 * aircraft holding one position for several frames and then jumping.
 *
 * `renderPosition`, `forward`, `up` and `right` are the interpolated values, and are
 * what the camera reads. They are updated in place, so nothing allocates per frame.
 */
import { Quaternion, Vector3 } from 'three';
import { AircraftController } from './AircraftController.js';

const LOCAL_FORWARD = new Vector3(0, 0, -1);
const LOCAL_RIGHT = new Vector3(1, 0, 0);
const LOCAL_UP = new Vector3(0, 1, 0);

export class PlayerAircraft {
  /**
   * @param {object} options
   * @param {object} options.aircraft definition from `data/aircraft.js`
   * @param {import('three').Group} options.model the built airframe
   * @param {'procedural'|'packed'} options.source which pipeline produced the model
   * @param {{update: Function, dispose: Function}|null} [options.effects] engine glow
   */
  constructor({ aircraft, model, source = 'procedural', effects = null }) {
    this.aircraft = aircraft;
    this.model = model;
    this.source = source;
    this.effects = effects;
    this.controller = new AircraftController({ attributes: aircraft.attributes });

    /** The interpolated transform, and the basis the camera follows. */
    this.renderPosition = new Vector3();
    this.renderQuaternion = new Quaternion();
    this.forward = new Vector3(0, 0, -1);
    this.right = new Vector3(1, 0, 0);
    this.up = new Vector3(0, 1, 0);

    this.model.name = `aircraft:${aircraft.id}`;
    this.sync(1);
  }

  get object3D() {
    return this.model;
  }

  /** The simulated (not interpolated) position. */
  get position() {
    return this.controller.position;
  }

  get quaternion() {
    return this.controller.quaternion;
  }

  /** Advance the simulation by one fixed step. Rendering happens in `sync`. */
  update(dt, input) {
    if (input) this.controller.setInput(input);
    this.controller.step(dt);
  }

  /**
   * Animate the engine glow. Called once per rendered frame, not per simulation
   * step, so the flicker stays even when several steps run in one frame.
   */
  updateEffects(dt) {
    this.effects?.update?.(this.controller.throttle, this.controller.input.boost, dt);
  }

  /** Reset to the start of a run, keeping the interpolation history consistent. */
  reset() {
    this.controller.reset();
    this.sync(1);
  }

  /**
   * Copy an interpolated transform onto the model and the camera basis.
   * @param {number} alpha how far this frame sits between the previous step and the
   *   current one: `accumulator / fixedStep`.
   */
  sync(alpha = 1) {
    const controller = this.controller;

    this.renderPosition.lerpVectors(controller.previousPosition, controller.position, alpha);
    this.renderQuaternion.slerpQuaternions(controller.previousQuaternion, controller.quaternion, alpha);

    this.model.position.copy(this.renderPosition);
    this.model.quaternion.copy(this.renderQuaternion);

    this.forward.copy(LOCAL_FORWARD).applyQuaternion(this.renderQuaternion);
    this.right.copy(LOCAL_RIGHT).applyQuaternion(this.renderQuaternion);
    this.up.copy(LOCAL_UP).applyQuaternion(this.renderQuaternion);
  }

  telemetry() {
    return {
      aircraft: this.aircraft.id,
      source: this.source,
      ...this.controller.telemetry(),
    };
  }
}
