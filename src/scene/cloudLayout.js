/**
 * Sky Combat — cloud field layout.
 *
 * The placement maths for the cumulus layer in `scene/Clouds.js`, kept apart from
 * it so the recycling rules can be unit tested in plain Node: no Three.js, no DOM.
 *
 * Clouds live in a ring around the aircraft. When one drifts outside the ring it is
 * moved to a fresh spot in the cone ahead of the player, which keeps a small, fixed
 * set of billboards in view forever without ever creating or destroying one.
 */

/** The ring the clouds live in, in metres. */
export const CLOUD_FIELD = Object.freeze({
  /**
   * Nothing closer than this. The widest card is about 1050 m across, so a 900 m
   * inner ring keeps every cloud at least 300 m clear of the aircraft: the player
   * flies between and around the clouds rather than through a flat billboard.
   */
  innerRadius: 900,
  /** Beyond this a cloud is recycled to the far side of the aircraft. */
  outerRadius: 5400,
  minAltitude: 560,
  maxAltitude: 1750,
  minScale: 430,
  maxScale: 1050,
  /** Full width of the cone ahead of the aircraft that new clouds are seeded into. */
  spread: 2.3,
});

/**
 * Yaw of a direction vector, in the convention the rest of the game uses: a heading
 * of 0 points along -Z, and a heading of +pi/2 points along +X.
 */
export function headingOf(forward) {
  return Math.atan2(forward?.x ?? 0, -(forward?.z ?? -1));
}

/**
 * Put a cloud somewhere ahead of the aircraft.
 *
 * Writes into `out` and returns it, so recycling a cloud in flight never allocates.
 *
 * @param {() => number} random deterministic source in [0, 1)
 * @param {{x:number, z:number}} focus the aircraft
 * @param {{x:number, z:number}} forward the aircraft's heading
 * @param {object} [field]
 * @param {object} [out]
 */
export function placeCloud(random, focus, forward, field = CLOUD_FIELD, out = {}) {
  const angle = headingOf(forward) + (random() - 0.5) * field.spread;
  const distance = field.innerRadius + random() * (field.outerRadius - field.innerRadius);

  out.x = focus.x + Math.sin(angle) * distance;
  out.z = focus.z - Math.cos(angle) * distance;
  out.y = field.minAltitude + random() * (field.maxAltitude - field.minAltitude);
  out.scale = field.minScale + random() * (field.maxScale - field.minScale);
  // How the billboard is turned about its own axis, so a reused texture does not
  // read as the same cloud repeated.
  out.roll = random() * Math.PI * 2;
  // Multiplied into the material colour, which varies thickness without a second
  // material or a second draw call.
  out.brightness = 0.8 + random() * 0.2;
  // A second draw used per zone: how thick the cloud is. A zone with a coverage of
  // 0.5 keeps the clouds drawn with a coverage below 0.5 and hides the rest, which
  // varies the density of the sky without moving a single billboard.
  out.coverage = random();
  return out;
}

/** Has this cloud fallen out of the ring and earned a new position? */
export function shouldRecycle(cloud, focus, field = CLOUD_FIELD) {
  const dx = cloud.x - focus.x;
  const dz = cloud.z - focus.z;
  return dx * dx + dz * dz > field.outerRadius * field.outerRadius;
}

/** How far a cloud is from the aircraft, in the horizontal plane. */
export function cloudDistance(cloud, focus) {
  return Math.hypot(cloud.x - focus.x, cloud.z - focus.z);
}

/**
 * Build the whole field at start-up. `out` is filled with plain objects that are
 * then recycled in place for the rest of the run.
 */
export function seedClouds(random, focus, forward, count, field = CLOUD_FIELD, out = []) {
  out.length = 0;
  for (let i = 0; i < count; i += 1) out.push(placeCloud(random, focus, forward, field, {}));
  return out;
}
