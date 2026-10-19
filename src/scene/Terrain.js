/**
 * Sky Combat — the land.
 *
 * Islands, as low-poly radial heightfields, placed on the deterministic grid in
 * `scene/islandLayout.js` and drawn only near the aircraft. Their purpose is scale
 * and depth: without land the sea is an endless plane and the aircraft has no sense
 * of how fast or how high it is.
 *
 * Deliberately cheap: eight shared geometries, a fixed pool of meshes, no shadow
 * casting, no collision. The land sits well below the aircraft's normal altitude band
 * and is scenery, not level geometry — see docs/ASSETS.md for what that means.
 */
import { Color, Group, Mesh, MeshStandardMaterial, BufferGeometry, Float32BufferAttribute, SRGBColorSpace } from 'three';
import { createSeededRandom } from '../game/math.js';
import { ISLAND_FIELD, cellOf, islandsAround } from './islandLayout.js';

/** How many distinct island shapes are built. They are reused across the whole world. */
const SHAPE_COUNT = 8;

/** Colour bands by height fraction: sand, grass, rock, snow. */
function bandColour(color, t) {
  if (t < 0.05) return color.setRGB(0.87, 0.81, 0.65, SRGBColorSpace);
  if (t < 0.32) return color.setRGB(0.35, 0.45, 0.29, SRGBColorSpace);
  if (t < 0.7) return color.setRGB(0.45, 0.43, 0.38, SRGBColorSpace);
  return color.setRGB(0.87, 0.89, 0.93, SRGBColorSpace);
}

/**
 * One island: a dome of triangles with a wobbling outline, coloured by height.
 *
 * The rim is sunk a few metres below sea level so the waterline is a clean
 * intersection instead of two coplanar surfaces fighting over the same pixels.
 *
 * Winding is chosen so every face points upward; `tests/assets.test.mjs` asserts it
 * rather than trusting it.
 */
export function buildIslandGeometry(random, { rings = 8, segments = 22, height = 190, radius = 620 } = {}) {
  const positions = [];
  const colors = [];
  const indices = [];
  const color = new Color();

  const phaseA = random() * Math.PI * 2;
  const phaseB = random() * Math.PI * 2;
  const squash = 0.82 + random() * 0.4;
  const peak = 0.85 + random() * 0.3;
  const stride = segments + 1;

  const sample = (t, angle) => {
    const wobble =
      1 + 0.26 * Math.sin(angle * 3 + phaseA) + 0.14 * Math.sin(angle * 5 + phaseB);
    const dome = Math.cos((t * Math.PI) / 2) ** 1.5;
    // `t ** 8` only bites on the outermost ring, so just the shoreline sinks.
    const y = height * dome * wobble * (1 - 0.3 * t) * peak - 8 * t ** 8;
    const radial = radius * t * (1 + 0.2 * Math.sin(angle * 2 + phaseB));
    return { x: Math.cos(angle) * radial, y, z: Math.sin(angle) * radial * squash };
  };

  const push = (point) => {
    positions.push(point.x, point.y, point.z);
    bandColour(color, Math.max(0, point.y) / height);
    colors.push(color.r, color.g, color.b);
  };

  // The summit, then every ring out to the shore.
  push({ x: 0, y: height * peak, z: 0 });
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

  constructor(zone, preset) {
    this.#group = new Group();
    this.#group.name = 'terrain';

    const count = Math.max(0, preset.islands ?? 0);
    const random = createSeededRandom(9137);
    const shapes = Math.max(1, Math.min(SHAPE_COUNT, count));

    // One set of shapes for the whole world: a cell reuses whichever shape its pool
    // slot already holds, so flying around never builds or frees geometry.
    for (let i = 0; i < shapes; i += 1) this.#shapes.push(buildIslandGeometry(random));

    this.#material = new MeshStandardMaterial({
      vertexColors: true,
      flatShading: true,
      roughness: 0.94,
      metalness: 0.02,
      envMapIntensity: 0.55,
    });

    for (let i = 0; i < count; i += 1) {
      const mesh = new Mesh(this.#shapes[i % this.#shapes.length], this.#material);
      mesh.name = `island:${i}`;
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

  /** Re-tint the land for a zone and re-read how dense the archipelago is. */
  setZone(zone) {
    const palette = zone.terrain ?? {};
    this.#material.color.set(palette.color ?? '#ffffff');
    this.#field = {
      ...ISLAND_FIELD,
      density: palette.density ?? ISLAND_FIELD.density,
      seed: ISLAND_FIELD.seed + (palette.seedOffset ?? 0),
    };
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
