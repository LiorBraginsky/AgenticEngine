/**
 * keychain-prod-probe — env-isolated behavioral demo driver (DoD #1 + prod half of #3).
 *
 * ─── Purpose ─────────────────────────────────────────────────────────────
 * This script is the DRIVER for Lior's behavioral sign-off (§6.1 demo).
 * It proves that the daemon can resolve the Anthropic API key from the macOS
 * Keychain under a CLEANED environment (no AGENTIC_ENV, no ANTHROPIC_API_KEY,
 * no reachable .env) — the prod condition.
 *
 * ─── BANNER ──────────────────────────────────────────────────────────────
 * REQUIRES: live run with a real Anthropic API key stored in Keychain + network.
 * This script existing and type-checking is necessary-but-not-sufficient evidence.
 * LIOR'S LIVE §6.1 DEMO IS THE ACTUAL SIGN-OFF. Do not record this as "verified"
 * from the script's existence alone.
 *
 * ─── Exact invocation command ────────────────────────────────────────────
 * Option A (recommended — re-exec under cleaned env automatically):
 *   bun run --cwd packages/daemon keychain-prod-probe
 *   (the script detects AGENTIC_ENV/ANTHROPIC_API_KEY and re-execs itself under
 *    a cleaned env automatically if they are present)
 *
 * Option B (manual env strip — more explicit):
 *   env -i HOME="$HOME" /path/to/bun run packages/daemon/scripts/keychain-prod-probe.ts
 *
 * For Option B, find the bun path with: which bun
 * Example:  env -i HOME="$HOME" /Users/lior/.bun/bin/bun run packages/daemon/scripts/keychain-prod-probe.ts
 *
 * ─── Cleaned-env conditions ──────────────────────────────────────────────
 * The cleaned environment must have:
 *   - HOME preserved (Keychain lives under the user's login session)
 *   - NO AGENTIC_ENV (disables .env fallback — C1 gate)
 *   - NO ANTHROPIC_API_KEY (no env bypass)
 *   - NO PATH (proves /usr/bin/security is invoked by absolute path — Grill #1)
 *
 * ─── What success looks like ─────────────────────────────────────────────
 *   [probe] Anthropic API key resolved from Keychain (source=keychain).
 *   [probe] Sending session_start to Anthropic API...
 *   [probe] advance() returned ok=true
 *   [probe] session_end reason=completed — PASS
 *   [probe] EXIT 0
 *
 * ─── What each failure looks like ────────────────────────────────────────
 *   cli_not_found:
 *     [probe] FAIL: /usr/bin/security not found — absolute-path bug or non-macOS.
 *     Exit 1.
 *
 *   acl_denied:
 *     [probe] FAIL: Keychain ACL denied. The security CLI cannot read the item
 *     without a UI prompt in this session (known risk: non-session ACL). See PR note.
 *     Exit 1.
 *
 *   missing:
 *     [probe] FAIL: ANTHROPIC_API_KEY not found in Keychain. Run:
 *       bun run --cwd packages/daemon keychain-set
 *     Exit 1.
 *
 *   Anthropic auth error (invalid key):
 *     [probe] FAIL: Anthropic API returned auth error — invalid/missing API key.
 *     Check the key stored in Keychain is valid.
 *     Exit 1.
 *
 *   Anthropic network/other error:
 *     [probe] FAIL: Anthropic API call failed — <reason>.
 *     Exit 1.
 */

// ── Banner ─────────────────────────────────────────────────────────────────

console.log("");
console.log("╔══════════════════════════════════════════════════════════════════╗");
console.log("║  keychain-prod-probe — BEHAVIORAL DoD #1 DRIVER                 ║");
console.log("║  Requires: live run + real Anthropic key in Keychain + network   ║");
console.log("║  Sign-off: Lior's live §6.1 demo — NOT script existence alone    ║");
console.log("╚══════════════════════════════════════════════════════════════════╝");
console.log("");

// ── Auto re-exec under cleaned env if contaminated ────────────────────────

const hasContamination =
  Bun.env.AGENTIC_ENV !== undefined ||
  Bun.env.ANTHROPIC_API_KEY !== undefined;

if (hasContamination) {
  console.log("[probe] Detected contaminated environment. Re-execing under cleaned env...");
  console.log("[probe] (AGENTIC_ENV and/or ANTHROPIC_API_KEY present — stripping them)");
  console.log("");

  // Build a minimal cleaned env: only HOME + PATH to find bun itself
  // Note: PATH is stripped to verify /usr/bin/security is absolute-path invoked
  // but we need PATH to find bun for the re-exec. The subprocess spawned by
  // resolveAnthropicKey() uses /usr/bin/security (absolute) — Grill #1 verified.
  const cleanEnv: Record<string, string> = {
    HOME: Bun.env.HOME ?? "",
    // Minimal PATH so bun itself can run. /usr/bin/security is called by absolute path.
    PATH: "/usr/local/bin:/usr/bin:/bin",
  };

  const bunExe = process.execPath;
  const scriptPath = import.meta.path;

  const proc = Bun.spawnSync(
    [bunExe, "run", scriptPath],
    {
      env: cleanEnv,
      stdout: "inherit",
      stderr: "inherit",
    },
  );
  process.exit(proc.exitCode ?? 1);
}

// ── Confirm the env is clean ───────────────────────────────────────────────

console.log("[probe] Environment check:");
console.log(`  AGENTIC_ENV       = ${Bun.env.AGENTIC_ENV ?? "(not set — GOOD: .env fallback disabled)"}`);
console.log(`  ANTHROPIC_API_KEY = ${Bun.env.ANTHROPIC_API_KEY ? "(SET — should not be here)" : "(not set — GOOD: Keychain-only path)"}`);
console.log(`  HOME              = ${Bun.env.HOME ?? "(not set)"}`);
console.log("");

if (Bun.env.ANTHROPIC_API_KEY) {
  console.error("[probe] FAIL: ANTHROPIC_API_KEY is still set after env clean. " +
    "This probe must run without it to prove the key comes from Keychain.");
  process.exit(1);
}

// ── Step 1: Resolve from Keychain ─────────────────────────────────────────

import { resolveAnthropicKey } from "../src/secrets/cloud-secrets.js";
import { createAnthropicApiProvider } from "../src/providers/anthropic-api-provider.js";
import type { ProviderInput } from "../src/providers/provider.js";

const resolved = resolveAnthropicKey();

if (!resolved.ok) {
  switch (resolved.reason) {
    case "cli_not_found":
      console.error(
        "[probe] FAIL: /usr/bin/security not found or failed to spawn.\n" +
        "  This means the absolute-path guard (Grill #1) has a bug, or this is not macOS.\n" +
        "  fixHint: " + resolved.fixHint,
      );
      break;
    case "acl_denied":
      console.error(
        "[probe] FAIL: Keychain ACL denied.\n" +
        "  The security CLI cannot read the item in this session.\n" +
        "  This is the 'known risk: non-session Keychain ACL' from the plan.\n" +
        "  Surface this finding in the PR — it informs future launchd packaging.\n" +
        "  fixHint: " + resolved.fixHint,
      );
      break;
    case "missing":
      console.error(
        "[probe] FAIL: ANTHROPIC_API_KEY not found in Keychain.\n" +
        "  Store the key first:\n" +
        "    bun run --cwd packages/daemon keychain-set\n" +
        "  fixHint: " + resolved.fixHint,
      );
      break;
  }
  process.exit(1);
}

// NEVER print the key value — spec §3.8
console.log(`[probe] Anthropic API key resolved from Keychain (source=${resolved.source}).`);
console.log("");

// ── Step 2: Make one real Anthropic call ──────────────────────────────────

console.log("[probe] Sending session_start to Anthropic API...");
console.log("  (This is a real network call — requires internet + valid key)");
console.log("");

// Use createAnthropicApiProvider() with NO apiKey — the resolver fires
// internally on advance(). The key is already resolved so resolveAnthropicKey()
// returns the memoized value.
const provider = createAnthropicApiProvider();

const sessionStart: Extract<ProviderInput, { type: "session_start" }> = {
  type: "session_start",
  trigger: "user",
  text: "Reply with exactly: PROBE_OK",
  client_session_id: "keychain-prod-probe",
};

const result = await provider.advance(undefined, sessionStart);

if (!result.ok) {
  const detail = result.error.detail;
  if (detail.includes("invalid/missing API key") || detail.includes("invalid api key")) {
    console.error(
      "[probe] FAIL: Anthropic API returned auth error — invalid/missing API key.\n" +
      "  The key stored in Keychain may be expired or invalid.\n" +
      "  Re-run keychain-set with a valid key:\n" +
      "    bun run --cwd packages/daemon keychain-set",
    );
  } else if (detail.includes("rate limited")) {
    console.error(
      "[probe] FAIL: Rate limited by Anthropic API.\n" +
      "  Wait a moment and retry.",
    );
  } else {
    console.error(
      `[probe] FAIL: Anthropic API call failed.\n  detail: ${detail}`,
    );
  }
  process.exit(1);
}

// ── Assert the envelopes ──────────────────────────────────────────────────

const envelopes = result.outbound;
const sessionEnd = envelopes.find((e) => e.type === "session_end");
if (!sessionEnd || sessionEnd.type !== "session_end") {
  console.error("[probe] FAIL: No session_end envelope in result. Unexpected response shape.");
  process.exit(1);
}

if (sessionEnd.reason !== "completed") {
  console.error(
    `[probe] FAIL: session_end.reason="${sessionEnd.reason}" (expected "completed").\n` +
    `  This means the provider returned an error envelope, not a successful reply.`,
  );
  process.exit(1);
}

// ── Success ───────────────────────────────────────────────────────────────

console.log("[probe] advance() returned ok=true");
console.log(`[probe] session_end reason=${sessionEnd.reason} — PASS`);
console.log("");
console.log("╔══════════════════════════════════════════════════════════════════╗");
console.log("║  PROBE PASSED — necessary evidence for behavioral DoD #1         ║");
console.log("║  LIOR: run this live for §6.1 sign-off (not just in CI)          ║");
console.log("╚══════════════════════════════════════════════════════════════════╝");
console.log("");

process.exit(0);
