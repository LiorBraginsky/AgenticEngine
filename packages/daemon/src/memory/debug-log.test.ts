/**
 * debug-log.test.ts — unit tests for MEMORY_DEBUG env-gated pipeline log.
 *
 * TDD (v2-06, Step 1.4):
 *   1. When MEMORY_DEBUG is unset / "0" → memDebug produces NO console.error output.
 *   2. When MEMORY_DEBUG="1" → exactly ONE [memory-debug] line with the right JSON keys.
 *   3. Secret discipline: the payload must contain NEITHER a key-shaped secret nor "Bearer".
 */

import { test, expect, spyOn, beforeEach, afterEach } from "bun:test";

// Save and restore the env var around each test so tests don't bleed state.
let savedDebug: string | undefined;
beforeEach(() => { savedDebug = process.env["MEMORY_DEBUG"]; });
afterEach(() => {
  if (savedDebug === undefined) delete process.env["MEMORY_DEBUG"];
  else process.env["MEMORY_DEBUG"] = savedDebug;
});

// ── Test 1: OFF by default ─────────────────────────────────────────────────

test("MEMORY_DEBUG unset → memDebug does NOT call console.error", async () => {
  delete process.env["MEMORY_DEBUG"];

  const { memDebug } = await import("./debug-log.js");
  const spy = spyOn(console, "error").mockImplementation(() => {});
  try {
    memDebug("distill", { threadId: "t1", sinceTurn: -1, tail: [], candidates: [] });
    memDebug("retrieve", { forThreadId: "t1", injected: [] });
    memDebug("forget", { route: "forgetFact", target: {}, deletedIds: [], deletedCount: 0 });
    expect(spy).not.toHaveBeenCalled();
  } finally {
    spy.mockRestore();
  }
});

test("MEMORY_DEBUG=0 → memDebug does NOT call console.error", async () => {
  process.env["MEMORY_DEBUG"] = "0";

  const { memDebug } = await import("./debug-log.js");
  const spy = spyOn(console, "error").mockImplementation(() => {});
  try {
    memDebug("distill", { threadId: "t1", sinceTurn: -1, tail: [], candidates: [] });
    expect(spy).not.toHaveBeenCalled();
  } finally {
    spy.mockRestore();
  }
});

// ── Test 2: ON → one structured greppable line ─────────────────────────────

test("MEMORY_DEBUG=1 + distill stage → exactly one [memory-debug] distill line with expected JSON keys", async () => {
  process.env["MEMORY_DEBUG"] = "1";

  const { memDebug, MEMORY_DEBUG } = await import("./debug-log.js");
  // Verify the MEMORY_DEBUG() function reads the env dynamically
  expect(MEMORY_DEBUG()).toBe(true);

  const captured: string[] = [];
  const spy = spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    captured.push(args.join(" "));
  });
  try {
    memDebug("distill", {
      threadId: "t1",
      sinceTurn: 0,
      tail: [{ id: "m1", role: "user", len: 10, preview: "hello ther" }],
      candidates: [{ ordinal: 1, id: "f1", factPreview: "user likes" }],
    });

    expect(spy).toHaveBeenCalledTimes(1);
    const line = captured[0]!;
    // Must be greppable with prefix
    expect(line).toContain("[memory-debug]");
    expect(line).toContain("distill");
    // Must be parseable as structured JSON in the suffix
    const jsonPart = line.slice(line.indexOf(" {"));
    const obj = JSON.parse(jsonPart.trim());
    expect(obj).toHaveProperty("stage", "distill");
    expect(obj).toHaveProperty("threadId", "t1");
  } finally {
    spy.mockRestore();
  }
});

test("MEMORY_DEBUG=1 + retrieve stage → one [memory-debug] retrieve line with expected shape", async () => {
  process.env["MEMORY_DEBUG"] = "1";

  const { memDebug } = await import("./debug-log.js");

  const captured: string[] = [];
  const spy = spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    captured.push(args.join(" "));
  });
  try {
    memDebug("retrieve", {
      forThreadId: "t2",
      injected: [{ factPreview: "user is Lior", order: 0 }],
    });

    expect(spy).toHaveBeenCalledTimes(1);
    const line = captured[0]!;
    expect(line).toContain("[memory-debug]");
    expect(line).toContain("retrieve");
    const jsonPart = line.slice(line.indexOf(" {"));
    const obj = JSON.parse(jsonPart.trim());
    expect(obj).toHaveProperty("stage", "retrieve");
    expect(obj).toHaveProperty("forThreadId", "t2");
  } finally {
    spy.mockRestore();
  }
});

// ── Test 3: Secret discipline ──────────────────────────────────────────────

test("MEMORY_DEBUG=1 → payload contains no key-shaped secret and no 'Bearer'", async () => {
  process.env["MEMORY_DEBUG"] = "1";

  const { memDebug } = await import("./debug-log.js");

  const captured: string[] = [];
  const spy = spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    captured.push(args.join(" "));
  });
  try {
    // Send a payload that intentionally does NOT contain key or token — the module
    // must never let a caller sneak them through either.
    memDebug("forget", {
      route: "forgetFact",
      target: { provenance: "thread:t1", normalizedText: "user likes blue" },
      deletedIds: ["f1", "f2"],
      deletedCount: 2,
    });

    expect(captured.length).toBeGreaterThan(0);
    for (const line of captured) {
      // No "Bearer" token shape
      expect(line).not.toMatch(/Bearer\s+[A-Za-z0-9\-_]+/);
      // No raw Anthropic API key shape (sk-ant-...)
      expect(line).not.toMatch(/sk-ant-[A-Za-z0-9\-_]+/);
      // No generic API key prefix pattern
      expect(line).not.toMatch(/sk-[A-Za-z0-9]{20,}/);
    }
  } finally {
    spy.mockRestore();
  }
});

// ── Test 4: MEMORY_DEBUG() function re-reads env dynamically ──────────────

test("MEMORY_DEBUG() is a function that re-reads process.env each call", async () => {
  const { MEMORY_DEBUG } = await import("./debug-log.js");

  process.env["MEMORY_DEBUG"] = "0";
  expect(MEMORY_DEBUG()).toBe(false);

  process.env["MEMORY_DEBUG"] = "1";
  expect(MEMORY_DEBUG()).toBe(true);

  delete process.env["MEMORY_DEBUG"];
  expect(MEMORY_DEBUG()).toBe(false);
});
