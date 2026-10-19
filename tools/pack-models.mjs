/**
 * Sky Combat — model packer.
 *
 * start.ng serves only a fixed list of file types and `.glb`/`.gltf` are not on it
 * (see docs/PLATFORM.md), so a licensed model cannot be shipped as-is. This tool
 * converts a GLB into a base64 payload inside a `.json` file, which the game
 * fetches at runtime and hands to `GLTFLoader.parse` (see assets/modelRegistry.js).
 *
 *   node tools/pack-models.mjs            pack every assets/*.glb into public/models/
 *   node tools/pack-models.mjs --probe    write a tiny synthetic model to prove the
 *                                         path works, for POST /games/check
 *
 * Run `npm run build` afterwards so the payloads are copied into dist/models/.
 */
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_DIR = join(ROOT, 'assets');
const OUTPUT_DIR = join(ROOT, 'public', 'models');

/** start.ng refuses any single file larger than this. */
const MAX_FILE_BYTES = 25 * 1024 * 1024;

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

/**
 * Build a minimal, valid, self-contained GLB: one triangle.
 *
 * It exists so the packed-model path can be verified against start.ng's checks
 * before any licensed model is committed. Exported so the unit test can validate
 * the bytes rather than trusting the writer.
 */
export function buildProbeGlb() {
  const positions = new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]);
  const indices = new Uint16Array([0, 1, 2]);
  const positionBytes = positions.byteLength;
  const binLength = positionBytes + indices.byteLength;

  const binary = new Uint8Array(binLength + 4);
  binary.set(new Uint8Array(positions.buffer), 0);
  binary.set(new Uint8Array(indices.buffer), positionBytes);

  const gltf = {
    asset: { version: '2.0', generator: 'sky-combat tools/pack-models.mjs probe' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: 'probe' }],
    meshes: [{ name: 'probe', primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [-1, -1, 0], max: [1, 1, 0] },
      { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positionBytes, target: 34962 },
      { buffer: 0, byteOffset: positionBytes, byteLength: indices.byteLength, target: 34963 },
    ],
    buffers: [{ byteLength: binLength }],
  };

  const jsonBytes = new TextEncoder().encode(JSON.stringify(gltf));
  const jsonPadding = (4 - (jsonBytes.length % 4)) % 4;
  const binPadding = (4 - (binLength % 4)) % 4;
  const jsonChunkLength = jsonBytes.length + jsonPadding;
  const binChunkLength = binLength + binPadding;
  const total = 12 + 8 + jsonChunkLength + 8 + binChunkLength;

  const glb = new Uint8Array(total);
  const view = new DataView(glb.buffer);
  view.setUint32(0, GLB_MAGIC, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);

  view.setUint32(12, jsonChunkLength, true);
  view.setUint32(16, CHUNK_JSON, true);
  glb.set(jsonBytes, 20);
  glb.fill(0x20, 20 + jsonBytes.length, 20 + jsonChunkLength); // JSON chunks pad with spaces

  const binChunkStart = 20 + jsonChunkLength;
  view.setUint32(binChunkStart, binChunkLength, true);
  view.setUint32(binChunkStart + 4, CHUNK_BIN, true);
  glb.set(binary.subarray(0, binLength), binChunkStart + 8);

  return glb;
}

/** Wrap model bytes in the JSON envelope the game fetches. */
export function toPayload(id, bytes, extra = {}) {
  return JSON.stringify({
    format: 'glb',
    id,
    bytes: bytes.byteLength,
    note: 'Packed by tools/pack-models.mjs: base64 GLB, because start.ng does not serve .glb files.',
    ...extra,
    data: Buffer.from(bytes).toString('base64'),
  });
}

function writePayload(id, bytes, extra = {}) {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const file = join(OUTPUT_DIR, `${id}.json`);
  writeFileSync(file, toPayload(id, bytes, extra));
  const size = statSync(file).size;
  const flag = size > MAX_FILE_BYTES ? '  ✗ OVER THE 25 MB LIMIT' : '';
  console.log(`  ${id}.json  ${(size / 1024).toFixed(0)} KB${flag}`);
  return size;
}

function packDirectory() {
  let files = [];
  try {
    files = readdirSync(SOURCE_DIR).filter((name) => name.toLowerCase().endsWith('.glb'));
  } catch {
    files = [];
  }

  if (files.length === 0) {
    console.log(`No .glb files in ${SOURCE_DIR}.`);
    console.log('Nothing to pack — the aircraft are built in code (see docs/ASSETS.md).');
    console.log('Run `npm run models:probe` to verify the packed-model path instead.');
    return 0;
  }

  let total = 0;
  for (const name of files) {
    const id = basename(name, '.glb').toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    const bytes = readFileSync(join(SOURCE_DIR, name));
    total += writePayload(id, bytes, { source: `assets/${name}` });
  }
  console.log(`\nPacked ${files.length} model(s), ${(total / 1024 / 1024).toFixed(2)} MB total.`);
  console.log('Run `npm run build` so they are copied into dist/models/.');
  return total;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const asIndex = process.argv.indexOf('--as');
  const target = asIndex === -1 ? 'probe' : process.argv[asIndex + 1];

  if (process.argv.includes('--probe')) {
    console.log(`Writing a synthetic probe model as public/models/${target}.json:`);
    writePayload(target, buildProbeGlb(), { synthetic: true, purpose: 'pipeline validation' });
    console.log('\nRun `npm run build`, then check with `npm run startng:check`.');
    console.log('Delete the payload afterwards — it is a probe, not shipped art.');
  } else {
    packDirectory();
  }
}
