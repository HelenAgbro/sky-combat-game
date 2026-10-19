/**
 * Sky Combat — hit and destruction effects.
 *
 * One `InstancedMesh` of camera-facing additive cards, pooled. Every spark, every hit
 * flash and every puff of a destroyed aircraft is one instance of the same geometry with
 * its own size, colour and lifetime, so the whole of the fight's feedback costs one draw
 * call and nothing is allocated when something explodes.
 *
 * Restraint is the point: a hit is a small bright flash that is gone in a fifth of a
 * second, and a kill is two of them, slightly larger. No screen shake, no debris, no
 * lingering smoke.
 */
import {
  AdditiveBlending,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  InstancedMesh,
  MeshBasicMaterial,
  Object3D,
  PlaneGeometry,
  Vector3,
} from 'three';
import { createGlowTexture } from '../assets/textures.js';
import { Pool } from './Pool.js';

export class Impacts {
  #mesh;
  #geometry;
  #material;
  #texture;
  #pool;
  #dummy = new Object3D();
  #colour = new Color();

  constructor({ capacity = 32 } = {}) {
    this.#texture = createGlowTexture({ size: 128 });
    this.#geometry = new PlaneGeometry(1, 1);
    this.#material = new MeshBasicMaterial({
      map: this.#texture,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      side: DoubleSide,
      fog: false,
      toneMapped: false,
    });

    this.#mesh = new InstancedMesh(this.#geometry, this.#material, capacity);
    this.#mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.#mesh.frustumCulled = false;
    this.#mesh.name = 'impacts';
    this.#mesh.renderOrder = 6;

    this.#pool = new Pool({
      capacity,
      create: () => ({
        position: new Vector3(),
        colour: new Color(),
        age: 0,
        life: 0.2,
        size: 3,
        growth: 1.5,
      }),
    });

    // Allocate the per-instance colour buffer once, so it is never created mid-fight.
    for (let i = 0; i < capacity; i += 1) this.#mesh.setColorAt(i, this.#colour.setScalar(0));
    this.#mesh.instanceColor.needsUpdate = true;
    this.update(0, null);
  }

  get mesh() {
    return this.#mesh;
  }

  get activeCount() {
    return this.#pool.activeCount;
  }

  /**
   * Flash at a point.
   *
   * @param {Vector3} position
   * @param {{size?:number, colour?:string, life?:number, growth?:number}} [options]
   */
  spawn(position, { size = 3, colour = '#ffd9a0', life = 0.22, growth = 1.6 } = {}) {
    const impact = this.#pool.acquire();
    if (!impact) return null;

    impact.position.copy(position);
    impact.colour.set(colour);
    impact.age = 0;
    impact.life = life;
    impact.size = size;
    impact.growth = growth;
    return impact;
  }

  /**
   * Age every effect, then face them all at the camera.
   *
   * @param {number} dt seconds
   * @param {import('three').Camera|null} camera
   */
  update(dt, camera) {
    const items = this.#pool.items;

    for (let i = 0; i < items.length; i += 1) {
      const impact = items[i];
      if (!impact.active) continue;
      impact.age += dt;
      if (impact.age >= impact.life) this.#pool.release(impact);
    }

    for (let i = 0; i < items.length; i += 1) {
      const impact = items[i];
      if (!impact.active) {
        this.#dummy.scale.set(0, 0, 0);
        this.#dummy.updateMatrix();
        this.#mesh.setMatrixAt(i, this.#dummy.matrix);
        continue;
      }

      const t = impact.age / impact.life;
      const size = impact.size * (1 + impact.growth * t);
      this.#dummy.position.copy(impact.position);
      if (camera) this.#dummy.quaternion.copy(camera.quaternion);
      this.#dummy.scale.set(size, size, 1);
      this.#dummy.updateMatrix();
      this.#mesh.setMatrixAt(i, this.#dummy.matrix);

      // Additive blending means fading the colour to black is fading the effect out.
      const fade = 1 - t * t;
      this.#mesh.setColorAt(i, this.#colour.copy(impact.colour).multiplyScalar(fade));
    }

    this.#mesh.instanceMatrix.needsUpdate = true;
    this.#mesh.instanceColor.needsUpdate = true;
  }

  releaseAll() {
    this.#pool.releaseAll();
  }

  dispose() {
    this.#geometry.dispose();
    this.#material.dispose();
    this.#texture.dispose();
    this.#mesh.dispose();
  }
}
