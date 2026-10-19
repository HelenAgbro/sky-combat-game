/**
 * Sky Combat — aircraft effects.
 *
 * The engine glow: an additive plume and core out of each nozzle, plus a soft
 * sprite at the exit, all scaled by throttle and boosted by the afterburner. It is
 * deliberately cheap — two cones and one sprite per nozzle, no particles — because
 * the exhaust trail and the impact effects belong with the combat work.
 */
import {
  AdditiveBlending,
  Color,
  ConeGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  Sprite,
  SpriteMaterial,
} from 'three';
import { lengthToZ } from '../assets/models/Fighter.js';
import { createGlowTexture } from '../assets/textures.js';
import { clamp } from '../game/math.js';

export class EngineGlow {
  #group;
  #texture;
  #plumes = [];
  #cores = [];
  #sprites = [];
  #disposables = [];
  #time = 0;

  /**
   * @param {object} shape from `data/aircraft.js`
   * @param {{accent?: string}} [livery]
   */
  constructor(shape, livery = {}) {
    this.#group = new Group();
    this.#group.name = 'engine-glow';

    this.#texture = createGlowTexture();
    this.#disposables.push(this.#texture);

    const { nozzle } = shape;
    const exitZ = lengthToZ(shape, 1) + nozzle.length * 0.12;
    const offsetX = nozzle.radius * 0.85 + nozzle.spacing * 0.5;
    const y = -0.03 * shape.body.height;

    const outer = new Color('#ff7a2a');
    const inner = new Color('#cfe4ff');
    const glow = new Color(livery.accent ? '#ffd0a0' : '#ffb066');

    for (let i = 0; i < nozzle.count; i += 1) {
      const x = nozzle.count === 1 ? 0 : i === 0 ? -offsetX : offsetX;

      const plume = this.#cone(nozzle.radius * 0.85, nozzle.length * 2.4, outer, 0.3);
      plume.position.set(x, y, exitZ);
      this.#plumes.push(plume);
      this.#group.add(plume);

      const core = this.#cone(nozzle.radius * 0.42, nozzle.length * 1.5, inner, 0.5);
      core.position.set(x, y, exitZ);
      this.#cores.push(core);
      this.#group.add(core);

      const sprite = new Sprite(
        new SpriteMaterial({
          map: this.#texture,
          color: glow,
          blending: AdditiveBlending,
          transparent: true,
          depthWrite: false,
          opacity: 0.4,
        }),
      );
      sprite.position.set(x, y, exitZ);
      const base = nozzle.radius * 3.2;
      sprite.userData.base = base;
      sprite.scale.set(base, base, 1);
      this.#sprites.push(sprite);
      this.#disposables.push(sprite.material);
      this.#group.add(sprite);
    }
  }

  get group() {
    return this.#group;
  }

  /** A cone with its base at the local origin, pointing aft along +Z. */
  #cone(radius, length, color, opacity) {
    const geometry = new ConeGeometry(radius, length, 16, 1, true);
    geometry.rotateX(Math.PI / 2);
    geometry.translate(0, 0, length / 2);

    const material = new MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      blending: AdditiveBlending,
      depthWrite: false,
      side: DoubleSide,
      fog: false,
    });

    this.#disposables.push(geometry, material);
    return new Mesh(geometry, material);
  }

  /**
   * Scale the glow with the engine.
   * @param {number} throttle 0–1
   * @param {boolean} boost afterburner
   * @param {number} dt seconds
   */
  update(throttle, boost, dt) {
    this.#time += dt;
    const power = clamp(throttle, 0, 1) * (boost ? 1.75 : 1);

    // Two frequencies that do not divide into each other, so the flicker never
    // settles into a visible loop.
    const flicker = 0.9 + 0.1 * Math.sin(this.#time * 37.1) * Math.sin(this.#time * 11.3);

    const lengthScale = (0.3 + power * 1.05) * flicker;
    const radiusScale = 0.5 + power * 0.55;

    for (const plume of this.#plumes) {
      plume.scale.set(radiusScale, radiusScale, lengthScale);
      plume.material.opacity = clamp(0.14 + power * 0.4, 0, 0.75) * flicker;
    }
    for (const core of this.#cores) {
      core.scale.set(radiusScale * 0.9, radiusScale * 0.9, lengthScale * 0.6);
      core.material.opacity = clamp(0.18 + power * 0.6, 0, 0.9) * flicker;
    }
    for (const sprite of this.#sprites) {
      const scale = (sprite.userData.base ?? 1) * (0.6 + power * 0.7 * flicker);
      sprite.scale.set(scale, scale, 1);
      sprite.material.opacity = clamp(0.16 + power * 0.34, 0, 0.6) * flicker;
    }
  }

  dispose() {
    for (const disposable of this.#disposables) disposable.dispose?.();
    this.#disposables.length = 0;
    this.#plumes.length = 0;
    this.#cores.length = 0;
    this.#sprites.length = 0;
    this.#group.clear();
  }
}
