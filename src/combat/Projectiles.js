/**
 * Sky Combat — projectiles.
 *
 * One `InstancedMesh` per side, so every shot the player or an enemy has in the air costs
 * one draw call in total rather than one each. The pool is fixed, and firing is writing
 * into an unused slot: nothing is created or destroyed while the game runs.
 *
 * A tracer is a short glowing rod oriented along its own velocity. That is the "visible
 * trail" — it needs no billboarding, no particles and no second draw call, and at 640 m/s
 * the rod reads as a streak rather than a dot.
 */
import {
  AdditiveBlending,
  CylinderGeometry,
  DynamicDrawUsage,
  InstancedMesh,
  MeshBasicMaterial,
  Object3D,
  Vector3,
} from 'three';
import { Pool } from './Pool.js';

/** The rod's own axis, which is what the velocity is aligned to. */
const AXIS = new Vector3(0, 0, 1);

export class Projectiles {
  #mesh;
  #geometry;
  #material;
  #pool;
  #dummy = new Object3D();
  #colour;

  /**
   * @param {{capacity:number, colour:string, name:string, radius?:number, length?:number}} options
   */
  constructor({ capacity, colour, name, radius = 0.09, length = 5.5 }) {
    this.#colour = colour;

    this.#geometry = new CylinderGeometry(radius, radius, length, 5, 1, true);
    // Lay the rod along +Z, which is the axis the velocity is aligned to.
    this.#geometry.rotateX(Math.PI / 2);

    this.#material = new MeshBasicMaterial({
      color: colour,
      transparent: true,
      opacity: 0.95,
      blending: AdditiveBlending,
      depthWrite: false,
      // Not fogged and not tone-mapped: a tracer is the thing being aimed, so it stays
      // the brightest thing in the frame however far away it is.
      fog: false,
      toneMapped: false,
    });

    this.#mesh = new InstancedMesh(this.#geometry, this.#material, capacity);
    this.#mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.#mesh.frustumCulled = false;
    this.#mesh.name = name;
    this.#mesh.renderOrder = 4;

    this.#pool = new Pool({
      capacity,
      create: () => ({
        position: new Vector3(),
        previous: new Vector3(),
        direction: new Vector3(0, 0, 1),
        speed: 0,
        age: 0,
        life: 0,
        scale: 1,
      }),
    });

    this.#writeMatrices();
  }

  get mesh() {
    return this.#mesh;
  }

  get active() {
    return this.#pool.active;
  }

  get activeCount() {
    return this.#pool.activeCount;
  }

  get capacity() {
    return this.#pool.capacity;
  }

  /**
   * Fire a shot.
   *
   * @param {Vector3} origin
   * @param {Vector3} direction unit vector
   * @param {number} speed metres per second
   * @param {number} life seconds
   * @param {number} [scale=1] how much longer the tracer is drawn — special ammunition is
   *   visibly heavier rather than only being stronger
   * @returns {object|null} the shot, or null when the pool is exhausted
   */
  fire(origin, direction, speed, life, scale = 1) {
    const shot = this.#pool.acquire();
    if (!shot) return null;

    shot.position.copy(origin);
    shot.previous.copy(origin);
    shot.direction.copy(direction);
    shot.speed = speed;
    shot.age = 0;
    shot.life = life;
    shot.scale = scale;
    return shot;
  }

  /** Recolour the tracers. Used when special ammunition is loaded and unloaded. */
  setColour(colour) {
    this.#material.color.set(colour);
  }

  release(shot) {
    this.#pool.release(shot);
  }

  releaseAll() {
    this.#pool.releaseAll();
    this.#writeMatrices();
  }

  /**
   * Integrate every shot one step and expire the ones that have run their course.
   *
   * `previous` is left holding where the shot was at the start of the step, which is what
   * the swept collision test needs.
   */
  update(dt) {
    const items = this.#pool.items;
    for (let i = 0; i < items.length; i += 1) {
      const shot = items[i];
      if (!shot.active) continue;

      shot.previous.copy(shot.position);
      shot.position.addScaledVector(shot.direction, shot.speed * dt);
      shot.age += dt;
      if (shot.age >= shot.life) this.#pool.release(shot);
    }

    this.#writeMatrices();
  }

  /** Point every live rod along its velocity; hide the rest. */
  #writeMatrices() {
    const items = this.#pool.items;
    for (let i = 0; i < items.length; i += 1) {
      const shot = items[i];
      if (shot.active) {
        this.#dummy.position.copy(shot.position);
        this.#dummy.quaternion.setFromUnitVectors(AXIS, shot.direction);
        // Length only: a heavier round is drawn longer, not fatter, so the pool's single
        // geometry still fits every shot.
        this.#dummy.scale.set(1, 1, shot.scale ?? 1);
      } else {
        this.#dummy.scale.set(0, 0, 0);
      }
      this.#dummy.updateMatrix();
      this.#mesh.setMatrixAt(i, this.#dummy.matrix);
    }
    this.#mesh.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this.#geometry.dispose();
    this.#material.dispose();
    this.#mesh.dispose();
  }
}
