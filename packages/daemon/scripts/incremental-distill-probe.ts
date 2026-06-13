/**
 * incremental-distill-probe — EXECUTED v2-03 incremental distill smoke probe.
 *
 * ─── Purpose ──────────────────────────────────────────────────────────────────
 * Proves the v2-03 incremental distill flow works end-to-end on a REAL on-disk
 * MemoryStore. No LLM call required — uses the echo-stub pattern from
 * distiller-integration.daemon.test.ts (all DumbTailProvider, no Anthropic key).
 *
 * Assertions:
 *   1. First dismiss → ops produced, watermark advances (distilled_through_turn ≥ 0)
 *   2. Second dismiss (no new messages) → skip-guard fires, 0 new ops, facts stable
 *      (STABILITY: same id across two dismisses — no DELETE-all)
 *   3. Third dismiss (after new message) → only NEW tail messages are included in ops,
 *      NOT already-distilled messages (idempotence / -1 sentinel correctness)
 *   4. Watermark sentinel -1: a brand-new thread with no messages never-distilled
 *      shows distilled_through_turn = -1
 *   5. Messages are BYTE-UNCHANGED across all distill cycles (lossless invariant)
 *
 * ─── STRIKE-5 BANNER ──────────────────────────────────────────────────────────
 * This script existing and type-checking is NECESSARY-BUT-NOT-SUFFICIENT.
 * A probe written + typechecked is NOT yet evidence (PIPELINE.md §6.1, Strike-5).
 * The EXECUTED run by the orchestrator — with full stdout pasted into the PR body —
 * is the actual DoD evidence.
 *
 * ─── Exact invocation command ─────────────────────────────────────────────────
 *   bun run packages/daemon/scripts/incremental-distill-probe.ts
 *
 * ─── What success looks like ──────────────────────────────────────────────────
 *   [incr-probe] === incremental-distill-probe (v2-03) ===
 *   [incr-probe] step-1: first dismiss → N ops, watermark advanced
 *   [incr-probe] step-2: second dismiss → 0 new ops (skip-guard), same fact id (stability)
 *   [incr-probe] step-3: third dismiss after new message → only new tail in ops
 *   [incr-probe] step-4: brand-new thread watermark = -1 (never-distilled sentinel)
 *   [incr-probe] step-5: messages byte-unchanged (lossless invariant)
 *   PROBE PASSED
 *
 * ─── What failure looks like ──────────────────────────────────────────────────
 *   [incr-probe] FAIL: <assertion> — <detail>
 *   Exit 1.
 */

console.log("");
console.log("╔══════════════════════════════════════════════════════════════════════════════╗");
console.log("║  incremental-distill-probe — v2-03 delta+stability smoke probe              ║");
console.log("║  No LLM call required — DumbTailProvider only                               ║");
console.log("║  Type-check alone is NOT evidence. ORCHESTRATOR runs this for DoD.          ║");
console.log("╚══════════════════════════════════════════════════════════════════════════════╝");
console.log("");

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryStore } from "../src/memory/store.js";
import { DumbTailProvider } from "../src/memory/providers/dumb-tail-provider.js";
import { ConsolidationHook } from "../src/memory/consolidation-hook.js";
import { registerDistiller } from "../src/memory/distiller-registration.js";
import { RuleBasedScanner } from "../src/memory/scanner/memory-scanner.js";

const tmpDir = mkdtempSync(join(tmpdir(), "incr-probe-"));

try {
  console.log("[incr-probe] === incremental-distill-probe (v2-03) ===");
  console.log("");

  // ── Setup ─────────────────────────────────────────────────────────────────

  const store = new MemoryStore({ dataDir: tmpDir });
  const hook = new ConsolidationHook(store);
  const dumb = new DumbTailProvider();
  registerDistiller(hook, store, dumb, new RuleBasedScanner());

  // ── Step 4: watermark sentinel = -1 on brand-new thread ───────────────────
  // (check before any messages exist, before distill)

  console.log("[incr-probe] step-4: checking -1 sentinel on brand-new thread...");
  const freshThread = store.createThread("sentinel-test");
  const sentinel = store.readThreadDistillState(freshThread);
  console.log(`  distilled_through_turn = ${sentinel.distilled_through_turn}`);
  if (sentinel.distilled_through_turn !== -1) {
    throw new Error(`FAIL step-4: expected -1 sentinel, got ${sentinel.distilled_through_turn}`);
  }
  console.log("  OK — sentinel is -1 (never distilled)");
  console.log("");

  // ── Step 1: first dismiss → ops produced, watermark advances ──────────────

  console.log("[incr-probe] step-1: first dismiss...");
  const threadId = store.createThread("probe-thread");
  const M1 = "deploy is yeet.sh";
  const M2 = "dark mode is the only mode";
  store.appendMessages(threadId, [
    { role: "user", content: M1 },
    { role: "user", content: M2 },
  ], "s1");

  // Snapshot messages before first distill (lossless check preparation)
  const messagesBefore = store.rawDb()
    .query("SELECT id, content, role, turn_index FROM messages WHERE thread_id = ? ORDER BY turn_index")
    .all(threadId) as { id: string; content: string; role: string; turn_index: number }[];

  await hook.dismiss([threadId]);

  const facts1 = store.readDistilledFacts(50);
  const watermark1 = store.readThreadDistillState(threadId);
  console.log(`  facts after first dismiss: ${facts1.length}`);
  console.log(`  distilled_through_turn after first dismiss: ${watermark1.distilled_through_turn}`);
  console.log(`  distilled_through after first dismiss: ${watermark1.distilled_through}`);

  if (facts1.length === 0) {
    throw new Error("FAIL step-1: expected ≥1 fact after first dismiss");
  }
  if (watermark1.distilled_through_turn < 0) {
    throw new Error(`FAIL step-1: watermark not advanced (still ${watermark1.distilled_through_turn})`);
  }

  // The fact for M1 must be present (DumbTailProvider echoes message content)
  const m1Fact = facts1.find((f) => f.fact === M1);
  if (!m1Fact) {
    throw new Error(`FAIL step-1: expected fact "${M1}" not found in ${JSON.stringify(facts1.map((f) => f.fact))}`);
  }
  const factId1 = store.rawDb()
    .query<{ id: string }, string>("SELECT id FROM distilled_facts WHERE fact = ?")
    .get(M1)!.id;
  console.log(`  fact id for "${M1}": ${factId1}`);
  console.log("  OK — facts produced, watermark advanced");
  console.log("");

  // ── Step 2: second dismiss → skip-guard, facts stable ─────────────────────

  console.log("[incr-probe] step-2: second dismiss (no new messages)...");
  await hook.dismiss([threadId]);

  const facts2 = store.readDistilledFacts(50);
  const watermark2 = store.readThreadDistillState(threadId);
  console.log(`  facts after second dismiss: ${facts2.length}`);
  console.log(`  distilled_through_turn unchanged: ${watermark2.distilled_through_turn}`);

  // Fact id must be STABLE (no DELETE-all + re-insert)
  const factId2 = store.rawDb()
    .query<{ id: string }, string>("SELECT id FROM distilled_facts WHERE fact = ?")
    .get(M1)?.id;
  console.log(`  fact id for "${M1}" after second dismiss: ${factId2}`);
  if (factId2 !== factId1) {
    throw new Error(`FAIL step-2: fact id changed from ${factId1} to ${factId2} (DELETE-all detected!)`);
  }
  if (watermark2.distilled_through_turn !== watermark1.distilled_through_turn) {
    throw new Error(`FAIL step-2: watermark changed on skip-guard (${watermark1.distilled_through_turn} → ${watermark2.distilled_through_turn})`);
  }
  console.log("  OK — skip-guard fired, fact id stable (no DELETE-all)");
  console.log("");

  // ── Step 3: third dismiss after new message → only new tail ───────────────

  console.log("[incr-probe] step-3: adding new message, third dismiss...");
  const M3 = "favourite colour: crimson";
  store.appendMessages(threadId, [{ role: "user", content: M3 }], "s2");

  await hook.dismiss([threadId]);

  const facts3 = store.readDistilledFacts(50);
  const watermark3 = store.readThreadDistillState(threadId);
  console.log(`  facts after third dismiss: ${facts3.length}`);
  console.log(`  distilled_through_turn after third dismiss: ${watermark3.distilled_through_turn}`);

  // M3 must now be present
  if (!facts3.some((f) => f.fact === M3)) {
    throw new Error(`FAIL step-3: expected new fact "${M3}" not found after third dismiss`);
  }
  // M1 must still be present with SAME id (no DELETE-all)
  const factId3 = store.rawDb()
    .query<{ id: string }, string>("SELECT id FROM distilled_facts WHERE fact = ?")
    .get(M1)?.id;
  if (factId3 !== factId1) {
    throw new Error(`FAIL step-3: M1 fact id changed from ${factId1} to ${factId3} (DELETE-all detected on 3rd dismiss!)`);
  }
  // Idempotence: M1 must appear EXACTLY ONCE (no duplicate from re-distill)
  const m1Count = facts3.filter((f) => f.fact === M1).length;
  if (m1Count !== 1) {
    throw new Error(`FAIL step-3: M1 appears ${m1Count} times — expected exactly 1 (dup detected!)`);
  }
  if (watermark3.distilled_through_turn <= watermark1.distilled_through_turn) {
    throw new Error(`FAIL step-3: watermark didn't advance after M3 (${watermark1.distilled_through_turn} → ${watermark3.distilled_through_turn})`);
  }
  console.log(`  M1 appears exactly once: ${m1Count} (idempotent)`);
  console.log(`  M1 fact id stable: ${factId3}`);
  console.log("  OK — only new tail distilled, old facts stable");
  console.log("");

  // ── Step 5: messages byte-unchanged ───────────────────────────────────────

  console.log("[incr-probe] step-5: verifying messages byte-unchanged...");
  const messagesAfter = store.rawDb()
    .query("SELECT id, content, role, turn_index FROM messages WHERE thread_id = ? ORDER BY turn_index")
    .all(threadId) as { id: string; content: string; role: string; turn_index: number }[];

  // The FIRST 2 messages from messagesBefore must be byte-identical to messagesAfter[0..1]
  for (let i = 0; i < messagesBefore.length; i++) {
    const before = messagesBefore[i]!;
    const after = messagesAfter[i]!;
    if (before.id !== after.id || before.content !== after.content || before.role !== after.role) {
      throw new Error(
        `FAIL step-5: message[${i}] changed!\n  before: ${JSON.stringify(before)}\n  after:  ${JSON.stringify(after)}`,
      );
    }
  }
  console.log(`  All ${messagesBefore.length} original messages byte-identical`);
  console.log("  OK — lossless invariant holds");
  console.log("");

  store.close();

  // ── Final verdict ──────────────────────────────────────────────────────────

  console.log("╔══════════════════════════════════════════════════════════════════════════════╗");
  console.log("║  PROBE PASSED — all 5 assertions green                                       ║");
  console.log("║  1. first dismiss → ops produced, watermark advanced                         ║");
  console.log("║  2. second dismiss → skip-guard, fact id stable (no DELETE-all)              ║");
  console.log("║  3. third dismiss → only new tail, old facts stable, no dup                  ║");
  console.log("║  4. brand-new thread watermark = -1 (never-distilled sentinel)               ║");
  console.log("║  5. messages byte-unchanged (lossless invariant)                              ║");
  console.log("║  Paste this stdout into the PR body = v2-03 EXECUTED evidence.               ║");
  console.log("╚══════════════════════════════════════════════════════════════════════════════╝");
  console.log("");

} catch (err) {
  console.error(
    `[incr-probe] PROBE FAILED — unexpected error:\n  ${err instanceof Error ? err.message : String(err)}`,
  );
  if (err instanceof Error && err.stack) {
    console.error(`  stack: ${err.stack}`);
  }
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  process.exit(1);
}

try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
