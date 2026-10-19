/**
 * Sky Combat — procedural sky and environment.
 *
 * A single gradient dome with a haze band, a sun disc and a glow, driven by the
 * active zone's palette. The same dome is rendered into a PMREM environment map,
 * which is what gives the airframe, canopy and sea their reflections without
 * loading an HDR file (start.ng does not serve `.hdr`).
 */
import {
  BackSide,
  Color,
  Mesh,
  MathUtils,
  PMREMGenerator,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from 'three';

const VERTEX_SHADER = /* glsl */ `
  varying vec3 vDirection;
  void main() {
    vDirection = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uHaze;
  uniform vec3 uSunColor;
  uniform vec3 uSunDirection;
  varying vec3 vDirection;

  void main() {
    vec3 direction = normalize(vDirection);
    float height = direction.y;

    float rise = pow(clamp(height, 0.0, 1.0), 0.5);
    vec3 sky = mix(uHorizon, uZenith, rise);

    // Haze thickens toward the horizon, and below it fades into the same colour.
    float haze = pow(1.0 - clamp(abs(height), 0.0, 1.0), 5.0);
    sky = mix(sky, uHaze, haze * 0.65);
    sky = mix(sky, uHaze * 0.72, smoothstep(0.0, -0.22, height));

    // Sun disc, tight bloom and a broad scatter glow.
    float sun = max(dot(direction, normalize(uSunDirection)), 0.0);
    float disc = smoothstep(0.9994, 0.99985, sun);
    vec3 color = sky + uSunColor * (disc * 6.0 + pow(sun, 260.0) * 0.8 + pow(sun, 9.0) * 0.14);

    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/** Dome radius. Kept inside the camera's far plane; depth testing is off anyway. */
const DOME_RADIUS = 6000;

export class Sky {
  #renderer;
  #material;
  #mesh;
  #geometry;
  #envMap = null;
  #sunDirection = new Vector3(0, 0.4, 0.9);
  #zone;

  constructor(renderer, zone) {
    this.#renderer = renderer;

    this.#material = new ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms: {
        uZenith: { value: new Color('#1d5da8') },
        uHorizon: { value: new Color('#cfe3f2') },
        uHaze: { value: new Color('#9fc0d8') },
        uSunColor: { value: new Color('#fff4d8') },
        uSunDirection: { value: this.#sunDirection.clone() },
      },
      side: BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
    });

    this.#geometry = new SphereGeometry(1, 40, 28);
    this.#mesh = new Mesh(this.#geometry, this.#material);
    this.#mesh.scale.setScalar(DOME_RADIUS);
    this.#mesh.frustumCulled = false;
    this.#mesh.renderOrder = -1000;
    this.#mesh.name = 'sky';

    this.setZone(zone);
  }

  get mesh() {
    return this.#mesh;
  }

  /** Unit vector pointing from the world toward the sun. */
  get sunDirection() {
    return this.#sunDirection;
  }

  /** The environment map used for reflections on every material in the scene. */
  get envMap() {
    return this.#envMap;
  }

  /** Re-colour the sky for a zone and rebuild the environment map. */
  setZone(zone) {
    this.#zone = zone;
    const uniforms = this.#material.uniforms;
    uniforms.uZenith.value.set(zone.sky.zenith);
    uniforms.uHorizon.value.set(zone.sky.horizon);
    uniforms.uHaze.value.set(zone.sky.haze);
    uniforms.uSunColor.value.set(zone.sky.sun);

    const elevation = MathUtils.degToRad(zone.sun.elevation);
    const azimuth = MathUtils.degToRad(zone.sun.azimuth);
    this.#sunDirection
      .set(
        Math.cos(elevation) * Math.sin(azimuth),
        Math.sin(elevation),
        Math.cos(elevation) * Math.cos(azimuth),
      )
      .normalize();
    uniforms.uSunDirection.value.copy(this.#sunDirection);

    this.#buildEnvironment();
  }

  /** Render the dome into a pre-filtered environment map for reflections. */
  #buildEnvironment() {
    const previous = this.#envMap;
    const generator = new PMREMGenerator(this.#renderer);
    const scene = new Scene();
    const dome = new Mesh(this.#geometry, this.#material);
    dome.frustumCulled = false;
    scene.add(dome);

    try {
      const target = generator.fromScene(scene, 0, 0.1, 1000);
      this.#envMap = target.texture;
    } catch (error) {
      console.warn('[SkyCombat] could not build the environment map; reflections are disabled.', error);
      this.#envMap = null;
    } finally {
      generator.dispose();
      scene.remove(dome);
      previous?.dispose();
    }
  }

  /** Keep the dome centred on the camera so the horizon never moves. */
  update(camera) {
    this.#mesh.position.copy(camera.position);
  }

  dispose() {
    this.#geometry.dispose();
    this.#material.dispose();
    this.#envMap?.dispose();
    this.#envMap = null;
  }
}
