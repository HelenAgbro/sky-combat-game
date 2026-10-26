/**
 * Sky Combat — coins, fuel and power-up pickups.
 *
 * Three pools in one module, because they are one system: all three are placed ahead of the
 * aircraft, all three are collected by flying through them, and all three are recycled the
 * same way. What differs is only how they look and what collecting one is worth.
 *
 * Everything is pooled. Coins are one `InstancedMesh` — a single draw call for every coin in
 * the sky — while fuel canisters and power-ups are a handful of cloned merged meshes, which
 * is cheap because there are at most eight and six of them respectively.
 *
 * Two rules keep a coin from being collected twice:
 *
 * 1. collection releases the coin *in the same call* that reports it, so the loop that
 *    credits the run and the loop that finds the next overlap cannot disagree;
 * 2. a released coin is inactive and invisible before the next iteration, so no second test
 *    in the same step can find it, and its slot cannot come back until the pool hands it
 *    out again.
 */
import {
  AdditiveBlending,
  Color,
  CylinderGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { mergeStaticParts } from '../assets/mergeStaticParts.js';
import { Pool } from '../combat/Pool.js';
import { spheresOverlap } from '../combat/collisions.js';
import { chooseSpawnPoint } from '../combat/spawn.js';
import { POWERUP_IDS, getPowerup } from '../data/powerups.js';
import { BOUNDS, RUN } from '../game/config.js';
import { clamp, createSeededRandom, radialDistance } from '../game/math.js';
import { MAX_PATTERN_COINS, choosePattern, writePattern } from './pickupLayout.js';

/** How big the aircraft is treated as, for collection. Wings count. */
export const PICKUP_PLAYER_RADIUS = 6;

/** Visual radius of a coin, in metres. Larger than a real coin, so it reads at distance. */
const COIN_RADIUS = 3.2;

/**
 * Height of the beacon over a fuel canister or a power-up, in metres.
 *
 * They are spawned up to 2.2 km ahead, where a seven-metre canister is a few pixels wide.
 * A beam is the cheapest thing that reads at that distance, and it is a cue players already
 * know: something is there, fly through it.
 */
const BEAM_HEIGHT = 110;

// Scratch objects: placement and collection never allocate while the game runs.
const _forward = new Vector3();
const _right = new Vector3();
const _position = new Vector3();
const _scratch = new Vector3();
const _colour = new Color();
const _roll = new Quaternion();
const VIEW_AXIS = new Vector3(0, 0, 1);

/** Keep a collectible inside the area the player is allowed to fly in. */
function keepInside(point) {
  point.y = clamp(point.y, BOUNDS.minAltitude + 60, BOUNDS.maxAltitude - 60);
  const radius = radialDistance(point.x, point.z);
  if (radius > BOUNDS.softRadius) {
    const pull = BOUNDS.softRadius / radius;
    point.x *= pull;
    point.z *= pull;
  }
  return point;
}

export class Pickups {
  #group;
  #config;
  #random;
  #flash;

  /* Coins: a pool of plain objects driving one instanced mesh. */
  #coins;
  #coinMesh;
  #dummy = new Object3D();

  /* Fuel and power-ups: pooled, each with its own model. */
  #fuel;
  #power;
  #fuelPrototype = null;
  #powerPrototype = null;
  #disposables = [];

  /* Placement. */
  #centre = new Vector3();
  #pattern = new Float32Array(MAX_PATTERN_COINS * 3);
  #choice = { kind: 'line', count: 0 };
  #timers = { coins: 0, fuel: 0, power: 0 };
  #spawned = { coins: 0, fuel: 0, power: 0 };

  /** Reused by `collect`, so a step that touches four coins allocates nothing. */
  #taken = { coins: 0, fuel: 0, power: [] };

  /**
   * @param {{preset?:object, config?:object, flash?:Function, seed?:number}} [options]
   *   `flash(position, {size, colour, life, growth})` is called on every collection.
   */
  constructor({ preset, config = RUN, flash = null, seed = 4711 } = {}) {
    this.#config = config;
    this.#random = createSeededRandom(seed);
    this.#flash = flash;

    this.#group = new Group();
    this.#group.name = 'pickups';

    const coinCapacity = capacityOf(preset?.coins, config.coins.capacity);
    const fuelCapacity = capacityOf(preset?.fuel, config.fuel.capacity);
    const powerCapacity = capacityOf(preset?.powerups, config.powerups.capacity);

    /* ---------------------------------------------------------------- coins */
    const coinGeometry = new CylinderGeometry(COIN_RADIUS, COIN_RADIUS, 0.5, 16);
    // A disc standing face-on to the camera, rather than lying flat.
    coinGeometry.rotateX(Math.PI / 2);
    const coinMaterial = new MeshStandardMaterial({
      color: new Color('#e9b949'),
      emissive: new Color('#7a4f08'),
      emissiveIntensity: 1.4,
      metalness: 0.85,
      roughness: 0.28,
      envMapIntensity: 1.1,
      side: DoubleSide,
    });
    this.#disposables.push(coinGeometry, coinMaterial);

    this.#coinMesh = new InstancedMesh(coinGeometry, coinMaterial, coinCapacity);
    this.#coinMesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.#coinMesh.frustumCulled = false;
    this.#coinMesh.name = 'coins';
    this.#group.add(this.#coinMesh);

    this.#coins = new Pool({
      capacity: coinCapacity,
      create: () => ({ position: new Vector3(), age: 0, roll: 0, phase: 0 }),
    });

    /* ----------------------------------------------------------------- fuel */
    this.#fuel = new Pool({
      capacity: fuelCapacity,
      create: () => ({ model: null, position: new Vector3(), age: 0, phase: 0 }),
    });
    this.#fuelPrototype = this.#buildFuelCanister();
    for (const canister of this.#fuel.items) {
      canister.model = this.#fuelPrototype.clone();
      canister.model.visible = false;
      this.#group.add(canister.model);
    }

    /* ------------------------------------------------------------- power-ups */
    this.#power = new Pool({
      capacity: powerCapacity,
      create: () => ({
        model: null,
        material: null,
        haloMaterial: null,
        beam: null,
        id: POWERUP_IDS[0],
        position: new Vector3(),
        age: 0,
        phase: 0,
      }),
    });
    this.#powerPrototype = this.#buildOrb();
    for (const orb of this.#power.items) {
      // Each orb gets its own core and halo material so it can carry the colour of the
      // power-up it holds. The geometry is shared across all of them.
      const model = this.#powerPrototype.clone();
      model.visible = false;
      this.#group.add(model);

      orb.model = model;
      orb.material = this.#coreMaterial();
      orb.haloMaterial = this.#haloMaterial();
      orb.beam = model.getObjectByName('beam');
      model.traverse((child) => {
        // The beam's material is assigned when the orb is given a power-up, because it is
        // the only part of the orb that has to change colour.
        if (!child.isMesh || child === orb.beam) return;
        child.material = child.name === 'halo' ? orb.haloMaterial : orb.material;
      });
    }

    this.reset();
  }

  get group() {
    return this.#group;
  }

  /** Coins in the air, for telemetry and the tests. */
  get coinsActive() {
    return this.#coins.activeCount;
  }

  get fuelActive() {
    return this.#fuel.activeCount;
  }

  get powerActive() {
    return this.#power.activeCount;
  }

  /** Everything this module can hold at once, across all three pools. */
  get capacity() {
    return this.#coins.capacity + this.#fuel.capacity + this.#power.capacity;
  }

  /** Totals placed since construction. Read by the tests. */
  get spawned() {
    return { ...this.#spawned };
  }

  /** The instanced mesh, so a test can read what is actually drawn. */
  get coinMesh() {
    return this.#coinMesh;
  }

  /*
   * The three pools. Exposed the same way `Combat` exposes its enemies and hazards: the
   * acceptance tests place a player exactly on a pickup, which needs the real positions.
   */
  get coinPool() {
    return this.#coins;
  }

  get fuelPool() {
    return this.#fuel;
  }

  get powerPool() {
    return this.#power;
  }

  /** Clear the sky and restart every placement timer. Called at the start of a run. */
  reset() {
    this.#coins.releaseAll();
    for (let i = this.#fuel.active.length - 1; i >= 0; i -= 1) this.releaseFuel(this.#fuel.active[i]);
    for (let i = this.#power.active.length - 1; i >= 0; i -= 1) this.releasePower(this.#power.active[i]);

    this.#timers.coins = this.#config.coins.firstSpawn;
    this.#timers.fuel = this.#config.fuel.firstSpawn;
    this.#timers.power = this.#config.powerups.firstSpawn;
    this.#writeCoinMatrices(null);
  }

  /* ------------------------------------------------------------ prototypes */

  /** A fuel canister: a bright amber drum with white bands and a filler cap. */
  #buildFuelCanister() {
    const body = new MeshStandardMaterial({
      color: new Color('#e2a13c'),
      roughness: 0.52,
      metalness: 0.35,
      emissive: new Color('#5c3403'),
      emissiveIntensity: 0.9,
      envMapIntensity: 0.9,
    });
    const band = new MeshStandardMaterial({
      color: new Color('#f4efe2'),
      roughness: 0.6,
      metalness: 0.1,
      emissive: new Color('#3a352a'),
      emissiveIntensity: 0.8,
    });
    this.#disposables.push(body, band);

    const parts = new Group();

    parts.add(new Mesh(new CylinderGeometry(2.6, 2.6, 6.4, 14), body));

    const hoop = new TorusGeometry(2.66, 0.34, 6, 18);
    hoop.rotateX(Math.PI / 2);
    hoop.translate(0, 1.1, 0);
    parts.add(new Mesh(hoop, band));

    const lowHoop = hoop.clone();
    lowHoop.translate(0, -2.2, 0);
    parts.add(new Mesh(lowHoop, band));

    const cap = new CylinderGeometry(0.9, 0.9, 1.1, 8);
    cap.translate(0, 3.6, 0);
    parts.add(new Mesh(cap, band));

    // One draw call per material, and the geometries are disposed by the merge.
    const merged = mergeStaticParts(parts);
    merged.add(this.#buildBeam(this.#beamFor('fuel', '#ffb648')));
    return merged;
  }

  /**
   * A soft column of light above a pickup.
   *
   * A narrow cone rather than a tube, blended normally rather than additively: additive
   * blending against a bright sky washes out to white and loses the colour that says which
   * pickup it is. Named so each orb slot can give theirs the power-up's own colour.
   */
  #buildBeam(material) {
    const geometry = new CylinderGeometry(3, 12, BEAM_HEIGHT, 10, 1, true);
    geometry.translate(0, BEAM_HEIGHT / 2 - 2, 0);

    const beam = new Mesh(geometry, material);
    beam.name = 'beam';
    beam.frustumCulled = false;
    return beam;
  }

  /** A beacon material in a pickup's colour, one per power-up, made once. */
  #beamFor(id, colour) {
    let material = this.#beams.get(id);
    if (!material) {
      material = new MeshBasicMaterial({
        color: new Color(colour),
        transparent: true,
        opacity: 0.4,
        depthWrite: false,
        side: DoubleSide,
        fog: false,
        toneMapped: false,
      });
      this.#beams.set(id, material);
      this.#disposables.push(material);
    }
    return material;
  }

  #beams = new Map();

  /**
   * A power-up: a faceted core inside a ring, with a soft halo behind it.
   *
   * The core and the ring share a material and are merged, so an orb is two draw calls —
   * the lit shape and the additive halo that makes it visible against the sky from a long
   * way off. The halo is named so each slot can attach its own colour to it.
   */
  #buildOrb() {
    const parts = new Group();
    parts.add(new Mesh(new IcosahedronGeometry(3.1, 0), this.#sharedCoreMaterial()));

    const ring = new TorusGeometry(4.4, 0.34, 6, 20);
    ring.rotateX(Math.PI / 2.4);
    // The icosahedron has no index buffer, so the ring is expanded to match it. Merging a
    // geometry that has an index with one that does not fails, and costs a draw call.
    const smoothRing = ring.toNonIndexed();
    ring.dispose();
    parts.add(new Mesh(smoothRing, this.#sharedCoreMaterial()));

    const merged = mergeStaticParts(parts);

    const halo = new Mesh(new SphereGeometry(7.2, 12, 10), this.#sharedHaloMaterial());
    halo.name = 'halo';
    merged.add(halo);

    // The orb's beacon gets its own material when the orb is given a power-up, so the beam
    // carries that power-up's colour.
    merged.add(this.#buildBeam(this.#sharedHaloMaterial()));

    return merged;
  }

  /** The material the prototype is built with; each slot replaces it with its own. */
  #sharedCoreMaterial() {
    if (!this.#corePrototype) {
      this.#corePrototype = new MeshStandardMaterial({
        color: new Color('#ffffff'),
        emissive: new Color('#ffffff'),
        emissiveIntensity: 1.1,
        roughness: 0.35,
        metalness: 0.2,
        envMapIntensity: 1,
      });
      this.#disposables.push(this.#corePrototype);
    }
    return this.#corePrototype;
  }

  #sharedHaloMaterial() {
    if (!this.#haloPrototype) {
      this.#haloPrototype = new MeshBasicMaterial({
        color: new Color('#ffffff'),
        transparent: true,
        opacity: 0.16,
        blending: AdditiveBlending,
        depthWrite: false,
        side: DoubleSide,
        fog: false,
        toneMapped: false,
      });
      this.#disposables.push(this.#haloPrototype);
    }
    return this.#haloPrototype;
  }

  #corePrototype = null;
  #haloPrototype = null;

  /** A private copy of the core material, so one orb's colour is its own. */
  #coreMaterial() {
    const material = this.#sharedCoreMaterial().clone();
    this.#disposables.push(material);
    return material;
  }

  #haloMaterial() {
    const material = this.#sharedHaloMaterial().clone();
    this.#disposables.push(material);
    return material;
  }

  /* -------------------------------------------------------------- placement */

  /**
   * Lay a whole coin pattern ahead of the player.
   *
   * A partial pattern is never placed: if the pool cannot fit all of it, none of it goes in.
   * A line that stops halfway reads as a bug, and the cooldown simply tries again later.
   *
   * @param {{position:object, forward:object, right:object}} player
   * @returns {number} coins placed
   */
  spawnCoins(player) {
    const { coins } = this.#config;
    const { kind, count } = choosePattern(this.#random, coins, this.#choice);
    const n = Math.min(count, MAX_PATTERN_COINS);

    if (this.#coins.activeCount + n > this.#coins.capacity) return 0;

    chooseSpawnPoint(this.#random, player, coins, this.#centre);
    writePattern(kind, n, coins.spacing, this.#pattern);

    _forward.copy(player.forward);
    _right.copy(player.right);

    let placed = 0;
    for (let i = 0; i < n; i += 1) {
      const coin = this.#coins.acquire();
      if (!coin) break;

      const offset = i * 3;
      _position
        .copy(this.#centre)
        .addScaledVector(_forward, this.#pattern[offset])
        .addScaledVector(_right, this.#pattern[offset + 1]);
      _position.y += this.#pattern[offset + 2];
      keepInside(_position);

      coin.position.copy(_position);
      coin.age = 0;
      coin.roll = this.#random() * Math.PI * 2;
      coin.phase = this.#random() * Math.PI * 2;
      placed += 1;
    }

    this.#spawned.coins += placed;
    return placed;
  }

  /** One canister, in the air ahead. */
  spawnFuel(player) {
    const canister = this.#fuel.acquire();
    if (!canister) return null;

    chooseSpawnPoint(this.#random, player, this.#config.fuel, canister.position);
    keepInside(canister.position);
    canister.age = 0;
    canister.phase = this.#random() * Math.PI * 2;
    canister.model.visible = true;
    canister.model.position.copy(canister.position);
    this.#spawned.fuel += 1;
    return canister;
  }

  /**
   * One orb, carrying a named power-up.
   *
   * @param {{position:object, forward:object, right:object}} player
   * @param {string|null} [id] a power-up id, or null to pick one
   */
  spawnPower(player, id = null) {
    const orb = this.#power.acquire();
    if (!orb) return null;

    const chosen = id ?? POWERUP_IDS[Math.floor(this.#random() * POWERUP_IDS.length)];
    const powerup = getPowerup(chosen) ?? getPowerup(POWERUP_IDS[0]);
    orb.id = powerup.id;

    const colour = _colour.set(powerup.pickup);
    orb.material.color.copy(colour);
    orb.material.emissive.copy(colour);
    orb.haloMaterial.color.copy(colour);
    if (orb.beam) orb.beam.material = this.#beamFor(powerup.id, powerup.pickup);

    chooseSpawnPoint(this.#random, player, this.#config.powerups, orb.position);
    keepInside(orb.position);
    orb.age = 0;
    orb.phase = this.#random() * Math.PI * 2;
    orb.model.visible = true;
    orb.model.position.copy(orb.position);
    this.#spawned.power += 1;
    return orb;
  }

  /* ---------------------------------------------------------------- runtime */

  /**
   * Place on the timers, then age, spin and recycle whatever is in the air.
   *
   * @param {number} dt seconds
   * @param {{position:object, forward:object, right:object}} player
   */
  update(dt, player) {
    this.#timers.coins -= dt;
    if (this.#timers.coins <= 0) {
      this.#timers.coins = this.#config.coins.interval;
      this.spawnCoins(player);
    }

    this.#timers.fuel -= dt;
    if (this.#timers.fuel <= 0) {
      this.#timers.fuel = this.#config.fuel.interval;
      this.spawnFuel(player);
    }

    this.#timers.power -= dt;
    if (this.#timers.power <= 0) {
      this.#timers.power = this.#config.powerups.interval;
      this.spawnPower(player);
    }

    this.#ageCoins(dt, player);
    this.#ageFuel(dt, player);
    this.#agePower(dt, player);
  }

  /** Recycled when it is old, far away, or behind the aircraft. */
  #isGone(item, player, lifespan) {
    if (item.age > lifespan) return true;

    const dx = item.position.x - player.position.x;
    const dz = item.position.z - player.position.z;
    const dy = item.position.y - player.position.y;
    const { despawnBehind, despawnRange } = this.#config;

    if (dx * dx + dy * dy + dz * dz > despawnRange * despawnRange) return true;
    return dx * player.forward.x + dz * player.forward.z < -despawnBehind;
  }

  #ageCoins(dt, player) {
    const lifespan = this.#config.coins.lifespan;
    this.#coins.forEachActive((coin) => {
      coin.age += dt;
      coin.roll += dt * 1.9;
      if (this.#isGone(coin, player, lifespan)) this.#coins.release(coin);
    });
    // The instance matrices are written once per frame by `updateVisuals`, so nothing is
    // written here: a coin recycled in a step is hidden by the next frame's write.
  }

  #ageFuel(dt, player) {
    const lifespan = this.#config.fuel.lifespan;
    this.#fuel.forEachActive((canister) => {
      canister.age += dt;
      // The model is placed from `position` every step, so what is drawn and what can be
      // collected can never disagree.
      canister.model.position.set(
        canister.position.x,
        canister.position.y + Math.sin(canister.age * 1.1 + canister.phase) * 0.9,
        canister.position.z,
      );
      canister.model.rotation.y += dt * 0.5;
      canister.model.rotation.z = Math.sin(canister.age * 0.8 + canister.phase) * 0.12;
      if (this.#isGone(canister, player, lifespan)) this.releaseFuel(canister);
    });
  }

  #agePower(dt, player) {
    const lifespan = this.#config.powerups.lifespan;
    this.#power.forEachActive((orb) => {
      orb.age += dt;
      orb.model.position.set(
        orb.position.x,
        orb.position.y + Math.sin(orb.age * 0.9 + orb.phase) * 1.2,
        orb.position.z,
      );
      orb.model.rotation.y += dt * 0.9;
      // No roll: the orb's beacon is part of its model, so rotating about X would tip the
      // beam over instead of spinning the orb.
      // A slow pulse, so an orb reads as something switched on rather than as a rock.
      orb.haloMaterial.opacity = 0.12 + Math.sin(orb.age * 2.2 + orb.phase) * 0.06;
      if (this.#isGone(orb, player, lifespan)) this.releasePower(orb);
    });
  }

  /* ------------------------------------------------------------- collection */

  /**
   * Take everything the aircraft is touching.
   *
   * The returned object is reused: read it before the next step. Each pickup is released
   * *before* it is reported, which is what makes collecting the same one twice impossible —
   * by the time the caller reads the summary, the pickup is already out of the pool.
   *
   * `power` is a reused array of ids because two different orbs can be in reach in the same
   * step; each one still starts exactly one effect.
   *
   * @param {{position:object}} player
   */
  collect(player) {
    const taken = this.#taken;
    taken.coins = 0;
    taken.fuel = 0;
    taken.power.length = 0;

    this.#coins.forEachActive((coin) => {
      if (!spheresOverlap(coin.position, player.position, this.#config.coins.radius, PICKUP_PLAYER_RADIUS)) {
        return;
      }
      _scratch.copy(coin.position);
      this.#coins.release(coin);
      taken.coins += this.#config.coins.value;
      this.#spark(_scratch, '#ffd257', 7);
    });

    this.#fuel.forEachActive((canister) => {
      if (!spheresOverlap(canister.position, player.position, this.#config.fuel.radius, PICKUP_PLAYER_RADIUS)) {
        return;
      }
      _scratch.copy(canister.position);
      this.releaseFuel(canister);
      taken.fuel += this.#config.fuel.amount;
      this.#spark(_scratch, '#ffb648', 12);
    });

    this.#power.forEachActive((orb) => {
      if (!spheresOverlap(orb.position, player.position, this.#config.powerups.radius, PICKUP_PLAYER_RADIUS)) {
        return;
      }
      const id = orb.id;
      _scratch.copy(orb.position);
      this.releasePower(orb);
      taken.power.push(id);
      this.#spark(_scratch, getPowerup(id)?.pickup ?? '#ffffff', 18);
    });

    return taken;
  }

  #spark(position, colour, size) {
    this.#flash?.(position, { size, colour, life: 0.3, growth: 2.1 });
  }

  releaseFuel(canister) {
    if (!canister?.active) return;
    canister.model.visible = false;
    this.#fuel.release(canister);
  }

  releasePower(orb) {
    if (!orb?.active) return;
    orb.model.visible = false;
    this.#power.release(orb);
  }

  /**
   * Write the coin instances.
   *
   * Coins face the camera and roll about the view axis, so they read as tokens from any
   * angle instead of vanishing edge-on. Without a camera — at construction, or when a run is
   * reset — the roll is the only thing applied, which is harmless because nothing is drawn.
   */
  #writeCoinMatrices(camera) {
    const items = this.#coins.items;
    for (let i = 0; i < items.length; i += 1) {
      const coin = items[i];
      if (!coin.active) {
        this.#dummy.scale.set(0, 0, 0);
        this.#dummy.updateMatrix();
        this.#coinMesh.setMatrixAt(i, this.#dummy.matrix);
        continue;
      }

      this.#dummy.position.copy(coin.position);
      if (camera) this.#dummy.quaternion.copy(camera.quaternion);
      else this.#dummy.quaternion.identity();
      this.#dummy.quaternion.multiply(_roll.setFromAxisAngle(VIEW_AXIS, coin.roll));
      this.#dummy.scale.set(1, 1, 1);
      this.#dummy.updateMatrix();
      this.#coinMesh.setMatrixAt(i, this.#dummy.matrix);
    }
    this.#coinMesh.instanceMatrix.needsUpdate = true;
  }

  /**
   * Billboard the coins. Called once per rendered frame, after the simulation.
   *
   * @param {number} _dt unused; the signature matches `Combat.updateVisuals`
   * @param {import('three').Camera|null} camera
   */
  updateVisuals(_dt, camera) {
    this.#writeCoinMatrices(camera ?? null);
  }

  /** Put everything back, for a new run or a teardown. */
  releaseAll() {
    this.#coins.releaseAll();
    for (let i = this.#fuel.active.length - 1; i >= 0; i -= 1) this.releaseFuel(this.#fuel.active[i]);
    for (let i = this.#power.active.length - 1; i >= 0; i -= 1) this.releasePower(this.#power.active[i]);
    this.#writeCoinMatrices(null);
  }

  dispose() {
    this.#fuelPrototype?.traverse((child) => child.geometry?.dispose());
    this.#powerPrototype?.traverse((child) => child.geometry?.dispose());
    this.#fuelPrototype = null;
    this.#powerPrototype = null;
    for (const disposable of this.#disposables) disposable?.dispose?.();
    this.#disposables.length = 0;
    this.#coinMesh.dispose();
    this.#group.clear();
  }
}

/** A pool may not exceed what the configuration allows, whatever the quality tier asks for. */
function capacityOf(requested, fallback) {
  const value = Number.isFinite(requested) ? requested : fallback;
  return Math.max(0, Math.floor(Math.min(value, fallback)));
}




