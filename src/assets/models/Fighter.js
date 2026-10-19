/**
 * Sky Combat — procedural fighter airframe.
 *
 * TEMPORARY ARTWORK. This airframe is generated in code because no licensed
 * aircraft model is available yet, and start.ng cannot serve `.glb`/`.gltf` files
 * anyway (see docs/ASSETS.md). It is a complete, fully-modelled shape — a lofted
 * fuselage with a canopy, intake duct, swept airfoil wings, stabilisers, fins,
 * nozzles, pylons and wingtip missiles — but it stands in for real artwork, and
 * the game says so on the menu.
 *
 * To replace it with a licensed model: put the `.glb` in `assets/`, run
 * `npm run models`, and `AircraftFactory` will prefer it automatically, falling
 * back to this airframe if the payload is missing or fails to parse.
 *
 * The shape is described entirely by the `shape` block in `data/aircraft.js`, so
 * the four aircraft differ by configuration and share this one builder.
 */
import { Group, Mesh, SphereGeometry } from 'three';
import { airfoilRing, loftRings, mirrorX, scaleRing, superellipseRing } from '../loft.js';

/** Ring density. Enough to keep curvature smooth without wasting triangles. */
const BODY_RING = 30;
const SURFACE_RING = 22;
const SURFACE_SPAN_STEPS = 12;

/**
 * Where the moving surfaces sit, as fractions of the surface they belong to. Exported
 * so the tests can check a hinge is really on the edge it claims to be.
 */
/** The flaperon's span, from the wing root to the tip. */
export const FLAPERON_SPAN = Object.freeze([0.22, 0.96]);
/** How much of the local wing chord the flaperon takes, at the trailing edge. */
export const FLAPERON_SHARE = 0.26;
/** The same, for the rudder on the fin. */
export const RUDDER_SHARE = 0.3;
/** Where the stabilator pivots, as a fraction of its root chord. */
export const STABILATOR_HINGE = 0.3;

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
 *
 * `spanFraction`, `chordScale` and `chordShift` let a piece of the same surface be
 * built on its own — which is how the flaperons are lofted: they are evaluated at the
 * wing's own spanwise parameters, so they follow its taper, sweep and dihedral
 * exactly instead of approximating them.
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
  spanFraction = [0, 1],
  chordScale = 1,
  chordShift = 0,
}) {
  const halfSpan = span * 0.5;
  const travel = halfSpan - rootX;
  const profile = airfoilRing(SURFACE_RING, thickness, camber);
  const sections = [];
  const [from, to] = spanFraction;

  for (let i = 0; i <= steps; i += 1) {
    const t = from + (to - from) * (i / steps);
    const chord = (rootChord + (tipChord - rootChord) * t) * chordScale;
    sections.push({
      at: rootX + travel * t,
      ring: scaleRing(profile, {
        u: chord,
        v: chord,
        uOffset: leadingEdgeZ + sweep * t + chordShift,
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

/**
 * Wrap a control surface in a pivot group whose origin is its hinge.
 *
 * The geometry is shifted so the hinge point sits at the group's origin, and the group
 * is placed where the hinge really is on the airframe. Rotating the group then moves
 * the surface about its hinge line — which is the whole reason the surfaces are
 * separate objects rather than merged into the wing they belong to.
 */
export function controlSurface(geometry, material, { hingeX = 0, hingeZ = 0, x = hingeX, y = 0, z = hingeZ, options = {} } = {}) {
  geometry.translate(-hingeX, 0, -hingeZ);
  const group = new Group();
  group.position.set(x, y, z);
  group.add(surface(geometry, material, options));
  return group;
}

/**
 * Mirror a pivot group to the other side of the aircraft.
 *
 * A rotation about X is unaffected by mirroring in X, so both sides of a stabilator or
 * a flaperon can be driven with the same angle; the differential is applied by the
 * caller, not by the geometry.
 */
export function mirrorGroup(group) {
  const mirrored = new Group();
  mirrored.position.set(-group.position.x, group.position.y, group.position.z);
  for (const child of group.children) {
    const mesh = new Mesh(mirrorX(child.geometry), child.material);
    mesh.castShadow = child.castShadow;
    mesh.receiveShadow = child.receiveShadow;
    mirrored.add(mesh);
  }
  return mirrored;
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

/**
 * The bubble canopy: a closed lens that sits over the forward fuselage.
 *
 * `from`/`to`/`scale` build a slice of it slightly proud of the glass, which is how
 * the windscreen and canopy bows are made: the same curve, a fraction larger, over
 * the front and rear of the bubble.
 */
export function buildCanopy(shape, { from = 0, to = 1, scale = 1, steps = 14 } = {}) {
  const { start, end, width, height } = shape.canopy;
  const sections = [];

  for (let i = 0; i <= steps; i += 1) {
    const t = from + (to - from) * (i / steps);
    // Kept just off zero so the tips are never degenerate.
    const profile = 0.1 + 0.9 * Math.sin(Math.PI * t) ** 0.5;
    const halfWidth = shape.body.width * width * profile * scale;
    const halfHeight = height * profile * scale;
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

  /*
   * Flaperons: the wing's own trailing edge, from 22% to 96% of the half-span, at 26%
   * of the local chord. They are evaluated at the wing's own spanwise parameters, so
   * they follow its taper, sweep and dihedral exactly rather than approximating them,
   * and they move with the roll input in opposite directions on the two sides.
   */
  const flaperonFrom = FLAPERON_SPAN[0];
  const flaperonTo = FLAPERON_SPAN[1];
  const flaperonShare = FLAPERON_SHARE;
  const flaperonRootX = wingRootX + (wing.span * 0.5 - wingRootX) * flaperonFrom;
  const flaperonChordAt = (t) => wing.rootChord + (wing.tipChord - wing.rootChord) * t;
  const flaperonHingeZ =
    lengthToZ(shape, wing.at) + wing.sweep * flaperonFrom + flaperonChordAt(flaperonFrom) * (1 - flaperonShare);

  const flaperon = controlSurface(
    buildLiftingSurface({
      span: wing.span,
      rootChord: wing.rootChord,
      tipChord: wing.tipChord,
      // Parallel to the wing's trailing edge, so the hinge line lies along it.
      sweep: wing.sweep + (wing.tipChord - wing.rootChord) * (1 - flaperonShare),
      dihedral: wing.dihedral ?? 0,
      thickness: wing.thickness * 0.72,
      camber: 0,
      leadingEdgeZ: lengthToZ(shape, wing.at),
      rootX: wingRootX,
      rootY: wing.y ?? 0,
      steps: 8,
      spanFraction: [flaperonFrom, flaperonTo],
      chordScale: flaperonShare,
      chordShift: wing.rootChord * (1 - flaperonShare),
    }),
    materials.skin,
    { hingeX: flaperonRootX, hingeZ: flaperonHingeZ },
  );

  // Stabilators: all-moving, so each half pivots about its own hinge at 30% chord.
  const tail = shape.tail;
  const tailRootX = tail.x * bodyWidth;
  const tailHingeZ = lengthToZ(shape, tail.at) + tail.rootChord * STABILATOR_HINGE;
  const stabilator = controlSurface(liftingSurface(tail), materials.skin, {
    hingeX: tailRootX,
    hingeZ: tailHingeZ,
    options: { receive: true },
  });

  // Vertical fins: one on the centreline, or a canted pair.
  const fins = shape.fins;
  const finBaseY = fins.y * bodyHeight;
  const finLeZ = lengthToZ(shape, fins.at);
  const finCant = fins.count === 2 ? -fins.cant : 0;
  const finOffsetX = fins.count === 2 ? bodyWidth * 0.85 : 0;

  const finGeometry = buildLiftingSurface({
    span: fins.height,
    rootChord: fins.rootChord,
    tipChord: fins.tipChord,
    sweep: fins.sweep,
    thickness: fins.thickness,
    camber: 0,
    leadingEdgeZ: finLeZ,
    rootX: 0,
    rootY: 0,
  });
  finGeometry.rotateZ(Math.PI / 2);
  if (finCant !== 0) finGeometry.rotateZ(finCant);
  finGeometry.translate(finOffsetX, finBaseY, 0);

  if (fins.count === 2) {
    right.push({ geometry: finGeometry, material: materials.skin });
  } else {
    parts.push(surface(finGeometry, materials.skin));
  }

  /*
   * The rudder: a slimmer surface hinged along the fin's trailing edge. The cant is
   * applied to the geometry about the hinge, so the hinge line tilts with the fin and
   * the group's own yaw rotation stays the correct axis. The hinge is a straight line
   * rather than following the fin's full sweep, which is a fraction of a degree of
   * error at the tip and invisible at the deflections the rudder actually uses.
   */
  const rudderShare = RUDDER_SHARE;
  const rudderHingeZ = finLeZ + fins.rootChord * (1 - rudderShare);
  const rudderGeometry = buildLiftingSurface({
    span: fins.height,
    rootChord: fins.rootChord,
    tipChord: fins.tipChord,
    sweep: fins.sweep + (fins.tipChord - fins.rootChord) * (1 - rudderShare),
    thickness: fins.thickness * 0.8,
    camber: 0,
    leadingEdgeZ: finLeZ,
    rootX: 0,
    rootY: 0,
    steps: 8,
    chordScale: rudderShare,
    chordShift: fins.rootChord * (1 - rudderShare),
  });
  rudderGeometry.rotateZ(Math.PI / 2);
  if (finCant !== 0) rudderGeometry.rotateZ(finCant);

  const rudder = controlSurface(rudderGeometry, materials.skin, {
    hingeX: 0,
    hingeZ: rudderHingeZ,
    x: finOffsetX,
    y: finBaseY,
    z: rudderHingeZ,
  });

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

  /*
   * Canopy bows. The glass is a bubble with no centre rail — a straight rail over a
   * curved canopy floats above it at the ends, which is exactly what the first version
   * of this did — so the frame is the two arches alone, each a slice of the same curve
   * a fraction proud of the glass.
   */
  parts.push(
    surface(buildCanopy(shape, { from: 0, to: 0.16, scale: 1.12, steps: 4 }), materials.dark, { cast: false }),
  );
  parts.push(
    surface(buildCanopy(shape, { from: 0.84, to: 1, scale: 1.12, steps: 4 }), materials.dark, { cast: false }),
  );

  // Ventral fins under the tail: the pair a fighter of this shape carries.
  const ventral = buildLiftingSurface({
    span: 0.95,
    rootChord: 1.15,
    tipChord: 0.5,
    sweep: 0.55,
    thickness: 0.06,
    camber: 0,
    leadingEdgeZ: lengthToZ(shape, 0.86),
    rootX: 0,
    rootY: 0,
  });
  ventral.rotateZ(-Math.PI / 2);
  ventral.translate(bodyWidth * 0.52, -bodyHeight * 0.44, 0);
  right.push({ geometry: ventral, material: materials.dark });

  // Air-data probe on the nose.
  const probe = buildBody({
    from: lengthToZ(shape, 0) - 0.55,
    to: lengthToZ(shape, 0) + 0.14,
    steps: 4,
    rings: { width: 0.035, height: 0.035 },
    exponent: 2,
    taper: (t) => 0.3 + 0.7 * t,
  });
  probe.translate(0, -bodyHeight * 0.05, 0);
  parts.push(surface(probe, materials.trim, { cast: false }));

  // The gun muzzle, at the wing root.
  const muzzle = buildBody({
    from: lengthToZ(shape, 0.44),
    to: lengthToZ(shape, 0.44) + 0.45,
    steps: 3,
    rings: { width: 0.065, height: 0.065 },
    exponent: 2,
    taper: 0.85,
  });
  muzzle.translate(bodyWidth * 0.42, bodyHeight * 0.4, 0);
  right.push({ geometry: muzzle, material: materials.dark, options: { cast: false } });

  // Navigation lights: red to port, green to starboard, white on the tail.
  const wingTip = surfacePoint(wing, shape, wingRootX, 1);
  const light = (material, x, y, z) => {
    const mesh = surface(new SphereGeometry(0.085, 6, 5), material, { cast: false });
    mesh.position.set(x, y, z);
    return mesh;
  };
  parts.push(light(materials.navRed, -wingTip.x * 0.97, wingTip.y + 0.06, wingTip.leZ + wingTip.chord * 0.45));
  parts.push(light(materials.navGreen, wingTip.x * 0.97, wingTip.y + 0.06, wingTip.leZ + wingTip.chord * 0.45));
  parts.push(
    light(materials.navWhite, 0, finBaseY + fins.height * 0.5 - 0.12, finLeZ + fins.sweep + fins.tipChord - 0.2),
  );

  /*
   * The moving surfaces. Each is built on the right and mirrored to the left, and each
   * is handed to the caller so the flight controls can deflect it — see
   * `aircraft/surfaces.js`.
   */
  const flaperonRight = flaperon;
  const flaperonLeft = mirrorGroup(flaperonRight);
  const stabilatorRight = stabilator;
  const stabilatorLeft = mirrorGroup(stabilatorRight);
  const rudders = [rudder];
  if (fins.count === 2) rudders.push(mirrorGroup(rudder));
  parts.push(stabilatorRight, stabilatorLeft, flaperonRight, flaperonLeft, ...rudders);

  // Mirror every right-hand part to the left, then collect the whole aircraft.
  for (const part of right) {
    parts.push(surface(part.geometry, part.material, part.options));
    parts.push(surface(mirror(part.geometry), part.material, part.options));
  }

  const group = assemble(shape.name ?? 'airframe', parts);
  group.userData.surfaces = {
    stabilator: { left: stabilatorLeft, right: stabilatorRight },
    flaperon: { left: flaperonLeft, right: flaperonRight },
    rudder: rudders,
  };
  return group;
}
