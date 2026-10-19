/**
 * Sky Combat — the scenery kinds.
 *
 * A zone *names* a terrain kind and a ridge kind; the kinds carry the numbers that turn
 * a radial heightfield into land and a horizon band into distant mountains. That split is
 * what makes a new zone data rather than code: adding a volcanic archipelago means adding
 * an entry here and pointing a zone at it, with no change to the scene.
 *
 * Two kinds are built and one is polished:
 *
 * - `islands` is the coastal zone, and is the one that has been flown and reviewed;
 * - `mountains` exists to prove the architecture holds a second, very different kind —
 *   it is implemented and unit tested, but it has not been art-directed;
 * - `none` is open water, for a zone that should have no land at all.
 */

/** How a heightfield falls away from its summit, and how jagged its outline is. */
export const TERRAIN_KINDS = Object.freeze({
  /** Open water in every direction. */
  none: Object.freeze({
    height: 0,
    radius: 1,
    rings: 4,
    segments: 8,
    density: 0,
    fullness: 1,
    taper: 0,
    peaks: 0,
    peakSpread: 1,
    wobble: [],
    squash: [1, 1],
    peakScale: [1, 1],
    sink: 0,
    bands: [],
  }),

  /** Low islands: a beach, grass and a rocky crown. The coastal zone. */
  islands: Object.freeze({
    height: 190,
    radius: 620,
    rings: 8,
    segments: 22,
    density: 0.5,
    /**
     * The exponent on the dome profile. Higher is a spike, lower is a broad hill.
     * A full island wants a rounded top and a wide base.
     */
    fullness: 1.5,
    /** How much the rim pulls in below the summit, 0–1. */
    taper: 0.3,
    /** How many summits, and how tightly the extra ones are gathered. */
    peaks: 1,
    peakSpread: 2.4,
    /** Angular harmonics: `[frequency, amplitude]`, which is what stops it being a cone. */
    wobble: [
      [3, 0.26],
      [5, 0.14],
    ],
    /** Random range for the horizontal stretch and the summit height. */
    squash: [0.82, 1.22],
    peakScale: [0.85, 1.15],
    /** How far the shoreline sinks below sea level, in metres. */
    sink: 8,
    /** Colour bands, by height fraction: `[upTo, r, g, b]` in sRGB. */
    bands: [
      [0.04, 0.87, 0.81, 0.65],
      [0.3, 0.35, 0.45, 0.29],
      [0.72, 0.45, 0.43, 0.38],
      [1, 0.87, 0.89, 0.93],
    ],
  }),

  /** High, jagged ridges: the mountain zone. Implemented, not yet art-directed. */
  mountains: Object.freeze({
    height: 1250,
    radius: 1000,
    rings: 10,
    segments: 26,
    density: 0.62,
    fullness: 0.55,
    taper: 0.12,
    peaks: 3,
    peakSpread: 1.1,
    wobble: [
      [4, 0.3],
      [7, 0.18],
      [11, 0.1],
    ],
    squash: [0.7, 1.3],
    peakScale: [0.8, 1.2],
    sink: 14,
    bands: [
      [0.03, 0.6, 0.58, 0.52],
      [0.22, 0.32, 0.38, 0.3],
      [0.62, 0.44, 0.43, 0.44],
      [1, 0.9, 0.92, 0.96],
    ],
  }),
});

/**
 * The distant horizon band: the silhouettes that stop the world being a flat line where
 * the water meets the sky. `height` is a fraction of the band's own height, `layers` is
 * how many ridges are stacked behind one another, and `jaggedness` is how sharp the peaks
 * are.
 */
export const RIDGE_KINDS = Object.freeze({
  none: Object.freeze({ layers: 0, height: 0, jaggedness: 0, softness: 1 }),
  coast: Object.freeze({ layers: 3, height: 0.17, jaggedness: 0.45, softness: 1.4 }),
  peaks: Object.freeze({ layers: 4, height: 0.36, jaggedness: 0.85, softness: 0.9 }),
  dunes: Object.freeze({ layers: 2, height: 0.1, jaggedness: 0.2, softness: 2.2 }),
});

/**
 * Resolve the kind objects a zone names.
 *
 * @param {object} zone
 * @returns {{terrain: object, ridge: object, terrainId: string, ridgeId: string}}
 */
export function sceneryFor(zone) {
  const terrainId = zone?.scenery?.terrain ?? 'islands';
  const ridgeId = zone?.ridge?.kind ?? 'coast';

  return {
    terrainId,
    ridgeId,
    terrain: TERRAIN_KINDS[terrainId] ?? TERRAIN_KINDS.islands,
    ridge: RIDGE_KINDS[ridgeId] ?? RIDGE_KINDS.coast,
  };
}
