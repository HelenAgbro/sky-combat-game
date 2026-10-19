/**
 * Sky Combat — blending one scenery zone into another.
 *
 * Pure hex and number maths, so a transition can be unit tested without a renderer. A
 * zone is a description, and a description can be interpolated: the sky, the water, the
 * fog, the light and the clouds all read the same fields, so one blended object drives
 * all of them.
 *
 * The one thing that cannot be interpolated is geometry — the land is built, not tinted —
 * so `ZoneDirector` swaps the scenery kind at the midpoint of a transition, where the
 * change is least visible.
 */
import { clamp } from '../game/math.js';

/** '#rrggbb' to a `[r, g, b]` triple in 0–255. */
export function parseHex(hex) {
  const value = hex.replace('#', '');
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
  ];
}

/** `[r, g, b]` back to a '#rrggbb' string, rounded and clamped. */
export function toHex(rgb) {
  const channel = (value) =>
    Math.round(clamp(value, 0, 255)).toString(16).padStart(2, '0');
  return `#${channel(rgb[0])}${channel(rgb[1])}${channel(rgb[2])}`;
}

/** Blend two hex colours. */
export function blendHex(from, to, t) {
  const a = parseHex(from);
  const b = parseHex(to);
  const k = clamp(t, 0, 1);
  return toHex([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]);
}

/** Blend two numbers. */
export function blendNumber(from, to, t) {
  return from + (to - from) * clamp(t, 0, 1);
}

/**
 * Blend two zones into one description with the same shape.
 *
 * Every field the scene reads is covered here; a field that is not listed is taken from
 * the zone being transitioned away from, which is the safe default for anything that
 * cannot sensibly be half-way between two values.
 *
 * @param {object} from the zone being left
 * @param {object} to the zone being entered
 * @param {number} t 0 is entirely `from`, 1 is entirely `to`
 */
export function blendZones(from, to, t) {
  const k = clamp(t, 0, 1);

  return {
    // Identity follows the destination as soon as the transition starts: the player is
    // heading somewhere, and the name should say where.
    id: k < 0.5 ? from.id : to.id,
    name: k < 0.5 ? from.name : to.name,
    description: k < 0.5 ? from.description : to.description,

    sky: {
      zenith: blendHex(from.sky.zenith, to.sky.zenith, k),
      horizon: blendHex(from.sky.horizon, to.sky.horizon, k),
      haze: blendHex(from.sky.haze, to.sky.haze, k),
      sun: blendHex(from.sky.sun, to.sky.sun, k),
    },
    sun: {
      elevation: blendNumber(from.sun.elevation, to.sun.elevation, k),
      azimuth: blendNumber(from.sun.azimuth, to.sun.azimuth, k),
      intensity: blendNumber(from.sun.intensity, to.sun.intensity, k),
    },
    sea: {
      color: blendHex(from.sea.color, to.sea.color, k),
      depth: blendHex(from.sea.depth, to.sea.depth, k),
      roughness: blendNumber(from.sea.roughness, to.sea.roughness, k),
      metalness: blendNumber(from.sea.metalness, to.sea.metalness, k),
      waveScale: blendNumber(from.sea.waveScale, to.sea.waveScale, k),
    },
    fog: {
      color: blendHex(from.fog.color, to.fog.color, k),
      near: blendNumber(from.fog.near, to.fog.near, k),
      far: blendNumber(from.fog.far, to.fog.far, k),
    },
    ambient: {
      color: blendHex(from.ambient.color, to.ambient.color, k),
      intensity: blendNumber(from.ambient.intensity, to.ambient.intensity, k),
    },
    clouds: {
      color: blendHex(from.clouds.color, to.clouds.color, k),
      opacity: blendNumber(from.clouds.opacity, to.clouds.opacity, k),
      cirrus: blendHex(from.clouds.cirrus, to.clouds.cirrus, k),
      cirrusOpacity: blendNumber(from.clouds.cirrusOpacity, to.clouds.cirrusOpacity, k),
      coverage: blendNumber(from.clouds.coverage, to.clouds.coverage, k),
    },
    terrain: {
      color: blendHex(from.terrain.color, to.terrain.color, k),
      density: blendNumber(from.terrain.density, to.terrain.density, k),
      seedOffset: from.terrain.seedOffset,
    },
    /*
     * Geometry cannot be interpolated, so the kind flips at the midpoint — where the two
     * descriptions are least alike and a change is least visible. The terrain and the
     * horizon band rebuild themselves when they see a new kind.
     */
    scenery: k < 0.5 ? from.scenery : to.scenery,
    ridge: {
      kind: k < 0.5 ? from.ridge.kind : to.ridge.kind,
      color: blendHex(from.ridge.color, to.ridge.color, k),
      opacity: blendNumber(from.ridge.opacity, to.ridge.opacity, k),
    },
    exposure: blendNumber(from.exposure, to.exposure, k),
  };
}
