/**
 * smart-distiller-probe — EXECUTED real-Haiku smoke probe (Strike-5).
 *
 * ─── Purpose ─────────────────────────────────────────────────────────────
 * This script proves that SmartDistillerProvider drives a REAL Haiku call
 * against a REAL on-disk MemoryStore (seeded with known messages) and
 * produces ≥1 distilled fact.
 *
 * ─── STRIKE-5 BANNER ─────────────────────────────────────────────────────
 * This script existing and type-checking is NECESSARY-BUT-NOT-SUFFICIENT.
 * A probe written + typechecked is NOT yet evidence (PIPELINE.md §6.1,
 * Strike-5). The EXECUTED run by the orchestrator — with full stdout pasted
 * into the PR body — is the actual DoD evidence.
 *
 * ─── Exact invocation command ────────────────────────────────────────────
 *   bun run packages/daemon/scripts/smart-distiller-probe.ts
 * or via the package.json alias (from repo root):
 *   bun run --cwd packages/daemon smart-distiller-probe
 *
 * ─── What success looks like ─────────────────────────────────────────────
 *   [smart-probe] key resolved (source=keychain)
 *   [smart-probe] store seeded: 3 threads, 5 messages
 *   [smart-probe] calling provider.distill() — real Haiku network call...
 *   [smart-probe] fact[0]: { fact: "...", scope: "...", confidence: ..., provenance: "..." }
 *   ...
 *   [smart-probe] PROBE PASSED — ≥1 fact produced; stdout pasted in PR = Strike-5 evidence.
 *
 * ─── What failure looks like ──────────────────────────────────────────────
 *   [smart-probe] FAIL: key not resolved: <reason> — <fixHint>
 *   Exit 1.
 *
 *   [smart-probe] PROBE FAILED — 0 facts produced; expected ≥1.
 *   Exit 1.
 *
 * ─── Environment requirements ────────────────────────────────────────────
 * - Real Anthropic API key in macOS Keychain (service=agentic-engine,
 *   account=ANTHROPIC_API_KEY) — OR AGENTIC_ENV=dev + ANTHROPIC_API_KEY set.
 * - Network access to api.anthropic.com.
 * - No AGENTIC_ENV=dev re-exec needed: the probe works in any env where the
 *   key resolves (Keychain is the expected prod path; .env is the dev fallback).
 */

// ── Banner ─────────────────────────────────────────────────────────────────

console.log("");
console.log("╔══════════════════════════════════════════════════════════════════════╗");
console.log("║  smart-distiller-probe — Strike-5 EXECUTED evidence (chunk 03)      ║");
console.log("║  Requires: live run + real Anthropic key in Keychain + network       ║");
console.log("║  Type-check alone is NOT evidence. ORCHESTRATOR runs this for DoD.  ║");
console.log("╚══════════════════════════════════════════════════════════════════════╝");
console.log("");

// ── Imports ────────────────────────────────────────────────────────────────

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveAnthropicKey } from "../src/secrets/cloud-secrets.js";
import { MemoryStore } from "../src/memory/store.js";
import { SmartDistillerProvider } from "../src/memory/providers/smart-distiller-provider.js";

// ── Step 1: Resolve the Anthropic API key ─────────────────────────────────

const resolved = resolveAnthropicKey();

if (!resolved.ok) {
  console.error(
    `[smart-probe] FAIL: key not resolved.\n` +
    `  reason:      ${resolved.reason}\n` +
    `  triedStores: ${resolved.triedStores.join(", ")}\n` +
    `  fixHint:     ${resolved.fixHint}`,
  );
  process.exit(1);
}

// NEVER print the key value — spec §3.8 / PIPELINE §6.1
console.log(`[smart-probe] key resolved (source=${resolved.source})`);
console.log("");

// ── Step 2: Seed a real on-disk MemoryStore ───────────────────────────────
//
// Creates 3 threads with a mix of messages including a known retrievable fact
// ("my favourite colour is blue") to ensure the LLM has something to distill.
// Uses the real appendMessages() path — identical to what the daemon + integration
// tests use. NO mock store.

const tmpDir = mkdtempSync(join(tmpdir(), "smart-probe-"));

let store: MemoryStore | null = null;
let triggerThreadId: string;

try {
  store = new MemoryStore({ dataDir: tmpDir });

  // Thread A: contains the known fact we expect Haiku to distill
  const threadA = store.createThread("probe-thread-A");
  store.appendMessages(
    threadA,
    [
      { role: "user", content: "hi" },
      { role: "assistant", content: "Hello! How can I help you?" },
      { role: "user", content: "my favourite colour is blue" },
      { role: "assistant", content: "Got it — I'll remember that your favourite colour is blue." },
    ],
    "probe-session-A",
  );

  // Thread B: a second thread (tests cross-thread dedup)
  const threadB = store.createThread("probe-thread-B");
  store.appendMessages(
    threadB,
    [
      { role: "user", content: "hi" },
    ],
    "probe-session-B",
  );

  // Thread C: a third thread with another user-stated fact
  const threadC = store.createThread("probe-thread-C");
  store.appendMessages(
    threadC,
    [
      { role: "user", content: "hi, I prefer dark mode in all my apps" },
      { role: "assistant", content: "Noted — dark mode preference recorded." },
    ],
    "probe-session-C",
  );

  // Use thread A as the triggerThreadId (the thread that triggered consolidation)
  triggerThreadId = threadA;

  console.log(`[smart-probe] store seeded: 3 threads, 7 messages`);
  console.log(`[smart-probe] tmpDir: ${tmpDir}`);
  console.log(`[smart-probe] triggerThreadId: ${triggerThreadId}`);
  console.log("");

  // ── Step 3: Construct SmartDistillerProvider (real client — no injected factory) ──

  const provider = new SmartDistillerProvider();
  // ^ No opts → getClient() uses resolveAnthropicKey() internally → real Haiku

  // ── Step 4: Call distill (REAL HAIKU NETWORK CALL) ────────────────────────

  console.log("[smart-probe] calling provider.distill() — real Haiku network call...");
  console.log("  (This is a live API call — requires internet + valid key + billing)");
  console.log("");

  const result = await provider.distill(store, triggerThreadId);

  // ── Step 5: Print each produced fact (NEVER print the key) ───────────────

  console.log(`[smart-probe] distill returned ${result.facts.length} fact(s):`);
  console.log("");

  for (let i = 0; i < result.facts.length; i++) {
    const f = result.facts[i]!;
    console.log(`[smart-probe] fact[${i}]: {`);
    console.log(`  fact:       ${JSON.stringify(f.fact)}`);
    console.log(`  scope:      ${JSON.stringify(f.scope)}`);
    console.log(`  confidence: ${f.confidence}`);
    console.log(`  provenance: ${JSON.stringify(f.provenance)}`);
    console.log(`  expiry:     ${f.expiry ?? "null"}`);
    console.log(`  authored_by: ${JSON.stringify(f.authored_by)}`);
    console.log(`}`);
    console.log("");
  }

  // ── Step 6: Assert ≥1 fact ────────────────────────────────────────────────

  if (result.facts.length >= 1) {
    console.log("╔══════════════════════════════════════════════════════════════════════╗");
    console.log("║  PROBE PASSED — ≥1 fact produced                                     ║");
    console.log("║  Paste this stdout into the PR body = Strike-5 EXECUTED evidence.    ║");
    console.log("╚══════════════════════════════════════════════════════════════════════╝");
    console.log("");
  } else {
    console.error("[smart-probe] PROBE FAILED — 0 facts produced; expected ≥1.");
    console.error("  The LLM returned an empty array for a non-empty archive.");
    console.error("  Check the system prompt, digest format, and LLM response below.");
    // Clean up before exit
    rmSync(tmpDir, { recursive: true, force: true });
    process.exit(1);
  }
} catch (err) {
  console.error(
    `[smart-probe] PROBE FAILED — unexpected error:\n  ${err instanceof Error ? err.message : String(err)}`,
  );
  if (err instanceof Error && err.stack) {
    console.error(`  stack: ${err.stack}`);
  }
  // Best-effort cleanup
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  process.exit(1);
}

// ── Step 7: Cleanup ───────────────────────────────────────────────────────

try {
  rmSync(tmpDir, { recursive: true, force: true });
  console.log(`[smart-probe] cleaned up tmpDir`);
} catch (cleanErr) {
  // Best-effort — failure to clean up does NOT fail the probe
  console.warn(`[smart-probe] warning: cleanup failed — ${cleanErr instanceof Error ? cleanErr.message : String(cleanErr)}`);
}

process.exit(0);
