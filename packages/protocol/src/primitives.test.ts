import { test, expect } from "bun:test";
import { TextPrimitive } from "./primitives.js";

test("TextPrimitive validates { primitive: 'text', content: string }", () => {
  const ok = TextPrimitive.safeParse({ primitive: "text", content: "hello" });
  expect(ok.success).toBe(true);
});

test("TextPrimitive rejects missing content", () => {
  expect(TextPrimitive.safeParse({ primitive: "text" }).success).toBe(false);
});

test("TextPrimitive rejects non-string content", () => {
  expect(TextPrimitive.safeParse({ primitive: "text", content: 42 }).success).toBe(false);
});

test("TextPrimitive rejects wrong primitive tag", () => {
  expect(TextPrimitive.safeParse({ primitive: "color-picker", content: "x" }).success).toBe(false);
});

test("TextPrimitive accepts empty-string content (display-only, no min)", () => {
  // content is not constrained to non-empty in this slice (Q2 / versioning stays open).
  expect(TextPrimitive.safeParse({ primitive: "text", content: "" }).success).toBe(true);
});
