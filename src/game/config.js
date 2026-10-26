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
  fuelBurnPerSecond: 0.009,
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
   * the frame at a fixed offset, and a hard bank brings the wingtips closer still.
   */
  fitRadius: 8.5,
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

/** Flight-area boundaries. The limits are enforced by turning the aircraft, not teleporting it. */
export const BOUNDS = {
  /** Hard floor, comfortably above the sea. */
  minAltitude: 60,
  /** Hard ceiling. */
  maxAltitude: 1800,
  /** Within this band of either limit the aircraft is eased back automatically. */
  altitudeBand: 130,
  /** Beyond this radius the aircraft is gently turned back toward the centre. */
  softRadius: 3400,
  /** It is never allowed beyond this radius. */
  hardRadius: 4200,
  /** How hard the boundary turns the nose back, in radians per second at full urgency. */
  correctionRate: 1.6,
};

/** Touch controls. */
export const TOUCH = {
  /** Fraction of the viewport width used as the steering zone. */
  stickZoneWidth: 0.5,
  /** Ignore stick movement below this fraction of full travel, so a resting thumb is still. */
  deadZone: 0.14,
  /** Stick travel in pixels for full deflection. */
  stickTravel: 58,
};

/** The gentle scripted flight used for the menu backdrop until the player takes over. */
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

/**
 * Combat: the gun, the enemies, the hazards and the difficulty ramp.
 *
 * Everything here is a number rather than a rule, so the fight can be tuned without
 * touching the systems that run it. Fictional arcade combat only: no real-world
 * tactics, no real aircraft.
 */
export const COMBAT = {
  /** The player's gun. */
  gun: {
    /** Seconds between shots. */
    cooldown: 0.115,
    /** Muzzle velocity, added to the aircraft's own. */
    speed: 640,
    /** Seconds before an unfired shot expires. */
    lifespan: 1.5,
    damage: 34,
    /** Aim scatter, in radians. Small: this is a gun, not a spray. */
    spread: 0.0045,
    capacity: 64,
  },

  /** Enemy guns. Slower, weaker and much less accurate, so a fight is survivable. */
  enemyGun: {
    cooldown: 1.5,
    speed: 400,
    lifespan: 2.2,
    damage: 7,
    spread: 0.02,
    capacity: 48,
    /** Never fire from further away than this. */
    maxRange: 1500,
  },

  /** Enemy aircraft. */
  enemies: {
    /** Ceiling on enemies alive at once, whatever the difficulty ramp says. */
    hardCap: 7,
    /** Seconds into a run before the first one appears. */
    firstSpawn: 3.5,
    minSpawnDistance: 750,
    maxSpawnDistance: 1150,
    /**
     * How far off the player's flight path an enemy may appear, sideways and
     * vertically. The minimum matters: nothing is ever spawned dead ahead at close
     * range, so every enemy is avoidable.
     */
    minLateralOffset: 80,
    maxLateralOffset: 340,
    minVerticalOffset: 45,
    maxVerticalOffset: 200,
    /** Collision radius, in metres. Generous, so a near miss still counts as a hit. */
    radius: 9,
    /** Hull of one enemy. Two solid hits, or one long burst. */
    integrity: 100,
    /** What ramming one costs the player. */
    ramDamage: 24,
    /** Points a kill is worth. */
    scorePerKill: 100,
    /** Seconds between enemy shots at the start of a run, before the ramp. */
    fireInterval: 3.2,
  },

  /** Environmental hazards: tethered balloons the player has to fly around. */
  obstacles: {
    /**
     * Seconds into a run before the first one appears. How often they follow is part of the
     * difficulty ramp (`ramp.obstacleInterval`) rather than a second number here, so there is
     * only ever one answer to "how busy is the sky".
     */
    firstSpawn: 8,
    minSpawnDistance: 1000,
    maxSpawnDistance: 2800,
    /** Nothing is ever placed dead ahead: a hazard you cannot see is not a hazard. */
    minLateralOffset: 55,
    maxLateralOffset: 460,
    /**
     * Altitude relative to the player at the moment of placement, as a signed band:
     * hazards sit above and below the flight path, not only above it.
     */
    signedAltitude: true,
    minAltitudeOffset: -140,
    maxAltitudeOffset: 240,
    /** Collision radius of the envelope, in metres. */
    radius: 12,
    damage: 34,
    /** Seconds a hazard stays in the world before it is recycled. */
    lifespan: 40,
    /** Envelope radius at build time, before the per-instance scale. */
    envelopeRadius: 9,
  },

  /** The player's hull. */
  hull: {
    max: 100,
    /**
     * Seconds of grace after a hit. Without it, flying through one hazard would chew
     * the whole hull in a handful of frames and read as an instant, unexplained loss.
     */
    grace: 1.25,
  },

  /**
   * The difficulty ramp: harder with distance flown, never with the clock.
   *
   * The first `grace` metres are the easiest setting held flat, then every number is eased
   * from the first value to the second over `distance` metres. Easing matters: a linear climb
   * joins the opening with a step and reaches its hardest setting at full speed, while a
   * smoothstep starts and ends flat, so no metre is meaningfully harder than the one before it
   * (`docs/RUN.md` has the curve and the numbers).
   */
  ramp: {
    /** Metres of easy opening: what a new player learns the controls against. */
    grace: 1200,
    /** Metres over which the ramp then climbs to its hardest setting. */
    distance: 12000,
    /** Seconds between enemy arrivals. */
    spawnInterval: [8, 2.8],
    maxAlive: [2, 6],
    speed: [0.8, 1.15],
    fireRate: [0.4, 1],
    /** Seconds between balloons: the hazards ramp with the fight, not on their own. */
    obstacleInterval: [3.4, 2.2],
  },
};

/**
 * The run's resources: things to fly through and pick up.
 *
 * Two rules separate these from the hazards in `COMBAT.obstacles`:
 *
 * 1. a collectible is placed *on or near* the flight path on purpose (`minLateralOffset`
 *    is zero), because it is a reward for flying well rather than something to dodge;
 * 2. every collectible is worth having, so none of them is ever placed behind the player
 *    or outside the arena — `chooseSpawnPoint` guarantees both.
 *
 * Fuel burn itself lives in `FLIGHT`, because it is part of the flight model; this block
 * only covers the canisters that put fuel back.
 */
export const RUN = {
  /** Coins: a run of them, laid out in a pattern ahead of the aircraft. */
  coins: {
    /** Pennies are pooled too, so there is a hard ceiling on what is on screen. */
    capacity: 48,
    firstSpawn: 3.5,
    /** Seconds between patterns. */
    interval: 3,
    /** A pattern is a short line of coins rather than a single one. */
    patterns: ['line', 'arc', 'slalom'],
    /** How many coins one pattern holds, inclusive range. */
    perPattern: [4, 7],
    /** Metres between coins along the pattern. */
    spacing: 46,
    /** Where the middle of the pattern is placed, ahead of the player. */
    minSpawnDistance: 560,
    maxSpawnDistance: 1500,
    /** Coins may sit exactly on the flight line: that is the point of them. */
    minLateralOffset: 0,
    maxLateralOffset: 230,
    /** Altitude relative to the player, as a signed band. */
    signedAltitude: true,
    minAltitudeOffset: -70,
    maxAltitudeOffset: 90,
    /** Collection radius, in metres. Generous: missing one at 150 m/s is not a skill test. */
    radius: 10,
    /** Coins a single one is worth. */
    value: 1,
    /** Seconds a coin survives before it is recycled. */
    lifespan: 40,
  },

  /** Fuel: scarce, and the only pickup that can save a run rather than improve it. */
  fuel: {
    capacity: 8,
    firstSpawn: 14,
    interval: 13,
    minSpawnDistance: 700,
    maxSpawnDistance: 2200,
    minLateralOffset: 0,
    maxLateralOffset: 170,
    signedAltitude: true,
    minAltitudeOffset: -60,
    maxAltitudeOffset: 80,
    radius: 13,
    /** What one canister puts back, as a fraction of a full tank. */
    amount: 0.25,
    /** Below this fraction the HUD turns amber and warns. */
    lowWarning: 0.25,
    lifespan: 45,
  },

  /** Power-ups: temporary, one slot per effect, and gone when the run ends. */
  powerups: {
    capacity: 6,
    firstSpawn: 20,
    interval: 24,
    minSpawnDistance: 650,
    maxSpawnDistance: 2000,
    minLateralOffset: 0,
    maxLateralOffset: 200,
    signedAltitude: true,
    minAltitudeOffset: -50,
    maxAltitudeOffset: 80,
    radius: 15,
    lifespan: 45,
    /** How long each effect lasts, in seconds. */
    duration: { boost: 12, special: 10 },
    /** Speed multiplier while the speed boost is running. */
    boostSpeedScale: 1.3,
    /** Damage multiplier while the special ammunition is loaded. */
    specialDamageScale: 2.2,
    /** How much longer the special tracer is drawn, so the change is visible. */
    specialTracerScale: 1.7,
  },

  /** How far behind, or how far away, a collectible is recycled. Shared by all three. */
  despawnBehind: 900,
  despawnRange: 3000,
};
