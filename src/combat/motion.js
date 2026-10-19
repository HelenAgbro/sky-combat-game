/**
 * Sky Combat — enemy motion.
 *
 * Enemies are not flown by the flight model. They fly *patterns*: a target heading and
 * climb, produced by a small function, which the enemy then turns toward at a fixed
 * rate. That is deliberate — a pattern is readable, which is what an arcade dogfight
 * needs, and it costs a handful of trigonometry per enemy per step rather than a second
 * flight simulation.
 *
 * Everything here is pure and unit tested.
 */
import { Euler, Quaternion } from 'three';
import { clamp, shortestAngle } from '../game/math.js';

const _euler = new Euler();

/**
 * A yaw-pitch-roll orientation in the game's convention.
 *
 * `heading` 0 points along -Z and increases toward +X, matching `headingOf` in the cloud
 * layout and the rest of the game. The yaw is negated because a positive rotation about
 * the local +Y axis turns the nose the other way.
 */
export function orientationFrom(heading, climb = 0, bank = 0, out = new Quaternion()) {
  _euler.set(climb, -heading, bank, 'YXZ');
  return out.setFromEuler(_euler);
}

/** Turn `current` toward `target` by at most `rate` radians per second, without overshooting. */
export function steerAngle(current, target, rate, dt) {
  const difference = shortestAngle(current, target);
  const step = clamp(difference, -rate * dt, rate * dt);
  return current + step;
}

/** Where something is relative to the player: the heading to it, and the range. */
export function bearingTo(from, to, out = {}) {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  out.heading = Math.atan2(dx, -dz);
  out.range = Math.hypot(dx, dz);
  out.climb = clamp((to.y - from.y) / Math.max(120, out.range), -0.5, 0.5);
  return out;
}

/** Scratch for the bearing helpers, so the patterns never allocate. */
const _bearing = { heading: 0, range: 0, climb: 0 };

/**
 * The patterns. Each writes a target heading, climb and speed scale into `out`.
 *
 * They are ordered here from easiest to hardest to fight against, and they are all
 * predictable on purpose: nothing an enemy does should be a surprise.
 */
export const PATTERNS = Object.freeze({
  /** Straight and level with a slow, readable altitude change. The one to learn on. */
  patrol(enemy, context, out) {
    out.heading = enemy.baseHeading;
    out.climb = Math.sin(enemy.age * 0.6 + enemy.phase) * 0.12;
    out.speed = 0.9;
    return out;
  },

  /** A wide lateral weave: harder to lead, still entirely predictable. */
  weave(enemy, context, out) {
    out.heading = enemy.baseHeading + Math.sin(enemy.age * 0.9 + enemy.phase) * 0.5;
    out.climb = Math.sin(enemy.age * 0.45 + enemy.phase) * 0.1;
    out.speed = 0.95;
    return out;
  },

  /** Holds a station off the player: always in view, always moving across the frame. */
  orbit(enemy, context, out) {
    const bearing = bearingTo(enemy.position, context.position, _bearing);
    out.heading = bearing.heading + Math.PI * 0.5 + Math.sin(enemy.age * 0.3) * 0.2;
    out.climb = Math.sin(enemy.age * 0.5 + enemy.phase) * 0.08;
    out.speed = 0.85;
    return out;
  },

  /** Turns in toward the player while far away, then breaks off past them. */
  engage(enemy, context, out) {
    const bearing = bearingTo(enemy.position, context.position, _bearing);
    const closing = bearing.range > 420;
    out.heading = closing ? bearing.heading : bearing.heading + 2.4;
    out.climb = clamp(bearing.climb, -0.22, 0.22);
    out.speed = closing ? 1.05 : 0.95;
    return out;
  },
});

/** The patterns in the order they are introduced as a run gets harder. */
export const PATTERN_ORDER = Object.freeze(['patrol', 'weave', 'orbit', 'engage']);
