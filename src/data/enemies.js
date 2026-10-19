/**
 * Sky Combat — the enemy aircraft.
 *
 * Fictional, and deliberately so. These are not models of anything real: they are arcade
 * opponents, named for birds and insects, with silhouettes chosen to be unmistakable
 * against the player's aircraft at range. Nothing here represents a real air force, and
 * nothing about how they fly represents real tactics — they fly readable patterns and
 * break off, which is what an arcade fight needs.
 *
 * Each one is a `shape` for the same builder the player's airframe uses, so an enemy
 * costs three numbers and a palette rather than a model.
 */

export const ENEMIES = [
  {
    id: 'wasp',
    name: 'Wasp',
    role: 'Light interceptor',
    /** How it flies, from `combat/motion.js`. */
    pattern: 'weave',
    speed: 96,
    turnRate: 0.75,
    livery: { paint: '#4a3038', accent: '#ff6a4d', dark: '#241a1e', glass: '#3a2a30' },
    shape: {
      length: 12.4,
      body: { width: 0.56, height: 0.6, exponent: 3 },
      canopy: { start: 0.2, end: 0.46, width: 0.44, height: 0.34 },
      intake: { at: 0.32, width: 0.58, height: 0.4, length: 1.8, y: -0.3, exponent: 4.5 },
      wing: {
        span: 8.2,
        rootChord: 5,
        tipChord: 1.1,
        sweep: 3.8,
        dihedral: 0.04,
        thickness: 0.055,
        at: 0.42,
        x: 0.42,
        y: -0.1,
        camber: 0.015,
      },
      tail: {
        span: 3.6,
        rootChord: 2,
        tipChord: 0.8,
        sweep: 2,
        thickness: 0.05,
        at: 0.9,
        x: 0.44,
        y: -0.02,
        camber: 0.008,
      },
      fins: {
        count: 2,
        height: 2.2,
        rootChord: 2.6,
        tipChord: 0.8,
        sweep: 2.6,
        cant: 0.5,
        at: 0.88,
        y: 0.22,
        thickness: 0.05,
      },
      canards: null,
      nozzle: { count: 1, radius: 0.4, length: 0.8, spacing: 0 },
      wingtipMissiles: false,
      pylons: 0,
    },
  },
  {
    id: 'kite',
    name: 'Kite',
    role: 'Patrol fighter',
    pattern: 'patrol',
    speed: 86,
    turnRate: 0.6,
    livery: { paint: '#3c4148', accent: '#ff9a3c', dark: '#1e2126', glass: '#33404a' },
    shape: {
      length: 14,
      body: { width: 0.72, height: 0.72, exponent: 2.6 },
      canopy: { start: 0.2, end: 0.44, width: 0.5, height: 0.4 },
      intake: { at: 0.28, width: 0.66, height: 0.5, length: 2, y: -0.36, exponent: 4 },
      wing: {
        span: 11.4,
        rootChord: 5.6,
        tipChord: 1.9,
        sweep: 2.4,
        dihedral: 0.1,
        thickness: 0.07,
        at: 0.38,
        x: 0.52,
        y: -0.14,
        camber: 0.02,
      },
      tail: {
        span: 4.6,
        rootChord: 2.4,
        tipChord: 1,
        sweep: 1.7,
        thickness: 0.06,
        at: 0.9,
        x: 0.48,
        y: 0,
        camber: 0.01,
      },
      fins: {
        count: 1,
        height: 3,
        rootChord: 3,
        tipChord: 1.2,
        sweep: 2.2,
        cant: 0,
        at: 0.85,
        y: 0.42,
        thickness: 0.06,
      },
      canards: null,
      nozzle: { count: 2, radius: 0.3, length: 0.85, spacing: 0.4 },
      wingtipMissiles: false,
      pylons: 0,
    },
  },
  {
    id: 'ember',
    name: 'Ember',
    role: 'Heavy gun platform',
    pattern: 'engage',
    speed: 78,
    turnRate: 0.5,
    livery: { paint: '#332b2b', accent: '#ffcf4d', dark: '#1b1616', glass: '#3a3230' },
    shape: {
      length: 16.2,
      body: { width: 0.86, height: 0.82, exponent: 2.3 },
      canopy: { start: 0.18, end: 0.42, width: 0.56, height: 0.42 },
      intake: { at: 0.24, width: 0.8, height: 0.58, length: 2.4, y: -0.42, exponent: 3.6 },
      wing: {
        span: 12.6,
        rootChord: 6.2,
        tipChord: 2.4,
        sweep: 1.8,
        dihedral: 0.08,
        thickness: 0.095,
        at: 0.34,
        x: 0.56,
        y: -0.18,
        camber: 0.025,
      },
      tail: {
        span: 5.4,
        rootChord: 2.9,
        tipChord: 1.2,
        sweep: 1.6,
        thickness: 0.075,
        at: 0.9,
        x: 0.5,
        y: -0.01,
        camber: 0.01,
      },
      fins: {
        count: 2,
        height: 2.6,
        rootChord: 3.2,
        tipChord: 1.2,
        sweep: 2.2,
        cant: 0.22,
        at: 0.86,
        y: 0.34,
        thickness: 0.075,
      },
      canards: { span: 3.6, rootChord: 2, tipChord: 0.7, sweep: 1.4, thickness: 0.06, at: 0.22, x: 0.42, y: 0.14 },
      nozzle: { count: 2, radius: 0.36, length: 0.9, spacing: 0.5 },
      wingtipMissiles: false,
      pylons: 0,
    },
  },
];

/** Look an enemy type up by id, falling back to the first. */
export function getEnemy(id) {
  return ENEMIES.find((enemy) => enemy.id === id) ?? ENEMIES[0];
}

export const ENEMY_IDS = ENEMIES.map((enemy) => enemy.id);
