/**
 * smart-distiller-probe — EXECUTED real-Haiku smoke probe (Strike-5).
 *
 * ─── Purpose ─────────────────────────────────────────────────────────────
 * This script proves the v2-03 STABILITY headline end-to-end with a REAL (non-
 * deterministic) LLM call: on a FRESH store, seed a real conversation, run a REAL
 * SmartDistillerProvider distill (first distill → seeds facts), capture fact ids,
 * then append a related follow-up turn, bump the marker, and re-dismiss (second REAL
 * Haiku distill that will see overlapping candidates). Assert:
 *   - the originally-distilled fact(s) row id(s) are UNCHANGED
 *   - the fact texts are still present (nothing vanished)
 *   - the injected slice is coherent (≥1 fact total after re-distill)
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
 *   [smart-probe] store seeded (FRESH tmpDir)
 *   [smart-probe] --- DISTILL 1 (real Haiku) ---
 *   [smart-probe] distill-1 produced N fact(s). ids captured.
 *   [smart-probe] --- DISTILL 2 (re-dismiss, real Haiku, overlapping candidates) ---
 *   [smart-probe] distill-2 produced M fact(s).
 *   [smart-probe] STABILITY: all N original fact id(s) UNCHANGED after re-distill
 *   [smart-probe] PROBE PASSED — STABILITY proven: original fact ids unchanged
 *                 across two real-Haiku distills on a FRESH store.
 *
 * ─── What failure looks like ──────────────────────────────────────────────
 *   [smart-probe] FAIL: key not resolved: <reason> — <fixHint>
 *   Exit 1.
 *
 *   [smart-probe] PROBE FAILED — 0 facts produced on first distill; cannot test stability.
 *   Exit 1.
 *
 *   [smart-probe] PROBE FAILED — STABILITY VIOLATED: fact(s) vanished after re-distill.
 *   Exit 1.
 *
 * ─── Environment requirements ────────────────────────────────────────────
 * - Real Anthropic API key in macOS Keychain (service=agentic-engine,
 *   account=ANTHROPIC_API_KEY) — OR AGENTIC_ENV=dev + ANTHROPIC_API_KEY set.
 * - Network access to api.anthropic.com.
 */

// ── Banner ─────────────────────────────────────────────────────────────────

console.log("");
console.log("╔══════════════════════════════════════════════════════════════════════╗");
console.log("║  smart-distiller-probe — Strike-5 EXECUTED evidence (chunk 03)      ║");
console.log("║  Proves STABILITY: original fact ids UNCHANGED across 2 real Haiku  ║");
console.log("║  distills on a FRESH store (DoD #6: stable facts end-to-end).       ║");
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

// ── Helper: read all fact rows (id + fact text) via rawDb ─────────────────
// DistilledFactRow does not expose id (it's a public display type); use rawDb for id access.

interface FactDbRow { id: string; fact: string }

function readAllFactRows(store: MemoryStore): FactDbRow[] {
  return store.rawDb()
    .query("SELECT id, fact FROM distilled_facts ORDER BY rowid ASC")
    .all() as FactDbRow[];
}

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

// ── Step 2: Seed a real on-disk MemoryStore (FRESH store) ─────────────────
//
// Creates a fresh tmpDir store with a known fact seeded in thread A
// ("my favourite colour is blue") — clear enough for Haiku to distill as a fact.

const tmpDir = mkdtempSync(join(tmpdir(), "smart-probe-"));

let store: MemoryStore | null = null;
let threadA: string;

try {
  store = new MemoryStore({ dataDir: tmpDir });

  // Thread A: contains the known fact we expect Haiku to distill
  threadA = store.createThread("probe-thread-A");
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

  console.log(`[smart-probe] store seeded (FRESH tmpDir: ${tmpDir})`);
  console.log(`[smart-probe] thread A: ${threadA}`);
  console.log("");

  // ── Step 3: Construct SmartDistillerProvider (real client — no injected factory) ──

  const provider = new SmartDistillerProvider();
  // ^ No opts → getClient() uses resolveAnthropicKey() internally → real Haiku

  const { ConsolidationHook } = await import("../src/memory/consolidation-hook.js");
  const { registerDistiller } = await import("../src/memory/distiller-registration.js");
  const { RuleBasedScanner } = await import("../src/memory/scanner/memory-scanner.js");

  const hook = new ConsolidationHook(store);
  registerDistiller(hook, store, provider, new RuleBasedScanner());

  // ── Step 4: DISTILL 1 — real Haiku call on the seeded conversation ─────────

  console.log("[smart-probe] --- DISTILL 1 (real Haiku network call) ---");
  console.log("  (This is a live API call — requires internet + valid key + billing)");
  console.log("");

  await hook.dismiss([threadA]);

  // Use rawDb to get stable ids (DistilledFactRow does not expose id)
  const rowsAfterFirst = readAllFactRows(store);

  console.log(`[smart-probe] distill-1 produced ${rowsAfterFirst.length} fact(s):`);
  for (let i = 0; i < rowsAfterFirst.length; i++) {
    const r = rowsAfterFirst[i]!;
    console.log(`  [${i}] id=${r.id}  fact=${JSON.stringify(r.fact)}`);
  }
  console.log("");

  if (rowsAfterFirst.length === 0) {
    console.error("[smart-probe] PROBE FAILED — 0 facts produced on first distill; cannot test stability.");
    console.error("  The LLM returned an empty array for a non-empty conversation.");
    console.error("  Check the system prompt, new-tail read, and LLM response.");
    rmSync(tmpDir, { recursive: true, force: true });
    process.exit(1);
  }

  // Capture the ids + texts after the FIRST distill (these must remain stable)
  const firstDistillIds = new Map<string, string>(); // id → fact text
  for (const r of rowsAfterFirst) {
    firstDistillIds.set(r.id, r.fact);
  }
  console.log(`[smart-probe] captured ${firstDistillIds.size} fact id(s) after distill-1`);
  console.log("");

  // ── Step 5: Append a related follow-up turn + bump the marker ─────────────
  //
  // Append a related follow-up message so:
  //   (a) the skip-guard doesn't no-op (marker bumps via appendMessages)
  //   (b) the LLM sees an overlapping candidate (the colour fact) in the FTS pool
  //   (c) we test the STABILITY guarantee: the original fact ids must not change

  store.appendMessages(
    threadA,
    [
      { role: "user", content: "actually, I also like green quite a lot" },
      { role: "assistant", content: "Noted — I'll remember you also like green." },
    ],
    "probe-session-A-followup",
  );

  console.log("[smart-probe] appended follow-up turn (overlapping topic: colour preference)");
  console.log("");

  // ── Step 6: DISTILL 2 — re-dismiss (second real Haiku call, sees overlapping candidates) ──

  console.log("[smart-probe] --- DISTILL 2 (re-dismiss, real Haiku, overlapping candidates) ---");
  console.log("  (Second live API call — LLM will see the colour fact as a candidate in the pool)");
  console.log("");

  // dismiss again using the SAME hook (already registered).
  // appendMessages bumped the mutation marker, so the skip-guard won't no-op.
  await hook.dismiss([threadA]);

  // Use rawDb to get ids after the second distill
  const rowsAfterSecond = readAllFactRows(store);

  console.log(`[smart-probe] distill-2 produced ${rowsAfterSecond.length} fact(s) total:`);
  for (let i = 0; i < rowsAfterSecond.length; i++) {
    const r = rowsAfterSecond[i]!;
    const wasFromFirst = firstDistillIds.has(r.id);
    console.log(`  [${i}] id=${r.id}  fact=${JSON.stringify(r.fact)}${wasFromFirst ? "  [from distill-1]" : "  [new in distill-2]"}`);
  }
  console.log("");

  // ── Step 7: Assert STABILITY — original ids UNCHANGED, nothing vanished ────

  let stabilityPass = true;
  const failedLines: string[] = [];

  for (const [id, text] of firstDistillIds) {
    const stillExists = rowsAfterSecond.some((r) => r.id === id);
    if (!stillExists) {
      stabilityPass = false;
      failedLines.push(`id=${id}  fact=${JSON.stringify(text)}  → VANISHED`);
    }
  }

  if (!stabilityPass) {
    console.error("[smart-probe] PROBE FAILED — STABILITY VIOLATED: fact(s) vanished after re-distill.");
    for (const msg of failedLines) {
      console.error(`  ${msg}`);
    }
    console.error("  Original ids from distill-1 must survive distill-2 unchanged (DoD #6).");
    console.error("  A DELETE-all strategy would cause this — v2-03 delta-apply must not DELETE-all.");
    rmSync(tmpDir, { recursive: true, force: true });
    process.exit(1);
  }

  // Also assert ≥1 fact total after second distill (coherent slice)
  if (rowsAfterSecond.length === 0) {
    console.error("[smart-probe] PROBE FAILED — 0 facts after re-distill; incoherent state.");
    rmSync(tmpDir, { recursive: true, force: true });
    process.exit(1);
  }

  console.log(`[smart-probe] STABILITY: all ${firstDistillIds.size} original fact id(s) UNCHANGED after re-distill`);
  console.log(`[smart-probe] STABILITY: ≥1 fact total after re-distill (${rowsAfterSecond.length} total)`);
  console.log("");

  console.log("╔══════════════════════════════════════════════════════════════════════╗");
  console.log("║  PROBE PASSED — STABILITY proven                                     ║");
  console.log("║  Original fact id(s) UNCHANGED across two real-Haiku distills.       ║");
  console.log("║  Nothing vanished. Injected slice coherent. DoD #6 satisfied.        ║");
  console.log("║  Paste this stdout into the PR body = Strike-5 EXECUTED evidence.    ║");
  console.log("╚══════════════════════════════════════════════════════════════════════╝");
  console.log("");

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

// ── Step 8: Cleanup ───────────────────────────────────────────────────────

try {
  rmSync(tmpDir, { recursive: true, force: true });
  console.log(`[smart-probe] cleaned up tmpDir`);
} catch (cleanErr) {
  // Best-effort — failure to clean up does NOT fail the probe
  console.warn(`[smart-probe] warning: cleanup failed — ${cleanErr instanceof Error ? cleanErr.message : String(cleanErr)}`);
}

process.exit(0);
