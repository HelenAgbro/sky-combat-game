/**
 * Sky Combat — coins, fuel and power-ups.
 *
 * One object owns everything the player collects, because all three are the same shape:
 * something placed ahead of the aircraft on a timer, taken by flying into it, and given
 * back once it is behind or too old.
 *
 * The rules that matter, and where they live:
 *
 * - **Nothing is allocated in flight.** Coins are one `InstancedMesh` over a fixed pool;
 *   fuel canisters and power-ups are merged prototypes cloned once per pool slot, exactly
 *   as the hazard balloons are. Collecting writes into an object that already exists.
 * - **A collectible is collected once.** Collection and removal happen in the same call —
 *   the object is marked as popping before anything else can look at it, and a popping
 *   object is skipped by the collision test — so one coin cannot be counted twice.
 * - **The power-up clocks run on the simulation step**, which is the whole answer to
 *   pausing: pause the game and the timers stop, without this code knowing what a pause is.
 * - **Nothing carries over.** `reset()` empties both pools, clears the power-up timers and
 *   zeroes the counters, and the aircraft's own `reset()` clears the speed boost it was
 *   granted, so a new run starts clean.
 *
 * Coins are counted, not scored: what they are worth is the hangar's business, and that is
 * a later stage. See docs/PICKUPS.md.
 */
import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  OctahedronGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { mergeStaticParts } from '../assets/mergeStaticParts.js';
import { Pool } from '../combat/Pool.js';
import { spheresOverlap } from '../combat/collisions.js';
import { chooseSpawnPoint } from '../combat/spawn.js';
import { PICKUPS } from '../game/config.js';
import { clamp, createSeededRandom } from '../game/math.js';
import { COIN_PATTERN_IDS, placeCoinPattern, shouldRecycle } from './pickupLayout.js';
import {
  POWER_UPS,
  POWER_UP_IDS,
  activate,
  activeList,
  advance,
  createPowerUpState,
  effectsOf,
  resetPowerUps,
} from './powerUps.js';

/** Coin size, in metres: readable from 800 m without looking like a plate. */
const COIN_RADIUS = 3.4;
const COIN_THICKNESS = 0.5;
/** How fast a coin turns, in radians per second. */
const COIN_SPIN = 2.4;
/** The player's hit volume, matching `combat/Combat.js`. */
const PLAYER_RADIUS = 5;
/** The kinds of supply that share the pool. */
const SUPPLY_KINDS = Object.freeze(['fuel', ...POWER_UP_IDS]);
/** How the supply capacity is divided: half fuel, and the rest split between power-ups. */
const SUPPLY_SPLIT = Object.freeze({ fuel: 0.5, speed: 0.25, ammo: 0.25 });
/** How much bigger than the model the collection volume is. Generous: it is a reward. */
const SUPPLY_GRAB = 1.25;
/** Seconds a collected supply takes to pop and vanish. */
const SUPPLY_COLLECT_TIME = 0.3;

/** The largest coin pattern, so the scratch points can be allocated once. */
const MAX_PATTERN = 12;

/** Fuel is green; a power-up is drawn in the same colour as its HUD chip. */
function colourFor(kind) {
  return kind === 'fuel' ? '#3fa34d' : POWER_UPS[kind].colour;
}
export class Pickups {
  #group;
  #coinMesh;
  #coinGeometry;
  #coinMaterial;
  #coinPool;
  #pools = new Map();
  #prototypes = new Map();
  #disposables = [];
  #impacts;
  #random;
  #config;
  #state;
  #effects;
  #expired = [];
  /** Preallocated points, so laying out a pattern never allocates. */
  #points = Array.from({ length: MAX_PATTERN }, () => ({ x: 0, y: 0, z: 0 }));
  #dummy = new Object3D();
  #forward = new Vector3();
  #lastPattern = null;

  #coinTimer = 0;
  #fuelTimer = 0;
  #powerTimer = 0;
  #coins = 0;
  #fuelTaken = 0;
  #powerTaken = 0;
  #listeners = new Map();

  /**
   * @param {object} options
   * @param {object} [options.preset] the quality tier: how many coins and supplies
   * @param {object|null} [options.impacts] the shared hit-flash pool, from `Combat`
   * @param {object} [options.config] the `PICKUPS` block
   * @param {number} [options.seed]
   */
  constructor({ preset = {}, impacts = null, config = PICKUPS, seed = 7717 } = {}) {
    this.#config = config;
    this.#impacts = impacts;
    this.#random = createSeededRandom(seed);
    this.#state = createPowerUpState();
    this.#effects = effectsOf(this.#state, { speedMultiplier: 1, damageMultiplier: 1 });

    this.#group = new Group();
    this.#group.name = 'pickups';

    this.#buildCoins(Math.max(0, preset.coins ?? 48));
    this.#buildSupplies(Math.max(0, preset.supplies ?? 8));
    this.#resetTimers();
  }

  get group() {
    return this.#group;
  }

  get coins() {
    return this.#coins;
  }

  /** The power-up timers, for the tests and for anything that needs to inspect them. */
  get powerUps() {
    return this.#state;
  }

  /** What is running right now: `{speedMultiplier, damageMultiplier}`. */
  get effects() {
    return this.#effects;
  }

  get capacity() {
    return this.#coinPool.capacity + this.#supplyCapacity;
  }

  get #supplyCapacity() {
    let total = 0;
    for (const pool of this.#pools.values()) total += pool.capacity;
    return total;
  }

  /* ------------------------------------------------------------------ building */

  /**
   * The coin field: one instanced draw call for every coin in the world.
   *
   * A coin is a disc standing on its edge, turning about the vertical axis — the shape
   * everyone already reads as "pick me up".
   */
  #buildCoins(capacity) {
    this.#coinGeometry = new CylinderGeometry(COIN_RADIUS, COIN_RADIUS, COIN_THICKNESS, 16);
    // Stand the disc up so its face points down the flight path.
    this.#coinGeometry.rotateX(Math.PI / 2);

    this.#coinMaterial = new MeshStandardMaterial({
      color: new Color('#ffc94d'),
      metalness: 1,
      roughness: 0.3,
      // A little self-illumination: a coin has to be findable against a bright sea, and
      // gold with no light on it is brown.
      emissive: new Color('#5c3f00'),
      emissiveIntensity: 0.6,
      envMapIntensity: 1.2,
    });

    // An InstancedMesh needs at least one instance, even on a tier that shows none.
    this.#coinMesh = new InstancedMesh(this.#coinGeometry, this.#coinMaterial, Math.max(1, capacity));
    this.#coinMesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.#coinMesh.frustumCulled = false;
    this.#coinMesh.name = 'coins';
    this.#coinMesh.renderOrder = 2;
    this.#coinMesh.visible = capacity > 0;
    this.#group.add(this.#coinMesh);

    this.#coinPool = new Pool({
      capacity,
      create: () => ({
        position: new Vector3(),
        age: 0,
        phase: 0,
        spin: 0,
        /** Set the moment it is collected, so nothing can collect it again. */
        collecting: false,
        collectAge: 0,
      }),
    });

    this.#writeCoinMatrices();
  }

  /**
   * The supplies: a canister and two power-up shapes, each merged down to one mesh per
   * material and cloned once per slot, so a slot is a mesh that is switched on rather
   * than a mesh that is created.
   */
  #buildSupplies(capacity) {
    for (const kind of SUPPLY_KINDS) {
      this.#prototypes.set(kind, this.#buildPrototype(kind));
      const share = Math.floor(capacity * (SUPPLY_SPLIT[kind] ?? 0));

      const pool = new Pool({
        capacity: share,
        create: () => ({
          kind,
          model: null,
          position: new Vector3(),
          anchorY: 0,
          age: 0,
          phase: 0,
          collecting: false,
          collectAge: 0,
        }),
      });

      for (const supply of pool.items) {
        supply.model = this.#prototypes.get(kind).clone();
        supply.model.visible = false;
        this.#group.add(supply.model);
      }

      this.#pools.set(kind, pool);
    }
  }

  /** One supply model, merged down to a body and a trim material. */
  #buildPrototype(kind) {
    const colour = colourFor(kind);
    const body = new MeshStandardMaterial({
      color: new Color(colour),
      roughness: 0.42,
      metalness: 0.3,
      // Supplies glow slightly, so they are findable at range and in a dark zone.
      emissive: new Color(colour),
      emissiveIntensity: 0.3,
      envMapIntensity: 1,
    });
    const trim = new MeshStandardMaterial({
      color: new Color('#f2ece0'),
      roughness: 0.6,
      metalness: 0.1,
      envMapIntensity: 0.8,
    });
    this.#disposables.push(body, trim);

    const parts = new Group();

    if (kind === 'fuel') {
      // A drum with a band and a cap: the tallest silhouette in the sky.
      parts.add(new Mesh(new CylinderGeometry(2.4, 2.4, 6.4, 12), body));
      const band = new TorusGeometry(2.45, 0.42, 6, 18);
      band.rotateX(Math.PI / 2);
      parts.add(new Mesh(band, trim));
      const cap = new CylinderGeometry(0.85, 0.85, 1.1, 8);
      cap.translate(0, 3.7, 0);
      parts.add(new Mesh(cap, trim));
    } else if (kind === 'speed') {
      // A chevron pointing up: nothing else in the sky looks like it.
      parts.add(new Mesh(new OctahedronGeometry(3.3, 0), body));
      const ring = new TorusGeometry(3.4, 0.3, 6, 18);
      ring.rotateX(Math.PI / 2);
      parts.add(new Mesh(ring, trim));
    } else {
      // Heavy rounds: a crate, banded both ways.
      parts.add(new Mesh(new BoxGeometry(4.6, 3.2, 3.2), body));
      parts.add(new Mesh(new BoxGeometry(5, 0.7, 0.7), trim));
      parts.add(new Mesh(new BoxGeometry(0.7, 3.4, 3.4), trim));
    }

    return mergeStaticParts(parts);
  }

  /* -------------------------------------------------------------------- running */

  /**
   * One simulation step of everything collectible.
   *
   * @param {number} dt seconds
   * @param {import('../aircraft/AircraftController.js').AircraftController} player
   */
  update(dt, player) {
    // The power-up clocks run here, on the simulation step, which is why pausing the game
    // pauses them: the step is not taken, so no timer moves.
    advance(this.#state, dt, this.#expired);
    for (const id of this.#expired) this.#onExpired(id, player);

    // Read the heading once: `player.forward` builds a fresh vector on every access.
    this.#forward.copy(player.forward);
    const position = player.position;

    this.#spawnOnTimers(dt, player);
    this.#updateCoins(dt, player, position);
    this.#updateSupplies(dt, player, position);
    this.#writeCoinMatrices();

    /*
     * Worked out last, so that a power-up collected on this step is already in effect on
     * this step: `Game` applies these multipliers straight after `update`, and computing
     * them first would mean the aircraft did not speed up until a step after the pickup
     * burst — a frame of lag that would read as the pickup not having worked.
     */
    effectsOf(this.#state, this.#effects);
  }

  /** Place coins and supplies when their timers come round. */
  #spawnOnTimers(dt, player) {
    this.#coinTimer -= dt;
    if (this.#coinTimer <= 0) {
      this.#coinTimer = this.#config.coins.interval;
      this.#spawnCoinPattern(player);
    }

    this.#fuelTimer -= dt;
    if (this.#fuelTimer <= 0) {
      this.#fuelTimer = this.#config.fuel.interval;
      this.spawnSupply('fuel', player);
    }

    this.#powerTimer -= dt;
    if (this.#powerTimer <= 0) {
      this.#powerTimer = this.#config.powerups.interval;
      this.spawnSupply(POWER_UP_IDS[Math.floor(this.#random() * POWER_UP_IDS.length)], player);
    }
  }

  /**
   * Lay out one pattern of coins.
   *
   * The pattern is chosen at random but never twice in a row: two identical patterns back
   * to back read as one long, broken pattern rather than as two.
   *
   * @returns {number} how many coins were actually placed
   */
  #spawnCoinPattern(player) {
    let index = Math.floor(this.#random() * COIN_PATTERN_IDS.length);
    if (COIN_PATTERN_IDS[index] === this.#lastPattern) index = (index + 1) % COIN_PATTERN_IDS.length;

    const patternId = COIN_PATTERN_IDS[index];
    this.#lastPattern = patternId;

    const count = placeCoinPattern(this.#random, player, patternId, this.#config.coins, this.#points);

    let placed = 0;
    for (let i = 0; i < count; i += 1) {
      // The pool is the ceiling: whatever does not fit is simply not laid out.
      const coin = this.placeCoin(this.#points[i]);
      if (!coin) break;

      coin.spin = this.#random() * Math.PI * 2;
      coin.phase = this.#random() * Math.PI * 2;
      placed += 1;
    }

    if (placed > 0) this.#emit('pattern', { pattern: patternId, count: placed });
    return placed;
  }

  /**
   * Put one coin at an exact point.
   *
   * Public for the same reason `Obstacles.spawn` is: a test that has to fly around until it
   * happens to hit a coin is a test that measures luck.
   *
   * @param {{x:number,y:number,z:number}} point
   * @returns {object|null} the coin, or null when the pool is full
   */
  placeCoin(point) {
    const coin = this.#coinPool.acquire();
    if (!coin) return null;

    coin.position.set(point.x, point.y, point.z);
    coin.age = 0;
    coin.spin = 0;
    coin.phase = 0;
    coin.collecting = false;
    coin.collectAge = 0;
    return coin;
  }

  /**
   * Put one supply in the air ahead of the player.
   *
   * Public because the acceptance test places one deliberately, the same way it places a
   * hazard: a test that has to wait for a timer is a test that measures luck.
   *
   * @param {'fuel'|'speed'|'ammo'} kind
   * @returns {object|null} the supply, or null when that kind's pool is full
   */
  spawnSupply(kind, player) {
    const pool = this.#pools.get(kind);
    if (!pool) return null;

    const supply = pool.acquire();
    if (!supply) return null;

    // The same placement rules the combat spawner uses: ahead of the player, off the
    // flight path, and inside the arena the player is allowed to fly in.
    const options = kind === 'fuel' ? this.#config.fuel : this.#config.powerups;
    chooseSpawnPoint(this.#random, player, options, supply.position);

    supply.anchorY = supply.position.y;
    supply.age = 0;
    supply.phase = this.#random() * Math.PI * 2;
    supply.collecting = false;
    supply.collectAge = 0;
    supply.model.visible = true;
    supply.model.position.copy(supply.position);
    return supply;
  }

  /** Give a supply back to its pool. */
  release(supply) {
    if (!supply?.active) return;
    supply.model.visible = false;
    this.#pools.get(supply.kind)?.release(supply);
  }
  /* ---------------------------------------------------------------- collecting */

  /** Fly every coin one step: collect it, pop it, or give it back. */
  #updateCoins(dt, player, position) {
    const options = this.#config.coins;

    this.#coinPool.forEachActive((coin) => {
      coin.age += dt;
      coin.spin += dt * COIN_SPIN;

      /*
       * A coin that is popping has already been collected. It is skipped before the
       * collision test, so however many steps the aircraft spends inside one coin it can
       * only ever be counted once.
       */
      if (coin.collecting) {
        coin.collectAge += dt;
        if (coin.collectAge >= options.collectTime) this.#coinPool.release(coin);
        return;
      }

      if (spheresOverlap(position, coin.position, PLAYER_RADIUS, options.radius)) {
        this.#collectCoin(coin);
        return;
      }

      if (shouldRecycle(coin, position, this.#forward, options)) this.#coinPool.release(coin);
    });
  }

  /** Fly every supply one step, and collect the one the aircraft is inside. */
  #updateSupplies(dt, player, position) {
    for (let i = 0; i < SUPPLY_KINDS.length; i += 1) {
      const kind = SUPPLY_KINDS[i];
      const pool = this.#pools.get(kind);
      const options = kind === 'fuel' ? this.#config.fuel : this.#config.powerups;
      const grab = options.radius * SUPPLY_GRAB;

      pool.forEachActive((supply) => {
        supply.age += dt;

        if (supply.collecting) {
          supply.collectAge += dt;
          if (supply.collectAge >= SUPPLY_COLLECT_TIME) this.release(supply);
          return;
        }

        // A slow bob and a turn, so a supply reads as a thing in the air rather than a
        // marker pinned to the sky.
        supply.position.y = supply.anchorY + Math.sin(supply.age * 1.1 + supply.phase) * 2.4;
        supply.model.position.copy(supply.position);
        supply.model.rotation.y += dt * 0.45;

        if (spheresOverlap(position, supply.position, PLAYER_RADIUS, grab)) {
          this.#collectSupply(supply, player);
          return;
        }

        if (shouldRecycle(supply, position, this.#forward, options)) this.release(supply);
      });
    }
  }

  /**
   * Collect a coin.
   *
   * The count goes up and the coin starts popping in the same call, and a popping coin is
   * skipped by the test above — so this happens exactly once per coin.
   */
  #collectCoin(coin) {
    coin.collecting = true;
    coin.collectAge = 0;
    this.#coins += 1;

    this.#impacts?.spawn(coin.position, { size: 5, colour: '#ffe08a', life: 0.22, growth: 2 });
    this.#emit('collect', { kind: 'coin', coins: this.#coins });
  }

  /**
   * Collect a fuel canister or a power-up.
   *
   * Fuel is added through the aircraft's own `refuel`, which clamps: a canister taken with
   * a full tank is a canister wasted rather than a tank of 1.3. A power-up is started or
   * refreshed — the rule for two of the same is in `powerUps.js`.
   */
  #collectSupply(supply, player) {
    supply.collecting = true;
    supply.collectAge = 0;

    const kind = supply.kind;
    const colour = colourFor(kind);
    const at = supply.position;

    if (kind === 'fuel') {
      const taken = player.refuel(this.#config.fuel.refill);
      this.#fuelTaken += 1;
      this.#impacts?.spawn(at, { size: 7, colour, life: 0.3, growth: 2.2 });
      this.#emit('collect', { kind, taken, fuel: player.fuel });
      return;
    }

    const result = activate(this.#state, kind);
    this.#powerTaken += 1;
    this.#impacts?.spawn(at, { size: 9, colour, life: 0.4, growth: 2.6 });
    this.#emit('collect', {
      kind,
      id: kind,
      /** True when it topped up something already running. */
      refreshed: result?.refreshed ?? false,
      remaining: result?.remaining ?? 0,
    });
  }

  /**
   * A power-up ran out.
   *
   * The effect is drawn at the aircraft, where the player is looking, so an effect ending
   * is as visible as one starting. It fires exactly once, because `advance` only reports
   * the step on which a timer reaches zero.
   */
  #onExpired(id, player) {
    this.#impacts?.spawn(player.position, {
      size: 10,
      colour: POWER_UPS[id].colour,
      life: 0.32,
      growth: 2.4,
    });
    this.#emit('expired', { id });
  }

  /** Position, spin and pop every coin; hide the slots the pool is not using. */
  #writeCoinMatrices() {
    const items = this.#coinPool.items;
    const collectTime = this.#config.coins.collectTime;

    for (let i = 0; i < items.length; i += 1) {
      const coin = items[i];

      if (!coin.active) {
        this.#dummy.scale.set(0, 0, 0);
        this.#dummy.updateMatrix();
        this.#coinMesh.setMatrixAt(i, this.#dummy.matrix);
        continue;
      }

      const pop = coin.collecting ? clamp(coin.collectAge / collectTime, 0, 1) : 0;

      this.#dummy.position.copy(coin.position);
      // A collected coin swells, rises and is gone: the collection animation. The swell is
      // what makes it read as *taken* rather than as having simply vanished.
      if (pop > 0) this.#dummy.position.y += pop * 7;
      this.#dummy.rotation.set(0, coin.spin, 0);
      this.#dummy.scale.setScalar(pop > 0 ? (1 + pop * 1.6) * (1 - pop * pop) : 1);
      this.#dummy.updateMatrix();
      this.#coinMesh.setMatrixAt(i, this.#dummy.matrix);
    }

    this.#coinMesh.instanceMatrix.needsUpdate = true;
  }

  /* --------------------------------------------------------- reporting and reset */

  /** Everything the HUD, the results screen and the tests read. */
  telemetry() {
    return {
      coins: this.#coins,
      /** Canisters taken, and power-ups taken — the two halves of the collection count. */
      fuelPickups: this.#fuelTaken,
      powerPickups: this.#powerTaken,
      coinsActive: this.#coinPool.activeCount,
      coinCapacity: this.#coinPool.capacity,
      suppliesActive: this.#activeSupplies(),
      supplyCapacity: this.#supplyCapacity,
      /** The power-ups running right now, with their remaining time. */
      powerUps: activeList(this.#state),
      speedMultiplier: this.#effects.speedMultiplier,
      damageMultiplier: this.#effects.damageMultiplier,
    };
  }

  #activeSupplies() {
    let total = 0;
    for (let i = 0; i < SUPPLY_KINDS.length; i += 1) total += this.#pools.get(SUPPLY_KINDS[i]).activeCount;
    return total;
  }

  /**
   * Start a run clean.
   *
   * Every collectible goes back, the counters go to zero and the power-up timers are
   * cleared — so a new run cannot inherit the last one's speed boost or heavy rounds.
   */
  reset() {
    this.#coinPool.releaseAll();
    for (let i = 0; i < SUPPLY_KINDS.length; i += 1) {
      const pool = this.#pools.get(SUPPLY_KINDS[i]);
      for (let j = pool.active.length - 1; j >= 0; j -= 1) this.release(pool.active[j]);
    }

    this.#coins = 0;
    this.#fuelTaken = 0;
    this.#powerTaken = 0;
    this.#lastPattern = null;

    resetPowerUps(this.#state);
    effectsOf(this.#state, this.#effects);
    this.#resetTimers();
    this.#writeCoinMatrices();
  }

  /** The first of each arrives a little early, so a run opens with something to aim at. */
  #resetTimers() {
    this.#coinTimer = this.#config.coins.interval * 0.35;
    this.#fuelTimer = this.#config.fuel.interval * 0.6;
    this.#powerTimer = this.#config.powerups.interval * 0.7;
  }

  on(event, listener) {
    if (!this.#listeners.has(event)) this.#listeners.set(event, new Set());
    this.#listeners.get(event).add(listener);
    return () => this.#listeners.get(event)?.delete(listener);
  }

  #emit(event, payload) {
    for (const listener of this.#listeners.get(event) ?? []) {
      try {
        listener(payload);
      } catch (error) {
        console.error(`[SkyCombat] pickups listener for "${event}" failed`, error);
      }
    }
  }

  dispose() {
    this.#coinGeometry.dispose();
    this.#coinMaterial.dispose();
    this.#coinMesh.dispose();

    for (const prototype of this.#prototypes.values()) {
      prototype.traverse((child) => child.geometry?.dispose());
    }
    this.#prototypes.clear();

    for (const disposable of this.#disposables) disposable?.dispose?.();
    this.#disposables.length = 0;

    this.#listeners.clear();
    this.#group.clear();
  }

}
