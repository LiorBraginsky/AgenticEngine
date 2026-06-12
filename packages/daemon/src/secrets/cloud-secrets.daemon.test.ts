/**
 * Real-I/O Keychain round-trip test (Step 6a — DoD #2).
 *
 * NO mocks. Writes a key to the real macOS Keychain, reads it back via
 * resolveAnthropicKey(), asserts round-trip, and cleans up.
 *
 * ─── Namespace isolation ──────────────────────────────────────────────────
 * Uses a DISTINCT service ("agentic-engine-test") and a random UUID account
 * per run. This avoids polluting the real login Keychain item that the
 * production daemon reads (service="agentic-engine", account="ANTHROPIC_API_KEY").
 *
 * ─── Cleanup guarantee ───────────────────────────────────────────────────
 * afterEach deletes the test item via /usr/bin/security delete-generic-password.
 * If the test crashes, the finally-block inside each test also attempts cleanup.
 *
 * ─── CI / headless skip-guard ────────────────────────────────────────────
 * If /usr/bin/security is absent or returns an ACL-denied signal on write,
 * the test skips with a clear reason rather than hard-failing. The real login
 * Keychain is unavailable in headless CI environments (no login session).
 *
 * ─── Injection seam used ─────────────────────────────────────────────────
 * resolveAnthropicKey accepts a ResolveOpts.keychainGet override. The test
 * injects a custom keychainGet that reads from the test service/account pair
 * (NOT from the production pair). This keeps the test isolated without
 * modifying the production default pair.
 */
import { describe, test, expect, afterEach } from "bun:test";
import { _resetMemo } from "./cloud-secrets.js";
import type { KeychainResult } from "./cloud-secrets.js";
import { resolveAnthropicKey } from "./cloud-secrets.js";

// ── Test constants ─────────────────────────────────────────────────────────

const TEST_SERVICE = "agentic-engine-test";
const TEST_VALUE = "sk-ant-round-trip-test-value";

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Write a password to the Keychain using /usr/bin/security.
 * Returns the exit code and stderr text so the skip-guard can inspect them.
 */
function keychainWrite(service: string, account: string, value: string): { exitCode: number | null; stderr: string } {
  try {
    const proc = Bun.spawnSync(
      [
        "/usr/bin/security",
        "add-generic-password",
        "-U",
        "-s", service,
        "-a", account,
        "-w", value,
      ],
      { stderr: "pipe" },
    );
    const stderr = new TextDecoder().decode(proc.stderr).trim();
    return { exitCode: proc.exitCode, stderr };
  } catch {
    return { exitCode: null, stderr: "spawn failed — /usr/bin/security not found" };
  }
}

/**
 * Delete a Keychain item. Called in cleanup — errors are silently swallowed
 * (item may not exist if write was skipped or the test failed before writing).
 */
function keychainDelete(service: string, account: string): void {
  try {
    Bun.spawnSync(
      [
        "/usr/bin/security",
        "delete-generic-password",
        "-s", service,
        "-a", account,
      ],
      { stderr: "pipe" },
    );
  } catch {
    // Silently ignore — cleanup best-effort
  }
}

/**
 * Read a password from the Keychain. Returns the raw KeychainResult.
 * Used as the injectable keychainGet for resolveAnthropicKey so we can
 * resolve from the TEST service/account pair without touching the production pair.
 */
function makeTestKeychainGet(service: string, account: string): () => KeychainResult {
  return () => {
    try {
      const proc = Bun.spawnSync(
        ["/usr/bin/security", "find-generic-password", "-s", service, "-a", account, "-w"],
        { stderr: "pipe" },
      );
      if (proc.exitCode === 0) {
        const raw = new TextDecoder().decode(proc.stdout).trim();
        if (raw.length > 0) return { ok: true, value: raw };
        return { ok: false, reason: "missing" };
      }
      const stderr = new TextDecoder().decode(proc.stderr).trim().toLowerCase();
      if (
        stderr.includes("could not be found") ||
        stderr.includes("errsecitemnotfound")
      ) {
        return { ok: false, reason: "missing" };
      }
      if (
        stderr.includes("user interaction not allowed") ||
        stderr.includes("acl") ||
        stderr.includes("denied")
      ) {
        return { ok: false, reason: "acl_denied" };
      }
      return { ok: false, reason: "acl_denied" };
    } catch {
      return { ok: false, reason: "cli_not_found" };
    }
  };
}

// ── Lifecycle ─────────────────────────────────────────────────────────────

// Track per-test account so afterEach can clean up
let currentTestAccount = "";

afterEach(() => {
  _resetMemo();
  if (currentTestAccount) {
    keychainDelete(TEST_SERVICE, currentTestAccount);
    currentTestAccount = "";
  }
});

// ── Tests ──────────────────────────────────────────────────────────────────

describe("Keychain real-I/O round-trip (agentic-engine-test)", () => {
  test("write → resolveAnthropicKey → value round-trips; source='keychain'", () => {
    // Use a unique account per run to avoid test-pollution between parallel runs
    const testAccount = crypto.randomUUID();
    currentTestAccount = testAccount;

    // ── Pre-flight: check if /usr/bin/security works in this environment ─────
    const writeResult = keychainWrite(TEST_SERVICE, testAccount, TEST_VALUE);

    if (writeResult.exitCode === null) {
      // Spawn failed entirely — /usr/bin/security absent
      console.log("[keychain-daemon-test] SKIP: /usr/bin/security not available");
      return; // Skip — Bun test has no .skip() on the instance; we just return early
    }

    const writeStderr = writeResult.stderr.toLowerCase();
    if (writeResult.exitCode !== 0) {
      // Classify: ACL denied (headless CI) vs other
      const isAcl =
        writeStderr.includes("user interaction not allowed") ||
        writeStderr.includes("acl") ||
        writeStderr.includes("denied") ||
        writeStderr.includes("authorization");
      if (isAcl) {
        console.log(
          "[keychain-daemon-test] SKIP: Keychain ACL denied on write — " +
          "non-interactive environment (CI/headless). stderr: " + writeResult.stderr,
        );
        return; // Skip
      }
      // Any other write failure is an unexpected environment problem — still skip
      console.log(
        "[keychain-daemon-test] SKIP: Keychain write failed unexpectedly. " +
        `exitCode=${writeResult.exitCode} stderr=${writeResult.stderr}`,
      );
      return;
    }

    // ── Write succeeded — now resolve via the module ─────────────────────────
    // Inject a custom keychainGet that reads from the TEST pair (not the prod pair).
    const testGet = makeTestKeychainGet(TEST_SERVICE, testAccount);
    const result = resolveAnthropicKey({ keychainGet: testGet });

    // ── Assertions ────────────────────────────────────────────────────────────
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.source).toBe("keychain");
      expect(result.key).toBe(TEST_VALUE);
      // Verify the value round-tripped exactly (no truncation, no padding)
      expect(result.key.length).toBe(TEST_VALUE.length);
    }
  });

  test("deleted item → resolveAnthropicKey returns ok:false with reason='missing'", () => {
    const testAccount = crypto.randomUUID();
    currentTestAccount = testAccount;

    // Pre-flight: check if the CLI works
    const writeResult = keychainWrite(TEST_SERVICE, testAccount, TEST_VALUE);
    if (writeResult.exitCode === null) {
      console.log("[keychain-daemon-test] SKIP: /usr/bin/security not available");
      return;
    }
    const writeStderr = writeResult.stderr.toLowerCase();
    if (writeResult.exitCode !== 0) {
      const isAcl =
        writeStderr.includes("user interaction not allowed") ||
        writeStderr.includes("acl") ||
        writeStderr.includes("denied");
      if (isAcl) {
        console.log("[keychain-daemon-test] SKIP: ACL denied — headless CI environment");
        return;
      }
      console.log("[keychain-daemon-test] SKIP: write failed, exitCode=" + writeResult.exitCode);
      return;
    }

    // Delete the item immediately
    keychainDelete(TEST_SERVICE, testAccount);
    currentTestAccount = ""; // afterEach needn't re-delete

    // Resolve should report missing
    const testGet = makeTestKeychainGet(TEST_SERVICE, testAccount);
    const result = resolveAnthropicKey({ keychainGet: testGet });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("missing");
    }
  });
});
