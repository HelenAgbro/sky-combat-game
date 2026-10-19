/**
 * Sky Combat — scene lighting.
 *
 * One sun with a tight shadow camera that follows the aircraft, plus sky and
 * ground bounce light. The sun's direction comes from the sky, so the highlight
 * on the aircraft always matches the sun in the background.
 *
 * One sun is deliberate. A second shadow-casting light would double the shadow cost
 * for a scene whose only shadow-receiving object is the aircraft itself; the sky and
 * ground bounce the environment map provides do the rest of the work.
 */
import { AmbientLight, Color, DirectionalLight, Group, HemisphereLight, Vector3 } from 'three';

/** How far the sun sits from its focus point. Only the direction matters. */
const SUN_DISTANCE = 320;
/** Half-extent of the shadow camera, in metres. Tight, so shadows stay sharp. */
const SHADOW_EXTENT = 34;
/** Fallback axis for the light basis, when the sun is directly overhead. */
const WORLD_UP = new Vector3(0, 1, 0);

export class Lighting {
  #group;
  #sun;
  #hemisphere;
  #ambient;
  #target;
  #preset;
  #shadowMapSize;
  /** Reused: the snapped focus, and the light's own basis for snapping it. */
  #focus = new Vector3();
  #right = new Vector3();
  #up = new Vector3();

  constructor(zone, preset) {
    this.#preset = preset;
    this.#group = new Group();
    this.#group.name = 'lighting';

    this.#sun = new DirectionalLight(new Color(zone.sky.sun), zone.sun.intensity);
    this.#sun.castShadow = Boolean(preset.shadows);
    this.#shadowMapSize = preset.shadowMapSize || 1024;
    this.#sun.shadow.mapSize.set(this.#shadowMapSize, this.#shadowMapSize);
    this.#sun.shadow.camera.left = -SHADOW_EXTENT;
    this.#sun.shadow.camera.right = SHADOW_EXTENT;
    this.#sun.shadow.camera.top = SHADOW_EXTENT;
    this.#sun.shadow.camera.bottom = -SHADOW_EXTENT;
    this.#sun.shadow.camera.near = 1;
    this.#sun.shadow.camera.far = SUN_DISTANCE * 2;
    this.#sun.shadow.bias = -0.0006;
    this.#sun.shadow.normalBias = 0.05;

    this.#target = new Group();
    this.#sun.target = this.#target;

    this.#hemisphere = new HemisphereLight(
      new Color(zone.sky.horizon),
      new Color(zone.sea.color),
      zone.ambient.intensity,
    );

    this.#ambient = new AmbientLight(new Color(zone.ambient.color), zone.ambient.intensity * 0.35);

    this.#group.add(this.#sun, this.#target, this.#hemisphere, this.#ambient);
  }

  get group() {
    return this.#group;
  }

  get sun() {
    return this.#sun;
  }

  /** Re-tune the lights for a zone. */
  setZone(zone) {
    this.#sun.color.set(zone.sky.sun);
    this.#sun.intensity = zone.sun.intensity;
    this.#hemisphere.color.set(zone.sky.horizon);
    this.#hemisphere.groundColor.set(zone.sea.color);
    this.#hemisphere.intensity = zone.ambient.intensity;
    this.#ambient.color.set(zone.ambient.color);
    this.#ambient.intensity = zone.ambient.intensity * 0.35;
  }

  /**
   * Keep the sun and its shadow frustum anchored to the aircraft, so shadows are
   * always sharp near the player and never run out at the edge of the map.
   *
   * The focus is snapped to the shadow map's own texel grid, measured along the
   * light's basis vectors. Without it, every sub-texel move of the aircraft
   * re-rasterises the map against a slightly shifted sample grid and the shadow edge
   * crawls and shimmers — the single most visible artefact of a tight shadow camera.
   */
  update(sunDirection, focus) {
    const texel = (SHADOW_EXTENT * 2) / this.#shadowMapSize;

    // A basis perpendicular to the light. `right` can be degenerate when the sun is
    // straight overhead, so it falls back to a fixed axis.
    this.#right.crossVectors(sunDirection, WORLD_UP);
    if (this.#right.lengthSq() < 1e-6) this.#right.set(1, 0, 0);
    else this.#right.normalize();
    this.#up.crossVectors(this.#right, sunDirection).normalize();

    const alongRight = focus.dot(this.#right);
    const alongUp = focus.dot(this.#up);
    this.#focus
      .copy(focus)
      .addScaledVector(this.#right, Math.round(alongRight / texel) * texel - alongRight)
      .addScaledVector(this.#up, Math.round(alongUp / texel) * texel - alongUp);

    this.#target.position.copy(this.#focus);
    this.#sun.position.copy(this.#focus).addScaledVector(sunDirection, SUN_DISTANCE);
    this.#sun.updateMatrixWorld();
  }

  dispose() {
    this.#sun.shadow?.map?.dispose();
    this.#group.clear();
  }
}
