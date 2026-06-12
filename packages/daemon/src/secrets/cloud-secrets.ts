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
}

// ── macOS Keychain helper (absolute path — Grill #1) ─────────────────────

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

  // Non-zero exit — classify from stderr
  const stderr = new TextDecoder().decode(proc.stderr).trim().toLowerCase();

  // "SecKeychainSearchCopyNext" / "The specified item could not be found" is item-not-found
  if (
    stderr.includes("could not be found") ||
    stderr.includes("errSecItemNotFound") ||
    stderr.includes("44") // -25300 decimal truncated in some stderr formats
  ) {
    return { ok: false, reason: "missing" };
  }

  // ACL / user-interaction prompt denial patterns
  if (
    stderr.includes("user interaction not allowed") ||
    stderr.includes("acl") ||
    stderr.includes("denied") ||
    stderr.includes("authorizationdenied") ||
    stderr.includes("errSecInteractionNotAllowed")
  ) {
    return { ok: false, reason: "acl_denied" };
  }

  // Any other non-zero exit: if it looks like the binary wasn't usable, cli_not_found
  // Otherwise fall to acl_denied as the safer escalation (surfaces the known-risk).
  if (proc.exitCode === null) {
    // Killed / no exit code → treat as cli issue
    return { ok: false, reason: "cli_not_found" };
  }

  // Default non-zero with unrecognised stderr → acl_denied (safer over-report)
  return { ok: false, reason: "acl_denied" };
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
  const keychainResult = get(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT);

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
