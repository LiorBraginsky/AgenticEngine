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

// ── thread-forget (2e) chunk-02 Task 3: history.html fallback ────────────────

test("HISTORY_HTML pins the FROZEN §0.2 confirm copy template (q#019 rider 3)", () => {
  expect(HISTORY_HTML).toContain(`"Erase this conversation's content (" + messageCount + " messages)? Distilled facts remain. Cannot be undone."`);
});

test("HISTORY_HTML sends target_type:'thread' and renders an honest 409 line", () => {
  expect(HISTORY_HTML).toContain(`target_type: "thread"`);
  expect(HISTORY_HTML).toContain("This conversation is open — close it first.");
});
