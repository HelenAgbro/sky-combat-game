/**
 * Sky Combat — the third-person chase camera.
 *
 * Sits behind and above the aircraft, follows its heading and pitch fully but
 * only part of its roll, so the horizon stays readable while the aircraft banks.
 * Position and rotation are both damped, which is what makes the camera feel
 * heavy and cinematic rather than glued to the model. The field of view widens
 * with speed as a sense-of-speed cue.
 */
import { MathUtils, Matrix4, Quaternion, Vector3 } from 'three';
import { CAMERA, FLIGHT, RENDER } from '../game/config.js';

const WORLD_UP = new Vector3(0, 1, 0);

// Scratch objects, reused every frame.
const _forward = new Vector3();
const _up = new Vector3();
const _right = new Vector3();
const _blendedUp = new Vector3();
const _desired = new Vector3();
const _lookAt = new Vector3();
const _velocity = new Vector3();
const _lookMatrix = new Matrix4();
const _targetQuaternion = new Quaternion();

const clamp = (value, min, max) => MathUtils.clamp(value, min, max);

export class CameraController {
  #camera;
  #positionDamping;
  #rotationDamping;
  #shake = 0;
  #ready = false;
  #lastFov = RENDER.fov;

  constructor(camera, { offset = CAMERA.offset, positionDamping = CAMERA.positionDamping, rotationDamping = CAMERA.rotationDamping } = {}) {
    this.#camera = camera;
    this.offset = new Vector3(offset.x, offset.y, offset.z);
    this.#positionDamping = positionDamping;
    this.#rotationDamping = rotationDamping;
  }

  /** Add a one-off camera shake, used for hits, boosts and explosions. */
  addShake(amount) {
    this.#shake = Math.min(CAMERA.maxShake, this.#shake + amount);
  }

  /** Place the camera immediately, with no easing. Used when a run starts. */
  snap(aircraft) {
    this.#composeDesired(aircraft);
    this.#camera.position.copy(_desired);
    this.#camera.up.copy(_blendedUp);
    this.#camera.lookAt(_lookAt);
    this.#ready = true;
  }

  /**
   * The camera's up vector: mostly level, with a limited amount of the aircraft's
   * roll mixed in. Clamping the roll is what stops the world appearing upside down
   * when the aircraft is inverted, and keeps the horizon readable while banking.
   */
  #composeUp(aircraft) {
    _up.copy(aircraft.controller.up);
    _right.copy(aircraft.controller.right);

    const roll = Math.atan2(_right.y, _up.y);
    const limited = clamp(-roll * CAMERA.rollFollow, -CAMERA.maxRoll, CAMERA.maxRoll);

    // A vertical climb or dive makes "up" meaningless; fall back to the world up.
    if (Math.abs(_forward.y) > 0.985) {
      _blendedUp.copy(WORLD_UP);
    } else {
      _blendedUp.copy(WORLD_UP).applyAxisAngle(_forward, limited);
    }
    _blendedUp.normalize();
  }

  /** Compute the ideal position and the look-at point for this frame. */
  #composeDesired(aircraft) {
    _forward.copy(aircraft.controller.forward);
    this.#composeUp(aircraft);

    _right.crossVectors(_forward, _blendedUp).normalize();
    _up.crossVectors(_right, _forward).normalize();

    _desired
      .copy(aircraft.position)
      .addScaledVector(_right, this.offset.x)
      .addScaledVector(_up, this.offset.y)
      .addScaledVector(_forward, -this.offset.z);

    _lookAt.copy(aircraft.position).addScaledVector(_forward, CAMERA.lookAhead);
  }

  update(dt, aircraft) {
    if (!this.#ready) {
      this.snap(aircraft);
      return;
    }

    this.#composeDesired(aircraft);

    // Damping alone would leave the camera trailing the aircraft by speed/damping
    // (about 16 m at full speed), which loses the intended framing. Adding the
    // velocity back cancels that steady-state lag while transients still ease.
    _velocity
      .copy(aircraft.controller.forward)
      .multiplyScalar(aircraft.controller.speed / this.#positionDamping);
    _desired.add(_velocity);

    const positionAlpha = 1 - Math.exp(-this.#positionDamping * dt);
    this.#camera.position.lerp(_desired, positionAlpha);

    // Shake decays quickly and never accumulates.
    if (this.#shake > 0.0005) {
      const magnitude = this.#shake;
      this.#camera.position.x += (Math.random() - 0.5) * magnitude;
      this.#camera.position.y += (Math.random() - 0.5) * magnitude;
      this.#shake = Math.max(0, this.#shake - dt * 1.6);
    }

    this.#camera.up.copy(_blendedUp);

    // A camera looks down its -Z axis. Matrix4.lookAt builds exactly that rotation;
    // Object3D.lookAt would point +Z at the target and face the camera backwards.
    _lookMatrix.lookAt(this.#camera.position, _lookAt, _blendedUp);
    _targetQuaternion.setFromRotationMatrix(_lookMatrix);

    const rotationAlpha = 1 - Math.exp(-this.#rotationDamping * dt);
    this.#camera.quaternion.slerp(_targetQuaternion, rotationAlpha);

    // Field of view widens with speed.
    const speedRange = FLIGHT.boostSpeed - FLIGHT.cruiseSpeed;
    const speedFactor = MathUtils.clamp((aircraft.controller.speed - FLIGHT.cruiseSpeed) / speedRange, -0.5, 1.4);
    const targetFov = RENDER.fov + speedFactor * CAMERA.fovSpeedGain * 60;
    this.#camera.fov += (targetFov - this.#camera.fov) * Math.min(1, 2.5 * dt);
    if (Math.abs(this.#camera.fov - this.#lastFov) > 0.05) {
      this.#camera.updateProjectionMatrix();
      this.#lastFov = this.#camera.fov;
    }
  }
}
