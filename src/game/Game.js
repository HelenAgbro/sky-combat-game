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
  Vector3,
  WebGLRenderer,
} from 'three';
import { AircraftFactory } from '../aircraft/AircraftFactory.js';
import { PlayerAircraft } from '../aircraft/PlayerAircraft.js';
import { Combat } from '../combat/Combat.js';
import { DEFAULT_AIRCRAFT_ID } from '../data/aircraft.js';
import { DEFAULT_ZONE_ID, getZone } from '../data/zones.js';
import { Pickups } from '../pickups/Pickups.js';
import { POWER_UPS } from '../pickups/powerUps.js';
import { CameraController } from '../scene/CameraController.js';
import { Clouds } from '../scene/Clouds.js';
import { DistantRidge } from '../scene/DistantRidge.js';
import { Lighting } from '../scene/Lighting.js';
import { Sky } from '../scene/Sky.js';
import { Terrain } from '../scene/Terrain.js';
import { World } from '../scene/World.js';
import { ZoneDirector } from '../scene/ZoneDirector.js';
import { PRESETS, QualityManager, pickTier, readDeviceMetrics } from '../systems/QualityManager.js';
import { DEMO_FLIGHT, RENDER } from './config.js';
import { GameState, STATES } from './GameState.js';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/** Controls centred, for the glide after a run ends. */
const COAST_INPUT = Object.freeze({
  pitch: 0,
  roll: 0,
  yaw: 0,
  throttle: 0.5,
  boost: false,
  fire: false,
});

export class Game {
  /** Bound listener handles, declared here because they are assigned in a method. */
  #onResize;
  #onVisibility;
  /** Unsubscribes the keyboard pause action. */
  #unsubscribeInput = null;

  constructor({ canvas, input = null }) {
    this.canvas = canvas;
    /** The control source. The menu backdrop flies itself, so this may be absent. */
    this.input = input;
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
    /** What ended the run — `'hull'`, `'fuel'` — or null while it is still going. */
    this.reason = null;
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

    // The atmosphere and the land. Both recycle a fixed pool of objects around the
    // aircraft rather than growing, so flying for an hour costs the same as flying for
    // a minute.
    this.clouds = new Clouds(zone, this.quality.preset);
    this.scene.add(this.clouds.group);

    this.terrain = new Terrain(zone, this.quality.preset);
    this.scene.add(this.terrain.group);

    // The horizon band: the land beyond the play area, which is what stops the world
    // being a flat line where the water meets the sky.
    this.ridge = new DistantRidge(zone, this.quality.preset);
    this.scene.add(this.ridge.group);

    /*
     * One place that decides which zone is on show and blends the move between them. The
     * modules above already know how to dress themselves for a zone; the director is what
     * hands them a blended one while a transition runs.
     */
    this.zones = new ZoneDirector(
      {
        sky: this.sky,
        world: this.world,
        lighting: this.lighting,
        clouds: this.clouds,
        terrain: this.terrain,
        ridge: this.ridge,
        renderer: this.renderer,
        scene: this.scene,
        zone,
      },
      { preset: this.quality.preset },
    );

    // The fight. Everything it owns is pooled, and it runs on the fixed step, so pausing
    // the game pauses all of it without it knowing anything about pausing.
    this.combat = new Combat({ preset: this.quality.preset });
    this.scene.add(this.combat.group);
    this.combat.on('destroyed', (payload) => this.#onDestroyed(payload));

    /*
     * Coins, fuel and power-ups. They borrow the fight's hit-flash pool rather than owning
     * a second one: a coin popping and a shot landing are the same effect with different
     * numbers, and one pool is one draw call.
     */
    this.pickups = new Pickups({
      preset: this.quality.preset,
      impacts: this.combat.impacts,
    });
    this.scene.add(this.pickups.group);

    this.factory = new AircraftFactory({
      anisotropy: this.quality.preset.anisotropy,
      paintTextureSize: this.quality.preset.paintTextureSize,
    });
    const { aircraft, group, source, effects } = await this.factory.create(DEFAULT_AIRCRAFT_ID);
    this.aircraft = new PlayerAircraft({ aircraft, model: group, source, effects });
    this.scene.add(this.aircraft.object3D);

    this.cameraRig = new CameraController(this.camera);
    this.cameraRig.snap(this.aircraft);

    // One key press, one toggle: the InputManager reports the edge, not the held key.
    this.#unsubscribeInput = this.input?.on('pause', () => this.togglePause()) ?? null;

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
      zone: this.zones?.zone.id ?? 'none',
      /** Scene budget: what the atmosphere and the land are actually costing. */
      clouds: this.clouds?.count ?? 0,
      islands: this.terrain?.placed ?? 0,
      islandCapacity: this.terrain?.capacity ?? 0,
      /** Whether the airframe has moving control surfaces to deflect. */
      controlSurfaces: Boolean(this.aircraft?.surfaces),
      /** Where the nose is pointing on screen, as a percentage of the frame. */
      reticle: this.#projectReticle(),
      ...(this.combat?.telemetry() ?? {}),
      ...(this.pickups?.telemetry() ?? {}),
      ...(this.aircraft?.telemetry() ?? {}),
      /** What ended the run, or null while it is still going. */
      reason: this.reason ?? null,
    };
  }

  /**
   * Project a point far down the aircraft's own nose into screen space.
   *
   * The reticle has to be where the gun is pointing, not in the middle of the frame: the
   * chase camera sits above and behind the aircraft, so the nose is not at the centre and
   * moves around the frame as the aircraft pitches and rolls.
   */
  #projectReticle() {
    if (!this.camera || !this.aircraft) return null;
    this.#reticlePoint
      .copy(this.aircraft.renderPosition)
      .addScaledVector(this.aircraft.forward, 600)
      .project(this.camera);

    return {
      x: (this.#reticlePoint.x * 0.5 + 0.5) * 100,
      y: (-this.#reticlePoint.y * 0.5 + 0.5) * 100,
      // A point behind the camera projects to nonsense; the HUD hides it instead.
      onScreen: this.#reticlePoint.z <= 1,
    };
  }

  #reticlePoint = new Vector3();

  /** Begin a flight. */
  start() {
    this.aircraft.reset();
    this.combat?.reset();
    // A run starts clean: no coins from the last one, no fuel carried over, and no
    // power-up still ticking.
    this.pickups?.reset();
    this.reason = null;
    this.cameraRig.snap(this.aircraft);
    this.accumulator = 0;
    if (!this.state.set(STATES.FLYING)) return false;
    this.#run();
    return true;
  }

  /**
   * Move to another scenery zone over `seconds`.
   *
   * The architecture for later transitions: one call, and the sky, the water, the fog, the
   * light, the clouds and the land all cross-fade together. Only the coastal zone is
   * polished so far — see docs/SCENERY.md.
   *
   * @param {string} id
   * @param {{seconds?:number}} [options]
   */
  setZone(id, options) {
    return this.zones?.setZone(id, options) ?? false;
  }

  /**
   * Hold the flight. The scene keeps rendering, which is what makes a pause look
   * like a pause rather than a freeze — and means pause never needs a second loop.
   * @returns {boolean} whether the state actually changed
   */
  pause() {
    if (!this.state.set(STATES.PAUSED)) return false;
    this.emit('paused');
    return true;
  }

  /** Release the hold. Safe to call when not paused. */
  resume() {
    if (this.state.is(STATES.PAUSED)) {
      this.state.set(STATES.FLYING);
      this.emit('resumed');
    }
    this.#run();
    return true;
  }

  /** What the pause key does: one press, one change, whichever way it goes. */
  togglePause() {
    if (this.state.is(STATES.FLYING)) return this.pause();
    if (this.state.is(STATES.PAUSED)) return this.resume();
    return false;
  }

  /** Return to the menu, keeping the aircraft flying as a backdrop. */
  toMenu() {
    if (this.state.is(STATES.ERROR)) return false;
    this.state.set(STATES.MENU);
    this.aircraft.reset();
    this.combat?.reset();
    this.pickups?.reset();
    this.reason = null;
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

    /*
     * Interpolate the rendered transform between the last two simulation states.
     * Without this, a display refreshing faster than the 60 Hz simulation — or one
     * whose frame times straddle the step boundary — shows the aircraft frozen for
     * several frames and then jumping, which reads as a shiver or a ghosted jet.
     */
    this.aircraft.sync(this.accumulator / step);
    this.aircraft.updateEffects(dt);

    const focus = this.aircraft.renderPosition;
    this.sky.update(this.camera);
    this.lighting.update(this.sky.sunDirection, focus);
    this.world.update(dt, focus);
    this.clouds.update(dt, this.camera, focus, this.aircraft.forward);
    this.terrain.update(focus);
    this.ridge.update(this.camera);
    // A zone transition, if one is running. Nothing happens on an ordinary frame.
    this.zones.update(dt);
    this.combat.updateVisuals(dt, this.camera);
    if (this.cameraOverride) this.cameraOverride(this.camera, this.aircraft);
    else this.cameraRig.update(dt, this.aircraft);
  }

  #simulate(step) {
    // A paused or failed game holds its last state; everything else keeps flying.
    if (this.state.is(STATES.PAUSED, STATES.ERROR)) return;

    // Flying is the player's aircraft and the fight; the menu backdrop flies itself.
    if (this.state.is(STATES.FLYING)) {
      this.aircraft.update(step, this.input?.read());
      this.pickups?.update(step, this.aircraft.controller);

      /*
       * Hand the power-ups to the systems they affect, every step, from the one place that
       * owns them. The flight model and the gun are *told* what is running rather than
       * asking, so an effect that has just expired cannot leave either of them loaded for
       * even one extra step.
       */
      const effects = this.pickups?.effects;
      if (effects) {
        this.aircraft.controller.speedBoost = effects.speedMultiplier;
        this.combat?.setSpecialAmmo(effects.damageMultiplier, POWER_UPS.ammo.colour);
      }

      this.combat.update(step, this.aircraft.controller);

      // Out of fuel ends the run, exactly like running out of hull — and exactly once,
      // because the state machine refuses a second move to RESULTS.
      if (this.aircraft.controller.fuel <= 0) this.#endRun('fuel');
      return;
    }

    // A finished run: the wreck glides on with the controls centred, rather than keeping
    // whatever the player was holding when it came apart.
    if (this.state.is(STATES.RESULTS)) {
      this.aircraft.update(step, COAST_INPUT);
      return;
    }

    this.aircraft.update(step, this.#demoInput(step));
  }

  /**
   * End the run, once.
   *
   * The two ways a run can finish — the hull reaching zero and the tank running dry — both
   * come through here. The state machine refuses a second move to RESULTS and this checks
   * the state before moving at all, so a burst of collisions in one frame, or a collision
   * on the same step the tank runs dry, cannot produce two summaries or two game overs.
   *
   * @param {'hull'|'fuel'} reason what ended it
   * @param {object} [payload] whatever the caller knows, merged into the event
   * @returns {boolean} whether the run actually ended
   */
  #endRun(reason, payload = {}) {
    if (!this.state.is(STATES.FLYING)) return false;

    this.reason = reason;
    this.state.set(STATES.RESULTS);
    this.emit('destroyed', { ...payload, ...this.telemetry() });
    return true;
  }

  /** The player's aircraft has been destroyed. */
  #onDestroyed(payload) {
    this.#endRun('hull', payload);
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
    this.#unsubscribeInput?.();
    this.#unsubscribeInput = null;
    window.removeEventListener('resize', this.#onResize);
    window.removeEventListener('orientationchange', this.#onResize);
    document.removeEventListener('visibilitychange', this.#onVisibility);
    this.sky?.dispose();
    this.lighting?.dispose();
    this.world?.dispose();
    this.clouds?.dispose();
    this.terrain?.dispose();
    this.ridge?.dispose();
    this.pickups?.dispose();
    this.combat?.dispose();
    this.factory?.dispose();
    this.renderer?.dispose();
    this.listeners.clear();
  }
}
