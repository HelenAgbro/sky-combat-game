/**
 * Sky Combat — the world surface.
 *
 * Today that is the sea: one plane with generated wave normals, kept centred
 * under the aircraft and snapped to the texture period so the waves stay locked
 * to the world instead of sliding along with the player. Stage 4 adds terrain,
 * clouds and the remaining zone geometry behind the same interface.
 */
import { Color, Group, MathUtils, Mesh, MeshStandardMaterial, PlaneGeometry, Vector2 } from 'three';
import { createSeaTextureSet } from '../assets/textures.js';
import { WORLD } from '../game/config.js';

export class World {
  #group;
  #sea;
  #material;
  #textures;
  #period;

  constructor(zone, preset) {
    this.#group = new Group();
    this.#group.name = 'world';

    this.#textures = createSeaTextureSet({ size: 512, seed: 11 });

    // How many times the wave texture repeats across the plane. Fewer, larger
    // tiles read as ocean swell; many small tiles read as woven fabric. The repeat
    // count and the plane size together give the period the surface snaps to.
    const repeat = Math.max(8, preset.seaRepeat ?? 20);
    this.#period = WORLD.seaSize / repeat;
    for (const texture of Object.values(this.#textures)) {
      texture.repeat.set(repeat, repeat);
      texture.anisotropy = preset.anisotropy;
    }

    this.#material = new MeshStandardMaterial({
      color: new Color(zone.sea.color),
      normalMap: this.#textures.normalMap,
      normalScale: new Vector2(0.08, 0.08),
      roughness: zone.sea.roughness,
      metalness: zone.sea.metalness,
      envMapIntensity: 1.05,
    });

    const geometry = new PlaneGeometry(WORLD.seaSize, WORLD.seaSize, preset.seaSegments, preset.seaSegments);
    geometry.rotateX(-Math.PI / 2);

    this.#sea = new Mesh(geometry, this.#material);
    this.#sea.name = 'sea';
    this.#sea.receiveShadow = false;
    this.#group.add(this.#sea);
  }

  get group() {
    return this.#group;
  }

  get surface() {
    return this.#sea;
  }

  /** Re-colour the surface for a zone. */
  setZone(zone) {
    this.#material.color.set(zone.sea.color);
    this.#material.roughness = zone.sea.roughness;
    this.#material.metalness = zone.sea.metalness;
  }

  /** Keep the surface under the aircraft and drift the wave normals. */
  update(dt, focus) {
    this.#sea.position.x = Math.round(focus.x / this.#period) * this.#period;
    this.#sea.position.z = Math.round(focus.z / this.#period) * this.#period;

    const offset = this.#textures.normalMap.offset;
    offset.x = (offset.x + dt * 0.0045) % 1;
    offset.y = (offset.y + dt * 0.009) % 1;
  }

  dispose() {
    this.#sea.geometry.dispose();
    this.#material.dispose();
    for (const texture of Object.values(this.#textures)) texture.dispose();
    this.#group.clear();
  }
}
