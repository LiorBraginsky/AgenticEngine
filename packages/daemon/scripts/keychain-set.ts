/**
 * keychain-set — store ANTHROPIC_API_KEY in the macOS Keychain.
 *
 * Writes to service="agentic-engine", account="ANTHROPIC_API_KEY" (the exact
 * pair the production daemon reads). These names MUST match cloud-secrets.ts.
 *
 * ─── Security discipline ─────────────────────────────────────────────────
 * The key is read from STDIN — never from a positional argument. A CLI arg
 * would land in shell history and ps output. Stdin never does.
 *
 * ─── Usage ───────────────────────────────────────────────────────────────
 *   bun run --cwd packages/daemon keychain-set
 *
 * Or add to daemon package.json scripts:
 *   "keychain-set": "bun run scripts/keychain-set.ts"
 *
 * ─── Verify after writing ────────────────────────────────────────────────
 * On success this script prints the verify one-liner. Run it to confirm:
 *   /usr/bin/security find-generic-password -s agentic-engine -a ANTHROPIC_API_KEY -w
 *
 * ─── -U flag (update if exists) ─────────────────────────────────────────
 * Uses /usr/bin/security add-generic-password -U so re-running updates the
 * existing item rather than failing on a duplicate.
 */

import { KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT } from "../src/secrets/cloud-secrets.js";

// ── Prompt & read from stdin ───────────────────────────────────────────────

process.stderr.write(
  `\n[keychain-set] Writing ANTHROPIC_API_KEY to macOS Keychain\n` +
  `  service : ${KEYCHAIN_SERVICE}\n` +
  `  account : ${KEYCHAIN_ACCOUNT}\n\n` +
  `Paste your Anthropic API key and press Enter (input is NOT echoed):\n`,
);

// Read one line from stdin (Bun synchronous stdin read)
const stdin = Bun.stdin.text();
const lines = (await stdin).split("\n");
const rawValue = lines[0]?.trim() ?? "";

if (!rawValue) {
  process.stderr.write("[keychain-set] ERROR: no key provided — nothing written.\n");
  process.exit(1);
}

// ── Write to Keychain ─────────────────────────────────────────────────────

let proc: ReturnType<typeof Bun.spawnSync>;
try {
  proc = Bun.spawnSync(
    [
      "/usr/bin/security",
      "add-generic-password",
      "-U",          // update if exists
      "-s", KEYCHAIN_SERVICE,
      "-a", KEYCHAIN_ACCOUNT,
      "-w", rawValue,
    ],
    { stderr: "pipe" },
  );
} catch (err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(
    `[keychain-set] ERROR: /usr/bin/security spawn failed: ${msg}\n` +
    `  Is this macOS? /usr/bin/security must exist.\n`,
  );
  process.exit(1);
}

if (proc.exitCode !== 0) {
  const stderr = new TextDecoder().decode(proc.stderr).trim();
  process.stderr.write(
    `[keychain-set] ERROR: security command failed (exitCode=${proc.exitCode}).\n` +
    (stderr ? `  stderr: ${stderr}\n` : "") +
    `  Try opening Keychain Access.app and granting permission, then retry.\n`,
  );
  process.exit(1);
}

// ── Success ───────────────────────────────────────────────────────────────

// NEVER echo the key value — spec §3.8
process.stdout.write(
  `\n[keychain-set] SUCCESS — key written to macOS Keychain.\n` +
  `  service : ${KEYCHAIN_SERVICE}\n` +
  `  account : ${KEYCHAIN_ACCOUNT}\n\n` +
  `To verify the item was stored correctly, run:\n` +
  `  /usr/bin/security find-generic-password -s ${KEYCHAIN_SERVICE} -a ${KEYCHAIN_ACCOUNT} -w\n\n` +
  `The daemon reads this item on first use (bun run dev or prod).\n`,
);

process.exit(0);
