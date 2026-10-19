/**
 * Sky Combat — unit tests for the asset pipeline: the lofting maths that builds
 * every airframe, the base64 decoder used by the packed-model path, and the GLB
 * writer in tools/pack-models.mjs.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { base64ToArrayBuffer, decodeChunked } from '../src/assets/base64.js';
import {
  airfoilRing,
  loftRings,
  mirrorX,
  scaleRing,
  signedVolume,
  superellipseRing,
} from '../src/assets/loft.js';
import { buildProbeGlb, toPayload } from '../tools/pack-models.mjs';

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

/** A closed cylinder: radius 1, length 3, built from four sections. */
function cylinder() {
  const ring = superellipseRing(16, 2);
  return loftRings(
    [0, 1, 2, 3].map((at) => ({ at, ring: scaleRing(ring, { u: 1, v: 1 }) })),
    { axis: 'z' },
  );
}

test('superellipse rings are closed, bounded and unit-sized at exponent 2', () => {
  const circle = superellipseRing(16, 2);
  assert.equal(circle.length, 16);

  for (const [x, y] of circle) {
    assert.ok(Math.abs(x) <= 1 && Math.abs(y) <= 1);
    assert.ok(Math.abs(Math.hypot(x, y) - 1) < 0.02, 'exponent 2 gives a circle');
  }

  // The first point sits at the bottom, which is where the texture seam goes.
  assert.ok(Math.abs(circle[0][0]) < 1e-9);
  assert.ok(Math.abs(circle[0][1] + 1) < 1e-9);

  const square = superellipseRing(16, 6);
  const cornerish = Math.max(...square.map(([x, y]) => Math.hypot(x, y)));
  assert.ok(cornerish > 1.15, 'a higher exponent squares the ring off');
});

test('airfoil rings run from leading to trailing edge and stay thin', () => {
  const ring = airfoilRing(20, 0.1);
  assert.ok(ring.length >= 18, 'the profile is detailed enough');

  const chords = ring.map(([x]) => x);
  assert.ok(Math.min(...chords) < 0.01, 'starts at the leading edge');
  assert.ok(Math.max(...chords) > 0.99, 'reaches the trailing edge');

  const thickness = Math.max(...ring.map(([, y]) => Math.abs(y)));
  assert.ok(thickness > 0.03 && thickness < 0.09, `plausible half-thickness (${thickness})`);
});

test('a lofted cylinder is closed, correctly wound and the right size', () => {
  const geometry = cylinder();
  const position = geometry.getAttribute('position');

  // Four sections of 16 points, each with a duplicated seam vertex, plus two cap centres.
  assert.equal(position.count, 4 * 17 + 2);
  // Three bands of 16 quads (two triangles each) plus two 16-triangle caps.
  assert.equal(geometry.getIndex().count, (3 * 16 * 2 + 32) * 3);

  const volume = signedVolume(geometry);
  const expected = 0.5 * 16 * Math.sin((2 * Math.PI) / 16) * 3;
  assert.ok(volume > 0, 'the triangles face outwards');
  assert.ok(Math.abs(volume - expected) < 0.05, `volume ${volume} vs ${expected}`);

  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  assert.ok(Math.abs(box.min.x + 1) < 1e-6 && Math.abs(box.max.x - 1) < 1e-6);
  assert.ok(Math.abs(box.min.z) < 1e-6 && Math.abs(box.max.z - 3) < 1e-6);
});

test('lofting refuses input it cannot build', () => {
  const ring = superellipseRing(8, 2);
  assert.throws(() => loftRings([{ at: 0, ring }]), /at least two sections/);
  assert.throws(
    () => loftRings([{ at: 0, ring }, { at: 1, ring: ring.slice(0, 4) }]),
    /same number of points/,
  );
});

test('mirroring keeps the mesh outward-facing', () => {
  const right = cylinder();
  const left = mirrorX(right);

  const rightPosition = right.getAttribute('position');
  const leftPosition = left.getAttribute('position');
  assert.equal(leftPosition.count, rightPosition.count);

  for (let i = 0; i < rightPosition.count; i += 1) {
    assert.ok(Math.abs(leftPosition.getX(i) + rightPosition.getX(i)) < 1e-9, 'x is negated');
    assert.ok(Math.abs(leftPosition.getY(i) - rightPosition.getY(i)) < 1e-9, 'y is untouched');
  }

  assert.ok(signedVolume(left) > 0, 'the mirrored mesh still faces outwards');
  assert.ok(Math.abs(signedVolume(left) - signedVolume(right)) < 1e-6);
  assert.notDeepEqual(
    Array.from(left.getIndex().array.slice(0, 3)),
    Array.from(right.getIndex().array.slice(0, 3)),
    'winding is reversed so lighting stays correct',
  );
});

test('base64 decoding round-trips through both code paths', () => {
  const original = new Uint8Array([0, 1, 2, 127, 128, 200, 255, 66, 65, 76, 84]);
  const base64 = Buffer.from(original).toString('base64');

  assert.deepEqual(Array.from(new Uint8Array(base64ToArrayBuffer(base64))), Array.from(original));
  assert.deepEqual(Array.from(new Uint8Array(decodeChunked(base64))), Array.from(original));
  assert.deepEqual(
    Array.from(new Uint8Array(decodeChunked(base64, 4))),
    Array.from(original),
    'chunk boundaries do not corrupt the output',
  );
  assert.deepEqual(
    Array.from(new Uint8Array(base64ToArrayBuffer(`  ${base64}\n`))),
    Array.from(original),
    'whitespace is tolerated',
  );
});

test('the probe GLB is a structurally valid, self-contained model', () => {
  const bytes = buildProbeGlb();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  assert.equal(view.getUint32(0, true), GLB_MAGIC, 'glTF magic number');
  assert.equal(view.getUint32(4, true), 2, 'glTF version 2');
  assert.equal(view.getUint32(8, true), bytes.byteLength, 'declared length matches the file');
  assert.equal(bytes.byteLength % 4, 0, 'GLB is four-byte aligned');

  const jsonLength = view.getUint32(12, true);
  assert.equal(view.getUint32(16, true), CHUNK_JSON);
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)));
  assert.equal(json.asset.version, '2.0');
  assert.equal(json.meshes.length, 1);

  const binaryChunk = 20 + jsonLength;
  const binaryLength = view.getUint32(binaryChunk, true);
  assert.equal(view.getUint32(binaryChunk + 4, true), CHUNK_BIN);
  assert.equal(binaryChunk + 8 + binaryLength, bytes.byteLength, 'the file ends with the BIN chunk');

  for (const bufferView of json.bufferViews) {
    assert.ok(
      bufferView.byteOffset + bufferView.byteLength <= json.buffers[0].byteLength,
      'every buffer view fits inside the buffer',
    );
  }
  assert.equal(json.accessors[0].count, 3);
  assert.equal(json.accessors[0].componentType, 5126, 'positions are float32');
  assert.equal(json.accessors[1].componentType, 5123, 'indices are uint16');

  const binary = bytes.subarray(binaryChunk + 8, binaryChunk + 8 + binaryLength);
  const positions = Array.from(new Float32Array(binary.buffer, binary.byteOffset, 9));
  assert.deepEqual(positions, [-1, -1, 0, 1, -1, 0, 0, 1, 0]);
});

test('the packed payload decodes back to the original model bytes', () => {
  const bytes = buildProbeGlb();
  const payload = JSON.parse(toPayload('probe', bytes));

  assert.equal(payload.format, 'glb');
  assert.equal(payload.bytes, bytes.byteLength);
  assert.equal(typeof payload.data, 'string');

  const decoded = new Uint8Array(base64ToArrayBuffer(payload.data));
  assert.deepEqual(Array.from(decoded), Array.from(bytes));
});
