/**
 * keychain-set — store ANTHROPIC_API_KEY in the macOS Keychain.
 *
 * Writes to service="agentic-engine", account="ANTHROPIC_API_KEY" (the exact
 * pair the production daemon reads). These names MUST match cloud-secrets.ts.
 *
 * ─── Security discipline ─────────────────────────────────────────────────
 * The key is read from STDIN — not stored in shell history and NOT visible in
 * the process argument list (ps output). User-supplied secrets must NEVER
 * appear in the argv array; they are piped to the child process via stdin.
 *
 * /usr/bin/security add-generic-password expects the password AND a re-type
 * confirmation from stdin when -w is the last argument with no value. Both are
 * sent via the child's stdin pipe so the secret never enters argv.
 *
 * Note: /usr/bin/security writes its "password data:" prompts to stderr —
 * the operator sees them but the value is never echoed and never in argv.
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
  `Paste your Anthropic API key and press Enter (not stored in shell history / not visible in argv):\n`,
);

// Read one line from stdin (Bun synchronous stdin read)
const stdin = Bun.stdin.text();
const lines = (await stdin).split("\n");
const rawValue = lines[0]?.trim() ?? "";

if (!rawValue) {
  process.stderr.write("[keychain-set] ERROR: no key provided — nothing written.\n");
  process.exit(1);
}

// ── Write to Keychain via stdin pipe ──────────────────────────────────────
//
// SECURITY: user-supplied secrets must NEVER appear in the argv array.
// /usr/bin/security add-generic-password with -w as the LAST argument (no value)
// reads the password and its confirmation from stdin when stdin is not a TTY.
// We pipe "rawValue\nrawValue\n" (password + retype) via the child's stdin so
// the secret stays out of argv entirely.

const stdinPayload = new TextEncoder().encode(rawValue + "\n" + rawValue + "\n");

let proc: ReturnType<typeof Bun.spawn> | null = null;
let exitCode: number | null = null;
let spawnError: unknown = null;

try {
  proc = Bun.spawn(
    [
      "/usr/bin/security",
      "add-generic-password",
      "-U",          // update if exists
      "-s", KEYCHAIN_SERVICE,
      "-a", KEYCHAIN_ACCOUNT,
      // NOTE: -w is the LAST flag with NO value following it — this signals
      // that /usr/bin/security should read the password from stdin.
      // The secret must NEVER appear as an argument here.
      "-w",
    ],
    {
      stdin: new ReadableStream({
        start(controller) {
          controller.enqueue(stdinPayload);
          controller.close();
        },
      }),
      stderr: "pipe",
      stdout: "pipe",
    },
  );
  exitCode = await proc.exited;
} catch (err: unknown) {
  spawnError = err;
}

if (spawnError !== null) {
  const msg = spawnError instanceof Error ? spawnError.message : String(spawnError);
  process.stderr.write(
    `[keychain-set] ERROR: /usr/bin/security spawn failed: ${msg}\n` +
    `  Is this macOS? /usr/bin/security must exist.\n`,
  );
  process.exit(1);
}

if (exitCode !== 0) {
  let stderrText = "";
  if (proc?.stderr instanceof ReadableStream) {
    stderrText = new TextDecoder().decode(
      await new Response(proc.stderr).arrayBuffer(),
    ).trim();
  }
  process.stderr.write(
    `[keychain-set] ERROR: security command failed (exitCode=${exitCode}).\n` +
    (stderrText ? `  stderr: ${stderrText}\n` : "") +
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
