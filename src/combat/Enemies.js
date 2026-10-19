/**
 * Sky Combat — the enemy aircraft.
 *
 * A fixed pool of enemy slots. Each slot owns a model built once at start-up, and spawning
 * is switching it on and pointing it somewhere: nothing is created or destroyed while the
 * game runs.
 *
 * Enemies fly patterns rather than a flight model (see `combat/motion.js`). They steer
 * toward a target heading at a fixed rate, bank into the turn, and are recycled once they
 * are far enough behind the player that nothing about them can be seen.
 */
import {
  Color,
  Group,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Vector2,
  Vector3,
} from 'three';
import { mergeStaticParts } from '../assets/mergeStaticParts.js';
import { buildFighter } from '../assets/models/Fighter.js';
import { createPaintTextureSet } from '../assets/textures.js';
import { ENEMIES } from '../data/enemies.js';
import { BOUNDS, COMBAT } from '../game/config.js';
import { clamp, createSeededRandom, radialDistance } from '../game/math.js';
import { PATTERNS, bearingTo, orientationFrom, steerAngle } from './motion.js';
import { Pool } from './Pool.js';
import { chooseSpawnPoint } from './spawn.js';

/** Enemies are seen at range, so their paint maps are half the size of the player's. */
const ENEMY_TEXTURE_SIZE = 512;

/** How far behind the player, or how far away, an enemy is recycled. */
const DESPAWN_BEHIND = 1700;
const DESPAWN_RANGE = 3400;
const DESPAWN_AGE = 45;

const _forward = new Vector3();
const _target = { heading: 0, climb: 0, speed: 1 };
const _bearing = { heading: 0, range: 0, climb: 0 };

export class Enemies {
  #group;
  #pool;
  #prototypes = new Map();
  #disposables = [];
  #random;
  #config;
  #ceiling = 0;
  #context = { position: null, forward: null };

  constructor({ scene, preset, config = COMBAT.enemies, seed = 20261 }) {
    this.#config = config;
    this.#random = createSeededRandom(seed);

    this.#group = new Group();
    this.#group.name = 'enemies';

    const capacity = Math.min(config.hardCap, preset.enemies ?? config.hardCap);

    this.#pool = new Pool({
      capacity,
      create: () => ({
        type: ENEMIES[0],
        model: null,
        position: new Vector3(),
        previousPosition: new Vector3(),
        heading: 0,
        climb: 0,
        bank: 0,
        baseHeading: 0,
        phase: 0,
        age: 0,
        integrity: 0,
        fireCooldown: 0,
        pattern: 'patrol',
        speed: 90,
        turnRate: 0.6,
        radius: config.radius,
      }),
    });

    // One model per slot, cloned from a shared prototype per type so every enemy of a type
    // shares its geometry and its materials.
    for (let i = 0; i < this.#pool.items.length; i += 1) {
      const enemy = this.#pool.items[i];
      const type = ENEMIES[i % ENEMIES.length];
      enemy.type = type;
      enemy.model = this.#prototype(type).clone();
      enemy.model.name = `enemy:${type.id}`;
      enemy.model.visible = false;
      this.#group.add(enemy.model);
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

  /**
   * Put an enemy in the air ahead of the player.
   *
   * @param {{position:object, forward:object, right:object}} player
   * @returns {object|null} the enemy, or null when the pool or the ceiling is full
   */
  spawn(player) {
    if (this.#pool.activeCount >= this.#ceiling) return null;

    const enemy = this.#pool.acquire();
    if (!enemy) return null;

    chooseSpawnPoint(this.#random, player, this.#config, enemy.position);
    enemy.previousPosition.copy(enemy.position);

    /*
     * Point them across the player's path rather than straight down it. A head-on enemy
     * closes at two hundred metres a second and gives the player nothing to aim at; one
     * crossing the view is a fight.
     */
    const bearing = bearingTo(enemy.position, player.position, _bearing);
    const crossing = (this.#random() < 0.5 ? -1 : 1) * (0.9 + this.#random() * 0.6);
    enemy.baseHeading = bearing.heading + crossing;
    enemy.heading = enemy.baseHeading;
    enemy.climb = 0;
    enemy.bank = 0;
    enemy.phase = this.#random() * Math.PI * 2;
    enemy.age = 0;
    enemy.integrity = this.#config.integrity;
    enemy.fireCooldown = this.#config.fireInterval * (0.5 + this.#random());
    enemy.pattern = enemy.type.pattern;
    enemy.speed = enemy.type.speed;
    enemy.turnRate = enemy.type.turnRate;

    enemy.model.visible = true;
    enemy.model.position.copy(enemy.position);
    orientationFrom(enemy.heading, 0, 0, enemy.model.quaternion);

    return enemy;
  }

  /** Take an enemy out of the world. */
  release(enemy) {
    if (!enemy?.active) return;
    enemy.model.visible = false;
    this.#pool.release(enemy);
  }

  releaseAll() {
    for (let i = this.#pool.active.length - 1; i >= 0; i -= 1) this.release(this.#pool.active[i]);
  }

  /**
   * Fly every enemy one step.
   *
   * @param {number} dt seconds
   * @param {object} player the player's controller, for position and heading
   * @param {number} speedScale the difficulty ramp's multiplier
   */
  update(dt, player, speedScale = 1) {
    const context = this.#context;
    context.position = player.position;
    context.forward = player.forward;

    this.#pool.forEachActive((enemy) => {
      enemy.previousPosition.copy(enemy.position);
      enemy.age += dt;

      const pattern = PATTERNS[enemy.pattern] ?? PATTERNS.patrol;
      pattern(enemy, context, _target);

      const before = enemy.heading;
      enemy.heading = steerAngle(enemy.heading, _target.heading, enemy.turnRate, dt);
      enemy.climb = steerAngle(enemy.climb, _target.climb, enemy.turnRate * 0.55, dt);

      // Bank into the turn: a flat aircraft sliding sideways reads as broken, and this
      // costs one subtraction.
      const turn = clamp(((enemy.heading - before) / Math.max(1e-4, dt)) * 0.5, -0.9, 0.9);
      enemy.bank += (turn - enemy.bank) * Math.min(1, dt * 4);

      orientationFrom(enemy.heading, enemy.climb, enemy.bank, enemy.model.quaternion);
      _forward.set(0, 0, -1).applyQuaternion(enemy.model.quaternion);
      enemy.position.addScaledVector(_forward, enemy.speed * speedScale * dt);

      // Keep them inside the arena the player cannot leave, and inside the altitude band.
      const radius = radialDistance(enemy.position.x, enemy.position.z);
      if (radius > BOUNDS.softRadius) {
        const pull = BOUNDS.softRadius / radius;
        enemy.position.x *= pull;
        enemy.position.z *= pull;
      }
      enemy.position.y = clamp(enemy.position.y, BOUNDS.minAltitude, BOUNDS.maxAltitude);

      enemy.model.position.copy(enemy.position);

      if (this.#shouldDespawn(enemy, player)) this.release(enemy);
    });
  }

  /** Is this enemy past the point where it can matter? */
  #shouldDespawn(enemy, player) {
    if (enemy.age > DESPAWN_AGE) return true;

    const dx = enemy.position.x - player.position.x;
    const dy = enemy.position.y - player.position.y;
    const dz = enemy.position.z - player.position.z;
    if (dx * dx + dy * dy + dz * dz > DESPAWN_RANGE * DESPAWN_RANGE) return true;

    const ahead = dx * player.forward.x + dz * player.forward.z;
    return ahead < -DESPAWN_BEHIND;
  }

  dispose() {
    for (const prototype of this.#prototypes.values()) {
      prototype.traverse((child) => child.geometry?.dispose());
    }
    this.#prototypes.clear();
    for (const disposable of this.#disposables) disposable?.dispose?.();
    this.#disposables.length = 0;
    this.#group.clear();
  }

  /** The quality tier's ceiling on how many enemies may be alive at once. */
  setPreset(preset) {
    this.#ceiling = Math.min(this.#pool.capacity, preset.enemies ?? this.#pool.capacity);
  }

  /** Build (once per type) a merged model and the materials it shares. */
  #prototype(type) {
    let prototype = this.#prototypes.get(type.id);
    if (prototype) return prototype;

    const materials = this.#createMaterials(type);
    const built = buildFighter({ ...type.shape, name: `enemy:${type.id}` }, materials);
    prototype = mergeStaticParts(built);
    prototype.userData = {};
    this.#prototypes.set(type.id, prototype);
    return prototype;
  }

  /** A small, cheap material set: one painted surface plus the dark and glowing parts. */
  #createMaterials(type) {
    const paint = createPaintTextureSet(type.livery, {
      seed: 500 + type.id.length * 17,
      markings: false,
      size: ENEMY_TEXTURE_SIZE,
    });
    for (const texture of Object.values(paint)) this.#disposables.push(texture);

    const painted = new MeshPhysicalMaterial({
      map: paint.map,
      roughnessMap: paint.roughnessMap,
      normalMap: paint.normalMap,
      normalScale: new Vector2(0.4, 0.4),
      metalness: 0.14,
      roughness: 0.6,
      clearcoat: 0.22,
      clearcoatRoughness: 0.35,
      envMapIntensity: 0.85,
    });

    const dark = new MeshStandardMaterial({
      color: new Color(type.livery.dark),
      metalness: 0.3,
      roughness: 0.6,
      envMapIntensity: 0.7,
    });

    const glass = new MeshPhysicalMaterial({
      color: new Color(type.livery.glass),
      metalness: 0.1,
      roughness: 0.1,
      clearcoat: 1,
      clearcoatRoughness: 0.05,
      envMapIntensity: 1.1,
    });

    const nozzleGlow = new MeshStandardMaterial({
      color: new Color('#241512'),
      emissive: new Color(type.livery.accent),
      emissiveIntensity: 0.9,
      metalness: 0.8,
      roughness: 0.5,
    });

    /*
     * One painted material for the hull and the wings: an enemy is read at range, and one
     * texture set per type is already one too many. The navigation lights are not lit on
     * an enemy — they reuse the dark material and become small bumps.
     */
    this.#disposables.push(painted, dark, glass, nozzleGlow);
    return {
      fuselage: painted,
      skin: painted,
      dark,
      trim: dark,
      navRed: dark,
      navGreen: dark,
      navWhite: dark,
      glass,
      nozzleGlow,
    };
}

  }
