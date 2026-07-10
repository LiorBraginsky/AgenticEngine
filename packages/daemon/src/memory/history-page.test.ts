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

// ── A: honest locked / empty / daemon-down states (chunk-04 tail A) ──────────

test("A: initial thread-list is the honest locked state, not 'Loading…'", () => {
  const listUl = HISTORY_HTML.match(
    /<ul class="thread-list" id="thread-list">([\s\S]*?)<\/ul>/,
  );
  expect(listUl).not.toBeNull();
  expect(listUl![1]).toContain("Locked"); // static initial placeholder copy (dash encoding-agnostic)
  expect(listUl![1]).not.toContain("Loading…"); // list initial state must not be "Loading…"
});

test("A: loadThreadList has an explicit 401 -> locked branch (not 'No threads')", () => {
  expect(HISTORY_HTML).toContain("r.status === 401");
  expect(HISTORY_HTML).toContain("renderLocked");
});
