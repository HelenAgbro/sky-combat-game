/**
 * Sky Combat — the fight.
 *
 * One object owns everything that can shoot, be shot at, or be flown into, and resolves the
 * collisions between them. It runs on the fixed simulation step, which is what makes pause
 * work: when the game is paused the step is not taken, so no enemy moves, no shot travels
 * and no cooldown ticks, without this code knowing anything about pausing.
 *
 * Three rules hold the whole thing together:
 *
 * 1. **Everything is pooled.** Enemies, hazards, shots and impact flashes are created once
 *    and reused, so ten minutes of fighting costs the same as ten seconds.
 * 2. **A thing that is hit is removed in the same breath as it is scored.** A shot that
 *    connects is released immediately, so it cannot hit twice; an enemy that dies is
 *    released inside the same call that awards the kill, so it cannot be killed twice.
 * 3. **The run ends exactly once.** `#ended` is set the first time the hull reaches zero
 *    and nothing after that can fire a second game over.
 */
import { Group, Vector3 } from 'three';
import { BOUNDS, COMBAT, RUN } from '../game/config.js';
import { clamp, createSeededRandom } from '../game/math.js';
import { Enemies } from './Enemies.js';
import { Impacts } from './Impacts.js';
import { Obstacles } from './Obstacles.js';
import { Projectiles } from './Projectiles.js';
import { sweptSphereHit, spheresOverlap } from './collisions.js';
import { difficultyAt } from './difficulty.js';

/** The player's hit volume, in metres. A little smaller than the aircraft looks. */
const PLAYER_RADIUS = 5;

/** Where shots leave the aircraft, measured from its origin along its own nose. */
const MUZZLE_FORWARD = 6.5;

/** How the special ammunition is tuned. Defaulted here so `Combat` can be built without it. */
const POWERUP_TUNING = RUN.powerups;

const _origin = new Vector3();
const _direction = new Vector3();
const _point = new Vector3();
const _spread = new Vector3();

export class Combat {
  #group;
  #enemies;
  #obstacles;
  #playerShots;
  #enemyShots;
  #impacts;
  #config;
  #random;
  #listeners = new Map();

  #spawnTimer = 0;
  #cooldown = 0;
  #grace = 0;
  #ended = false;
  #hull = 0;
  #kills = 0;
  #score = 0;
  #shotsFired = 0;
  #hits = 0;
  /** Special ammunition: more damage, and a tracer you can see the difference with. */
  #specialAmmo = false;
  #damageScale = 1;
  #tracerScale = 1;

  constructor({ preset, config = COMBAT, seed = 1337 }) {
    this.#config = config;
    this.#random = createSeededRandom(seed);

    this.#group = new Group();
    this.#group.name = 'combat';

    this.#enemies = new Enemies({ preset, config: config.enemies, seed: seed + 11 });
    this.#obstacles = new Obstacles({ preset, config: config.obstacles, seed: seed + 29 });
    this.#playerShots = new Projectiles({
      capacity: config.gun.capacity,
      colour: '#ffd27a',
      name: 'player-shots',
    });
    this.#enemyShots = new Projectiles({
      capacity: config.enemyGun.capacity,
      colour: '#ff6a8a',
      name: 'enemy-shots',
    });
    this.#impacts = new Impacts({ capacity: preset.impacts ?? 32 });

    this.#group.add(
      this.#enemies.group,
      this.#obstacles.group,
      this.#playerShots.mesh,
      this.#enemyShots.mesh,
      this.#impacts.mesh,
    );

    this.#hull = config.hull.max;
  }

  get group() {
    return this.#group;
  }

  get enemies() {
    return this.#enemies;
  }

  get obstacles() {
    return this.#obstacles;
  }

  /** The impact pool, so pickups can flash with the same one draw call. */
  get impacts() {
    return this.#impacts;
  }

  /** True while the heavy rounds power-up is running. */
  get specialAmmo() {
    return this.#specialAmmo;
  }

  get hull() {
    return this.#hull;
  }

  get kills() {
    return this.#kills;
  }

  get ended() {
    return this.#ended;
  }

  /** Clear the fight back to the start of a run. Nothing is reallocated. */
  reset() {
    this.#enemies.releaseAll();
    this.#obstacles.releaseAll();
    this.#playerShots.releaseAll();
    this.#enemyShots.releaseAll();
    this.#impacts.releaseAll();

    this.#spawnTimer = this.#config.enemies.firstSpawn;
    this.#cooldown = 0;
    this.#grace = 0;
    this.#ended = false;
    this.#hull = this.#config.hull.max;
    this.#kills = 0;
    this.#score = 0;
    this.#shotsFired = 0;
    this.#hits = 0;
    this.setSpecialAmmo(false);
    this.#obstacles.reset();
  }

  /**
   * Load or unload the special ammunition.
   *
   * Idempotent: the game sets this from the power-up's state every step rather than on an
   * event, so a timer that expires mid-frame cannot leave the gun loaded. Returns whether
   * the state actually changed, which is what the muzzle flash keys off.
   *
   * @param {boolean} on
   * @param {object} [tuning] the `powerups` block of `RUN`
   */
  setSpecialAmmo(on, tuning = POWERUP_TUNING) {
    const next = Boolean(on);
    if (next === this.#specialAmmo) return false;

    this.#specialAmmo = next;
    this.#damageScale = next ? (tuning?.specialDamageScale ?? 2.2) : 1;
    this.#tracerScale = next ? (tuning?.specialTracerScale ?? 1.7) : 1;
    this.#playerShots.setColour(next ? '#bff0ff' : '#ffd27a');
    return true;
  }

  /**
   * Mark the run over without a game-over of the fight's own.
   *
   * Fuel exhaustion ends a run that the hull had nothing to do with, and the fight still has
   * to stop: this is the one door into `#ended` that does not emit `destroyed`. Idempotent,
   * so ending a run that has already ended is free.
   *
   * @returns {boolean} whether this call ended it
   */
  finish() {
    if (this.#ended) return false;
    this.#ended = true;
    return true;
  }

  /**
   * One simulation step of the fight.
   *
   * @param {number} dt seconds
   * @param {object} player the player's `AircraftController`
   */
  update(dt, player) {
    if (this.#ended) {
      // The wreck keeps falling, but nothing else happens: no spawns, no shots, no hits.
      this.#playerShots.update(dt);
      this.#enemyShots.update(dt);
      return;
    }

    const difficulty = difficultyAt(player.elapsed, this.#config);
    if (this.#grace > 0) this.#grace = Math.max(0, this.#grace - dt);

    // Spawn.
    this.#spawnTimer -= dt;
    if (this.#spawnTimer <= 0) {
      this.#spawnTimer = difficulty.spawnInterval;
      this.#enemies.spawn(player);
    }

    this.#enemies.update(dt, player, difficulty.speed);
    this.#obstacles.update(dt, player);

    this.#firePlayerGun(dt, player);
    this.#fireEnemyGuns(dt, player, difficulty);

    this.#playerShots.update(dt);
    this.#enemyShots.update(dt);

    this.#resolvePlayerShots();
    this.#resolvePlayerHits(player);
  }

  /** Face the impact flashes at the camera. Per frame, not per simulation step. */
  updateVisuals(dt, camera) {
    this.#impacts.update(dt, camera);
  }

  /**
   * The gun. Held down it fires at its own cadence, so the trigger is one control rather
   * than a stream of button events.
   */
  #firePlayerGun(dt, player) {
    this.#cooldown -= dt;
    if (!player.input?.fire || this.#cooldown > 0) return;

    const gun = this.#config.gun;
    this.#cooldown = gun.cooldown;
    this.#shotsFired += 1;

    this.#aimFrom(player, MUZZLE_FORWARD, gun.spread);
    // The shot inherits the aircraft's own speed: flying fast makes the gun hit harder,
    // which is both true and satisfying.
    const shot = this.#playerShots.fire(
      _origin,
      _direction,
      gun.speed + player.speed,
      gun.lifespan,
      this.#tracerScale,
    );
    if (!shot) return;

    // The round keeps the power it was fired with, even if the power-up expires while it is
    // still in the air. Ammunition is loaded at the muzzle, not at the target.
    shot.damageScale = this.#damageScale;

    this.#impacts.spawn(_origin, {
      size: this.#specialAmmo ? 3.4 : 2.2,
      colour: this.#specialAmmo ? '#cdf4ff' : '#fff0c0',
      life: 0.08,
      growth: 0.5,
    });
  }

  /** Enemies shoot rarely, and only when the player is close enough to be a threat. */
  #fireEnemyGuns(dt, player, difficulty) {
    const gun = this.#config.enemyGun;
    const cooldown = gun.cooldown / Math.max(0.05, difficulty.fireRate);

    for (const enemy of this.#enemies.active) {
      enemy.fireCooldown -= dt;
      if (enemy.fireCooldown > 0) continue;

      const dx = player.position.x - enemy.position.x;
      const dy = player.position.y - enemy.position.y;
      const dz = player.position.z - enemy.position.z;
      const range = Math.hypot(dx, dy, dz);

      enemy.fireCooldown = cooldown * (0.7 + this.#random() * 0.6);
      if (range > gun.maxRange) continue;

      _direction.set(dx / range, dy / range, dz / range);
      _spread.set(
        (this.#random() - 0.5) * gun.spread * 2,
        (this.#random() - 0.5) * gun.spread * 2,
        (this.#random() - 0.5) * gun.spread * 2,
      );
      _direction.add(_spread).normalize();
      _origin.copy(enemy.position);

      this.#enemyShots.fire(_origin, _direction, gun.speed, gun.lifespan);
    }
  }

  /** A shot leaves the nose, with a little scatter so a stream of them is a cone. */
  #aimFrom(player, forward, spread) {
    _origin.copy(player.position).addScaledVector(player.forward, forward);
    _direction.copy(player.forward);
    _spread.set(
      (this.#random() - 0.5) * spread * 2,
      (this.#random() - 0.5) * spread * 2,
      (this.#random() - 0.5) * spread * 2,
    );
    _direction.add(_spread).normalize();
  }

  /**
   * Player shots against enemies.
   *
   * The test is against the segment each shot swept during the step, not against its
   * position: at 640 m/s a shot covers more than ten metres per step, and a point test
   * against a nine-metre aircraft would miss most of the shots that should have landed.
   */
  #resolvePlayerShots() {
    const shots = this.#playerShots.active;

    for (let i = shots.length - 1; i >= 0; i -= 1) {
      const shot = shots[i];
      let hitEnemy = null;
      let hitT = 0;

      for (const enemy of this.#enemies.active) {
        const result = sweptSphereHit(shot.previous, shot.position, enemy.position, enemy.radius);
        if (result.hit) {
          hitEnemy = enemy;
          hitT = result.t;
          break;
        }
      }

      if (!hitEnemy) continue;

      // The shot is handed back before the damage is applied, so it cannot hit anything
      // else: one shot, one hit.
      const from = shot.previous;
      const to = shot.position;
      const damage = this.#config.gun.damage * (shot.damageScale ?? 1);
      this.#playerShots.release(shot);
      _point.lerpVectors(from, to, hitT);
      this.#hitEnemy(hitEnemy, damage, _point);
    }
  }

  /** Everything that can hurt the player, in one pass. */
  #resolvePlayerHits(player) {
    const shots = this.#enemyShots.active;
    for (let i = shots.length - 1; i >= 0; i -= 1) {
      const shot = shots[i];
      const result = sweptSphereHit(shot.previous, shot.position, player.position, PLAYER_RADIUS);
      if (!result.hit) continue;

      const from = shot.previous;
      const to = shot.position;
      this.#enemyShots.release(shot);
      _point.lerpVectors(from, to, result.t);
      this.#hurt(this.#config.enemyGun.damage, 'gunfire', _point);
    }

    // Flying into an enemy wrecks it, but it is not a kill: the player did not shoot it,
    // and crediting it would let a player farm the scoreboard by ramming.
    const enemies = this.#enemies.active;
    for (let i = enemies.length - 1; i >= 0; i -= 1) {
      const enemy = enemies[i];
      if (!spheresOverlap(player.position, enemy.position, PLAYER_RADIUS, enemy.radius)) continue;
      this.#wreckEnemy(enemy);
      this.#hurt(this.#config.enemies.ramDamage, 'collision', enemy.position);
    }

    // Hazards burst on contact, so the same one can never be hit twice.
    const obstacles = this.#obstacles.active;
    for (let i = obstacles.length - 1; i >= 0; i -= 1) {
      const obstacle = obstacles[i];
      if (!spheresOverlap(player.position, obstacle.position, PLAYER_RADIUS, obstacle.radius)) continue;
      const position = obstacle.position;
      this.#obstacles.release(obstacle);
      this.#impacts.spawn(position, {
        size: obstacle.radius * 1.3,
        colour: '#ffb27a',
        life: 0.45,
        growth: 2.2,
      });
      this.#hurt(this.#config.obstacles.damage, 'obstacle', position);
    }
  }

  /** A shot landing. */
  #hitEnemy(enemy, amount, point) {
    if (!enemy.active) return;
    this.#hits += 1;
    enemy.integrity -= amount;
    this.#impacts.spawn(point, { size: 3.2, colour: '#ffd9a0', life: 0.18, growth: 2.2 });
    this.#emit('hit', { enemy, point });

    if (enemy.integrity <= 0) this.#killEnemy(enemy, point);
  }

  /**
   * A kill: the reward and the removal happen in the same call, and a removed enemy is
   * inactive, so no sequence of events can score the same enemy twice.
   */
  #killEnemy(enemy, point) {
    if (!enemy.active) return;

    this.#kills += 1;
    this.#score += this.#config.enemies.scorePerKill;
    const position = enemy.position;
    this.#enemies.release(enemy);

    this.#impacts.spawn(position, {
      size: enemy.radius * 1.8,
      colour: '#ffb066',
      life: 0.5,
      growth: 2.6,
    });
    this.#impacts.spawn(position, {
      size: enemy.radius * 1.1,
      colour: '#fff4d0',
      life: 0.26,
      growth: 1.8,
    });
    this.#emit('kill', { enemy, point, position, kills: this.#kills, score: this.#score });
  }

  /** A collision: the enemy comes apart, but nobody is credited with it. */
  #wreckEnemy(enemy) {
    if (!enemy.active) return;
    const position = enemy.position;
    this.#enemies.release(enemy);
    this.#impacts.spawn(position, {
      size: enemy.radius * 1.6,
      colour: '#ff9a6a',
      life: 0.45,
      growth: 2.4,
    });
    this.#emit('wreck', { enemy, position });
  }

  /**
   * Take damage, at most once per grace window.
   *
   * The grace window stops a single pass through one hazard emptying the hull in a handful
   * of frames, and it is the second half of the answer to "a single collision must not
   * trigger two game overs" — the first half is `#ended`.
   */
  #hurt(amount, source, point) {
    if (this.#ended || this.#grace > 0) return;

    this.#grace = this.#config.hull.grace;
    this.#hull = Math.max(0, this.#hull - amount);
    this.#impacts.spawn(point ?? _point, { size: 5, colour: '#ff8a5a', life: 0.3, growth: 1.8 });
    this.#emit('damage', { amount, hull: this.#hull, source });

    if (this.#hull > 0) return;
    this.#ended = true;
    this.#emit('destroyed', { source, hull: 0, kills: this.#kills, score: this.#score });
  }

  /** Everything the HUD and the results screen read. */
  telemetry() {
    return {
      hull: this.#hull,
      hullMax: this.#config.hull.max,
      kills: this.#kills,
      score: this.#score,
      shotsFired: this.#shotsFired,
      shotsHit: this.#hits,
      accuracy: this.#shotsFired === 0 ? 0 : this.#hits / this.#shotsFired,
      enemies: this.#enemies.activeCount,
      enemyCapacity: this.#enemies.capacity,
      obstacles: this.#obstacles.activeCount,
      obstacleCapacity: this.#obstacles.capacity,
      playerShots: this.#playerShots.activeCount,
      enemyShots: this.#enemyShots.activeCount,
      impacts: this.#impacts.activeCount,
      ended: this.#ended,
      specialAmmo: this.#specialAmmo,
    };
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
        console.error(`[SkyCombat] combat listener for "${event}" failed`, error);
      }
    }
  }

  dispose() {
    this.#enemies.dispose();
    this.#obstacles.dispose();
    this.#playerShots.dispose();
    this.#enemyShots.dispose();
    this.#impacts.dispose();
    this.#listeners.clear();
    this.#group.clear();
  }
}
