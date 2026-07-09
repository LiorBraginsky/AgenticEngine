import { test, expect } from "bun:test";
import { HISTORY_HTML, SANITIZE_TOKEN_FN } from "./history-page.js";

// Compile the SAME source the page inlines — real behavioral coverage, no DOM, no transpile dep.
const sanitizeToken = new Function(
  `${SANITIZE_TOKEN_FN}; return sanitizeToken;`,
)() as (raw: string) => string;

const T = "a".repeat(64); // token shape = 64 lowercase hex (token-store.ts)

test("sanitizeToken: strips zsh trailing % and surrounding whitespace", () => {
  expect(sanitizeToken(T + "%")).toBe(T);
  expect(sanitizeToken("  " + T + "  ")).toBe(T);
  expect(sanitizeToken(T + "%\n")).toBe(T);
  expect(sanitizeToken("\t" + T + " %")).toBe(T);
});

test("sanitizeToken: strips surrounding quotes; clean token unchanged; non-string → ''", () => {
  expect(sanitizeToken('"' + T + '"')).toBe(T);
  expect(sanitizeToken("'" + T + "'")).toBe(T);
  expect(sanitizeToken("deadbeef")).toBe("deadbeef");
  // @ts-expect-error runtime guard
  expect(sanitizeToken(undefined)).toBe("");
});

test("no drift: the served page inlines the exact tested sanitizer verbatim", () => {
  expect(HISTORY_HTML).toContain(SANITIZE_TOKEN_FN);
});
