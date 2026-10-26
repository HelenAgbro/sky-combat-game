/**
 * Sky Combat — the game.
 *
 * Owns the renderer, the scene, the systems and the loop. The simulation runs on
 * a fixed step so behaviour is identical on every device, while rendering happens
 * once per animation frame. The camera reads the aircraft after the simulation has
 * been stepped, so it never lags a frame behind.
 *
 * A run is the whole of a flight: the menu backdrop, the flight, the pause and the summary.
 * The rules it follows live in `run/` (distance, fuel, pickups, the local record) and in
 * `combat/difficulty.js` (the ramp), and never in here; this class is where those rules meet
 * the loop, the scene and the state machine, and where the run ends exactly once.
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
import { Pickups } from '../run/Pickups.js';
import { RunState } from '../run/RunState.js';
import { addFuel, isFuelEmpty } from '../run/fuel.js';
import { readBestDistance, recordBestDistance, resolveStorage } from '../run/progress.js';
import { CameraController } from '../scene/CameraController.js';
import { Clouds } from '../scene/Clouds.js';
import { DistantRidge } from '../scene/DistantRidge.js';
import { Lighting } from '../scene/Lighting.js';
import { Sky } from '../scene/Sky.js';
import { Terrain } from '../scene/Terrain.js';
import { World } from '../scene/World.js';
import { ZoneDirector } from '../scene/ZoneDirector.js';
import { PRESETS, QualityManager, pickTier, readDeviceMetrics } from '../systems/QualityManager.js';
import { RUN, DEMO_FLIGHT, RENDER } from './config.js';
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
  /**
   * A finished run's numbers, frozen at the moment it ended.
   *
   * The wreck keeps flying while the summary is on screen, and so its odometer would keep
   * climbing; the run's distance is the distance it had when it ended, not the distance the
   * camera watched afterwards. `null` while no run has ended since the last start.
   */
  #summary = null;

  constructor({ canvas, input = null, storage = resolveStorage() }) {
    this.canvas = canvas;
    /** The control source. The menu backdrop flies itself, so this may be absent. */
    this.input = input;
    /**
     * Where the local best distance is kept. `null` when the browser has no usable store, in
     * which case the record simply lives for the session (`src/run/progress.js`).
     */
    this.storage = storage;
    /** The best distance this browser has flown, loaded at boot and banked at every run end. */
    this.bestDistance = 0;
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

    // The one thing that survives a reload. Read before anything can start a run, so the menu
    // can show it and the first run can be compared against it.
    this.bestDistance = readBestDistance(this.storage);

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
     * What the run has collected. Coins, fuel and power-ups are placed ahead of the aircraft
     * on the same recycled-grid principle as the fight, and their flashes borrow the fight's
     * impact pool rather than owning one — one draw call of feedback for the whole game.
     */
    this.run = new RunState();
    this.pickups = new Pickups({
      preset: this.quality.preset,
      flash: (position, options) => this.combat.impacts.spawn(position, options),
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
      /**
       * Coins, the power-up slots and the longest countdown, from `RunState`. The slots are
       * the same objects every frame, so the HUD can read them without anything being
       * allocated.
       */
      ...(this.run?.snapshot() ?? {}),
      /** What is in the sky, for the tests and the scene budget readout. */
      coinsInAir: this.pickups?.coinsActive ?? 0,
      fuelInAir: this.pickups?.fuelActive ?? 0,
      powerInAir: this.pickups?.powerActive ?? 0,
      pickupCapacity: this.pickups?.capacity ?? 0,
      ...(this.combat?.telemetry() ?? {}),
      ...(this.aircraft?.telemetry() ?? {}),
      /*
       * A finished run's numbers, spread last so they win over the live aircraft's odometer:
       * the wreck keeps flying while the summary is up, but the run does not keep scoring.
       */
      ...(this.#summary ?? {}),
      /** The local record, and whether the run that just ended beat it. */
      bestDistance: this.bestDistance,
      newBest: this.#summary?.newBest ?? false,
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

  /** Begin a flight. Nothing a previous run collected survives into this one. */
  start() {
    // The previous run's summary is what the results screen showed; a new run starts clean and
    // the local record is deliberately not part of that (it is the one thing that carries over).
    this.#summary = null;
    this.aircraft.reset();
    this.combat?.reset();
    this.run?.reset();
    this.pickups?.reset();
    // Belt and braces: the gun is unloaded explicitly rather than by relying on `reset`.
    this.combat?.setSpecialAmmo(false);
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
   *
   * Only a live flight can be paused. Asking from the menu or the results screen answers
   * `false` without touching the state machine, so a stray key press cannot print a refused
   * transition or interrupt a summary the player is reading.
   *
   * @returns {boolean} whether the state actually changed
   */
  pause() {
    if (!this.state.is(STATES.FLYING)) return false;
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
    this.#summary = null;
    this.state.set(STATES.MENU);
    this.aircraft.reset();
    this.combat?.reset();
    this.run?.reset();
    this.pickups?.reset();
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
    this.pickups.updateVisuals(dt, this.camera);
    if (this.cameraOverride) this.cameraOverride(this.camera, this.aircraft);
    else this.cameraRig.update(dt, this.aircraft);
  }

  #simulate(step) {
    // A paused or failed game holds its last state; everything else keeps flying.
    if (this.state.is(STATES.PAUSED, STATES.ERROR)) return;

    // Flying is the player's aircraft, the fight and what the run has collected; the menu
    // backdrop flies itself.
    if (this.state.is(STATES.FLYING)) {
      this.#simulateFlight(step);
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
   * One fixed step of a live flight: fly, fight, collect, then let the clocks run.
   *
   * The order matters. The aircraft moves first, because everything else reacts to where it
   * is; the fight runs next, because a hull loss has to end the run before anything is
   * credited to it; collection comes after that, so a coin is only ever counted for an
   * aircraft that is still flying.
   */
  #simulateFlight(step) {
    const controller = this.aircraft.controller;

    this.aircraft.update(step, this.input?.read());
    this.combat.update(step, controller);

    // The hull reaching zero ends the run from inside the fight, which changes the state
    // half-way through this step. Nothing is left to credit after that.
    if (!this.state.is(STATES.FLYING)) return;

    this.pickups.update(step, controller);
    this.#collectPickups(controller);
    this.run.update(step);
    this.#applyPowerups();

    // Fuel is the other way a run can end. `#endRun` refuses a second ending, so arriving
    // here in the same step as a hull loss costs nothing.
    if (isFuelEmpty(controller.fuel)) this.#endRun('fuel');
  }

  /** Credit whatever the aircraft has just flown through. */
  #collectPickups(controller) {
    const taken = this.pickups.collect(controller);

    if (taken.coins > 0) this.run.addCoins(taken.coins);

    if (taken.fuel > 0) {
      controller.fuel = addFuel(controller.fuel, taken.fuel);
      this.emit('refuelled', { fuel: controller.fuel });
    }

    // One orb, one effect: the orb was released before it was reported, so the same pickup
    // cannot start the same power-up twice.
    for (let i = 0; i < taken.power.length; i += 1) this.#startPowerup(taken.power[i]);
  }

  /** Start or refresh a power-up, and make its effect live immediately. */
  #startPowerup(id) {
    const result = this.run.activatePowerup(id);
    if (result === 'ignored') return;

    this.#applyPowerups();
    this.emit('powerup', { id, result, remaining: this.run.remaining(id) });
  }

  /**
   * Make the world match the power-up timers.
   *
   * State is the truth and the effects follow it, every step — nothing is switched on by one
   * event and off by another. A missed event cannot leave a boost running or the gun loaded,
   * and a timer that expires mid-frame is reflected in the same frame.
   */
  #applyPowerups() {
    const controller = this.aircraft.controller;
    controller.speedScale = this.run.isActive('boost') ? RUN.powerups.boostSpeedScale : 1;

    if (this.combat?.setSpecialAmmo(this.run.isActive('special'), RUN.powerups)) {
      this.emit('ammo', { special: this.combat.specialAmmo });
    }
  }

  /**
   * End the run, once, for any reason.
   *
   * The one door out of `FLYING`, so everything that must happen at the end happens here and in
   * this order: stop the fight, freeze the numbers, stop the effects, move the state, report.
   * A hull loss and an empty tank both arrive here, and the second call — whichever it is —
   * is refused by the first line.
   *
   * @param {string} reason `'fuel'`, or the source the fight reported (`'gunfire'`, ...)
   * @param {object|null} [detail] extra fields from the fight
   * @returns {boolean} whether this call ended it
   */
  #endRun(reason, detail = null) {
    if (!this.state.is(STATES.FLYING)) return false;
    // Stop the fight even when it did not cause this: fuel ends a run the hull never saw.
    this.combat?.finish();

    // Freeze the run before anything else can move — the same fixed step that would carry the
    // wreck onwards would also carry the odometer and the clocks.
    this.#summary = this.#freezeRun(reason);

    // The effects end with the run. The clocks are stopped and then applied through the same
    // state-to-effect path the flight uses, so no boost or loaded gun outlives the aircraft.
    this.run?.clearPowerups();
    this.#applyPowerups();

    this.state.set(STATES.RESULTS);
    this.emit('destroyed', { ...(detail ?? {}), ...this.telemetry() });
    return true;
  }

  /**
   * Take a copy of everything the run earned, and bank the record.
   *
   * The summary is the run's own account of itself, not a live reading: distance, time, coins,
   * kills, score and accuracy are all captured here, once. It is also the only place the local
   * record is written, so a run can be replayed without ever touching the store twice.
   *
   * @param {string} reason
   * @returns {object} frozen
   */
  #freezeRun(reason) {
    const controller = this.aircraft.controller;
    const fight = this.combat?.telemetry() ?? {};

    const distance = Math.max(0, controller.distance);
    const previousBest = this.bestDistance;
    const bestDistance = recordBestDistance(this.storage, distance, previousBest);
    const newBest = bestDistance > previousBest;
    this.bestDistance = bestDistance;

    return Object.freeze({
      reason,
      distance,
      elapsed: controller.elapsed,
      coins: this.run?.coins ?? 0,
      kills: fight.kills ?? 0,
      score: fight.score ?? 0,
      shotsFired: fight.shotsFired ?? 0,
      shotsHit: fight.shotsHit ?? 0,
      accuracy: fight.accuracy ?? 0,
      hull: fight.hull ?? 0,
      fuel: controller.fuel,
      bestDistance,
      newBest,
    });
  }

  /**
   * The player's aircraft has been destroyed.
   *
   * Called once per run, and only from FLYING. `Combat` sets its own `ended` flag before it
   * emits, and the state machine refuses a second move to RESULTS, so a burst of collisions
   * arriving in the same frame cannot end the run twice or show two summaries.
   */
  #onDestroyed(payload) {
    return this.#endRun(payload?.source ?? 'hull', payload);
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
    this.combat?.dispose();
    this.pickups?.dispose();
    this.factory?.dispose();
    this.renderer?.dispose();
    this.listeners.clear();
  }
}
