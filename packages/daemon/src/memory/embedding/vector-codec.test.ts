import { test, expect } from "bun:test";
import { encodeVector, decodeVector } from "./vector-codec.js";

test("encodeVector produces a little-endian BLOB of the expected byte length", () => {
  const v = new Float32Array([1, -0.5, 0, 3.25]);
  const bytes = encodeVector(v);
  expect(bytes.length).toBe(4 * v.length);
  // First float (1.0) as little-endian IEEE-754 bytes: 00 00 80 3F
  expect(Array.from(bytes.slice(0, 4))).toEqual([0x00, 0x00, 0x80, 0x3f]);
});

test("decodeVector round-trips bit-equal floats for the correct dims", () => {
  const v = new Float32Array([1, -0.5, 0, 3.25]);
  const bytes = encodeVector(v);
  const decoded = decodeVector(bytes, v.length);
  expect(Array.from(decoded)).toEqual(Array.from(v));
});
