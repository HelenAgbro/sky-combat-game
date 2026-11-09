/**
 * Sky Combat — laser beams.
 *
 * A laser is hitscan, so it has no projectile to show: damage lands the moment the trigger
 * closes. The visual is a pool of two-point additive lines, one per in-flight beam, drawn
 * from the muzzle to the hit point and faded out over a fraction of a second. Pooled like
 * everything else in the fight, so a long laser run costs the same as a short one.
 */
import {
  AdditiveBlending,
  BufferGeometry,
  Group,
  Line,
  LineBasicMaterial,
  Vector3,
} from 'three';

const _from = new Vector3();
const _to = new Vector3();

export class Beams {
  #group;
  #material;
  #items = [];

  constructor({ capacity = 12, colour = '#7df9ff' } = {}) {
    this.#group = new Group();
    this.#group.name = 'laser-beams';

    this.#material = new LineBasicMaterial({
      color: colour,
      transparent: true,
      opacity: 0.95,
      blending: AdditiveBlending,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    });

    for (let i = 0; i < capacity; i += 1) {
      const geometry = new BufferGeometry().setFromPoints([
        _from.set(0, 0, 0),
        _to.set(0, 0, -1),
      ]);
      const line = new Line(geometry, this.#material);
      line.visible = false;
      line.renderOrder = 5;
      line.frustumCulled = false;
      this.#group.add(line);
      this.#items.push({ line, geometry, age: 0, life: 0, active: false });
    }
  }

  get group() {
    return this.#group;
  }

  /**
   * Draw a beam for one laser shot.
   *
   * @param {Vector3} from muzzle
   * @param {Vector3} to hit point (or end of range)
   * @param {{life?:number}} [options]
   */
  spawn(from, to, { life = 0.1 } = {}) {
    const beam = this.#items.find((item) => !item.active);
    if (!beam) return null;

    beam.geometry.setFromPoints([_from.copy(from), _to.copy(to)]);
    beam.line.visible = true;
    beam.age = 0;
    beam.life = Math.max(0.02, life);
    beam.active = true;
    return beam;
  }

  /** Age every beam and hide the ones that are spent. */
  update(dt) {
    for (const beam of this.#items) {
      if (!beam.active) continue;
      beam.age += dt;
      if (beam.age >= beam.life) {
        beam.active = false;
        beam.line.visible = false;
      }
    }
  }

  releaseAll() {
    for (const beam of this.#items) {
      beam.active = false;
      beam.line.visible = false;
    }
  }

  dispose() {
    for (const beam of this.#items) beam.geometry.dispose();
    this.#material.dispose();
    this.#group.clear();
  }
}