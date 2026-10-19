/**
 * Sky Combat — the zone director.
 *
 * Owns which scenery zone is active, and how a change from one to another happens. The
 * scene modules each already know how to re-dress themselves for a zone; this is the one
 * place that decides when, and hands them a *blended* zone while a transition is running,
 * so the sky, the water, the fog, the light, the clouds and the land all move together
 * instead of snapping one at a time.
 *
 * Two things are handled specially:
 *
 * - **The environment map** is rebuilt a handful of times across a transition rather than
 *   every frame. A PMREM render per frame would cost more than the whole scene, and the
 *   eye reads the colour change rather than the reflection.
 * - **Geometry** cannot be interpolated, so the scenery kinds flip at the midpoint, where
 *   the two descriptions are least alike. The terrain and the horizon band notice the new
 *   kind and rebuild themselves.
 *
 * Only the coastal zone is polished; the others are described and can be switched to, but
 * they have not been art-directed. See docs/SCENERY.md.
 */
import { DEFAULT_ZONE_ID, getZone } from '../data/zones.js';
import { blendZones } from './zoneBlend.js';

/** How many times the environment map is rebuilt during one transition. */
const ENV_REBUILDS = 6;

export class ZoneDirector {
  #sky;
  #world;
  #lighting;
  #clouds;
  #terrain;
  #ridge;
  #renderer;
  #scene;
  #active;
  #from = null;
  #to = null;
  #duration = 0;
  #elapsed = 0;
  #nextRebuild = 0;
  #swaps = 0;

  /**
   * @param {object} parts the scene modules a zone dresses, plus the renderer and scene
   *   for the exposure and the fog
   * @param {object} [options] `preset` is the quality tier, so the horizon band can pick a
   *   texture size before it is built
   */
  constructor({ sky, world, lighting, clouds, terrain, ridge, renderer, scene, zone = null }, { preset = {} } = {}) {
    this.#sky = sky;
    this.#world = world;
    this.#lighting = lighting;
    this.#clouds = clouds;
    this.#terrain = terrain;
    this.#ridge = ridge;
    this.#renderer = renderer;
    this.#scene = scene;
    this.#ridgePreset = preset;

    this.#active = zone ?? getZone(DEFAULT_ZONE_ID);
    this.apply(this.#active, { rebuild: true });
  }

  /** The zone on show. During a transition this is the blended description. */
  get zone() {
    return this.#active;
  }

  get transitioning() {
    return this.#to !== null;
  }

  /** 0 at the start of a transition, 1 at the end. */
  get progress() {
    return this.#to === null ? 1 : this.#elapsed / this.#duration;
  }

  /** How many times the scenery kinds have flipped. Read by the tests. */
  get swaps() {
    return this.#swaps;
  }

  /**
   * Begin a transition. Passing the active zone, or an unknown id, is a no-op.
   *
   * @param {string|object} zoneOrId
   * @param {{seconds?:number}} [options]
   * @returns {boolean} whether a transition started
   */
  setZone(zoneOrId, { seconds = 7 } = {}) {
    const zone = typeof zoneOrId === 'string' ? getZone(zoneOrId) : zoneOrId;
    if (!zone || zone.id === this.#active.id) return false;

    // Interrupting a transition blends from what is on screen right now, not from the
    // zone that transition started at — otherwise the colours would jump.
    this.#from = this.#active;
    this.#to = zone;
    this.#duration = Math.max(0.001, seconds);
    this.#elapsed = 0;
    this.#nextRebuild = this.#duration / ENV_REBUILDS;
    return true;
  }

  /**
   * Advance a transition, if one is running.
   *
   * @param {number} dt seconds
   * @returns {boolean} whether anything changed this frame
   */
  update(dt) {
    if (!this.#to) return false;

    this.#elapsed = Math.min(this.#elapsed + dt, this.#duration);
    const t = this.#elapsed / this.#duration;

    const rebuild = this.#elapsed >= this.#nextRebuild;
    if (rebuild) this.#nextRebuild += this.#duration / ENV_REBUILDS;

    const blended = blendZones(this.#from, this.#to, t);
    const before = this.#active.ridge?.kind;
    this.#active = blended;
    if (blended.ridge?.kind !== before) this.#swaps += 1;

    this.apply(blended, { rebuild });

    if (t >= 1) {
      // Land exactly on the destination, so nothing is left half-blended.
      this.#active = this.#to;
      this.#from = null;
      this.#to = null;
      this.apply(this.#active, { rebuild: true });
    }

    return true;
  }

  /**
   * Push a zone description into every scene module.
   *
   * @param {object} zone
   * @param {{rebuild?: boolean}} [options]
   */
  apply(zone, { rebuild = true } = {}) {
    this.#sky.setZone(zone, { rebuild });
    this.#world.setZone(zone);
    this.#lighting.setZone(zone);
    this.#clouds.setZone(zone);
    this.#terrain.setZone(zone);
    this.#ridge.setZone(zone, this.#ridgePreset);

    this.#renderer.toneMappingExposure = zone.exposure;
    this.#scene.background.set(zone.sky.horizon);
    if (this.#scene.fog) {
      this.#scene.fog.color.set(zone.fog.color);
      this.#scene.fog.near = zone.fog.near;
      this.#scene.fog.far = zone.fog.far;
    }
  }

  /** The quality tier, so the horizon band can pick a texture size. */
  setPreset(preset) {
    this.#ridgePreset = preset;
  }

  #ridgePreset = {};
}
