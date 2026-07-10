import { test, expect } from "bun:test";
import { withRememberedIndex, buildOrdinalMap } from "./memory-turn-slice.js";
import { REMEMBERED_LABEL } from "./system-prompt.js";

test("withRememberedIndex inserts the 1-based ordinal AFTER the label", () => {
  expect(withRememberedIndex(`${REMEMBERED_LABEL}blue`, 3)).toBe(`${REMEMBERED_LABEL}3. blue`);
});

test("withRememberedIndex output still starts with REMEMBERED_LABEL (index.ts injectedMemory flag preserved)", () => {
  const out = withRememberedIndex(`${REMEMBERED_LABEL}blue`, 1);
  expect(out.startsWith(REMEMBERED_LABEL)).toBe(true);
});

test("withRememberedIndex is a no-op (defensive) on a non-remembered string", () => {
  expect(withRememberedIndex("plain user text", 1)).toBe("plain user text");
});

test("buildOrdinalMap builds a 1-based Map from an ordered id array", () => {
  expect(buildOrdinalMap(["a", "b"])).toEqual(new Map([[1, "a"], [2, "b"]]));
});

test("buildOrdinalMap on an empty array returns an empty Map", () => {
  expect(buildOrdinalMap([])).toEqual(new Map());
});
