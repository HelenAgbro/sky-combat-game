/**
 * Sky Combat — environmental hazards.
 *
 * Tethered balloons, drifting in the flight path: a bright, unmistakable thing to fly
 * around rather than into. They are placed ahead of the player on the same recycled-grid
 * principle as everything else, so they appear where the player is going and are given
 * back once they are behind.
 *
 * The collision volume is a sphere around the envelope. Simple, generous, and impossible
 * to slip through at speed — which is what a hazard needs to be.
 */
import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { mergeStaticParts } from '../assets/mergeStaticParts.js';
import { COMBAT } from '../game/config.js';
import { createSeededRandom } from '../game/math.js';
import { Pool } from './Pool.js';
import { chooseSpawnPoint } from './spawn.js';

/** How far behind the player, or how far away, a hazard is recycled. */
const DESPAWN_BEHIND = 1300;
const DESPAWN_RANGE = 3800;

export class Obstacles {
  #group;
  #pool;
  #prototype = null;
  #disposables = [];
  #random;
  #config;
  #timer = 0;
  #ceiling = 0;
  #spawned = 0;

  constructor({ preset, config = COMBAT.obstacles, seed = 8641 }) {
    this.#config = config;
    this.#random = createSeededRandom(seed);

    this.#group = new Group();
    this.#group.name = 'obstacles';

    const capacity = Math.max(0, preset.obstacles ?? 12);

    this.#pool = new Pool({
      capacity,
      create: () => ({
        model: null,
        position: new Vector3(),
        anchorY: 0,
        age: 0,
        phase: 0,
        drift: 0,
        radius: config.radius,
      }),
    });

    this.#prototype = this.#buildPrototype();
    for (let i = 0; i < this.#pool.items.length; i += 1) {
      const obstacle = this.#pool.items[i];
      obstacle.model = this.#prototype.clone();
      obstacle.model.visible = false;
      this.#group.add(obstacle.model);
    }

    this.setPreset(preset);
  }

  get group() {
    return this.#group;
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

  /** How many have been placed since construction. Read by the tests. */
  get spawned() {
    return this.#spawned;
  }

  setPreset(preset) {
    this.#ceiling = Math.min(this.#pool.capacity, preset.obstacles ?? this.#pool.capacity);
  }

  /** Clear every hazard and restart the placement timer. */
  reset() {
    this.releaseAll();
    this.#timer = this.#config.firstSpawn;
  }

  /** One balloon, merged down to one mesh per material and cloned per slot. */
  #buildPrototype() {
    const envelope = new MeshStandardMaterial({
      color: new Color('#d9502a'),
      roughness: 0.62,
      metalness: 0.05,
      envMapIntensity: 0.7,
    });
    const band = new MeshStandardMaterial({
      color: new Color('#f2ece0'),
      roughness: 0.7,
      metalness: 0.02,
      envMapIntensity: 0.6,
    });
    const rig = new MeshStandardMaterial({
      color: new Color('#3d2f22'),
      roughness: 0.85,
      metalness: 0.05,
    });
    this.#disposables.push(envelope, band, rig);

    const radius = this.#config.envelopeRadius;
    const parts = new Group();
    parts.name = 'balloon';

    // The envelope, a little taller than it is wide.
    const balloon = new SphereGeometry(radius, 18, 12);
    balloon.scale(1, 1.12, 1);
    parts.add(new Mesh(balloon, envelope));

    // A warning band around its middle.
    const ring = new TorusGeometry(radius * 0.985, radius * 0.09, 6, 20);
    ring.rotateX(Math.PI / 2);
    parts.add(new Mesh(ring, band));

    // The basket, and the cable holding it down.
    const basket = new BoxGeometry(radius * 0.26, radius * 0.2, radius * 0.26);
    basket.translate(0, -radius * 1.5, 0);
    parts.add(new Mesh(basket, rig));

    const cable = new CylinderGeometry(0.16, 0.16, radius * 4.2, 4);
    cable.translate(0, -radius * 3.6, 0);
    parts.add(new Mesh(cable, rig));

    return mergeStaticParts(parts);
  }

  /** Put a hazard in the air ahead of the player. */
  spawn(player) {
    if (this.#pool.activeCount >= this.#ceiling) return null;

    const obstacle = this.#pool.acquire();
    if (!obstacle) return null;

    chooseSpawnPoint(this.#random, player, this.#config, obstacle.position);
    obstacle.anchorY = obstacle.position.y;
    obstacle.age = 0;
    obstacle.phase = this.#random() * Math.PI * 2;
    obstacle.drift = (this.#random() - 0.5) * 2.4;
    obstacle.model.visible = true;
    obstacle.model.position.copy(obstacle.position);
    this.#spawned += 1;
    return obstacle;
  }

  release(obstacle) {
    if (!obstacle?.active) return;
    obstacle.model.visible = false;
    this.#pool.release(obstacle);
  }

  releaseAll() {
    for (let i = this.#pool.active.length - 1; i >= 0; i -= 1) this.release(this.#pool.active[i]);
  }

  /**
   * Place new hazards on a timer, bob the live ones, and recycle the ones behind.
   *
   * The cadence is handed in by the fight rather than read from config, because it is part of
   * the run's difficulty ramp: the same rule that makes enemies arrive sooner makes hazards
   * arrive sooner, and there is no second timer to keep in step.
   *
   * @param {number} dt seconds
   * @param {{position:object, forward:object, right:object}} player
   * @param {number} spawnInterval seconds between placements
   */
  update(dt, player, spawnInterval) {
    this.#timer -= dt;
    if (this.#timer <= 0) {
      // A ramp value of zero would place a balloon a frame; a missing one waits the opening
      // interval again rather than guessing at a cadence.
      this.#timer = Number.isFinite(spawnInterval) && spawnInterval > 0
        ? spawnInterval
        : this.#config.firstSpawn;
      this.spawn(player);
    }

    const forward = player.forward;
    const originX = player.position.x;
    const originZ = player.position.z;

    this.#pool.forEachActive((obstacle) => {
      obstacle.age += dt;
      // A slow bob and drift, so a hazard reads as a thing in the air rather than a marker
      // pinned to the sky.
      obstacle.position.y = obstacle.anchorY + Math.sin(obstacle.age * 0.6 + obstacle.phase) * 3;
      obstacle.position.x += Math.sin(obstacle.age * 0.21 + obstacle.phase) * obstacle.drift * dt;
      obstacle.position.z += Math.cos(obstacle.age * 0.17 + obstacle.phase) * obstacle.drift * dt;
      obstacle.model.position.copy(obstacle.position);
      obstacle.model.rotation.y += dt * 0.06;

      const dx = obstacle.position.x - originX;
      const dz = obstacle.position.z - originZ;
      const dy = obstacle.position.y - player.position.y;

      if (obstacle.age > this.#config.lifespan) {
        this.release(obstacle);
        return;
      }
      if (dx * dx + dy * dy + dz * dz > DESPAWN_RANGE * DESPAWN_RANGE) {
        this.release(obstacle);
        return;
      }
      if (dx * forward.x + dz * forward.z < -DESPAWN_BEHIND) this.release(obstacle);
    });
  }

  dispose() {
    this.#prototype?.traverse((child) => child.geometry?.dispose());
    this.#prototype = null;
    for (const disposable of this.#disposables) disposable?.dispose?.();
    this.#disposables.length = 0;
    this.#group.clear();
  }
}
