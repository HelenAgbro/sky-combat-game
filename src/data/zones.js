/**
 * Sky Combat — scenery zones.
 *
 * Five environments, described as palettes and atmosphere rather than geometry.
 * `scene/Sky.js` and `scene/World.js` read these today; Stage 8 reuses the same
 * definitions for zone transitions, so the look of a zone is never duplicated.
 * Colours are CSS hex strings so they can be used by both Three.js and the UI.
 */

export const ZONES = [
  {
    id: 'coastal',
    name: 'Coastal Run',
    description: 'Open water, long horizons and a clean blue sky.',
    sky: { zenith: '#1d5da8', horizon: '#cfe3f2', haze: '#9fc0d8', sun: '#fff4d8' },
    sun: { elevation: 26, azimuth: 138, intensity: 2.3 },
    sea: { color: '#10405f', depth: '#0a2739', roughness: 0.14, metalness: 0.04, waveScale: 70 },
    fog: { color: '#cfe3f2', near: 900, far: 6500 },
    ambient: { color: '#9dc4e2', intensity: 0.62 },
    exposure: 0.95,
  },
  {
    id: 'mountain',
    name: 'Mountain Pass',
    description: 'Cold air, hard light and granite ridges close enough to touch.',
    sky: { zenith: '#14417f', horizon: '#dfe9f2', haze: '#a8bccd', sun: '#fff6e2' },
    sun: { elevation: 38, azimuth: 95, intensity: 2.5 },
    sea: { color: '#2c4a4f', depth: '#16282c', roughness: 0.3, metalness: 0.02, waveScale: 90 },
    fog: { color: '#dfe9f2', near: 800, far: 5800 },
    ambient: { color: '#a9c3d8', intensity: 0.55 },
    exposure: 0.96,
  },
  {
    id: 'desert',
    name: 'Desert Basin',
    description: 'Heat shimmer, dust haze and a bleached sky at noon.',
    sky: { zenith: '#2f7fc4', horizon: '#f2e2c4', haze: '#e3cba6', sun: '#fff8e6' },
    sun: { elevation: 62, azimuth: 210, intensity: 2.8 },
    sea: { color: '#c69a5e', depth: '#8d6b3c', roughness: 0.85, metalness: 0.0, waveScale: 40 },
    fog: { color: '#f2e2c4', near: 1100, far: 6400 },
    ambient: { color: '#e0c49a', intensity: 0.7 },
    exposure: 0.98,
  },
  {
    id: 'storm',
    name: 'Storm Front',
    description: 'Low light, heavy rain and cloud that swallows the horizon.',
    sky: { zenith: '#1b2430', horizon: '#5c6a76', haze: '#49555f', sun: '#c9d3dc' },
    sun: { elevation: 12, azimuth: 300, intensity: 1.2 },
    sea: { color: '#1b2c36', depth: '#0d161c', roughness: 0.22, metalness: 0.06, waveScale: 120 },
    fog: { color: '#5c6a76', near: 400, far: 4200 },
    ambient: { color: '#6f8290', intensity: 0.75 },
    exposure: 0.95,
  },
  {
    id: 'sunset',
    name: 'Sunset Patrol',
    description: 'Long shadows, orange water and the last of the light.',
    sky: { zenith: '#20335f', horizon: '#ffb066', haze: '#e08a5a', sun: '#fff0c4' },
    sun: { elevation: 6, azimuth: 265, intensity: 2.0 },
    sea: { color: '#2a2f47', depth: '#14182a', roughness: 0.12, metalness: 0.08, waveScale: 80 },
    fog: { color: '#e79b6a', near: 700, far: 5600 },
    ambient: { color: '#b9846a', intensity: 0.5 },
    exposure: 0.96,
  },
];

/** Look up a zone by id, falling back to the first zone. */
export function getZone(id) {
  return ZONES.find((zone) => zone.id === id) ?? ZONES[0];
}

export const DEFAULT_ZONE_ID = ZONES[0].id;
