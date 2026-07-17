import { test, expect } from "bun:test";
import { truncateEncoding, MODEL_MAX_POSITIONS } from "./tokenizer.js";

test("truncateEncoding caps a >512-token encoding to MODEL_MAX_POSITIONS (first-N), aligning ids+mask", () => {
  const n = 25308; // the live-failure token count (D3 demo 2026-07-16)
  const ids = {
    inputIds: Array.from({ length: n }, (_, i) => i),
    attentionMask: Array.from({ length: n }, () => 1),
  };
  const out = truncateEncoding(ids);
  expect(out.inputIds.length).toBe(MODEL_MAX_POSITIONS);
  expect(out.attentionMask.length).toBe(MODEL_MAX_POSITIONS);
  expect(out.inputIds[0]).toBe(0);                            // head-of-doc preserved
  expect(out.inputIds[MODEL_MAX_POSITIONS - 1]).toBe(MODEL_MAX_POSITIONS - 1);
});

test("truncateEncoding leaves an at/under-cap encoding unchanged (same reference)", () => {
  const ids = { inputIds: [0, 5, 9, 2], attentionMask: [1, 1, 1, 1] };
  expect(truncateEncoding(ids)).toBe(ids);                    // no copy when nothing to cut
});
