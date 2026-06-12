/**
 * memory-provider-selector.test.ts
 *
 * Tests for selector registration of "smart" (R6) + default-unchanged guard.
 *
 * Test seam (Strike-4 — no shell-out in unit tests): buildMemoryProvider accepts an
 * optional `resolveKey` function. Tests inject a fake resolver returning controlled
 * ResolveResult values. Production callers pass nothing (real resolveAnthropicKey).
 */
import { test, expect, spyOn, beforeEach, afterEach } from "bun:test";
import type { ResolveResult } from "../secrets/cloud-secrets.js";

const fakeOk: ResolveResult = {
  ok: true,
  key: "test-key-abc",
  source: "keychain",
};

const fakeMissing: ResolveResult = {
  ok: false,
  reason: "missing",
  triedStores: ["keychain", "dotenv"],
  fixHint: "Add your ANTHROPIC_API_KEY to macOS Keychain under 'agentic-engine'.",
};

// Save + restore MEMORY_PROVIDER around each test
let savedEnv: string | undefined;
beforeEach(() => {
  savedEnv = process.env["MEMORY_PROVIDER"];
});
afterEach(() => {
  if (savedEnv === undefined) {
    delete process.env["MEMORY_PROVIDER"];
  } else {
    process.env["MEMORY_PROVIDER"] = savedEnv;
  }
});

test("MEMORY_PROVIDER=smart + resolvable key => provider.id === 'smart'", async () => {
  process.env["MEMORY_PROVIDER"] = "smart";
  // Dynamic import so the module can re-read the env each test
  const { buildMemoryProvider } = await import("./memory-provider-selector.js");
  const provider = buildMemoryProvider({ resolveKey: () => fakeOk });
  expect(provider.id).toBe("smart");
});

test("MEMORY_PROVIDER=smart + NO key => console.error fired AND provider.id === 'dumb-tail'", async () => {
  process.env["MEMORY_PROVIDER"] = "smart";
  const { buildMemoryProvider } = await import("./memory-provider-selector.js");
  const errSpy = spyOn(console, "error").mockImplementation(() => {});
  const provider = buildMemoryProvider({ resolveKey: () => fakeMissing });
  expect(errSpy).toHaveBeenCalled();
  // The error message must include the fixHint so the operator knows how to fix it
  const calls = errSpy.mock.calls;
  const allText = calls.map((c) => c.join(" ")).join(" ");
  expect(allText).toContain(fakeMissing.fixHint);
  errSpy.mockRestore();
  expect(provider.id).toBe("dumb-tail");
});

test("MEMORY_PROVIDER unset => provider.id === 'dumb-tail' (default UNCHANGED — chunk-04 guard)", async () => {
  delete process.env["MEMORY_PROVIDER"];
  const { buildMemoryProvider } = await import("./memory-provider-selector.js");
  // No resolveKey injection: production path; key is never consulted for dumb-tail
  const provider = buildMemoryProvider();
  expect(provider.id).toBe("dumb-tail");
});
