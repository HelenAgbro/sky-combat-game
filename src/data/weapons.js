/**
 * Sky Combat — the four weapons.
 *
 * Fictional arcade weapons, defined as data so the shop and the fight read the same numbers.
 * Each weapon is an id, a kind (which decides how it fires), a one-time unlock price, and a
 * list of upgrade levels. Level 0 is what you get the moment you own the weapon; every level
 * after it is bought separately with coins and never re-bought.
 *
 * The statistics map directly onto `combat/Combat.js`:
 * - `standard` / `spread` / `homing` fire projectiles with `speed`, `spread`, `lifespan`;
 * - `spread` adds `count` pellets in a `fan`;
 * - `laser` is hitscan with `range` (no travel time);
 * - `homing` steers with `turnRate` toward whatever is within `seekRange`.
 */

export const WEAPON_KINDS = Object.freeze(['standard', 'spread', 'laser', 'homing']);

export const WEAPONS = [
  {
    id: 'standard',
    kind: 'standard',
    name: 'Standard bullets',
    description: 'Rapid straight fire. Nothing fancy, nothing slow.',
    colour: '#ffd27a',
    price: 0,
    levels: [
      { cost: 0, cooldown: 0.115, damage: 34, speed: 640, spread: 0.0045, lifespan: 1.5 },
      { cost: 500, cooldown: 0.105, damage: 38, speed: 660, spread: 0.004, lifespan: 1.6 },
      { cost: 1200, cooldown: 0.095, damage: 44, speed: 690, spread: 0.0035, lifespan: 1.7 },
      { cost: 2500, cooldown: 0.085, damage: 52, speed: 720, spread: 0.003, lifespan: 1.8 },
    ],
  },
  {
    id: 'spread',
    kind: 'spread',
    name: 'Spread shot',
    description: 'A fan of pellets. Worse at range, impossible to miss up close.',
    colour: '#ffc46a',
    price: 1800,
    levels: [
      { cost: 0, cooldown: 0.28, damage: 14, speed: 560, lifespan: 1.2, count: 5, fan: 0.1 },
      { cost: 900, cooldown: 0.26, damage: 16, speed: 580, lifespan: 1.25, count: 6, fan: 0.095 },
      { cost: 2000, cooldown: 0.24, damage: 18, speed: 600, lifespan: 1.3, count: 7, fan: 0.09 },
      { cost: 4000, cooldown: 0.22, damage: 21, speed: 620, lifespan: 1.35, count: 8, fan: 0.085 },
    ],
  },
  {
    id: 'laser',
    kind: 'laser',
    name: 'Laser',
    description: 'Instant beam. No travel time, no warning — just damage.',
    colour: '#7df9ff',
    price: 3200,
    levels: [
      { cost: 0, cooldown: 0.4, damage: 26, range: 900 },
      { cost: 1500, cooldown: 0.36, damage: 34, range: 1000 },
      { cost: 3000, cooldown: 0.32, damage: 44, range: 1150 },
      { cost: 5500, cooldown: 0.28, damage: 58, range: 1300 },
    ],
  },
  {
    id: 'homing',
    kind: 'homing',
    name: 'Homing missiles',
    description: 'Slow but relentless. They chase whatever is nearest.',
    colour: '#ff9a7a',
    price: 5200,
    levels: [
      { cost: 0, cooldown: 0.55, damage: 60, speed: 220, turnRate: 2.4, seekRange: 1600, lifespan: 6, spread: 0 },
      { cost: 2200, cooldown: 0.5, damage: 70, speed: 250, turnRate: 2.7, seekRange: 1800, lifespan: 6.2, spread: 0 },
      { cost: 4500, cooldown: 0.45, damage: 82, speed: 280, turnRate: 3, seekRange: 2000, lifespan: 6.4, spread: 0 },
      { cost: 8000, cooldown: 0.4, damage: 96, speed: 310, turnRate: 3.3, seekRange: 2200, lifespan: 6.6, spread: 0 },
    ],
  },
];

/** The default: owned from the first launch, selected from the first launch. */
export const DEFAULT_WEAPON_ID = WEAPONS[0].id;

/** Every id, in a fixed order. */
export const WEAPON_IDS = WEAPONS.map((weapon) => weapon.id);

/** Look one up, falling back to the standard gun so a bad id never leaves the player unarmed. */
export function getWeapon(id) {
  return WEAPONS.find((weapon) => weapon.id === id) ?? WEAPONS[0];
}

/**
 * The resolved firing spec for a weapon at a level: the weapon's identity and kind, plus the
 * level's statistics flattened into one object. `resolveWeapon('laser', 2)` is what the fight
 * actually reads, so the shop and the gun can never disagree.
 *
 * @param {string} id
 * @param {number} [level] clamped to the weapon's own range
 */
export function resolveWeapon(id, level = 0) {
  const weapon = getWeapon(id);
  const max = weapon.levels.length - 1;
  const index = Number.isFinite(level) ? Math.min(max, Math.max(0, Math.floor(level))) : 0;
  const stats = weapon.levels[index];
  return {
    id: weapon.id,
    kind: weapon.kind,
    name: weapon.name,
    colour: weapon.colour,
    level: index,
    cooldown: stats.cooldown,
    damage: stats.damage,
    speed: stats.speed,
    spread: stats.spread ?? 0,
    lifespan: stats.lifespan,
    count: stats.count ?? 1,
    fan: stats.fan ?? 0,
    range: stats.range,
    turnRate: stats.turnRate,
    seekRange: stats.seekRange,
  };
}