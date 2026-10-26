/**
 * Sky Combat — the shape of a coin run.
 *
 * Pure, and unit tested, because "coins spawn in clear, collectible patterns" is a claim
 * about geometry: a line of coins has to actually be a line the aircraft can fly along, an
 * arc has to climb gently enough to follow, and a slalom has to stay inside the pattern's
 * own footprint so a single placement never stretches across half the sky.
 *
 * A pattern is written out as flat triples of offsets from the centre of the run —
 * `[along, lateral, vertical, ...]` — measured in the player's own frame: along the
 * heading, to the right, and up. Writing into a caller-owned array keeps placement free of
 * allocation while the game runs.
 */

/** The most coins one pattern may hold. The buffer the caller passes must fit this. */
export const MAX_PATTERN_COINS = 8;

/** The patterns, by name. `line` is the plain one; the other two are variations on it. */
export const COIN_PATTERNS = Object.freeze(['line', 'arc', 'slalom']);

/**
 * Write the offsets of one pattern.
 *
 * @param {string} kind one of `COIN_PATTERNS`
 * @param {number} count coins in the pattern (clamped to `MAX_PATTERN_COINS`)
 * @param {number} spacing metres between neighbouring coins
 * @param {Float32Array|number[]} out at least `3 * MAX_PATTERN_COINS` numbers
 * @returns {number} how many triples were written
 */
export function writePattern(kind, count, spacing, out) {
  const n = Math.max(1, Math.min(MAX_PATTERN_COINS, Math.floor(count) || 1));
  const step = Math.max(0, spacing);

  // The run is centred on the placement point, so a pattern is spread evenly either side
  // of it and the mean of its offsets is the point that was actually chosen for legality.
  const half = (n - 1) / 2;

  for (let i = 0; i < n; i += 1) {
    const index = i - half;
    const along = index * step;
    let lateral = 0;
    let vertical = 0;

    if (kind === 'arc') {
      // A shallow hill: up, over, and back down. The rise is a fraction of the spacing so
      // the whole arc stays flyable at cruise speed rather than being a wall.
      const t = n > 1 ? i / (n - 1) : 0.5;
      vertical = Math.sin(t * Math.PI) * step * 0.55;
    } else if (kind === 'slalom') {
      // One full gentle S over the length of the run, staying within one spacing either
      // side so it cannot wander out of the area it was placed in.
      const t = n > 1 ? i / (n - 1) : 0.5;
      lateral = Math.sin(t * Math.PI * 2) * step * 0.9;
    }

    const offset = i * 3;
    out[offset] = along;
    out[offset + 1] = lateral;
    out[offset + 2] = vertical;
  }

  return n;
}

/**
 * Choose a pattern and a length for one placement.
 *
 * @param {() => number} random deterministic source in [0, 1)
 * @param {{patterns?:string[], perPattern?:number[]}} options the `coins` block of `RUN`
 * @param {{kind?:string, count?:number}} [out] written into and returned, so a caller can
 *   keep one object for the life of the game
 * @returns {{kind:string, count:number}}
 */
export function choosePattern(random, options, out = {}) {
  const patterns = options?.patterns?.length ? options.patterns : COIN_PATTERNS;
  const [minCount, maxCount] = options?.perPattern ?? [4, 7];
  out.kind = patterns[Math.min(patterns.length - 1, Math.floor(random() * patterns.length))];
  out.count = Math.round(minCount + random() * (maxCount - minCount));
  return out;
}

/**
 * Total length of a pattern along the heading, in metres. Used to decide whether a pattern
 * that was placed ahead of the player will still be ahead of it when the last coin is
 * reached, rather than half of it already behind.
 */
export function patternLength(count, spacing) {
  return Math.max(0, (Math.max(1, count) - 1) * spacing);
}
