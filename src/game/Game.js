/**
 * Sky Combat — the game.
 *
 * Owns the renderer, the scene, the systems and the loop. The simulation runs on
 * a fixed step so behaviour is identical on every device, while rendering happens
 * once per animation frame. The camera reads the aircraft after the simulation has
 * been stepped, so it never lags a frame behind.
 *
 * Stage 2 flies a scripted demonstration sortie so the scene, the lighting and the
 * camera can be judged. Player input arrives in Stage 3.
 */
import {
  ACESFilmicToneMapping,
  Color,
  Fog,
  PCFSoftShadowMap,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
} from 'three';
import { AircraftFactory } from '../aircraft/AircraftFactory.js';
import { PlayerAircraft } from '../aircraft/PlayerAircraft.js';
import { DEFAULT_AIRCRAFT_ID } from '../data/aircraft.js';
import { DEFAULT_ZONE_ID, getZone } from '../data/zones.js';
import { CameraController } from '../scene/CameraController.js';
import { Lighting } from '../scene/Lighting.js';
import { Sky } from '../scene/Sky.js';
import { World } from '../scene/World.js';
import { PRESETS, QualityManager, pickTier, readDeviceMetrics } from '../systems/QualityManager.js';
import { DEMO_FLIGHT, RENDER } from './config.js';
import { GameState, STATES } from './GameState.js';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export class Game {
  /** Bound listener handles, declared here because they are assigned in a method. */
  #onResize;
  #onVisibility;

  constructor({ canvas }) {
    this.canvas = canvas;
    this.state = new GameState(STATES.BOOT);
    this.listeners = new Map();
    this.accumulator = 0;
    this.demoTime = 0;
    this.frameCount = 0;
    this.frameMs = 0;
    this.lastTime = 0;
    this.started = false;
    /** While true the aircraft flies the scripted Stage 2 sortie. */
    this.demo = true;
    /** When set, replaces the chase camera. Used by the cover renderer. */
    this.cameraOverride = null;
  }

  /** Take manual control of the camera, or pass null to hand it back to the rig. */
  setCameraOverride(handler) {
    this.cameraOverride = handler;
  }

  /** Build the renderer, the scene and the aircraft. Throws when WebGL is missing. */
  async init() {
    this.state.set(STATES.LOADING);

    const metrics = readDeviceMetrics();
    if (!metrics.webgl) {
      throw new Error('WebGL is not available in this browser');
    }

    const tier = pickTier(metrics);
    const preset = PRESETS[tier];
    const zone = getZone(DEFAULT_ZONE_ID);
    this.zone = zone;

    this.renderer = new WebGLRenderer({
      canvas: this.canvas,
      antialias: preset.antialias,
      alpha: false,
      stencil: false,
      powerPreference: 'high-performance',
    });
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = zone.exposure;
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.shadowMap.enabled = preset.shadows;
    this.renderer.shadowMap.type = PCFSoftShadowMap;

    this.quality = new QualityManager(this.renderer, { metrics, forcedTier: tier });
    this.quality.resize();

    this.scene = new Scene();
    this.scene.background = new Color(zone.sky.horizon);
    this.scene.fog = new Fog(new Color(zone.fog.color), zone.fog.near, zone.fog.far);

    this.camera = new PerspectiveCamera(RENDER.fov, this.#aspect(), RENDER.near, RENDER.far);
    this.camera.position.set(0, 430, 20);

    this.sky = new Sky(this.renderer, zone);
    this.scene.add(this.sky.mesh);
    this.scene.environment = this.sky.envMap;

    this.lighting = new Lighting(zone, this.quality.preset);
    this.scene.add(this.lighting.group);

    this.world = new World(zone, this.quality.preset);
    this.scene.add(this.world.group);

    this.factory = new AircraftFactory({ anisotropy: this.quality.preset.anisotropy });
    const { aircraft, group, source } = await this.factory.create(DEFAULT_AIRCRAFT_ID);
    this.aircraft = new PlayerAircraft({ aircraft, model: group, source });
    this.scene.add(this.aircraft.object3D);

    this.cameraRig = new CameraController(this.camera);
    this.cameraRig.snap(this.aircraft);

    this.#addEventListeners();
    this.state.set(STATES.MENU);

    // Start the loop immediately: the demonstration sortie is the menu's backdrop,
    // so the menu must never sit in front of an unrendered canvas.
    this.#run();
    return this;
  }

  get tier() {
    return this.quality?.tier ?? 'unknown';
  }

  /** Everything the HUD, the results screen and the tests need to read. */
  telemetry() {
    return {
      state: this.state.current,
      tier: this.tier,
      renderScale: this.quality?.renderScale ?? 1,
      frameMs: this.frameMs,
      frameCount: this.frameCount,
      modelSource: this.aircraft?.source ?? 'none',
      ...(this.aircraft?.telemetry() ?? {}),
    };
  }

  /** Begin a flight. */
  start() {
    this.aircraft.controller.reset();
    this.cameraRig.snap(this.aircraft);
    this.accumulator = 0;
    if (!this.state.set(STATES.FLYING)) return false;
    this.#run();
    return true;
  }

  pause() {
    if (this.state.set(STATES.PAUSED)) this.emit('paused');
  }

  resume() {
    if (this.state.is(STATES.PAUSED)) this.state.set(STATES.FLYING);
    this.#run();
  }

  /** Return to the menu, keeping the aircraft flying as a backdrop. */
  toMenu() {
    if (this.state.is(STATES.ERROR)) return false;
    this.state.set(STATES.MENU);
    this.aircraft.controller.reset();
    this.cameraRig.snap(this.aircraft);
    this.#run();
    return true;
  }

  on(event, listener) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(listener);
    return () => this.listeners.get(event)?.delete(listener);
  }

  emit(event, payload) {
    for (const listener of this.listeners.get(event) ?? []) {
      try {
        listener(payload);
      } catch (error) {
        console.error(`[SkyCombat] listener for "${event}" failed`, error);
      }
    }
  }

  /** Start the animation loop. Safe to call more than once. */
  #run() {
    if (this.started) return;
    this.started = true;
    this.lastTime = performance.now();
    this.renderer.setAnimationLoop(this.#tick);
  }

  #aspect() {
    const width = this.canvas.clientWidth || window.innerWidth;
    const height = this.canvas.clientHeight || window.innerHeight;
    return height > 0 ? width / height : 16 / 9;
  }

  #tick = (now) => {
    const dt = Math.min(0.25, Math.max(0, (now - this.lastTime) / 1000));
    this.lastTime = now;
    this.frameMs = dt * 1000;
    this.frameCount += 1;

    this.#update(dt);
    this.renderer.render(this.scene, this.camera);
    this.quality.update(this.frameMs);
    this.emit('frame', this.telemetry());
  };

  /** One frame: fixed-step simulation first, then the presentation layer. */
  #update(dt) {
    const step = RENDER.fixedStep;
    this.accumulator = Math.min(this.accumulator + dt, step * RENDER.maxSubSteps);
    while (this.accumulator >= step) {
      this.#simulate(step);
      this.accumulator -= step;
    }

    this.sky.update(this.camera);
    this.lighting.update(this.sky.sunDirection, this.aircraft.position);
    this.world.update(dt, this.aircraft.position);
    if (this.cameraOverride) this.cameraOverride(this.camera, this.aircraft);
    else this.cameraRig.update(dt, this.aircraft);
  }

  #simulate(step) {
    // A paused or failed game holds its last state; everything else keeps flying.
    if (this.state.is(STATES.PAUSED, STATES.ERROR)) return;
    this.aircraft.update(step, this.#demoInput(step));
  }

  /**
   * Stage 2's scripted flight: a stable S-turn with a gentle altitude hold, so the
   * camera, the lighting and the reflections are all moving and can be judged.
   *
   * Roll is commanded as a *bank angle* and turned into a roll rate by a simple
   * proportional controller. Commanding a roll rate directly would roll the
   * aircraft continuously and end up inverted. Stage 3 replaces this with input.
   */
  #demoInput(step) {
    this.demoTime += step;
    const aircraft = this.aircraft.controller;
    const altitudeCorrection =
      (DEMO_FLIGHT.altitudeHold - aircraft.altitude) * DEMO_FLIGHT.altitudeGain;

    const targetBank = this.demo
      ? Math.sin((this.demoTime / DEMO_FLIGHT.bankPeriod) * Math.PI * 2) * DEMO_FLIGHT.bankAmplitude
      : 0;
    const roll = clamp((aircraft.bankAngle - targetBank) * DEMO_FLIGHT.bankGain, -1, 1);

    const pitch = this.demo
      ? Math.sin((this.demoTime / DEMO_FLIGHT.pitchPeriod) * Math.PI * 2) * DEMO_FLIGHT.pitchAmplitude +
        altitudeCorrection
      : altitudeCorrection;

    return {
      roll,
      pitch: clamp(pitch, -1, 1),
      throttle: DEMO_FLIGHT.throttle,
      boost: false,
    };
  }

  #addEventListeners() {
    this.#onResize = () => {
      this.quality.resize();
      this.camera.aspect = this.#aspect();
      this.camera.updateProjectionMatrix();
    };
    this.#onVisibility = () => {
      if (document.hidden) {
        this.renderer.setAnimationLoop(null);
      } else if (this.started) {
        this.lastTime = performance.now();
        this.renderer.setAnimationLoop(this.#tick);
      }
    };

    window.addEventListener('resize', this.#onResize);
    window.addEventListener('orientationchange', this.#onResize);
    document.addEventListener('visibilitychange', this.#onVisibility);
  }

  /** Stop everything and release GPU resources. */
  dispose() {
    this.renderer.setAnimationLoop(null);
    this.started = false;
    window.removeEventListener('resize', this.#onResize);
    window.removeEventListener('orientationchange', this.#onResize);
    document.removeEventListener('visibilitychange', this.#onVisibility);
    this.sky?.dispose();
    this.lighting?.dispose();
    this.world?.dispose();
    this.factory?.dispose();
    this.renderer?.dispose();
    this.listeners.clear();
  }
}
