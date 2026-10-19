/**
 * Sky Combat — the world surface.
 *
 * The sea: one plane with generated wave normals, kept centred under the aircraft and
 * snapped to the texture period so the waves stay locked to the world instead of
 * sliding along with the player.
 *
 * Two normal layers are blended: a long swell, and a fine ripple that fades out with
 * distance. That fade is the whole point — fine detail in a tiled normal map aliases
 * into a visible grating when it is viewed at a grazing angle from 400 m up, so it is
 * only ever sampled where the screen has the pixels to resolve it. The blend is
 * injected into the standard material's own normal pass, which keeps Three's
 * lighting, fog, environment reflections and tone mapping exactly as they were.
 */
import { Color, Group, Mesh, MeshStandardMaterial, PlaneGeometry, Vector2 } from 'three';
import { createSeaTextureSet } from '../assets/textures.js';
import { WORLD } from '../game/config.js';

/** Distance over which the fine ripple fades in, and the distance it is gone by, in metres. */
const DETAIL_NEAR = 240;
const DETAIL_FAR = 1500;
/** How many times finer the ripple layer is than the swell layer. */
const DETAIL_SCALE = 4;

export class World {
  #group;
  #sea;
  #material;
  #textures;
  #detail;
  #period;

  constructor(zone, preset) {
    this.#group = new Group();
    this.#group.name = 'world';

    this.#textures = createSeaTextureSet({ size: 512, seed: 11 });
    // The fine layer: short wavelengths, low amplitude, and only worth generating when
    // the tier will actually sample it.
    this.#detail = createSeaTextureSet({
      size: preset.waterDetail ? 256 : 128,
      seed: 23,
      waveScale: 0.12,
      amplitude: 0.55,
    });

    // How many times the wave texture repeats across the plane. Fewer, larger
    // tiles read as ocean swell; many small tiles read as woven fabric. The repeat
    // count and the plane size together give the period the surface snaps to.
    const repeat = Math.max(8, preset.seaRepeat ?? 20);
    this.#period = WORLD.seaSize / repeat;
    for (const texture of Object.values(this.#textures)) {
      texture.repeat.set(repeat, repeat);
      texture.anisotropy = preset.anisotropy;
    }
    // Sampled with explicit UVs in the shader, so its own repeat stays at 1.
    this.#detail.normalMap.anisotropy = preset.anisotropy;

    this.#material = new MeshStandardMaterial({
      color: new Color(zone.sea.color),
      normalMap: this.#textures.normalMap,
      normalScale: new Vector2(0.11, 0.11),
      roughness: zone.sea.roughness,
      metalness: zone.sea.metalness,
      envMapIntensity: 1.05,
    });
    if (preset.waterDetail) this.#blendWaterDetail(this.#material);

    const geometry = new PlaneGeometry(WORLD.seaSize, WORLD.seaSize, preset.seaSegments, preset.seaSegments);
    geometry.rotateX(-Math.PI / 2);

    this.#sea = new Mesh(geometry, this.#material);
    this.#sea.name = 'sea';
    this.#sea.receiveShadow = false;
    this.#group.add(this.#sea);
  }

  /**
   * Blend the fine ripple into the material's normal pass, faded out with distance.
   *
   * The replacement is guarded: if the chunk is not where this version of Three keeps
   * it, the material is left with the plain swell normal map rather than being left
   * with a shader that will not compile.
   */
  #blendWaterDetail(material) {
    material.onBeforeCompile = (shader) => {
      const chunk = '#include <normal_fragment_maps>';
      if (!shader.fragmentShader.includes(chunk)) {
        console.warn('[SkyCombat] the water detail pass found no normal-map chunk; using the swell layer alone.');
        return;
      }

      shader.uniforms.uDetailMap = { value: this.#detail.normalMap };
      shader.uniforms.uDetailScale = { value: DETAIL_SCALE };
      shader.uniforms.uDetailNear = { value: DETAIL_NEAR };
      shader.uniforms.uDetailFar = { value: DETAIL_FAR };

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform sampler2D uDetailMap;
          uniform float uDetailScale;
          uniform float uDetailNear;
          uniform float uDetailFar;`,
        )
        .replace(
          chunk,
          `
          vec3 swellN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
          vec3 rippleN = texture2D( uDetailMap, vNormalMapUv * uDetailScale ).xyz * 2.0 - 1.0;
          float detailFade = 1.0 - smoothstep( uDetailNear, uDetailFar, length( vViewPosition ) );
          vec3 mapN = normalize( swellN * 0.62 + rippleN * 0.55 * detailFade );
          mapN.xy *= normalScale;
          normal = normalize( tbn * mapN );
          `,
        );
    };
    // Without this, a material patched this way can share a cached program with one
    // that was not.
    material.customProgramCacheKey = () => 'sea-water-detail';
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
    for (const texture of Object.values(this.#detail)) texture.dispose();
    this.#group.clear();
  }
}
