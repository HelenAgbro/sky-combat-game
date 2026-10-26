/**
 * Sky Combat — the arcade flight model.
 *
 * Deliberately not a flight simulator: the aircraft has a throttle, a pitch, a
 * roll and a rudder, it banks into turns, and it levels itself when the stick is
 * centred. Everything here is pure maths over a position and a quaternion, with
 * no renderer, no DOM and no allocation inside the loop, so it can be simulated
 * headlessly in the unit tests.
 */
import { Euler, Quaternion, Vector3 } from 'three';
import { BOUNDS, FLIGHT } from '../game/config.js';
import { clamp, headingError, radialDistance } from '../game/math.js';
import { burnFuel } from '../run/fuel.js';

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

const clamp01 = (value) => clamp(value, 0, 1);

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
    /**
     * A multiplier on the aircraft's speed ceiling, set by the speed-boost power-up and put
     * back to 1 when it expires or a run starts. It lives here rather than in the run state
     * because it is a property of the airframe's performance, not of the collection.
     */
    this.speedScale = 1;
    this.elapsed = 0;
    this.distance = 0;
    this.input = { ...NEUTRAL_INPUT };
    this.attributeScale = scaleFromAttributes(attributes);
    /** Which flight-area limit, if any, the aircraft is currently against. */
    this.boundary = 'clear';
    this.boundaryUrgency = 0;
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
    // Nothing a power-up did to the airframe survives into the next run.
    this.speedScale = 1;
    this.elapsed = 0;
    this.distance = 0;
    this.input = { ...NEUTRAL_INPUT };
    this.boundary = 'clear';
    this.boundaryUrgency = 0;
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

    const ceiling =
      FLIGHT.maxSpeed * scale.speed * (input.boost ? FLIGHT.boostMultiplier : 1) * this.speedScale;
    const targetSpeed = FLIGHT.minSpeed + (ceiling - FLIGHT.minSpeed) * this.throttle;
    this.speed += (targetSpeed - this.speed) * Math.min(1, FLIGHT.speedResponse * dt);

    /*
     * Body-frame rotation: pitch about X, rudder about Y, roll about Z.
     *
     * The rudder is negated. A positive rotation about the local +Y axis swings the
     * nose to the left, while the control mapping promises that `yaw: 1` is a turn to
     * the right — measured, not assumed: with the sign the other way, holding E turned
     * the aircraft the wrong way.
     */
    _euler.set(
      clamp(input.pitch ?? 0, -1, 1) * FLIGHT.pitchRate * agility * dt,
      -clamp(input.yaw ?? 0, -1, 1) * FLIGHT.yawRate * agility * dt,
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

    this.boundary = this.#applyBoundaries(dt, _forward);

    // Fuel: opened throttle burns more, boost burns far more, and a thirsty airframe empties
    // sooner. The rule itself lives in `run/fuel.js`, which is unit tested.
    this.fuel = burnFuel(this.fuel, dt, input, FLIGHT, scale.fuel);

    this.distance += this.speed * dt;
    this.elapsed += dt;
  }

  /**
   * Keep the flight inside the play area.
   *
   * The floor, the ceiling and the outer wall all work by *turning the aircraft*
   * rather than teleporting it: an invisible wall that simply stopped it would read
   * as a bug, whereas a nudge on the nose reads as the edge of the combat area. A
   * hard clamp is kept as the last resort, and the state is reported so the
   * interface can warn the player.
   *
   * @returns {'clear'|'altitude'|'edge'} which limit, if any, is being pushed against
   */
  #applyBoundaries(dt, forward) {
    let boundary = 'clear';
    let urgency = 0;

    const lowUrgency = clamp01(
      (BOUNDS.minAltitude + BOUNDS.altitudeBand - this.position.y) / BOUNDS.altitudeBand,
    );
    const highUrgency = clamp01(
      (this.position.y - (BOUNDS.maxAltitude - BOUNDS.altitudeBand)) / BOUNDS.altitudeBand,
    );
    const altitudeUrgency = Math.max(lowUrgency, highUrgency);

    if (altitudeUrgency > 0) {
      boundary = 'altitude';
      urgency = altitudeUrgency;
      // A positive pitch raises the nose, so the floor pitches up and the ceiling down.
      const direction = lowUrgency >= highUrgency ? 1 : -1;
      _euler.set(direction * altitudeUrgency * BOUNDS.correctionRate * dt, 0, 0, 'XYZ');
      this.quaternion.multiply(_spin.setFromEuler(_euler));
      this.position.y = clamp(this.position.y, BOUNDS.minAltitude, BOUNDS.maxAltitude);
    }

    const radius = radialDistance(this.position.x, this.position.z);
    if (radius > BOUNDS.softRadius) {
      boundary = 'edge';
      const edgeUrgency = clamp01((radius - BOUNDS.softRadius) / (BOUNDS.hardRadius - BOUNDS.softRadius));
      urgency = Math.max(urgency, edgeUrgency);

      // Steer back toward the middle of the area, in proportion to how far out we are.
      const error = headingError(forward.x, forward.z, -this.position.x / radius, -this.position.z / radius);
      this.quaternion.premultiply(
        _worldSpin.setFromAxisAngle(WORLD_UP, clamp(error, -1, 1) * BOUNDS.correctionRate * edgeUrgency * dt),
      );

      if (radius > BOUNDS.hardRadius) {
        const pull = BOUNDS.hardRadius / radius;
        this.position.x *= pull;
        this.position.z *= pull;
      }
    }

    this.boundaryUrgency = urgency;
    return boundary;
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
      pitch: Math.asin(clamp(LOCAL_FORWARD.clone().applyQuaternion(this.quaternion).y, -1, 1)),
      radius: radialDistance(this.position.x, this.position.z),
      elapsed: this.elapsed,
      boundary: this.boundary,
      boundaryUrgency: this.boundaryUrgency,
    };
  }
}
