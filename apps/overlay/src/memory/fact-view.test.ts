import { test, expect } from "bun:test";
import {
  parseProvenance, shouldShowExpiry, shouldShowConfidence, eventLabel, formatTs,
} from "./fact-view.js";

test("parseProvenance: thread:<id> → thread ref", () => {
  expect(parseProvenance("thread:abc")).toEqual({ kind: "thread", threadId: "abc" });
});
test("parseProvenance: bare msg-id / comma-list / empty-after-prefix → text", () => {
  expect(parseProvenance("11111111-1111-1111-1111-111111111111").kind).toBe("text");
  expect(parseProvenance("id1,id2").kind).toBe("text");
  expect(parseProvenance("thread:").kind).toBe("text");
});
test("expiry rule: shown only when non-default (non-null)", () => {
  expect(shouldShowExpiry({ expiry: null })).toBe(false);
  expect(shouldShowExpiry({ expiry: 1730000000000 })).toBe(true);
});
test("confidence rule: shown only when non-default (!== 1)", () => {
  expect(shouldShowConfidence({ confidence: 1 })).toBe(false);
  expect(shouldShowConfidence({ confidence: 0.5 })).toBe(true);
});
test("eventLabel: 0 facts is an observable event, not a gap (ADR-0012 5b)", () => {
  expect(eventLabel({ facts_produced: 0 })).toBe("0 facts (deliberately retained nothing)");
  expect(eventLabel({ facts_produced: 1 })).toBe("1 fact produced");
  expect(eventLabel({ facts_produced: 3 })).toBe("3 facts produced");
});
test("formatTs: null → em-dash; number → non-empty", () => {
  expect(formatTs(null)).toBe("—");
  expect(formatTs(1730000000000).length).toBeGreaterThan(0);
});
