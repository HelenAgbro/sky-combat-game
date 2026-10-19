/**
 * Sky Combat — scene lighting.
 *
 * One sun with a tight shadow camera that follows the aircraft, plus sky and
 * ground bounce light. The sun's direction comes from the sky, so the highlight
 * on the aircraft always matches the sun in the background.
 */
import { AmbientLight, Color, DirectionalLight, Group, HemisphereLight, Vector3 } from 'three';

/** How far the sun sits from its focus point. Only the direction matters. */
const SUN_DISTANCE = 320;
/** Half-extent of the shadow camera, in metres. Tight, so shadows stay sharp. */
const SHADOW_EXTENT = 34;

export class Lighting {
  #group;
  #sun;
  #hemisphere;
  #ambient;
  #target;
  #preset;

  constructor(zone, preset) {
    this.#preset = preset;
    this.#group = new Group();
    this.#group.name = 'lighting';

    this.#sun = new DirectionalLight(new Color(zone.sky.sun), zone.sun.intensity);
    this.#sun.castShadow = Boolean(preset.shadows);
    this.#sun.shadow.mapSize.set(preset.shadowMapSize, preset.shadowMapSize);
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
   */
  update(sunDirection, focus) {
    this.#target.position.copy(focus);
    this.#sun.position.copy(focus).addScaledVector(sunDirection, SUN_DISTANCE);
    this.#sun.updateMatrixWorld();
  }

  dispose() {
    this.#sun.shadow?.map?.dispose();
    this.#group.clear();
  }
}
