/**
 * Sky Combat — the cloud layer.
 *
 * Two things, both cheap:
 *
 * 1. **Cumulus**, as a single `InstancedMesh` of camera-facing cards. One draw call
 *    for the whole field. The field lives in a ring around the aircraft and is
 *    recycled in place — a cloud that falls outside the ring is moved to a new spot
 *    ahead of the player — so the sky is never empty and nothing is ever created or
 *    destroyed in flight.
 * 2. **Cirrus**, one large card high above, following the camera and drifting.
 *
 * There are deliberately no volumetric clouds and no shadow casting: a cloud layer
 * that costs a second shadow pass is not worth the frame time on a phone.
 */
import {
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PlaneGeometry,
} from 'three';
import { createCirrusTexture, createCloudTexture } from '../assets/textures.js';
import { createSeededRandom } from '../game/math.js';
import { CLOUD_FIELD, placeCloud, shouldRecycle } from './cloudLayout.js';

/** How high the cirrus sheet sits, and how far it reaches. Inside the far plane. */
const CIRRUS_ALTITUDE = 3400;
const CIRRUS_SIZE = 16000;
/** Metres of cirrus per tile, which is also the distance the sheet snaps to. */
const CIRRUS_TILE = 4000;

export class Clouds {
  #group;
  #mesh = null;
  #geometry = null;
  #material = null;
  #cloudTexture;
  #cirrus;
  #cirrusGeometry;
  #cirrusMaterial;
  #cirrusTexture;
  #clouds = [];
  #random;
  #dummy = new Object3D();
  #color = new Color();
  #focus = { x: 0, z: 0 };
  #forward = { x: 0, z: -1 };
  #count = 0;
  /** Fraction of the field the active zone keeps. Set by `setZone`. */
  #coverage = 1;

  constructor(zone, preset) {
    this.#group = new Group();
    this.#group.name = 'clouds';

    // A fixed seed, so the sky is the same sky on every run and every machine.
    this.#random = createSeededRandom(48271);
    this.#count = Math.max(0, preset.clouds ?? 0);

    this.#cloudTexture = createCloudTexture({ size: preset.cloudTextureSize ?? 256 });
    this.#cirrusTexture = createCirrusTexture({ size: preset.cloudTextureSize ?? 256 });

    if (this.#count > 0) {
      // The card matches the texture's aspect (wider than tall) so the art is not
      // stretched, and one card is shared by every cloud in the field.
      this.#geometry = new PlaneGeometry(1, 0.6);
      this.#material = new MeshBasicMaterial({
        map: this.#cloudTexture,
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
        // Distant clouds fade into the haze, which is what gives the sky depth.
        fog: true,
        opacity: 1,
      });

      this.#mesh = new InstancedMesh(this.#geometry, this.#material, this.#count);
      this.#mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      this.#mesh.frustumCulled = false;
      this.#mesh.renderOrder = 1;
      this.#mesh.name = 'cumulus';
      this.#group.add(this.#mesh);

      // Seed the field around the origin; `update` recycles from the aircraft's real
      // position on the first frame.
      for (let i = 0; i < this.#count; i += 1) {
        const cloud = placeCloud(this.#random, this.#focus, this.#forward, CLOUD_FIELD, {});
        this.#clouds.push(cloud);
        this.#mesh.setColorAt(i, this.#color.setScalar(cloud.brightness));
      }
      this.#mesh.instanceColor.needsUpdate = true;
    }

    this.#cirrusGeometry = new PlaneGeometry(CIRRUS_SIZE, CIRRUS_SIZE);
    this.#cirrusGeometry.rotateX(-Math.PI / 2);
    this.#cirrusTexture.repeat.set(CIRRUS_SIZE / CIRRUS_TILE, CIRRUS_SIZE / CIRRUS_TILE);
    this.#cirrusMaterial = new MeshBasicMaterial({
      map: this.#cirrusTexture,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      fog: false,
      opacity: 0.5,
    });
    this.#cirrus = new Mesh(this.#cirrusGeometry, this.#cirrusMaterial);
    this.#cirrus.position.y = CIRRUS_ALTITUDE;
    this.#cirrus.frustumCulled = false;
    // Drawn before the cumulus, so a cloud is never hidden behind the sheet.
    this.#cirrus.renderOrder = -1;
    this.#cirrus.name = 'cirrus';
    this.#group.add(this.#cirrus);

    this.setZone(zone);
  }

  get group() {
    return this.#group;
  }

  /** How many cumulus cards are live. Read by the tests. */
  get count() {
    return this.#count;
  }

  /** Re-tint the sky for a zone: thicker and darker in a storm, thin and bright at sea. */
  setZone(zone) {
    const palette = zone.clouds ?? {};
    if (this.#material) {
      this.#material.color.set(palette.color ?? '#ffffff');
      this.#material.opacity = palette.opacity ?? 0.92;
    }
    this.#cirrusMaterial.color.set(palette.cirrus ?? '#ffffff');
    this.#cirrusMaterial.opacity = palette.cirrusOpacity ?? 0.5;
    this.#coverage = palette.coverage ?? 1;
  }

  /**
   * Recycle anything that has fallen out of the ring, then re-place every card.
   *
   * Nothing here allocates: the cloud records, the instance matrices, the colours and
   * the scratch `Object3D` are all reused.
   *
   * @param {number} dt seconds
   * @param {import('three').Camera} camera
   * @param {{x:number, z:number}} focus the aircraft
   * @param {{x:number, z:number}} forward the aircraft's heading
   */
  update(dt, camera, focus, forward) {
    if (!this.#mesh) {
      this.#driftCirrus(dt, camera);
      return;
    }

    const field = CLOUD_FIELD;
    let colorsDirty = false;

    for (let i = 0; i < this.#count; i += 1) {
      const cloud = this.#clouds[i];
      if (shouldRecycle(cloud, focus, field)) {
        const brightness = cloud.brightness;
        placeCloud(this.#random, focus, forward, field, cloud);
        // Keep the card's tone: the colour is written once per recycle, not per frame.
        cloud.brightness = brightness;
        colorsDirty = true;
      }

      const hidden = cloud.coverage > this.#coverage;
      const yaw = Math.atan2(camera.position.x - cloud.x, camera.position.z - cloud.z);
      this.#dummy.position.set(cloud.x, cloud.y, cloud.z);
      this.#dummy.rotation.set(0, yaw, 0);
      const scale = hidden ? 0 : cloud.scale;
      this.#dummy.scale.set(scale, scale, 1);
      this.#dummy.updateMatrix();
      this.#mesh.setMatrixAt(i, this.#dummy.matrix);

      if (colorsDirty) this.#mesh.setColorAt(i, this.#color.setScalar(cloud.brightness));
    }

    this.#mesh.instanceMatrix.needsUpdate = true;
    if (colorsDirty) this.#mesh.instanceColor.needsUpdate = true;

    this.#driftCirrus(dt, camera);
  }

  /**
   * Keep the cirrus sheet centred on the camera, snapped to its own tile, so the
   * pattern stays locked to the world instead of sliding along with the player.
   */
  #driftCirrus(dt, camera) {
    this.#cirrus.position.x = Math.round(camera.position.x / CIRRUS_TILE) * CIRRUS_TILE;
    this.#cirrus.position.z = Math.round(camera.position.z / CIRRUS_TILE) * CIRRUS_TILE;

    const offset = this.#cirrusTexture.offset;
    offset.x = (offset.x + dt * 0.0016) % 1;
    offset.y = (offset.y + dt * 0.0004) % 1;
  }

  dispose() {
    this.#geometry?.dispose();
    this.#material?.dispose();
    this.#cloudTexture?.dispose();
    this.#cirrusGeometry?.dispose();
    this.#cirrusMaterial?.dispose();
    this.#cirrusTexture?.dispose();
    this.#clouds.length = 0;
    this.#group.clear();
  }
}
