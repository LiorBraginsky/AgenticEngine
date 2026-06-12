/**
 * cloud-secrets — resolve ANTHROPIC_API_KEY from macOS Keychain (prod) or
 * Bun.env/.env fallback (dev only).
 *
 * ─── Service / account ────────────────────────────────────────────────────
 *   service  : "agentic-engine"
 *   account  : "ANTHROPIC_API_KEY"
 *
 * These names MUST match the setup script (packages/daemon/scripts/keychain-set.ts)
 * and the behavioral probe (keychain-prod-probe.ts). A mismatch is the #1 cause
 * of false "missing" / "acl_denied" reports.
 *
 * ─── Dev vs prod gate (C1) ────────────────────────────────────────────────
 * .env / Bun.env fallback is permitted ONLY when `Bun.env.AGENTIC_ENV === "dev"`.
 * Absent → denied → prod-safe default. An env-isolated (env -i) daemon receives
 * no AGENTIC_ENV and cannot fall back even if a .env were reachable.
 *
 * ─── Failure modes ────────────────────────────────────────────────────────
 *   cli_not_found — spawn failure / ENOENT (/usr/bin/security not found).
 *   missing       — non-zero exit with item-not-found stderr.
 *   acl_denied    — non-zero exit consistent with an ACL prompt/denial.
 *
 * ─── NEVER log the key value (spec §3.8) ─────────────────────────────────
 *
 * ─── Memoization (B1) ─────────────────────────────────────────────────────
 * Successful resolution is cached for the process lifetime — one shell-out per
 * process. Failures are NOT memoized so transient ACL conditions can recover.
 */

// ── Constants ─────────────────────────────────────────────────────────────

export const KEYCHAIN_SERVICE = "agentic-engine";
export const KEYCHAIN_ACCOUNT = "ANTHROPIC_API_KEY";

const FIX_COMMAND = "bun run --cwd packages/daemon keychain-set";

// ── Types ──────────────────────────────────────────────────────────────────

export type KeychainSuccess = { ok: true; value: string };
export type KeychainFailure = {
  ok: false;
  reason: "cli_not_found" | "missing" | "acl_denied";
};
export type KeychainResult = KeychainSuccess | KeychainFailure;

/**
 * Injectable Keychain getter — allows unit tests to inject a fake without
 * shelling out. Production uses the real `keychainGet` backed by /usr/bin/security.
 */
export type KeychainGetFn = (service: string, account: string) => KeychainResult;

export type ResolveSuccess = { ok: true; key: string; source: "keychain" | "dotenv" };
export type ResolveFailure = {
  ok: false;
  reason: "missing" | "acl_denied" | "cli_not_found";
  triedStores: string[];
  fixHint: string;
};
export type ResolveResult = ResolveSuccess | ResolveFailure;

/** Options for resolveAnthropicKey — allows test injection. */
export interface ResolveOpts {
  /** Override the Keychain backend (for unit tests). Defaults to the real implementation. */
  keychainGet?: KeychainGetFn;
  /**
   * Override the Keychain service name looked up by the production keychainGetMacOS
   * implementation. Used ONLY by the real-I/O integration test to target the
   * "agentic-engine-test" namespace without touching the production item.
   * Never set in production code — defaults to KEYCHAIN_SERVICE.
   */
  service?: string;
  /**
   * Override the Keychain account name looked up by the production keychainGetMacOS
   * implementation. Used ONLY by the real-I/O integration test to target a
   * random-UUID test account. Never set in production code — defaults to KEYCHAIN_ACCOUNT.
   */
  account?: string;
}

// ── macOS Keychain helper (absolute path — Grill #1) ─────────────────────

/**
 * Classifies a non-zero-exit stderr from /usr/bin/security find-generic-password
 * into a named failure reason.
 *
 * Exported for unit testing — the classification logic is load-bearing (an ACL denial
 * MUST NOT be misreported as `missing`). Accepts already-lowercased stderr.
 *
 * Rules:
 *   - "could not be found" / "errsecitemnotfound" → missing (item absent).
 *   - ACL / denial patterns → acl_denied (known-risk signal).
 *   - All match literals are lowercase — caller must pass lowercased input.
 *   - Do NOT add bare digit strings (e.g. "44") — they match too broadly and can
 *     misclassify an ACL denial whose stderr contains those digits.
 */
export function _classifyKeychainStderr(
  lowercasedStderr: string,
  exitCode: number | null,
): "missing" | "acl_denied" | "cli_not_found" {
  // Item-not-found patterns
  if (
    lowercasedStderr.includes("could not be found") ||
    lowercasedStderr.includes("errsecitemnotfound")
  ) {
    return "missing";
  }

  // ACL / user-interaction prompt denial patterns.
  // All literals MUST be lowercase to match the .toLowerCase() applied by the caller.
  if (
    lowercasedStderr.includes("user interaction not allowed") ||
    lowercasedStderr.includes("acl") ||
    lowercasedStderr.includes("denied") ||
    lowercasedStderr.includes("authorizationdenied") ||
    lowercasedStderr.includes("errsecinteractionnotallowed")
  ) {
    return "acl_denied";
  }

  // No exit code (process killed) → treat as cli issue
  if (exitCode === null) {
    return "cli_not_found";
  }

  // Default: unrecognised non-zero stderr → acl_denied (safer over-report)
  return "acl_denied";
}

/**
 * Reads a password from the macOS Keychain via /usr/bin/security.
 *
 * Uses the absolute path /usr/bin/security because env -i strips PATH, and a
 * bare "security" would ENOENT — masquerading as an ACL denial (Grill #1).
 *
 * This is the macOS-specific backend. A future non-macOS backend slots here
 * beside it without touching the resolver's contract.
 */
function keychainGetMacOS(service: string, account: string): KeychainResult {
  let proc: ReturnType<typeof Bun.spawnSync>;
  try {
    proc = Bun.spawnSync(
      ["/usr/bin/security", "find-generic-password", "-s", service, "-a", account, "-w"],
      { stderr: "pipe" },
    );
  } catch (err: unknown) {
    // Spawn itself failed (e.g. ENOENT — /usr/bin/security not present)
    console.error(
      "[cloud-secrets] /usr/bin/security spawn failed:",
      err instanceof Error ? err.message : String(err),
    );
    return { ok: false, reason: "cli_not_found" };
  }

  if (proc.exitCode === 0) {
    // stdout is the password with a trailing newline
    const raw = new TextDecoder().decode(proc.stdout).trim();
    if (raw.length > 0) {
      return { ok: true, value: raw };
    }
    // Unlikely: exit 0 but empty — treat as missing
    return { ok: false, reason: "missing" };
  }

  // Non-zero exit — classify via the exported classifier
  const stderr = new TextDecoder().decode(proc.stderr).trim().toLowerCase();
  const reason = _classifyKeychainStderr(stderr, proc.exitCode);
  return { ok: false, reason };
}

// ── Failure message builders ───────────────────────────────────────────────

function buildTriedStores(): string[] {
  const stores = [`macOS Keychain service '${KEYCHAIN_SERVICE}'`];
  if (Bun.env.AGENTIC_ENV !== "dev") {
    stores.push(".env fallback disabled (AGENTIC_ENV≠dev)");
  }
  return stores;
}

function buildFixHint(reason: "missing" | "acl_denied" | "cli_not_found"): string {
  const storesStr = buildTriedStores().join("; ");
  switch (reason) {
    case "missing":
      return (
        `ANTHROPIC_API_KEY not found in Keychain (tried: ${storesStr}). ` +
        `Fix: ${FIX_COMMAND}`
      );
    case "acl_denied":
      return (
        `ANTHROPIC_API_KEY Keychain read was denied (ACL prompt / access denied) ` +
        `(tried: ${storesStr}). Fix: re-add the key via ${FIX_COMMAND} or grant CLI access in Keychain Access.app`
      );
    case "cli_not_found":
      return (
        `ANTHROPIC_API_KEY could not be read — /usr/bin/security not found or failed to spawn ` +
        `(tried: ${storesStr}). Fix: verify macOS installation or ${FIX_COMMAND}`
      );
  }
}

// ── Memoization ───────────────────────────────────────────────────────────

let _memo: ResolveSuccess | null = null;

/**
 * Reset the memo — for unit tests only (exported as _resetMemo).
 * Never call this in production code.
 */
export function _resetMemo(): void {
  _memo = null;
}

// ── Public resolver ───────────────────────────────────────────────────────

/**
 * Resolve the Anthropic API key.
 *
 * Resolution order:
 *   1. macOS Keychain (service="agentic-engine", account="ANTHROPIC_API_KEY")
 *   2. Bun.env.ANTHROPIC_API_KEY — ONLY if AGENTIC_ENV === "dev" (C1 gate)
 *
 * Returns a result object — never throws, never logs the key value.
 * Successful results are memoized; failures are not (transient ACL recovery).
 */
export function resolveAnthropicKey(opts: ResolveOpts = {}): ResolveResult {
  // Return memoized success immediately
  if (_memo) return _memo;

  const get: KeychainGetFn = opts.keychainGet ?? keychainGetMacOS;
  const service = opts.service ?? KEYCHAIN_SERVICE;
  const account = opts.account ?? KEYCHAIN_ACCOUNT;
  const keychainResult = get(service, account);

  if (keychainResult.ok) {
    const success: ResolveSuccess = {
      ok: true,
      key: keychainResult.value,
      source: "keychain",
    };
    _memo = success;
    console.log("[cloud-secrets] resolved source=keychain");
    return success;
  }

  // Keychain failed — try .env fallback if dev gate permits
  if (Bun.env.AGENTIC_ENV === "dev") {
    const envKey = Bun.env.ANTHROPIC_API_KEY;
    if (envKey && envKey.trim().length > 0) {
      const success: ResolveSuccess = {
        ok: true,
        key: envKey,
        source: "dotenv",
      };
      _memo = success;
      console.log("[cloud-secrets] resolved source=dotenv (dev)");
      return success;
    }
  }

  // Both stores failed — build a loud, named failure
  const reason = keychainResult.reason;
  const triedStores = buildTriedStores();
  const fixHint = buildFixHint(reason);
  console.error(`[cloud-secrets] resolution failed reason=${reason}`);

  return { ok: false, reason, triedStores, fixHint };
}
