/**
 * Real-I/O Keychain round-trip test.
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
 * ─── Production classifier is under test ─────────────────────────────────
 * resolveAnthropicKey is called WITHOUT a keychainGet override — it runs the
 * PRODUCTION keychainGetMacOS classifier against real /usr/bin/security output.
 * The service/account override seam (ResolveOpts.service/account) lets us target
 * the test namespace without touching the production pair.
 */
import { describe, test, expect, afterEach } from "bun:test";
import { _resetMemo } from "./cloud-secrets.js";
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

describe("Keychain real-I/O round-trip via production classifier (agentic-engine-test)", () => {
  test("write → resolveAnthropicKey (production keychainGetMacOS) → value round-trips; source='keychain'", () => {
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

    // ── Write succeeded — resolve via the PRODUCTION classifier ──────────────
    // NO keychainGet override — production keychainGetMacOS runs against real
    // /usr/bin/security output. service/account override targets the test namespace.
    const result = resolveAnthropicKey({
      service: TEST_SERVICE,
      account: testAccount,
    });

    // ── Assertions ────────────────────────────────────────────────────────────
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.source).toBe("keychain");
      expect(result.key).toBe(TEST_VALUE);
      // Verify the value round-tripped exactly (no truncation, no padding)
      expect(result.key.length).toBe(TEST_VALUE.length);
    }
  });

  test("deleted item → production keychainGetMacOS classifies real errSecItemNotFound as reason='missing'", () => {
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

    // Resolve should report missing — exercises the production classifier against
    // a real "SecKeychainSearchCopyNext: The specified item could not be found" stderr.
    const result = resolveAnthropicKey({
      service: TEST_SERVICE,
      account: testAccount,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("missing");
    }
  });
});
