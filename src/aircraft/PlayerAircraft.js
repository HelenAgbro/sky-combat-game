/**
 * Sky Combat — the player's aircraft.
 *
 * Ties the flight model to the rendered model and keeps them in step. The model's
 * transform is copied from the controller every frame; nothing else writes to it.
 */
import { AircraftController } from './AircraftController.js';

export class PlayerAircraft {
  /**
   * @param {object} options
   * @param {object} options.aircraft definition from `data/aircraft.js`
   * @param {import('three').Group} options.model the built airframe
   * @param {'procedural'|'packed'} options.source which pipeline produced the model
   */
  constructor({ aircraft, model, source = 'procedural' }) {
    this.aircraft = aircraft;
    this.model = model;
    this.source = source;
    this.controller = new AircraftController({ attributes: aircraft.attributes });
    this.model.name = `aircraft:${aircraft.id}`;
    this.sync();
  }

  get object3D() {
    return this.model;
  }

  get position() {
    return this.controller.position;
  }

  get quaternion() {
    return this.controller.quaternion;
  }

  /** Advance the aircraft and copy the result onto the model. */
  update(dt, input) {
    if (input) this.controller.setInput(input);
    this.controller.step(dt);
    this.sync();
  }

  /** Copy the simulated transform onto the rendered model. */
  sync() {
    this.model.position.copy(this.controller.position);
    this.model.quaternion.copy(this.controller.quaternion);
  }

  telemetry() {
    return {
      aircraft: this.aircraft.id,
      source: this.source,
      ...this.controller.telemetry(),
    };
  }
}
