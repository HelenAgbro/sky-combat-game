/**
 * Sky Combat — aircraft factory.
 *
 * Builds a playable aircraft from a definition in `data/aircraft.js`: it creates
 * the materials from the procedural texture factory, then either uses a packed
 * licensed model if one has been provided (see assets/modelRegistry.js) or builds
 * the airframe in code. Either way the caller receives a `THREE.Group` plus the
 * definition, so gameplay code never needs to know which path was taken.
 */
import {
  Color,
  Group,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Vector2,
} from 'three';
import { buildFighter } from '../assets/models/Fighter.js';
import { loadPackedModel } from '../assets/modelRegistry.js';
import { createPaintTextureSet } from '../assets/textures.js';
import { getAircraft } from '../data/aircraft.js';
import { EngineGlow } from '../scene/Effects.js';

/** A stable seed per aircraft, so each one gets its own panel layout. */
function seedFor(id) {
  let seed = 7;
  for (const character of id) seed = (seed * 31 + character.charCodeAt(0)) % 100000;
  return seed;
}

export class AircraftFactory {
  #anisotropy;
  #disposables = [];

  constructor({ anisotropy = 4 } = {}) {
    this.#anisotropy = anisotropy;
  }

  /**
   * Create an aircraft.
   * @param {string} id one of the ids in `data/aircraft.js`
   * @returns {Promise<{ aircraft: object, group: Group, source: 'packed'|'procedural' }>}
   */
  async create(id) {
    const aircraft = getAircraft(id);
    const packed = await loadPackedModel(aircraft.id);

    // The engine glow is added whichever way the airframe was built, because it is
    // driven by the shape data rather than by the model.
    const glow = new EngineGlow(aircraft.shape, aircraft.livery);
    this.#disposables.push(glow);

    if (packed) {
      this.#preparePackedModel(packed);
      packed.add(glow.group);
      return { aircraft, group: packed, source: 'packed', effects: glow };
    }

    const materials = this.#createMaterials(aircraft);
    const group = buildFighter(aircraft.shape, materials);
    group.add(glow.group);
    return { aircraft, group, source: 'procedural', effects: glow };
  }

  /** The material set for one airframe. Textures are generated, never loaded. */
  #createMaterials(aircraft) {
    // The fuselage carries the roundel, stencils and squadron flash. Wings,
    // tailplanes and fins get the same panel layout without them, because their
    // UVs run across the span and a fuselage stencil lands in the wrong place.
    const marked = createPaintTextureSet(aircraft.livery, {
      seed: seedFor(aircraft.id),
      markings: aircraft.markings,
    });
    const plain = createPaintTextureSet(aircraft.livery, {
      seed: seedFor(aircraft.id),
      markings: false,
      size: 512,
    });

    for (const texture of [...Object.values(marked), ...Object.values(plain)]) {
      texture.anisotropy = this.#anisotropy;
      this.#disposables.push(texture);
    }

    // Painted metal, not plastic: paint is a dielectric, so the sheen comes from
    // the clearcoat layer while the panel-line normal map carries the relief.
    const painted = (textures) =>
      new MeshPhysicalMaterial({
        map: textures.map,
        roughnessMap: textures.roughnessMap,
        normalMap: textures.normalMap,
        normalScale: new Vector2(0.45, 0.45),
        metalness: 0.12,
        roughness: 0.66,
        clearcoat: 0.28,
        clearcoatRoughness: 0.3,
        envMapIntensity: 0.8,
      });

    const fuselage = painted(marked);
    const skin = painted(plain);

    const dark = new MeshStandardMaterial({
      color: new Color(aircraft.livery.dark),
      metalness: 0.35,
      roughness: 0.55,
      envMapIntensity: 0.8,
    });

    const trim = new MeshStandardMaterial({
      color: new Color('#9aa0a8'),
      metalness: 0.45,
      roughness: 0.5,
      envMapIntensity: 0.9,
    });

    /*
     * A tinted canopy, not a transparent one. Without a modelled cockpit interior
     * a see-through bubble just shows the fuselage behind it, which reads as a
     * smudge; an opaque tinted shell with a strong reflection reads as glass.
     */
    const glass = new MeshPhysicalMaterial({
      color: new Color(aircraft.livery.glass),
      metalness: 0.1,
      roughness: 0.07,
      clearcoat: 1,
      clearcoatRoughness: 0.03,
      envMapIntensity: 1.2,
    });

    const nozzleGlow = new MeshStandardMaterial({
      color: new Color('#1c1712'),
      emissive: new Color('#ff5a1f'),
      emissiveIntensity: 0.4,
      metalness: 0.85,
      roughness: 0.5,
    });

    const materials = { fuselage, skin, dark, trim, glass, nozzleGlow };
    this.#disposables.push(...Object.values(materials));
    return materials;
  }

  /** A packed model brings its own materials; it only needs shadow flags. */
  #preparePackedModel(model) {
    model.traverse((object) => {
      if (object.isMesh) {
        object.castShadow = true;
        object.receiveShadow = false;
      }
    });
    if (!(model instanceof Group)) {
      const wrapper = new Group();
      wrapper.add(model);
      return wrapper;
    }
    return model;
  }

  /** Release every generated texture and material. */
  dispose() {
    for (const disposable of this.#disposables) {
      disposable?.dispose?.();
    }
    this.#disposables.length = 0;
  }
}
