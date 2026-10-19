/**
 * Packed model registry — the optional path for licensed 3D models.
 *
 * start.ng does not serve `.glb` or `.gltf` files (see docs/PLATFORM.md), so a
 * licensed model is converted at build time by `tools/pack-models.mjs` into a
 * base64 payload inside a `.json` file under `public/models/`. This module fetches
 * that payload and hands the decoded bytes to `GLTFLoader.parse`, which reads a
 * GLB from its binary chunk — so a single self-contained `.json` file carries the
 * geometry and its embedded textures.
 *
 * When no payload exists (the case today, since the airframes are built in code)
 * every call resolves to `null` and `AircraftFactory` uses the procedural model.
 * A payload that fails to parse is reported and treated the same way, so a bad
 * model can never stop the game from starting.
 */
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { base64ToArrayBuffer } from './base64.js';

const cache = new Map();
const loader = new GLTFLoader();

/**
 * The ids packed into `public/models/` when this build was made. The build injects
 * the list (see vite.config.js), so the game never asks for a payload that is not
 * there. When the constant is absent — in Node, or a stray import — every id is
 * treated as unavailable and the procedural airframe is used.
 */
function packedIds() {
  return typeof __PACKED_MODELS__ === 'undefined' ? null : __PACKED_MODELS__;
}

/**
 * Fetch and parse a packed model.
 * @param {string} id aircraft id, matching `models/<id>.json`
 * @returns {Promise<import('three').Group|null>} the model, or null when there is none
 */
export function loadPackedModel(id, { directory = 'models' } = {}) {
  const available = packedIds();
  if (available && !available.includes(id)) return Promise.resolve(null);
  if (cache.has(id)) return cache.get(id);

  const promise = (async () => {
    let response;
    try {
      const url = new URL(`${directory}/${id}.json`, document.baseURI);
      response = await fetch(url, { cache: 'force-cache' });
    } catch (error) {
      return null; // offline, or blocked: fall through to the procedural airframe
    }
    if (!response.ok) return null;

    let payload;
    try {
      payload = await response.json();
    } catch (error) {
      console.warn(`[SkyCombat] models/${id}.json is not valid JSON; using the procedural airframe.`);
      return null;
    }
    if (!payload?.data) return null;

    const buffer = base64ToArrayBuffer(payload.data);
    return await new Promise((resolve) => {
      loader.parse(
        buffer,
        '',
        (gltf) => resolve(gltf.scene ?? null),
        (error) => {
          console.warn(
            `[SkyCombat] packed model "${id}" could not be parsed; using the procedural airframe.`,
            error,
          );
          resolve(null);
        },
      );
    });
  })();

  cache.set(id, promise);
  return promise;
}

export function clearPackedModelCache() {
  cache.clear();
}
