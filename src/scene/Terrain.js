/**
 * Sky Combat — the land.
 *
 * Islands and ridges, as low-poly radial heightfields, placed on the deterministic grid
 * in `scene/islandLayout.js` and drawn only near the aircraft. Their purpose is scale
 * and depth: without land the sea is an endless plane and the aircraft has no sense of
 * how fast or how high it is.
 *
 * What the land *is* comes from a scenery kind (`scene/scenery.js`): height, footprint,
 * how many summits, how jagged the outline, and the colour bands by height. A zone names
 * a kind, so a new one is data rather than code.
 *
 * Deliberately cheap: a handful of shared geometries, a fixed pool of meshes, no shadow
 * casting, no collision. The land is scenery, not level geometry — see docs/ASSETS.md.
 */
import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshStandardMaterial,
  SRGBColorSpace,
} from 'three';
import { createSeededRandom, shortestAngle } from '../game/math.js';
import { ISLAND_FIELD, cellOf, islandsAround } from './islandLayout.js';
import { sceneryFor } from './scenery.js';

/** How many distinct terrain shapes are built. They are reused across the whole world. */
const SHAPE_COUNT = 8;

/** Pick a colour band by height fraction: beach, grass, rock, snow. */
function bandColour(color, t, bands) {
  for (const [upTo, r, g, b] of bands) {
    if (t <= upTo) return color.setRGB(r, g, b, SRGBColorSpace);
  }
  // A kind with no bands — open water — leaves the colour alone rather than reading off
  // the end of an empty list.
  if (bands.length === 0) return color;
  const last = bands[bands.length - 1];
  return color.setRGB(last[1], last[2], last[3], SRGBColorSpace);
}

/**
 * One landform: a heightfield of triangles with a wobbling outline, coloured by height.
 *
 * The rim is sunk a few metres below sea level so the waterline is a clean intersection
 * instead of two coplanar surfaces fighting over the same pixels.
 *
 * Winding is chosen so every face points upward; `tests/assets.test.mjs` asserts it
 * rather than trusting it.
 *
 * @param {() => number} random deterministic source
 * @param {object} kind from `scene/scenery.js`
 */
export function buildTerrainGeometry(random, kind) {
  const {
    rings,
    segments,
    height,
    radius,
    fullness,
    taper,
    peaks,
    peakSpread,
    wobble,
    squash,
    peakScale,
    sink,
    bands,
  } = kind;

  const positions = [];
  const colors = [];
  const indices = [];
  const color = new Color();
  const stride = segments + 1;

  // Every random choice is made once, outside the sampling loop, so a shape is
  // deterministic and the loop itself stays free of branching.
  const phases = wobble.map(() => random() * Math.PI * 2);
  const basePhase = random() * Math.PI * 2;
  const stretch = squash[0] + random() * (squash[1] - squash[0]);
  const summit = peakScale[0] + random() * (peakScale[1] - peakScale[0]);
  const peakAngles = [];
  for (let i = 0; i < peaks; i += 1) {
    peakAngles.push(basePhase + (i / peaks) * Math.PI * 2 + (random() - 0.5) * 0.7);
  }

  const sample = (t, angle) => {
    let edge = 1;
    for (let i = 0; i < wobble.length; i += 1) {
      edge += wobble[i][1] * Math.sin(angle * wobble[i][0] + phases[i]);
    }

    // One summit is a dome; several gathered around the rim make a ridge line, which is
    // the difference between an island and a mountain range.
    let ridge = 1;
    if (peaks > 1) {
      let nearest = 0;
      for (const peakAngle of peakAngles) {
        const distance = Math.abs(shortestAngle(peakAngle, angle));
        nearest = Math.max(nearest, Math.exp(-((distance / peakSpread) ** 2)));
      }
      ridge = 0.5 + 0.5 * nearest;
    }

    const dome = Math.cos((t * Math.PI) / 2) ** fullness;
    // `t ** 8` only bites on the outermost ring, so just the shoreline sinks.
    const y = height * dome * edge * ridge * summit * (1 - taper * t) - sink * t ** 8;
    const radial = radius * t * (1 + 0.2 * Math.sin(angle * 2 + basePhase));
    return { x: Math.cos(angle) * radial, y, z: Math.sin(angle) * radial * stretch };
  };

  const push = (point) => {
    positions.push(point.x, point.y, point.z);
    bandColour(color, Math.max(0, point.y) / height, bands);
    colors.push(color.r, color.g, color.b);
  };

  // The summit, then every ring out to the shore.
  push({ x: 0, y: height * summit, z: 0 });
  for (let r = 1; r <= rings; r += 1) {
    for (let s = 0; s <= segments; s += 1) {
      push(sample(r / rings, (s / segments) * Math.PI * 2));
    }
  }

  const at = (r, s) => 1 + (r - 1) * stride + s;
  for (let s = 0; s < segments; s += 1) {
    indices.push(0, at(1, s + 1), at(1, s));
  }
  for (let r = 1; r < rings; r += 1) {
    for (let s = 0; s < segments; s += 1) {
      const a = at(r, s);
      const b = at(r, s + 1);
      const c = at(r + 1, s);
      const d = at(r + 1, s + 1);
      indices.push(a, d, c, a, b, d);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  return geometry;
}

export class Terrain {
  #group;
  #material;
  #shapes = [];
  #pool = [];
  /** Preallocated output for `islandsAround`: the layout module never allocates. */
  #wanted;
  #field;
  #cell = { cx: NaN, cz: NaN };
  #placed = 0;
  /** Which terrain kind the shapes were built for. */
  #terrainId = null;

  constructor(zone, preset) {
    this.#group = new Group();
    this.#group.name = 'terrain';

    const count = Math.max(0, preset.islands ?? 0);

    this.#material = new MeshStandardMaterial({
      vertexColors: true,
      flatShading: true,
      roughness: 0.94,
      metalness: 0.02,
      envMapIntensity: 0.55,
    });

    this.#buildShapes(zone, count);

    for (let i = 0; i < count; i += 1) {
      const mesh = new Mesh(this.#shapes[i % this.#shapes.length], this.#material);
      mesh.name = `land:${i}`;
      // Static scenery: the transform is written once when a slot takes a cell, so
      // Three does not rebuild the matrix every frame.
      mesh.matrixAutoUpdate = false;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.visible = false;
      this.#pool.push(mesh);
      this.#group.add(mesh);
    }

    this.#wanted = Array.from(
      { length: Math.max(ISLAND_FIELD.maxIslands, count) },
      () => ({}),
    );

    this.setZone(zone);
  }

  /**
   * Build the shared shapes for the zone's terrain kind.
   *
   * One set of shapes serves the whole world: a cell reuses whichever shape its pool slot
   * already holds, so flying around never builds or frees geometry. They are rebuilt only
   * when the zone's kind actually changes, which happens at the midpoint of a transition.
   */
  #buildShapes(zone, count) {
    const { terrain, terrainId } = sceneryFor(zone);
    this.#terrainId = terrainId;

    for (const shape of this.#shapes) shape.dispose();
    this.#shapes.length = 0;
    if (count === 0 || terrain.density === 0) return;

    const random = createSeededRandom(9137);
    const shapes = Math.max(1, Math.min(SHAPE_COUNT, count));
    for (let i = 0; i < shapes; i += 1) this.#shapes.push(buildTerrainGeometry(random, terrain));
  }

  get group() {
    return this.#group;
  }

  /** How many islands the pool can show at once. Read by the tests. */
  get capacity() {
    return this.#pool.length;
  }

  /** How many islands are currently placed. Read by the tests. */
  get placed() {
    return this.#placed;
  }

  /** Re-tint the land for a zone, and rebuild it if the zone names a different kind. */
  setZone(zone) {
    const palette = zone.terrain ?? {};
    this.#material.color.set(palette.color ?? '#ffffff');

    if (sceneryFor(zone).terrainId !== this.#terrainId) {
      this.#buildShapes(zone, this.#pool.length);
      // The pool's meshes are shared, so they have to be re-pointed at the new shapes.
      const shapes = this.#shapes.length;
      for (let i = 0; i < this.#pool.length; i += 1) {
        if (shapes === 0) {
          this.#pool[i].visible = false;
        } else {
          this.#pool[i].geometry = this.#shapes[i % shapes];
        }
      }
    }

    this.#field = {
      ...ISLAND_FIELD,
      density: palette.density ?? ISLAND_FIELD.density,
      seed: ISLAND_FIELD.seed + (palette.seedOffset ?? 0),
    };

    // Forget which cell we are in, so the next update re-places the whole pool.
    this.#cell.cx = NaN;
    this.#cell.cz = NaN;
  }

  /**
   * Re-place the pool when the aircraft crosses into a new grid cell.
   *
   * This is the only work the terrain does, and it happens about once every 30
   * seconds at cruise speed — everything else is a handful of static meshes.
   *
   * @param {{x:number, z:number}} focus the aircraft
   */
  update(focus) {
    if (this.#pool.length === 0) return;

    const cell = cellOf(focus.x, focus.z, this.#field);
    if (cell.cx === this.#cell.cx && cell.cz === this.#cell.cz) return;
    this.#cell = cell;

    const limit = Math.min(this.#pool.length, this.#wanted.length);
    const count = islandsAround(focus, this.#field, this.#wanted, limit);

    for (let i = 0; i < this.#pool.length; i += 1) {
      const mesh = this.#pool[i];
      const island = i < count ? this.#wanted[i] : null;
      if (!island) {
        if (mesh.visible) mesh.visible = false;
        continue;
      }
      mesh.position.set(island.x, 0, island.z);
      mesh.rotation.y = island.rotation;
      mesh.scale.setScalar(island.scale);
      mesh.updateMatrix();
      mesh.visible = true;
    }

    this.#placed = count;
  }

  dispose() {
    for (const shape of this.#shapes) shape.dispose();
    this.#shapes.length = 0;
    this.#pool.length = 0;
    this.#material.dispose();
    this.#group.clear();
  }
}
