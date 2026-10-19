/**
 * Sky Combat — central tuning constants.
 *
 * Numbers that shape how the game feels and how it renders live here so they can
 * be tuned in one place. Nothing in this file touches the DOM, Three.js or the
 * network, so it is safe to import from unit tests.
 */

/** Renderer, camera and quality budgets. */
export const RENDER = {
  /** Pixel ratio is capped: retina phones otherwise render 3x the pixels for no visible gain. */
  maxPixelRatio: 2,
  /** Adaptive resolution floor, as a fraction of the capped pixel ratio. */
  minRenderScale: 0.6,
  /** Frame budget the adaptive scaler aims for (60 fps). */
  targetFrameMs: 1000 / 60,
  fov: 62,
  near: 0.5,
  far: 9000,
  toneMappingExposure: 1.02,
  shadowMapSize: 2048,
  /** Fixed simulation step. The renderer interpolates; the simulation never varies. */
  fixedStep: 1 / 60,
  /** Never simulate more than this many steps in one frame (protects slow devices). */
  maxSubSteps: 5,
};

/** Arcade flight model. Speeds are metres per second, rates are radians per second. */
export const FLIGHT = {
  cruiseSpeed: 78,
  minSpeed: 44,
  maxSpeed: 168,
  boostSpeed: 215,
  throttleRate: 0.6,
  speedResponse: 1.4,
  pitchRate: 0.9,
  rollRate: 2.3,
  yawRate: 0.34,
  /** Max pitch attitude before the model stops rotating, to keep the arcade feel. */
  pitchLimit: 1.25,
  /** How strongly the aircraft rolls itself back to level when there is no roll input. */
  autoLevelRate: 0.5,
  /** Banked turns: yaw rate added in proportion to the bank angle. */
  bankTurnGain: 0.42,
  maxBank: 1.15,
  boostMultiplier: 1.28,
  /** Fuel burn per second at full throttle, as a fraction of a full tank. */
  fuelBurnPerSecond: 0.0125,
  boostBurnMultiplier: 2.4,
  /** The aircraft starts airborne at this altitude. */
  startAltitude: 420,
};

/** Third-person chase camera. */
export const CAMERA = {
  /** Behind and above a 15 m aircraft, far enough back to read its whole shape. */
  offset: { x: 0, y: 5, z: 21 },
  lookAhead: 18,
  positionDamping: 9,
  rotationDamping: 7,
  /**
   * Horizontal radius of the aircraft that must stay in frame, and the margin kept
   * around it. A portrait frame is narrow horizontally, so the camera pulls back
   * until the wingspan fits — measured, not guessed: at 390x844 the wingtips left
   * the frame at a fixed offset.
   */
  fitRadius: 7,
  fitMargin: 1.15,
  /** How much of the aircraft's roll the camera copies, and the most it will ever roll. */
  rollFollow: 0.4,
  maxRoll: 0.5,
  fovSpeedGain: 0.1,
  maxShake: 0.35,
};

/** World scale and atmosphere. Fog comes from the active zone in `data/zones.js`. */
export const WORLD = {
  /**
   * Far larger than the fog's reach, so the surface has no visible edge and the
   * horizon is a true straight line rather than the curve of a finite plane.
   */
  seaSize: 40000,
  seaSegments: 48,
  /** The aircraft is kept inside this box; it wraps back to the centre rather than flying forever. */
  wrapRadius: 4200,
};

/**
 * The gentle scripted flight used by the Stage 2 prototype until player input arrives.
 * It commands a bank *angle* rather than a roll rate, so the weave is a stable
 * S-turn instead of a continuous barrel roll.
 */
export const DEMO_FLIGHT = {
  throttle: 0.72,
  bankAmplitude: 0.42,
  bankPeriod: 24,
  bankGain: 2.8,
  pitchAmplitude: 0.16,
  pitchPeriod: 15,
  altitudeHold: 420,
  altitudeGain: 0.0016,
};
