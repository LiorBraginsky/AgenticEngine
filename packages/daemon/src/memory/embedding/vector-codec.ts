/**
 * Float32 <-> little-endian BLOB codec (hybrid-retrieval spec §3.3 D3a). Plain SQLite
 * BLOB storage — no `sqlite-vec`/ANN extension (gotcha #47 honored, ADR-0017 decision 4).
 */

/** Encode a Float32Array as a little-endian byte BLOB (4 bytes per component). */
export function encodeVector(v: Float32Array): Uint8Array {
  const bytes = new Uint8Array(v.length * 4);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < v.length; i++) {
    view.setFloat32(i * 4, v[i]!, /* littleEndian */ true);
  }
  return bytes;
}

/** Decode a little-endian byte BLOB back into a Float32Array of exactly `dims` components. */
export function decodeVector(bytes: Uint8Array, dims: number): Float32Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Float32Array(dims);
  for (let i = 0; i < dims; i++) {
    out[i] = view.getFloat32(i * 4, /* littleEndian */ true);
  }
  return out;
}
