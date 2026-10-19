/**
 * Sky Combat — the arcade flight model.
 *
 * Deliberately not a flight simulator: the aircraft has a throttle, a pitch, a
 * roll and a rudder, it banks into turns, and it levels itself when the stick is
 * centred. Everything here is pure maths over a position and a quaternion, with
 * no renderer, no DOM and no allocation inside the loop, so it can be simulated
 * headlessly in the unit tests.
 */
import { Euler, MathUtils, Quaternion, Vector3 } from 'three';
import { FLIGHT, WORLD } from '../game/config.js';

export const NEUTRAL_INPUT = Object.freeze({
  pitch: 0,
  roll: 0,
  yaw: 0,
  throttle: 0.6,
  boost: false,
});

const WORLD_UP = new Vector3(0, 1, 0);
const LOCAL_FORWARD = new Vector3(0, 0, -1);
const LOCAL_RIGHT = new Vector3(1, 0, 0);
const LOCAL_UP = new Vector3(0, 1, 0);

// Scratch objects, reused every step so the loop never allocates.
const _euler = new Euler();
const _spin = new Quaternion();
const _worldSpin = new Quaternion();
const _forward = new Vector3();
const _right = new Vector3();
const _up = new Vector3();

const clamp = (value, min, max) => MathUtils.clamp(value, min, max);
const wrap = (value, radius) => (value > radius ? value - radius * 2 : value < -radius ? value + radius * 2 : value);

/** Turn 0–10 hangar ratings into multipliers. */
export function scaleFromAttributes({ speed = 5, agility = 5, fuel = 5 } = {}) {
  return {
    speed: 0.86 + (speed / 10) * 0.34,
    agility: 0.8 + (agility / 10) * 0.5,
    fuel: 0.85 + (fuel / 10) * 0.5,
  };
}

export class AircraftController {
  constructor({ attributes = {}, position = null } = {}) {
    this.position = position ? position.clone() : new Vector3(0, FLIGHT.startAltitude, 0);
    this.quaternion = new Quaternion();
    /**
     * The state at the end of the previous step. The renderer interpolates between
     * these two states, so the aircraft moves smoothly on a display that refreshes
     * faster — or more irregularly — than the fixed 60 Hz simulation.
     */
    this.previousPosition = this.position.clone();
    this.previousQuaternion = new Quaternion();
    this.speed = FLIGHT.cruiseSpeed;
    this.throttle = 0.6;
    this.fuel = 1;
    this.elapsed = 0;
    this.distance = 0;
    this.input = { ...NEUTRAL_INPUT };
    this.attributeScale = scaleFromAttributes(attributes);
  }

  /** Where the nose points. */
  get forward() {
    return _forward.copy(LOCAL_FORWARD).applyQuaternion(this.quaternion).clone();
  }

  get right() {
    return _right.copy(LOCAL_RIGHT).applyQuaternion(this.quaternion).clone();
  }

  get up() {
    return _up.copy(LOCAL_UP).applyQuaternion(this.quaternion).clone();
  }

  get altitude() {
    return this.position.y;
  }

  /**
   * Roll relative to the horizon: negative means the right wing is down.
   * Used for the auto-level correction and the banked turn.
   */
  get bankAngle() {
    _right.copy(LOCAL_RIGHT).applyQuaternion(this.quaternion);
    _up.copy(LOCAL_UP).applyQuaternion(this.quaternion);
    return Math.atan2(_right.y, _up.y);
  }

  /** Update only the fields present in `partial`, so systems can share one input. */
  setInput(partial) {
    Object.assign(this.input, partial);
  }

  reset({ position = null, altitude = FLIGHT.startAltitude } = {}) {
    this.position.set(0, altitude, 0);
    if (position) this.position.copy(position);
    this.quaternion.identity();
    // Keep the interpolation history consistent, or the first rendered frame jumps.
    this.previousPosition.copy(this.position);
    this.previousQuaternion.copy(this.quaternion);
    this.speed = FLIGHT.cruiseSpeed;
    this.throttle = 0.6;
    this.fuel = 1;
    this.elapsed = 0;
    this.distance = 0;
    this.input = { ...NEUTRAL_INPUT };
  }

  /** Advance the aircraft by one fixed step. */
  step(dt) {
    // Remember where this step started, so the renderer can interpolate across it.
    this.previousPosition.copy(this.position);
    this.previousQuaternion.copy(this.quaternion);

    const { input } = this;
    const scale = this.attributeScale;
    const agility = scale.agility;

    // Throttle eases toward the requested setting.
    const requested = clamp(input.throttle ?? this.throttle, 0, 1);
    this.throttle += (requested - this.throttle) * Math.min(1, FLIGHT.throttleRate * 2 * dt);

    const ceiling = FLIGHT.maxSpeed * scale.speed * (input.boost ? FLIGHT.boostMultiplier : 1);
    const targetSpeed = FLIGHT.minSpeed + (ceiling - FLIGHT.minSpeed) * this.throttle;
    this.speed += (targetSpeed - this.speed) * Math.min(1, FLIGHT.speedResponse * dt);

    // Body-frame rotation: pitch about X, rudder about Y, roll about Z.
    _euler.set(
      clamp(input.pitch ?? 0, -1, 1) * FLIGHT.pitchRate * agility * dt,
      clamp(input.yaw ?? 0, -1, 1) * FLIGHT.yawRate * agility * dt,
      -clamp(input.roll ?? 0, -1, 1) * FLIGHT.rollRate * agility * dt,
      'XYZ',
    );
    this.quaternion.multiply(_spin.setFromEuler(_euler));

    // Banked turn: a banked aircraft turns, whether or not the rudder is used.
    const bank = this.bankAngle;
    const turn = bank * FLIGHT.bankTurnGain * (this.speed / (FLIGHT.maxSpeed * scale.speed));
    if (Math.abs(turn) > 1e-5) {
      this.quaternion.premultiply(_worldSpin.setFromAxisAngle(WORLD_UP, turn * dt));
    }

    // Auto-level: with the stick centred, ease back to wings-level.
    if (Math.abs(input.roll ?? 0) < 0.05 && Math.abs(bank) > 0.002) {
      _euler.set(0, 0, clamp(-bank, -1, 1) * FLIGHT.autoLevelRate * dt, 'XYZ');
      this.quaternion.multiply(_spin.setFromEuler(_euler));
    }

    this.quaternion.normalize();

    // Integrate the flight path.
    _forward.copy(LOCAL_FORWARD).applyQuaternion(this.quaternion);
    this.position.addScaledVector(_forward, this.speed * dt);
    this.position.x = wrap(this.position.x, WORLD.wrapRadius);
    this.position.z = wrap(this.position.z, WORLD.wrapRadius);

    // Fuel burn: idle burns less than full throttle, and boost burns far more.
    const burn =
      (FLIGHT.fuelBurnPerSecond *
        (0.45 + this.throttle * 0.55) *
        (input.boost ? FLIGHT.boostBurnMultiplier : 1)) /
      scale.fuel;
    this.fuel = clamp(this.fuel - burn * dt, 0, 1);

    this.distance += this.speed * dt;
    this.elapsed += dt;
  }

  /** A snapshot for the HUD, the results screen and the tests. */
  telemetry() {
    return {
      speed: this.speed,
      throttle: this.throttle,
      fuel: this.fuel,
      distance: this.distance,
      altitude: this.altitude,
      bank: this.bankAngle,
      elapsed: this.elapsed,
    };
  }
}
