/**
 * Sky Combat — base64 decoding.
 *
 * Kept separate from the model loader so it is pure and can be unit tested. It is
 * used to turn a packed model payload (base64 inside a `.json` file) back into the
 * bytes `GLTFLoader.parse` expects.
 */

/**
 * Decode in chunks. Used where the platform has no `Uint8Array.fromBase64`, and
 * chunked so a multi-megabyte model cannot overflow the call stack.
 *
 * The result is sliced to the exact decoded length: `subarray().buffer` would
 * return the whole allocation, which leaves trailing zero bytes on the end.
 */
export function decodeChunked(base64, chunkSize = 8192) {
  const clean = String(base64).replace(/\s/g, '');
  const bytes = new Uint8Array(Math.ceil((clean.length * 3) / 4));
  let offset = 0;

  for (let i = 0; i < clean.length; i += chunkSize) {
    const binary = atob(clean.slice(i, i + chunkSize));
    for (let j = 0; j < binary.length; j += 1) {
      bytes[offset + j] = binary.charCodeAt(j);
    }
    offset += binary.length;
  }

  return bytes.buffer.slice(0, offset);
}

/** Decode base64 to an ArrayBuffer, using the fastest path the browser offers. */
export function base64ToArrayBuffer(base64) {
  if (typeof Uint8Array.fromBase64 === 'function') {
    return Uint8Array.fromBase64(String(base64).replace(/\s/g, '')).buffer;
  }
  return decodeChunked(base64);
}
