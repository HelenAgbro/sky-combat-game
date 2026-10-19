/**
 * Sky Combat — a fixed-size object pool.
 *
 * Everything in a fight is pooled: shots, enemies, hazards, impact effects. A capacity is
 * decided up front, every object is created once, and from then on acquiring and
 * releasing are array operations. Nothing is allocated while the game is running, which
 * is what keeps the frame time flat after ten minutes of combat rather than climbing as
 * the collector works.
 *
 * The active objects are kept contiguous, so iterating them is a plain loop and
 * releasing one is O(1) — the last active object is swapped into the gap it leaves.
 */
export class Pool {
  #items;
  #free;
  #active = [];

  /**
   * @param {{capacity:number, create:(index:number)=>object}} options
   *   `create` is called exactly `capacity` times, at construction.
   */
  constructor({ capacity, create }) {
    this.capacity = capacity;
    this.#items = new Array(capacity);
    this.#free = new Array(capacity);

    for (let i = 0; i < capacity; i += 1) {
      const item = create(i);
      item.active = false;
      item.slot = -1;
      this.#items[i] = item;
      this.#free[i] = item;
    }
  }

  /** Every object the pool owns, active or not. */
  get items() {
    return this.#items;
  }

  /** The active objects, contiguous. Iterate it forwards and it is safe to release. */
  get active() {
    return this.#active;
  }

  get activeCount() {
    return this.#active.length;
  }

  get freeCount() {
    return this.#free.length;
  }

  /** Take an object, or null when the pool is exhausted. */
  acquire() {
    const item = this.#free.pop();
    if (!item) return null;
    item.active = true;
    item.slot = this.#active.length;
    this.#active.push(item);
    return item;
  }

  /** Give an object back. Releasing something already released is harmless. */
  release(item) {
    if (!item || !item.active) return;
    const last = this.#active.length - 1;
    const moved = this.#active[last];

    this.#active[item.slot] = moved;
    moved.slot = item.slot;
    this.#active.pop();

    item.active = false;
    item.slot = -1;
    this.#free.push(item);
  }

  /** Release everything. Used when a run ends and a new one begins. */
  releaseAll() {
    for (let i = this.#active.length - 1; i >= 0; i -= 1) this.release(this.#active[i]);
  }

  /**
   * Iterate the active objects backwards.
   *
   * Backwards matters: a system that releases objects as it goes would otherwise skip
   * the one swapped into the gap. This is the loop every combat system uses.
   *
   * @param {(item:object, index:number) => void} visit
   */
  forEachActive(visit) {
    for (let i = this.#active.length - 1; i >= 0; i -= 1) visit(this.#active[i], i);
  }
}
