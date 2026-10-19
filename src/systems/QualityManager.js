/**
 * Sky Combat — quality tiers and adaptive resolution.
 *
 * The brief asks for measured performance rather than promised frame rates, so
 * this module does two things: it picks a starting tier from what the device
 * reports, and it keeps the render resolution inside a frame-time budget while
 * the game runs. `pickTier` is a pure function so its behaviour is unit tested.
 */

export const TIERS = Object.freeze(['low', 'medium', 'high']);

/** What each tier turns on. Consumed by the scene, sky, world and effects modules. */
export const PRESETS = Object.freeze({
  low: {
    shadows: false,
    shadowMapSize: 512,
    clouds: 0,
    waveDetail: 'flat',
    antialias: false,
    maxPixelRatio: 1,
    seaSegments: 16,
    seaRepeat: 6,
    anisotropy: 1,
    renderScaleRange: [0.6, 1],
  },
  medium: {
    shadows: true,
    shadowMapSize: 1024,
    clouds: 12,
    waveDetail: 'normal',
    antialias: true,
    maxPixelRatio: 1.5,
    seaSegments: 32,
    seaRepeat: 9,
    anisotropy: 4,
    renderScaleRange: [0.7, 1],
  },
  high: {
    shadows: true,
    shadowMapSize: 2048,
    clouds: 26,
    waveDetail: 'normal',
    antialias: true,
    maxPixelRatio: 2,
    seaSegments: 48,
    seaRepeat: 12,
    anisotropy: 8,
    renderScaleRange: [0.85, 1],
  },
});

/**
 * Choose a starting tier from device capabilities.
 *
 * @param {object} metrics
 * @param {boolean} [metrics.webgl2]  WebGL2 available (no WebGL2 means a very old device)
 * @param {boolean} [metrics.isMobile] coarse pointer / mobile user agent
 * @param {number} [metrics.cores]      navigator.hardwareConcurrency
 * @param {number} [metrics.memory]     navigator.deviceMemory, in GB (Safari does not report it)
 * @param {number} [metrics.maxTextureSize] GL_MAX_TEXTURE_SIZE
 * @returns {'low'|'medium'|'high'}
 */
export function pickTier({
  webgl2 = true,
  isMobile = false,
  cores = 4,
  memory = 4,
  maxTextureSize = 4096,
} = {}) {
  if (!webgl2) return 'low';

  let score = 0;
  score += cores >= 8 ? 3 : cores >= 4 ? 2 : 1;
  score += memory >= 8 ? 3 : memory >= 4 ? 2 : 1;
  score += maxTextureSize >= 8192 ? 2 : maxTextureSize >= 4096 ? 1 : 0;
  score += isMobile ? 0 : 3;

  if (score >= 9) return 'high';
  if (score >= 5) return 'medium';
  return 'low';
}

/**
 * Reads the device once and keeps the render resolution inside a frame budget.
 */
export class QualityManager {
  #renderer;
  #canvas;
  #tier;
  #preset;
  #renderScale;
  #frameTimes = [];
  #cooldown = 0;

  constructor(renderer, { metrics = {}, forcedTier = null } = {}) {
    this.#renderer = renderer;
    this.#canvas = renderer.domElement;
    this.#tier = forcedTier ?? pickTier(metrics);
    this.#preset = PRESETS[this.#tier];
    const [, ceiling] = this.#preset.renderScaleRange;
    this.#renderScale = ceiling;
  }

  get tier() {
    return this.#tier;
  }

  get preset() {
    return this.#preset;
  }

  get renderScale() {
    return this.#renderScale;
  }

  /** Effective pixel ratio currently applied to the canvas. */
  get pixelRatio() {
    return Math.min(window.devicePixelRatio || 1, this.#preset.maxPixelRatio) * this.#renderScale;
  }

  /** Resize the drawing buffer to the element's CSS size at the current scale. */
  resize() {
    const width = Math.max(1, this.#canvas.clientWidth || window.innerWidth);
    const height = Math.max(1, this.#canvas.clientHeight || window.innerHeight);
    this.#renderer.setPixelRatio(this.pixelRatio);
    this.#renderer.setSize(width, height, false);
  }

  /**
   * Feed one frame's duration. When the recent average drifts away from the
   * budget, the render scale moves in small steps so the change is never visible.
   *
   * The two thresholds are deliberately far apart and a change is followed by a
   * long cooldown: scaling up and back down again every second would show as a
   * shimmer, which is worse than the frame time it is trying to fix.
   */
  update(frameMs) {
    this.#frameTimes.push(frameMs);
    if (this.#frameTimes.length > 60) this.#frameTimes.shift();
    if (this.#frameTimes.length < 30 || this.#cooldown > 0) {
      this.#cooldown -= 1;
      return;
    }

    const average = this.#frameTimes.reduce((sum, value) => sum + value, 0) / this.#frameTimes.length;
    const budget = 1000 / 60;
    const [floor, ceiling] = this.#preset.renderScaleRange;

    if (average > budget * 1.35 && this.#renderScale > floor) {
      this.#renderScale = Math.max(floor, this.#renderScale - 0.05);
    } else if (average < budget * 0.78 && this.#renderScale < ceiling) {
      this.#renderScale = Math.min(ceiling, this.#renderScale + 0.05);
    } else {
      return;
    }

    this.#frameTimes.length = 0;
    this.#cooldown = 90;
    this.resize();
  }
}

/**
 * Read what the device reports about itself.
 *
 * A throwaway context is used to ask for WebGL2 and the maximum texture size, and
 * it is released again immediately so it does not count against the browser's
 * limit on live WebGL contexts. `webgl: false` is what lets the game show its
 * "can't start the 3D view" panel instead of failing silently.
 */
export function readDeviceMetrics() {
  const coarsePointer = window.matchMedia?.('(pointer: coarse)')?.matches ?? false;
  const isMobile = coarsePointer || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

  let webgl = false;
  let webgl2 = false;
  let maxTextureSize = 2048;

  try {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('webgl2');
    if (context) {
      webgl = true;
      webgl2 = true;
      maxTextureSize = context.getParameter(context.MAX_TEXTURE_SIZE) || maxTextureSize;
      context.getExtension('WEBGL_lose_context')?.loseContext();
    } else {
      const legacy = canvas.getContext('webgl');
      if (legacy) {
        webgl = true;
        maxTextureSize = legacy.getParameter(legacy.MAX_TEXTURE_SIZE) || maxTextureSize;
        legacy.getExtension('WEBGL_lose_context')?.loseContext();
      }
    }
  } catch (error) {
    webgl = false;
  }

  return {
    webgl,
    webgl2,
    isMobile,
    maxTextureSize,
    cores: navigator.hardwareConcurrency || 4,
    // Safari does not report deviceMemory; assume a modern desktop instead.
    memory: navigator.deviceMemory || (isMobile ? 4 : 8),
  };
}
