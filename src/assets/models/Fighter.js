/**
 * Sky Combat — procedural fighter airframe.
 *
 * The aircraft is a real, fully-modelled shape: a lofted fuselage with a canopy,
 * intake duct, swept airfoil wings, stabilisers, fins, nozzles, pylons and
 * wingtip missiles. It is described entirely by the `shape` block in
 * `data/aircraft.js`, so the four aircraft differ by configuration and share one
 * builder. See docs/ASSETS.md for why the game does not load a `.glb` file.
 */
import { Group, Mesh } from 'three';
import { airfoilRing, loftRings, mirrorX, scaleRing, superellipseRing } from '../loft.js';

/** Ring density. Enough to keep curvature smooth without wasting triangles. */
const BODY_RING = 30;
const SURFACE_RING = 22;
const SURFACE_SPAN_STEPS = 12;

/**
 * Fuselage cross-sections from nose (0) to tail (1).
 * `w`/`h` are half-width and half-height as multiples of `shape.body`, and `y`
 * nudges the centreline so the nose droops and the spine rises over the cockpit.
 */
const FUSELAGE_STATIONS = [
  { f: 0.0, w: 0.05, h: 0.05, y: -0.14 },
  { f: 0.05, w: 0.26, h: 0.28, y: -0.12 },
  { f: 0.13, w: 0.46, h: 0.48, y: -0.05 },
  { f: 0.24, w: 0.64, h: 0.66, y: 0.02 },
  { f: 0.36, w: 0.78, h: 0.82, y: 0.05 },
  { f: 0.5, w: 0.88, h: 0.92, y: 0.05 },
  { f: 0.64, w: 0.9, h: 0.94, y: 0.04 },
  { f: 0.78, w: 0.84, h: 0.9, y: 0.02 },
  { f: 0.9, w: 0.66, h: 0.74, y: 0 },
  { f: 1.0, w: 0.5, h: 0.6, y: -0.01 },
];

/** Linear sample of the fuselage profile at any fraction of the length. */
function sampleFuselage(f) {
  for (let i = 0; i < FUSELAGE_STATIONS.length - 1; i += 1) {
    const a = FUSELAGE_STATIONS[i];
    const b = FUSELAGE_STATIONS[i + 1];
    if (f >= a.f && f <= b.f) {
      const t = (f - a.f) / (b.f - a.f || 1);
      return {
        w: a.w + (b.w - a.w) * t,
        h: a.h + (b.h - a.h) * t,
        y: a.y + (b.y - a.y) * t,
      };
    }
  }
  const last = FUSELAGE_STATIONS[FUSELAGE_STATIONS.length - 1];
  return { w: last.w, h: last.h, y: last.y };
}

/** The aircraft's forward axis is -Z, matching Three.js conventions. */
export function lengthToZ(shape, fraction) {
  return -shape.length * 0.5 + fraction * shape.length;
}

/**
 * A closed hull between two fractions of the length. `scale` lifts a second copy
 * just proud of the first, which is how the dark radome is layered over the nose.
 */
export function buildHull(shape, { from = 0, to = 1, steps = 16, scale = 1, ring = BODY_RING } = {}) {
  const sections = [];
  for (let i = 0; i <= steps; i += 1) {
    const f = from + ((to - from) * i) / steps;
    const profile = sampleFuselage(f);
    sections.push({
      at: lengthToZ(shape, f),
      ring: scaleRing(superellipseRing(ring, shape.body.exponent), {
        u: profile.w * shape.body.width * scale,
        v: profile.h * shape.body.height * scale,
        vOffset: profile.y * shape.body.height,
      }),
    });
  }
  return loftRings(sections, { axis: 'z' });
}

/**
 * A lifting surface — wing, stabiliser, fin or foreplane — lofted from a real
 * airfoil. The span runs along +X; rotate the result for a fin.
 */
export function buildLiftingSurface({
  span,
  rootChord,
  tipChord,
  sweep,
  dihedral = 0,
  thickness = 0.08,
  camber = 0.02,
  leadingEdgeZ,
  rootX,
  rootY = 0,
  steps = SURFACE_SPAN_STEPS,
}) {
  const halfSpan = span * 0.5;
  const travel = halfSpan - rootX;
  const profile = airfoilRing(SURFACE_RING, thickness, camber);
  const sections = [];

  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const chord = rootChord + (tipChord - rootChord) * t;
    sections.push({
      at: rootX + travel * t,
      ring: scaleRing(profile, {
        u: chord,
        v: chord,
        uOffset: leadingEdgeZ + sweep * t,
        vOffset: rootY + dihedral * halfSpan * t,
      }),
    });
  }

  return loftRings(sections, { axis: 'x' });
}

/** A closed, rounded solid such as a pylon, missile body or nozzle. */
export function buildBody({ from, to, steps = 6, rings, exponent = 2.4, taper = 1 }) {
  const sections = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const scale = typeof taper === 'function' ? taper(t) : 1 + (taper - 1) * t;
    sections.push({
      at: from + (to - from) * t,
      ring: scaleRing(superellipseRing(16, exponent), {
        u: rings.width * scale,
        v: rings.height * scale,
      }),
    });
  }
  return loftRings(sections, { axis: 'z' });
}

/** Mirror a geometry across the aircraft's centreline. */
export function mirror(geometry) {
  return mirrorX(geometry);
}

/** Small helper: a mesh with a shared material and shadow settings applied. */
export function surface(geometry, material, { cast = true, receive = false } = {}) {
  const mesh = new Mesh(geometry, material);
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  return mesh;
}

/** Wrap parts into one group. */
export function assemble(name, children) {
  const group = new Group();
  group.name = name;
  for (const child of children) group.add(child);
  return group;
}

/** A position on a lifting surface, used to attach pylons and wingtip stores. */
export function surfacePoint(surface, shape, rootX, t) {
  const halfSpan = surface.span * 0.5;
  const travel = halfSpan - rootX;
  const chord = surface.rootChord + (surface.tipChord - surface.rootChord) * t;
  return {
    x: rootX + travel * t,
    chord,
    y: (surface.y ?? 0) + (surface.dihedral ?? 0) * halfSpan * t,
    leZ: lengthToZ(shape, surface.at) + surface.sweep * t,
  };
}

/** The bubble canopy: a closed lens that sits over the forward fuselage. */
export function buildCanopy(shape) {
  const { start, end, width, height } = shape.canopy;
  const steps = 14;
  const sections = [];

  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    // Kept just off zero so the tips are never degenerate.
    const profile = 0.1 + 0.9 * Math.sin(Math.PI * t) ** 0.5;
    const halfWidth = shape.body.width * width * profile;
    const halfHeight = height * profile;
    sections.push({
      at: lengthToZ(shape, start + (end - start) * t),
      ring: scaleRing(superellipseRing(20, 2.2), {
        u: halfWidth,
        v: halfHeight,
        vOffset: shape.body.height * 0.34 + halfHeight * 0.5,
      }),
    });
  }

  return loftRings(sections, { axis: 'z' });
}

/** The exhaust nozzle: a slightly flared, petal-ribbed ring with a recessed throat. */
export function buildNozzle(shape, { radius, length, inner = false }) {
  const tailZ = lengthToZ(shape, 1);
  const steps = 8;
  const sections = [];

  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const rib = inner ? 1 : 1 + (i % 2 === 0 ? 0.014 : -0.014);
    const flare = inner ? 0.62 + 0.3 * t : 0.94 + 0.16 * t;
    const size = radius * flare * rib;
    sections.push({
      at: tailZ - length * 0.85 + length * (inner ? 0.5 : 1) * t,
      ring: scaleRing(superellipseRing(22, 2.1), { u: size, v: size }),
    });
  }

  return loftRings(sections, { axis: 'z' });
}

/** A slim missile: pointed nose, tapered tail and four small fins. */
export function buildMissile({ length = 3, radius = 0.11 } = {}) {
  const taper = (t) => (t < 0.22 ? 0.12 + 0.88 * (t / 0.22) : 1 - 0.12 * ((t - 0.22) / 0.78) ** 2);

  const parts = [
    buildBody({
      from: -length * 0.5,
      to: length * 0.5,
      steps: 14,
      rings: { width: radius, height: radius },
      exponent: 2.1,
      taper,
    }),
  ];

  const finProfile = {
    span: radius * 2.6,
    rootChord: length * 0.16,
    tipChord: length * 0.07,
    sweep: length * 0.06,
    thickness: 0.09,
    camber: 0,
    leadingEdgeZ: length * 0.3,
    rootX: radius * 0.7,
    steps: 3,
  };

  for (const roll of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const fin = buildLiftingSurface(finProfile);
    fin.rotateZ(roll);
    parts.push(fin);
  }

  return parts;
}

/** A thin pylon under a wing, carrying a store. */
export function buildPylon({ height = 0.34, length = 1.2, width = 0.075 } = {}) {
  const taper = (t) => 0.7 + 0.3 * Math.sin(Math.PI * t) ** 0.6;
  return buildBody({
    from: -length * 0.5,
    to: length * 0.5,
    steps: 4,
    rings: { width, height: height * 0.5 },
    exponent: 4,
    taper,
  });
}

/** A slim store carried under a pylon. */
function buildStore({ length = 1.6, radius = 0.11 } = {}) {
  const taper = (t) => (t < 0.2 ? 0.15 + 0.85 * (t / 0.2) : 0.94 + 0.06 * t);
  return buildBody({
    from: -length * 0.5,
    to: length * 0.5,
    steps: 8,
    rings: { width: radius, height: radius },
    exponent: 2.1,
    taper,
  });
}

/**
 * Assemble a complete aircraft.
 *
 * @param {object} shape       from `data/aircraft.js`
 * @param {object} materials   { skin, dark, trim, glass, nozzleGlow }
 * @returns {import('three').Group} centred on the aircraft's origin, nose along -Z
 */
export function buildFighter(shape, materials) {
  const { width: bodyWidth, height: bodyHeight } = shape.body;
  const parts = [];
  /** Parts built on the right-hand side, mirrored to the left afterwards. */
  const right = [];

  // Fuselage, with a darker radome layered over the nose.
  parts.push(surface(buildHull(shape, { steps: 20 }), materials.fuselage, { receive: true }));
  parts.push(surface(buildHull(shape, { from: 0, to: 0.15, steps: 6, scale: 1.014 }), materials.dark));

  // Canopy.
  parts.push(surface(buildCanopy(shape), materials.glass, { cast: false }));

  // Intake duct and its dark throat.
  const intake = shape.intake;
  const mouthZ = lengthToZ(shape, intake.at);
  const intakeSize = { width: intake.width * bodyWidth, height: intake.height * bodyHeight };
  const duct = buildBody({
    from: mouthZ,
    to: mouthZ + intake.length,
    steps: 5,
    rings: intakeSize,
    exponent: intake.exponent,
    taper: 0.92,
  });
  duct.translate(0, intake.y * bodyHeight, 0);
  parts.push(surface(duct, materials.skin));

  const throat = buildBody({
    from: mouthZ + 0.02,
    to: mouthZ + intake.length * 0.5,
    steps: 3,
    rings: { width: intakeSize.width * 0.86, height: intakeSize.height * 0.86 },
    exponent: intake.exponent,
    taper: 0.6,
  });
  throat.translate(0, intake.y * bodyHeight, 0);
  parts.push(surface(throat, materials.dark, { cast: false }));

  // Wings and foreplanes.
  const wing = shape.wing;
  const wingRootX = wing.x * bodyWidth;
  const liftingSurface = (spec) =>
    buildLiftingSurface({
      span: spec.span,
      rootChord: spec.rootChord,
      tipChord: spec.tipChord,
      sweep: spec.sweep,
      dihedral: spec.dihedral ?? 0,
      thickness: spec.thickness,
      camber: spec.camber ?? 0.02,
      leadingEdgeZ: lengthToZ(shape, spec.at),
      rootX: spec.x * bodyWidth,
      rootY: spec.y ?? 0,
    });

  right.push({ geometry: liftingSurface(wing), material: materials.skin, options: { receive: true } });
  if (shape.canards) {
    right.push({ geometry: liftingSurface(shape.canards), material: materials.skin });
  }
  right.push({ geometry: liftingSurface(shape.tail), material: materials.skin, options: { receive: true } });

  // Vertical fins: one on the centreline, or a canted pair.
  const fins = shape.fins;
  const finGeometry = buildLiftingSurface({
    span: fins.height,
    rootChord: fins.rootChord,
    tipChord: fins.tipChord,
    sweep: fins.sweep,
    thickness: fins.thickness,
    camber: 0,
    leadingEdgeZ: lengthToZ(shape, fins.at),
    rootX: 0,
    rootY: 0,
  });
  finGeometry.rotateZ(Math.PI / 2);
  const finBaseY = fins.y * bodyHeight;

  if (fins.count === 2) {
    finGeometry.rotateZ(-fins.cant);
    finGeometry.translate(bodyWidth * 0.85, finBaseY, 0);
    right.push({ geometry: finGeometry, material: materials.skin });
  } else {
    finGeometry.translate(0, finBaseY, 0);
    parts.push(surface(finGeometry, materials.skin));
  }

  // Nozzles, with a recessed glowing throat.
  const nozzle = shape.nozzle;
  const nozzleY = -0.03 * bodyHeight;
  const nozzleOffset = nozzle.radius * 0.85 + nozzle.spacing * 0.5;
  for (let i = 0; i < nozzle.count; i += 1) {
    const offsetX = nozzle.count === 1 ? 0 : i === 0 ? -nozzleOffset : nozzleOffset;
    const shell = buildNozzle(shape, { radius: nozzle.radius, length: nozzle.length });
    shell.translate(offsetX, nozzleY, 0);
    parts.push(surface(shell, materials.dark));

    const glow = buildNozzle(shape, { radius: nozzle.radius * 0.92, length: nozzle.length, inner: true });
    glow.translate(offsetX, nozzleY, 0);
    parts.push(surface(glow, materials.nozzleGlow, { cast: false }));
  }

  // Under-wing pylons and stores.
  const pylonCount = Math.max(0, shape.pylons ?? 0);
  for (let i = 0; i < pylonCount; i += 1) {
    const t = pylonCount === 1 ? 0.5 : 0.28 + (i / (pylonCount - 1)) * 0.44;
    const point = surfacePoint(wing, shape, wingRootX, t);
    const pylon = buildPylon();
    pylon.translate(point.x, point.y - 0.22, point.leZ + point.chord * 0.45);
    right.push({ geometry: pylon, material: materials.dark });

    const store = buildStore();
    store.translate(point.x, point.y - 0.6, point.leZ + point.chord * 0.45);
    right.push({ geometry: store, material: materials.trim });
  }

  // Wingtip missiles.
  if (shape.wingtipMissiles) {
    const tip = surfacePoint(wing, shape, wingRootX, 1);
    for (const piece of buildMissile({ length: 3.1, radius: 0.095 })) {
      piece.translate(tip.x, tip.y - 0.07, tip.leZ + tip.chord * 0.5);
      right.push({ geometry: piece, material: materials.trim });
    }
  }

  // Mirror every right-hand part to the left, then collect the whole aircraft.
  for (const part of right) {
    parts.push(surface(part.geometry, part.material, part.options));
    parts.push(surface(mirror(part.geometry), part.material, part.options));
  }

  return assemble(shape.name ?? 'airframe', parts);
}
