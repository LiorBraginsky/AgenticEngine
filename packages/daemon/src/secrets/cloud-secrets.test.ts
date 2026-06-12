/**
 * Unit tests for the cloud-secrets resolver.
 *
 * All tests inject a fake spawn function — NEVER shell out to the real Keychain.
 * Tests cover:
 *   1. Successful Keychain resolution
 *   2. cli_not_found (ENOENT / spawn failure)
 *   3. missing (non-zero exit, item-not-found stderr)
 *   4. acl_denied (non-zero exit, ACL-related stderr)
 *   5. Dotenv fallback when AGENTIC_ENV=dev
 *   6. Dotenv fallback BLOCKED when AGENTIC_ENV is absent (prod-safe default-deny)
 *   7. Memoization: resolver only calls spawn once per process
 */
import { test, expect, describe, beforeEach } from "bun:test";

import type { KeychainGetFn, ResolveOpts } from "./cloud-secrets.js";
import { resolveAnthropicKey, _resetMemo } from "./cloud-secrets.js";

// Helper to build a fake keychainGet
function makeKeychainGet(
  result:
    | { ok: true; value: string }
    | { ok: false; reason: "cli_not_found" | "missing" | "acl_denied" },
): KeychainGetFn {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return (_service, _account) => result;
}

// Reset memo and env between tests
beforeEach(() => {
  _resetMemo();
  delete process.env.AGENTIC_ENV;
  delete process.env.ANTHROPIC_API_KEY;
});

// ── 1. Keychain success ────────────────────────────────────────────────────

describe("keychainGet returns ok:true", () => {
  test("resolveAnthropicKey returns {ok:true, key, source:'keychain'}", () => {
    const opts: ResolveOpts = {
      keychainGet: makeKeychainGet({ ok: true, value: "sk-ant-real-key" }),
    };
    const result = resolveAnthropicKey(opts);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.key).toBe("sk-ant-real-key");
      expect(result.source).toBe("keychain");
    }
  });
});

// ── 2. cli_not_found (ENOENT / spawn failure) ─────────────────────────────

describe("keychainGet returns cli_not_found", () => {
  test("resolveAnthropicKey returns {ok:false, reason:'cli_not_found'}", () => {
    const opts: ResolveOpts = {
      keychainGet: makeKeychainGet({ ok: false, reason: "cli_not_found" }),
    };
    const result = resolveAnthropicKey(opts);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("cli_not_found");
      // triedStores should mention the Keychain (substring match on the array element)
      expect(result.triedStores.some((s) => s.includes("macOS Keychain"))).toBe(true);
      expect(result.fixHint).toContain("keychain-set");
    }
  });

  test("fixHint mentions cli_not_found distinctly", () => {
    const opts: ResolveOpts = {
      keychainGet: makeKeychainGet({ ok: false, reason: "cli_not_found" }),
    };
    const result = resolveAnthropicKey(opts);
    if (!result.ok) {
      expect(result.fixHint.toLowerCase()).toMatch(/security.*not found|cli.*not found|\/usr\/bin\/security/i);
    }
  });
});

// ── 3. missing (key not in Keychain) ──────────────────────────────────────

describe("keychainGet returns missing", () => {
  test("resolveAnthropicKey returns {ok:false, reason:'missing'}", () => {
    const opts: ResolveOpts = {
      keychainGet: makeKeychainGet({ ok: false, reason: "missing" }),
    };
    const result = resolveAnthropicKey(opts);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("missing");
      expect(result.triedStores.some((s) => s.includes("macOS Keychain"))).toBe(true);
      expect(result.fixHint).toContain("keychain-set");
    }
  });
});

// ── 4. acl_denied ─────────────────────────────────────────────────────────

describe("keychainGet returns acl_denied", () => {
  test("resolveAnthropicKey returns {ok:false, reason:'acl_denied'}", () => {
    const opts: ResolveOpts = {
      keychainGet: makeKeychainGet({ ok: false, reason: "acl_denied" }),
    };
    const result = resolveAnthropicKey(opts);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("acl_denied");
      expect(result.triedStores.some((s) => s.includes("macOS Keychain"))).toBe(true);
    }
  });

  test("fixHint mentions acl_denied distinctly (not same as missing)", () => {
    const missingResult = resolveAnthropicKey({
      keychainGet: makeKeychainGet({ ok: false, reason: "missing" }),
    });
    _resetMemo();
    const aclResult = resolveAnthropicKey({
      keychainGet: makeKeychainGet({ ok: false, reason: "acl_denied" }),
    });

    if (!missingResult.ok && !aclResult.ok) {
      // The two hints must differ — they name different problems
      expect(aclResult.fixHint).not.toBe(missingResult.fixHint);
    }
  });
});

// ── 5. Dotenv fallback — dev path ────────────────────────────────────────

describe("dotenv fallback when AGENTIC_ENV=dev", () => {
  test("falls back to Bun.env.ANTHROPIC_API_KEY when keychainGet returns missing", () => {
    process.env.AGENTIC_ENV = "dev";
    process.env.ANTHROPIC_API_KEY = "sk-ant-env-key";

    const opts: ResolveOpts = {
      keychainGet: makeKeychainGet({ ok: false, reason: "missing" }),
    };
    const result = resolveAnthropicKey(opts);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.key).toBe("sk-ant-env-key");
      expect(result.source).toBe("dotenv");
    }
  });

  test("dotenv fallback NOT used if Keychain succeeds (even in dev)", () => {
    process.env.AGENTIC_ENV = "dev";
    process.env.ANTHROPIC_API_KEY = "sk-ant-env-key";

    const opts: ResolveOpts = {
      keychainGet: makeKeychainGet({ ok: true, value: "sk-ant-keychain-key" }),
    };
    const result = resolveAnthropicKey(opts);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.source).toBe("keychain");
      expect(result.key).toBe("sk-ant-keychain-key");
    }
  });
});

// ── 6. Default-deny: dotenv blocked in prod (AGENTIC_ENV absent) ──────────

describe("dotenv fallback BLOCKED when AGENTIC_ENV is absent (prod-safe)", () => {
  test("returns missing (not dotenv) even if ANTHROPIC_API_KEY is set in env", () => {
    // No AGENTIC_ENV set → prod condition
    process.env.ANTHROPIC_API_KEY = "sk-ant-env-key";

    const opts: ResolveOpts = {
      keychainGet: makeKeychainGet({ ok: false, reason: "missing" }),
    };
    const result = resolveAnthropicKey(opts);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("missing");
    }
  });

  test("triedStores mentions disabled .env fallback when AGENTIC_ENV absent", () => {
    const opts: ResolveOpts = {
      keychainGet: makeKeychainGet({ ok: false, reason: "missing" }),
    };
    const result = resolveAnthropicKey(opts);

    if (!result.ok) {
      // The message should indicate .env is disabled
      expect(result.triedStores.join(" ")).toMatch(/AGENTIC_ENV|\.env fallback/i);
    }
  });
});

// ── 7. Memoization ────────────────────────────────────────────────────────

describe("memoization", () => {
  test("keychainGet called exactly once even when resolve is called twice", () => {
    let callCount = 0;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const countingGet: KeychainGetFn = (_s, _a) => {
      callCount++;
      return { ok: true, value: "sk-ant-memo-key" };
    };

    const opts: ResolveOpts = { keychainGet: countingGet };

    resolveAnthropicKey(opts);
    resolveAnthropicKey(opts);

    expect(callCount).toBe(1);
  });

  test("memoized result returned on second call", () => {
    const opts: ResolveOpts = {
      keychainGet: makeKeychainGet({ ok: true, value: "sk-ant-memo-key" }),
    };

    const first = resolveAnthropicKey(opts);
    const second = resolveAnthropicKey(opts);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.key).toBe(first.key);
    }
  });

  test("only successful results are memoized — failure calls keychainGet each time", () => {
    let callCount = 0;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const countingGet: KeychainGetFn = (_s, _a) => {
      callCount++;
      return { ok: false, reason: "missing" as const };
    };

    const opts: ResolveOpts = { keychainGet: countingGet };

    resolveAnthropicKey(opts);
    resolveAnthropicKey(opts);

    expect(callCount).toBe(2);
  });
});
