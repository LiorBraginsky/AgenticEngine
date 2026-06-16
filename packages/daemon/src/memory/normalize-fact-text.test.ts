import { test, expect } from "bun:test";
import { normalizeFactText, dedupConnectorKey } from "./normalize-fact-text.js";

// ── normalizeFactText (existing behavior, regression guard) ──────────────────

test("normalizeFactText: lowercases, trims whitespace, strips trailing punct, strips surrounding quotes", () => {
  expect(normalizeFactText("  Hello World!  ")).toBe("hello world");
  expect(normalizeFactText('"quoted"')).toBe("quoted");
  expect(normalizeFactText("[remembered] deploy is yeet.sh")).toBe("deploy is yeet.sh");
  expect(normalizeFactText("NFKC fiffligature")).toBe("nfkc fiffligature"); // ﬀ → ff (two chars)
});

// ── dedupConnectorKey (v2-08 refined-B, bus q#013) ───────────────────────────

test("v2-08 refined-B: dedupConnectorKey collapses closed connectors but NEVER negations/quantifiers", () => {
  // connectors collapse (the demo-cited case):
  expect(dedupConnectorKey("favorite color is blue")).toBe(dedupConnectorKey("favorite color blue"));
  expect(dedupConnectorKey("the user likes blue")).toBe(dedupConnectorKey("user likes blue"));
  // HAZARD GUARD — negation MUST NOT collapse into its opposite:
  expect(dedupConnectorKey("favorite color is not blue")).not.toBe(dedupConnectorKey("favorite color is blue"));
  expect(dedupConnectorKey("favorite color is not blue")).not.toBe(dedupConnectorKey("favorite color blue"));
  // quantifier MUST NOT be stripped:
  expect(dedupConnectorKey("some users like blue")).not.toBe(dedupConnectorKey("users like blue"));
  // word-boundary only — "theory" must not lose "the" as a substring:
  expect(dedupConnectorKey("theory of colour")).toBe("theory of colour");
});
