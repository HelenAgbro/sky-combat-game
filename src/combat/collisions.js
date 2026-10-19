/**
 * Sky Combat — collision maths.
 *
 * Pure, and unit tested, because this is the one part of combat that has to be *right*
 * rather than merely look right.
 *
 * A shot travels at 640 m/s, which is more than ten metres in a single 60 Hz step. A
 * point test against a nine-metre aircraft would therefore miss most of the shots that
 * should have connected — the projectile would be in front of the target on one step and
 * behind it on the next. Everything here works on the segment the projectile swept
 * during the step instead, which cannot tunnel through anything.
 */

/**
 * The first point at which a segment enters a sphere.
 *
 * @param {{x:number,y:number,z:number}} from where the segment starts
 * @param {{x:number,y:number,z:number}} to   where it ends
 * @param {{x:number,y:number,z:number}} centre
 * @param {number} radius
 * @returns {{hit: boolean, t: number}} `t` is how far along the segment the contact is
 */
export function sweptSphereHit(from, to, centre, radius) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const fx = from.x - centre.x;
  const fy = from.y - centre.y;
  const fz = from.z - centre.z;

  const a = dx * dx + dy * dy + dz * dz;
  const b = 2 * (fx * dx + fy * dy + fz * dz);
  const c = fx * fx + fy * fy + fz * fz - radius * radius;

  // Already inside the sphere when the step began.
  if (c <= 0) return { hit: true, t: 0 };
  // No travel at all: a point that starts outside cannot reach it.
  if (a < 1e-12) return { hit: false, t: 0 };

  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return { hit: false, t: 0 };

  const t = (-b - Math.sqrt(discriminant)) / (2 * a);
  if (t < 0 || t > 1) return { hit: false, t: 0 };
  return { hit: true, t };
}

/** Closest distance between a segment and a point. */
export function closestApproach(from, to, point) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const lengthSq = dx * dx + dy * dy + dz * dz;

  if (lengthSq < 1e-12) {
    return Math.hypot(from.x - point.x, from.y - point.y, from.z - point.z);
  }

  const raw =
    ((point.x - from.x) * dx + (point.y - from.y) * dy + (point.z - from.z) * dz) / lengthSq;
  const t = raw < 0 ? 0 : raw > 1 ? 1 : raw;

  return Math.hypot(
    from.x + dx * t - point.x,
    from.y + dy * t - point.y,
    from.z + dz * t - point.z,
  );
}

/** Do two spheres overlap? The whole collision model, in one comparison. */
export function spheresOverlap(a, b, radiusA, radiusB) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  const sum = radiusA + radiusB;
  return dx * dx + dy * dy + dz * dz <= sum * sum;
}

/** Horizontal distance, which is what most of the placement rules care about. */
export function horizontalDistance(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}
