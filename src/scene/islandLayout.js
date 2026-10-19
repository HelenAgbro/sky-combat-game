/**
 * Sky Combat — island field layout.
 *
 * Where the land is, as pure maths, so `scene/Terrain.js` only has to move meshes
 * about and this can be unit tested without a renderer.
 *
 * The world is divided into a grid of cells. A cell either holds an island or it
 * does not, decided by hashing the cell's coordinates — so the same stretch of world
 * always has the same land, however the player got there, and no state has to be
 * stored to remember it. Only the cells near the aircraft are rendered.
 */

/** Grid, reach and density of the land. */
export const ISLAND_FIELD = Object.freeze({
  /** Metres per cell. */
  gridSize: 2600,
  /** How many cells out from the aircraft's own cell are considered. */
  reach: 2,
  /** Fraction of cells that hold an island. */
  density: 0.5,
  /** Ceiling on live islands, whatever the reach and density work out to. */
  maxIslands: 14,
  seed: 4177,
});

/**
 * A deterministic hash of a cell coordinate, in [0, 1).
 *
 * A murmur-style finaliser over the two coordinates: changing either one by a single
 * unit scatters the result completely, which is what stops the land forming the
 * visible diagonal pattern a simpler hash produces.
 */
export function cellHash(cx, cz, salt = 0) {
  let h = Math.imul(cx | 0, 0x27d4eb2d) ^ Math.imul(cz | 0, 0x165667b1) ^ Math.imul(salt | 0, 0x9e3779b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Which cell a world position falls in. */
export function cellOf(x, z, field = ISLAND_FIELD) {
  return { cx: Math.round(x / field.gridSize), cz: Math.round(z / field.gridSize) };
}

/**
 * The island in one cell, or `present: false` for open water.
 *
 * The island sits inside the middle of its cell with room to spare, so two
 * neighbouring islands never grow into each other and a cell can be described
 * without knowing anything about the cells next to it.
 */
export function islandForCell(cx, cz, field = ISLAND_FIELD, out = {}) {
  const size = field.gridSize;
  const seed = field.seed ?? 0;

  out.cx = cx;
  out.cz = cz;
  out.present = cellHash(cx, cz, seed) < field.density;
  out.x = cx * size + (cellHash(cx, cz, seed + 11) - 0.5) * size * 0.62;
  out.z = cz * size + (cellHash(cx, cz, seed + 23) - 0.5) * size * 0.62;
  out.scale = 0.72 + cellHash(cx, cz, seed + 37) * 1.15;
  out.rotation = cellHash(cx, cz, seed + 53) * Math.PI * 2;
  out.shape = Math.floor(cellHash(cx, cz, seed + 71) * 8) % 8;
  return out;
}

/**
 * The nearest islands to the aircraft, nearest first, written into `out`.
 *
 * `out` must already hold `limit` objects — the caller owns them and they are
 * rewritten in place, so flying around never allocates. Returns how many entries of
 * `out` are valid.
 *
 * Keeps the closest `limit` without sorting the whole neighbourhood: it walks the
 * cells once and only replaces the current farthest when a nearer island turns up.
 *
 * @param {{x:number, z:number}} focus
 * @param {object} [field]
 * @param {object[]} out preallocated, at least `limit` long
 * @param {number} [limit]
 * @returns {number} count of valid entries in `out`
 */
export function islandsAround(focus, field = ISLAND_FIELD, out = [], limit = field.maxIslands) {
  const origin = cellOf(focus.x, focus.z, field);
  const scratch = islandScratch();
  let count = 0;
  let farthest = 0;

  if (limit <= 0 || out.length === 0) return 0;

  for (let i = -field.reach; i <= field.reach; i += 1) {
    for (let j = -field.reach; j <= field.reach; j += 1) {
      const cell = islandForCell(origin.cx + i, origin.cz + j, field, scratch);
      if (!cell.present) continue;

      const dx = cell.x - focus.x;
      const dz = cell.z - focus.z;
      const distance = dx * dx + dz * dz;

      if (count < limit) {
        copyIsland(cell, out[count], distance);
        count += 1;
      } else {
        // `farthest` is only recomputed after a replacement, so the common case is
        // a single comparison per cell.
        if (distance < out[farthest].distance) {
          copyIsland(cell, out[farthest], distance);
          farthest = 0;
          for (let k = 1; k < count; k += 1) {
            if (out[k].distance > out[farthest].distance) farthest = k;
          }
        }
        continue;
      }

      if (count === limit) {
        farthest = 0;
        for (let k = 1; k < count; k += 1) {
          if (out[k].distance > out[farthest].distance) farthest = k;
        }
      }
    }
  }

  /*
   * Nearest first, so the caller can take slots in order and the closest land is always
   * the one that is shown. An insertion sort over at most `limit` entries, on the rare
   * frame where the aircraft crosses into a new cell.
   */
  for (let i = 1; i < count; i += 1) {
    const island = out[i];
    let j = i - 1;
    while (j >= 0 && out[j].distance > island.distance) {
      out[j + 1] = out[j];
      j -= 1;
    }
    out[j + 1] = island;
  }

  return count;
}

/** Copy the fields that matter out of the scratch cell, so it can be reused. */
function copyIsland(from, to, distance) {
  to.cx = from.cx;
  to.cz = from.cz;
  to.x = from.x;
  to.z = from.z;
  to.scale = from.scale;
  to.rotation = from.rotation;
  to.shape = from.shape;
  to.distance = distance;
  return to;
}

let scratch = null;

/** One reused scratch cell. Module-private: only `islandsAround` ever sees it. */
function islandScratch() {
  if (!scratch) scratch = {};
  return scratch;
}
