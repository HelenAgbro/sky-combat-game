/**
 * Sky Combat — geometry lofting helpers.
 *
 * Aircraft are built in code rather than loaded from files, because start.ng only
 * serves a fixed list of file types and `.glb`/`.gltf` are not on it (see
 * docs/PLATFORM.md). A fuselage is a sequence of cross-sections lofted into a
 * smooth hull; every wing, fin and stabiliser is a real airfoil lofted along its
 * span. Nothing here touches the DOM or the renderer, so the maths is unit tested.
 */
import { BufferGeometry, Float32BufferAttribute, Vector3 } from 'three';

/**
 * A superellipse ring: a circle at exponent 2, progressively squarer above it.
 * The first point sits at the bottom of the ring, which puts the texture seam on
 * the belly of an aircraft where it is least visible.
 */
export function superellipseRing(points = 24, exponent = 2.5, phase = -Math.PI / 2) {
  const ring = [];
  const power = 2 / exponent;
  for (let i = 0; i < points; i += 1) {
    const t = phase + (i / points) * Math.PI * 2;
    const c = Math.cos(t);
    const s = Math.sin(t);
    ring.push([Math.sign(c) * Math.abs(c) ** power, Math.sign(s) * Math.abs(s) ** power]);
  }
  return ring;
}

/**
 * A NACA-style airfoil ring. The first coordinate runs along the chord
 * (0 = leading edge, 1 = trailing edge) and the second is thickness.
 */
export function airfoilRing(points = 20, thickness = 0.1, camber = 0.02) {
  const half = Math.max(4, Math.round(points / 2));
  const upper = [];
  const lower = [];
  for (let i = 0; i < half; i += 1) {
    const x = 0.5 * (1 - Math.cos((i / (half - 1)) * Math.PI)); // cosine spacing: dense at both edges
    const yt =
      5 *
      thickness *
      (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
    const yc = camber * 4 * x * (1 - x);
    upper.push([x, yc + yt]);
    lower.push([x, yc - yt]);
  }
  const ring = [...upper];
  for (let i = half - 2; i >= 1; i -= 1) ring.push(lower[i]);
  return ring;
}

/** Scale and shift a ring, so one profile can be reused at any size or position. */
export function scaleRing(ring, { u = 1, v = 1, uOffset = 0, vOffset = 0 } = {}) {
  return ring.map(([a, b]) => [a * u + uOffset, b * v + vOffset]);
}

/**
 * Signed volume of a closed mesh. Positive means the triangles face outwards,
 * which is how lofted parts are checked for inside-out winding.
 */
export function signedVolume(geometry) {
  const position = geometry.getAttribute('position');
  const index = geometry.getIndex();
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  const cross = new Vector3();
  let volume = 0;
  const triangles = index ? index.count : position.count;

  for (let i = 0; i < triangles; i += 3) {
    const ia = index ? index.getX(i) : i;
    const ib = index ? index.getX(i + 1) : i + 1;
    const ic = index ? index.getX(i + 2) : i + 2;
    a.fromBufferAttribute(position, ia);
    b.fromBufferAttribute(position, ib);
    c.fromBufferAttribute(position, ic);
    volume += a.dot(cross.crossVectors(b, c)) / 6;
  }
  return volume;
}

/**
 * Loft a sequence of rings into a closed surface.
 *
 * `at` is the position along the advance axis, and ring coordinates map as:
 *   axis 'z': (a, b, at) — a is X (width), b is Y (height)
 *   axis 'x': (at, b, a) — a is Z (chord), b is Y (thickness)
 *
 * Each ring is written with its first vertex duplicated at the end so the UVs run
 * 0..1 and the texture seam closes without a squeezed band. The two seam vertices
 * then have their normals averaged, so the seam does not show as a shading crease.
 */
export function loftRings(sections, { axis = 'z', capStart = true, capEnd = true } = {}) {
  if (sections.length < 2) throw new Error('loftRings needs at least two sections');

  const count = sections[0].ring.length;
  const stride = count + 1;
  const positions = [];
  const uvs = [];
  const indices = [];
  const map = (a, b, at) => (axis === 'z' ? [a, b, at] : [at, b, a]);

  sections.forEach((section, s) => {
    if (section.ring.length !== count) {
      throw new Error('loftRings: every ring must have the same number of points');
    }
    const v = s / (sections.length - 1);
    for (let i = 0; i <= count; i += 1) {
      const [a, b] = section.ring[i % count];
      const [x, y, z] = map(a, b, section.at);
      positions.push(x, y, z);
      uvs.push(i / count, v);
    }
  });

  for (let s = 0; s < sections.length - 1; s += 1) {
    for (let i = 0; i < count; i += 1) {
      const a = s * stride + i;
      const b = a + 1;
      const c = (s + 1) * stride + i;
      const d = c + 1;
      indices.push(a, d, c, a, b, d);
    }
  }

  const addCap = (sectionIndex, facesForward) => {
    const section = sections[sectionIndex];
    const base = sectionIndex * stride;
    const [sumX, sumY] = section.ring.reduce(([ax, ay], [bx, by]) => [ax + bx, ay + by], [0, 0]);
    const [cx, cy, cz] = map(sumX / count, sumY / count, section.at);
    const centre = positions.length / 3;
    positions.push(cx, cy, cz);
    uvs.push(0.5, 0.5);
    for (let i = 0; i < count; i += 1) {
      const p = base + i;
      const q = base + i + 1;
      if (facesForward) indices.push(centre, p, q);
      else indices.push(centre, q, p);
    }
  };

  if (capEnd) addCap(sections.length - 1, true);
  if (capStart) addCap(0, false);

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  // A closed loft encloses a positive volume; if this one came out inside-out, flip it.
  if (capStart && capEnd && signedVolume(geometry) < 0) {
    const array = geometry.getIndex().array;
    for (let i = 0; i < array.length; i += 3) {
      const swap = array[i + 1];
      array[i + 1] = array[i + 2];
      array[i + 2] = swap;
    }
    geometry.getIndex().needsUpdate = true;
    geometry.computeVertexNormals();
  }

  // Blend the normals of the duplicated seam vertices so the seam shades smoothly.
  const normal = geometry.getAttribute('normal');
  for (let s = 0; s < sections.length; s += 1) {
    const first = s * stride;
    const last = first + count;
    const x = normal.getX(first) + normal.getX(last);
    const y = normal.getY(first) + normal.getY(last);
    const z = normal.getZ(first) + normal.getZ(last);
    const length = Math.hypot(x, y, z) || 1;
    normal.setXYZ(first, x / length, y / length, z / length);
    normal.setXYZ(last, x / length, y / length, z / length);
  }
  normal.needsUpdate = true;

  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  return geometry;
}

/** Mirror a geometry across the YZ plane, reversing winding so it stays outward-facing. */
export function mirrorX(geometry) {
  const mirrored = geometry.clone();
  const position = mirrored.getAttribute('position');
  const normal = mirrored.getAttribute('normal');

  for (let i = 0; i < position.count; i += 1) {
    position.setX(i, -position.getX(i));
    if (normal) normal.setX(i, -normal.getX(i));
  }
  position.needsUpdate = true;
  if (normal) normal.needsUpdate = true;

  const index = mirrored.getIndex();
  if (index) {
    const array = index.array;
    for (let i = 0; i < array.length; i += 3) {
      const swap = array[i + 1];
      array[i + 1] = array[i + 2];
      array[i + 2] = swap;
    }
    index.needsUpdate = true;
  }

  mirrored.computeBoundingSphere();
  mirrored.computeBoundingBox();
  return mirrored;
}
