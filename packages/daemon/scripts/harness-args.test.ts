import { test, expect } from "bun:test";
import { resolveSuite } from "./harness-args.js";

test("resolveSuite: unknown --suite value throws (fail-closed, no silent core)", () => {
  expect(() => resolveSuite(["--suite=bogus"])).toThrow("unknown --suite");
});
test("resolveSuite: absent flag defaults to core (documented default preserved)", () => {
  expect(resolveSuite([])).toBe("core");
});
test("resolveSuite: valid values pass through", () => {
  expect(resolveSuite(["--suite=2d"])).toBe("2d");
  expect(resolveSuite(["--suite=core"])).toBe("core");
});
