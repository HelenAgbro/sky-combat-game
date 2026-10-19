/**
 * Sky Combat — the distant horizon.
 *
 * A band of mountain silhouettes on a cylinder 8.5 km out, following the camera so it
 * never gets closer. This is the cheapest convincing answer to "what is on the horizon":
 * one draw call and one generated texture, no geometry near the player, and it turns the
 * world from a flat line where the water meets the sky into a place with somewhere else
 * beyond it.
 *
 * It deliberately does not use fog. At 8.5 km the fog would swallow it completely, so the
 * haze is baked into the texture's layer opacities and the band is tinted per zone
 * instead — which also means a storm can darken it and a sunset can warm it for free.
 */
import {
  BackSide,
  Color,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  RepeatWrapping,
} from 'three';
import { createRidgeTexture } from '../assets/textures.js';
import { sceneryFor } from './scenery.js';

/** Distance to the band, in metres. Inside the camera's far plane, beyond the fog. */
const RIDGE_RADIUS = 8500;
/** How far the band's base sits below sea level, so the waterline hides it. */
const RIDGE_SINK = 60;
/** How many times the silhouette repeats around the circle. */
const RIDGE_REPEAT = 7;

export class DistantRidge {
  #group;
  #mesh;
  #geometry;
  #material;
  #texture;
  #layers = 0;
  #zoneId = null;

  constructor(zone, preset) {
    this.#group = new Group();
    this.#group.name = 'ridge';

    this.#material = new MeshBasicMaterial({
      transparent: true,
      depthWrite: false,
      side: BackSide,
      fog: false,
      opacity: 0.5,
    });

    this.setZone(zone, preset);
  }

  get group() {
    return this.#group;
  }

  /** How many silhouette layers the band was built with. Read by the tests. */
  get layers() {
    return this.#layers;
  }

  /**
   * Re-tint the band for a zone, and rebuild it if the zone names a different ridge kind.
   *
   * @param {object} zone
   * @param {object} preset the quality tier, for the texture size
   */
  setZone(zone, preset = {}) {
    const { ridge, ridgeId } = sceneryFor(zone);
    const height = zone.ridge?.height ?? 900;

    this.#material.color.set(zone.ridge?.color ?? '#8fa3b8');
    this.#material.opacity = zone.ridge?.opacity ?? 0.5;

    if (ridgeId === this.#zoneId) return;
    this.#zoneId = ridgeId;
    this.#layers = ridge.layers;

    this.#texture?.dispose();
    this.#geometry?.dispose();
    if (this.#mesh) {
      this.#group.remove(this.#mesh);
      this.#mesh = null;
    }

    if (ridge.layers === 0) return;

    this.#texture = createRidgeTexture({
      size: preset.ridgeTextureSize ?? 512,
      height: (preset.ridgeTextureSize ?? 512) / 4,
      layers: ridge.layers,
      jaggedness: ridge.jaggedness,
    });
    this.#texture.repeat.set(RIDGE_REPEAT, 1);
    this.#material.map = this.#texture;
    this.#material.needsUpdate = true;

    this.#geometry = new CylinderGeometry(RIDGE_RADIUS, RIDGE_RADIUS, height, 96, 1, true);
    this.#mesh = new Mesh(this.#geometry, this.#material);
    this.#mesh.name = 'ridge-band';
    this.#mesh.position.y = height * 0.5 - RIDGE_SINK;
    // Drawn after the sky and before anything with real depth in front of it.
    this.#mesh.renderOrder = -900;
    this.#mesh.frustumCulled = false;
    this.#group.add(this.#mesh);
  }

  /** Follow the camera in the horizontal plane only: it is land, so its height is fixed. */
  update(camera) {
    if (!this.#mesh) return;
    this.#mesh.position.x = camera.position.x;
    this.#mesh.position.z = camera.position.z;
  }

  dispose() {
    this.#geometry?.dispose();
    this.#material.dispose();
    this.#texture?.dispose();
    this.#group.clear();
  }
}
