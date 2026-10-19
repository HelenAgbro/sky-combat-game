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
import { SURFACE_RATE, surfaceAngles } from './surfaces.js';
import { damp } from '../game/math.js';

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

    /**
     * The moving surfaces of the airframe, if it has any. A packed model brings its
     * own; a model with no control surfaces simply gets nothing to move.
     */
    this.surfaces = model.userData?.surfaces ?? null;
    this.surfaceState = { stabilator: 0, flaperon: 0, rudder: 0 };

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
   * Animate the engine glow and the control surfaces. Called once per rendered frame,
   * not per simulation step, so the flicker stays even when several steps run in one
   * frame.
   */
  updateEffects(dt) {
    this.effects?.update?.(this.controller.throttle, this.controller.input.boost, dt);
    this.updateSurfaces(dt);
  }

  /**
   * Deflect the stabilators, flaperons and rudder toward the commanded angles.
   *
   * Damped rather than snapped: an actuator takes a moment to reach full deflection,
   * and a surface that jumps to its stop reads as a glitch. The rate is exponential and
   * time-based for the same reason the camera damping is — the surfaces must move at
   * the same speed at 30 fps and at 240.
   */
  updateSurfaces(dt) {
    if (!this.surfaces) return;

    const target = surfaceAngles(this.controller.input);
    const state = this.surfaceState;
    state.stabilator = damp(state.stabilator, target.stabilator, SURFACE_RATE, dt);
    state.flaperon = damp(state.flaperon, target.flaperon, SURFACE_RATE, dt);
    state.rudder = damp(state.rudder, target.rudder, SURFACE_RATE, dt);

    const { stabilator, flaperon, rudder } = this.surfaces;
    stabilator.right.rotation.x = state.stabilator;
    stabilator.left.rotation.x = state.stabilator;

    // Differential: the wing that should rise drops its flaperon, the other raises it.
    flaperon.right.rotation.x = -state.flaperon;
    flaperon.left.rotation.x = state.flaperon;

    for (const surface of rudder) surface.rotation.y = state.rudder;
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
