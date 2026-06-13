/**
 * forget-roundtrip-probe — EXECUTED HTTP durable-delete smoke probe (Strike-5, chunk v2-04).
 *
 * ─── STRIKE-5 BANNER ─────────────────────────────────────────────────────────
 * Type-check alone is NOT evidence (PIPELINE.md §6.1, Strike-5).
 * The ORCHESTRATOR runs this probe and pastes the FULL stdout into the PR body.
 * That pasted stdout IS the Strike-5 EXECUTED evidence.
 *
 * This script proves fact-forget durable-delete through the REAL
 *   history.html → HTTP → Hatch
 * path — the exact path a browser using history.html exercises.
 *
 * ─── Exact invocation command ────────────────────────────────────────────────
 *   bun run packages/daemon/scripts/forget-roundtrip-probe.ts
 *
 * ─── What success looks like ──────────────────────────────────────────────────
 *   [forget-probe] pre-seed: thread <id>, message <id>, fact <id>
 *   [forget-probe] daemon started on port <N>
 *   [forget-probe] POST /memory/forget → 204
 *   [forget-probe] fact row GONE: true
 *   [forget-probe] fact_fts count === distilled_facts count: true (N === N)
 *   [forget-probe] fact_topics orphan count: 0
 *   [forget-probe] source message content byte-intact: true  <-- B1 structural invariant
 *   [forget-probe] source message content: "favourite colour: blue"
 *   [forget-probe] fact absent from GET /memory/thread/:id distilledFacts: true
 *   PROBE PASSED
 */

console.log("");
console.log("╔══════════════════════════════════════════════════════════════════════════════╗");
console.log("║  forget-roundtrip-probe — Strike-5 EXECUTED evidence (chunk v2-04)         ║");
console.log("║  Proves fact-forget durable-delete through the REAL HTTP path:             ║");
console.log("║    history.html → POST /memory/forget → Hatch → durable-delete            ║");
console.log("║  Type-check alone is NOT evidence. ORCHESTRATOR runs this for DoD.         ║");
console.log("╚══════════════════════════════════════════════════════════════════════════════╝");
console.log("");

import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryStore } from "../src/memory/store.js";
import type { DistilledFactRow } from "../src/memory/store.js";

// ── helpers ───────────────────────────────────────────────────────────────────

function assert(condition: boolean, label: string, detail?: string): void {
  if (!condition) {
    console.error(`[forget-probe] PROBE FAILED: ${label}${detail ? ` — ${detail}` : ""}`);
    process.exit(1);
  }
}

const FACT_TEXT = "favourite colour: blue";
const SOURCE_CONTENT = "favourite colour: blue";
const DISTILLER_VERSION = "v2-04-probe";

const tmpDir = mkdtempSync(join(tmpdir(), "forget-probe-v04-"));
let server: ReturnType<typeof import("../src/index.js").startDaemon> | null = null;

async function cleanup(): Promise<void> {
  if (server) {
    try { server.stop(true); } catch { /* ignore */ }
    server = null;
  }
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
}

// Register cleanup on exit so the temp dir is always removed.
process.on("exit", () => {
  if (server) { try { server.stop(true); } catch { /* ignore */ } }
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

try {
  // ── Step 1: set env BEFORE daemon starts ──────────────────────────────────
  process.env.AGENTIC_DATA_DIR = tmpDir;
  process.env.LLM_PROVIDER = "mock";

  // ── Step 2: pre-seed — thread + source message + ONE machine fact ────────
  // Do this with a fresh MemoryStore BEFORE the daemon boots so the daemon's
  // own MemoryStore (opened in startDaemon) sees the rows immediately.
  const seedStore = new MemoryStore({ dataDir: tmpDir });

  const threadId = seedStore.createThread("probe-thread");
  const [msgId] = seedStore.appendMessages(
    threadId,
    [{ role: "user", content: SOURCE_CONTENT }],
    "probe-session",
  );
  if (!msgId) throw new Error("appendMessages returned no id");

  // Insert one machine fact whose provenance is the seeded message id.
  const factId = seedStore.insertFact(
    {
      fact: FACT_TEXT,
      canonical: FACT_TEXT.toLowerCase(),
      provenance: msgId,
      scope: "cross-thread",
      expiry: null,
      confidence: 1.0,
      authored_by: "machine",
      topics: [],
    },
    DISTILLER_VERSION,
  );

  // Sanity: fact is in the store before we forget it
  const beforeFacts = seedStore.readDistilledFacts(50);
  const factBeforeCount = beforeFacts.length;
  const factRowPresent = beforeFacts.some((f: DistilledFactRow) => f.fact === FACT_TEXT);
  if (!factRowPresent) throw new Error(`Pre-seed fact "${FACT_TEXT}" not found after insertFact`);

  const dbBeforeSeed = seedStore.rawDb();
  const ftsCountBefore = (dbBeforeSeed.query("SELECT COUNT(*) AS n FROM fact_fts").get() as { n: number }).n;
  const topicsCountBefore = (dbBeforeSeed.query("SELECT COUNT(*) AS n FROM fact_topics WHERE fact_id = ?").get(factId) as { n: number }).n;

  console.log(`[forget-probe] pre-seed: threadId=${threadId}`);
  console.log(`[forget-probe] pre-seed: msgId=${msgId}`);
  console.log(`[forget-probe] pre-seed: factId=${factId}`);
  console.log(`[forget-probe] pre-seed: distilled_facts rows=${factBeforeCount}, fact_fts rows=${ftsCountBefore}, fact_topics for this fact=${topicsCountBefore}`);
  console.log("");

  seedStore.close();

  // ── Step 3: startDaemon(0) + read disk auth token ─────────────────────────
  const { startDaemon } = await import("../src/index.js");
  server = startDaemon(0);
  const PORT = server.port!;

  // Read the auth token the daemon wrote to disk (TokenStore mints it on first start)
  const token = readFileSync(join(tmpDir, "auth-token"), "utf8").trim();

  console.log(`[forget-probe] daemon started on port ${PORT}`);
  console.log(`[forget-probe] auth token read from disk (${tmpDir}/auth-token): ${token.slice(0, 8)}…`);
  console.log("");

  // ── Step 4: POST the EXACT request history.html's doForget sends ──────────
  // Matches the body shape in history-page.ts renderFacts → doForget call:
  //   { target_type: "fact", fact_text: factText, provenance: provenance, reason: "hatch-forget" }
  const forgetBody = {
    target_type: "fact",
    fact_text: FACT_TEXT,
    provenance: msgId,
    reason: "v2-04 probe",
  };

  console.log(`[forget-probe] POST /memory/forget body: ${JSON.stringify(forgetBody)}`);

  const res = await fetch(`http://127.0.0.1:${PORT}/memory/forget`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(forgetBody),
  });

  console.log(`[forget-probe] POST /memory/forget → ${res.status}`);
  if (res.status !== 204) {
    const body = await res.text();
    console.error(`[forget-probe] PROBE FAILED: expected 204, got ${res.status}. Body: ${body}`);
    await cleanup();
    process.exit(1);
  }
  assert(res.status === 204, "POST /memory/forget returned 204");
  console.log("");

  // ── Step 5: reopen a fresh MemoryStore and verify durable-delete ──────────
  const verifyStore = new MemoryStore({ dataDir: tmpDir });
  const db = verifyStore.rawDb();

  // 5a: the distilled_facts row by captured id is GONE
  const factRow = db.query("SELECT 1 FROM distilled_facts WHERE id = ?").get(factId);
  const factGone = factRow === null;
  console.log(`[forget-probe] fact row GONE (id=${factId}): ${factGone}`);
  assert(factGone, "distilled_facts row by id is GONE after durable-delete");

  // 5b: COUNT(fact_fts) === COUNT(distilled_facts) — trigger-sync consistency
  const distilledCount = (db.query("SELECT COUNT(*) AS n FROM distilled_facts").get() as { n: number }).n;
  const ftsCount = (db.query("SELECT COUNT(*) AS n FROM fact_fts").get() as { n: number }).n;
  const countsMatch = ftsCount === distilledCount;
  console.log(`[forget-probe] fact_fts count === distilled_facts count: ${countsMatch} (${ftsCount} === ${distilledCount})`);
  assert(countsMatch, "fact_fts count matches distilled_facts count (AFTER DELETE trigger fired)");

  // 5c: no orphan fact_topics rows for this fact id
  const orphanTopics = (db.query("SELECT COUNT(*) AS n FROM fact_topics WHERE fact_id = ?").get(factId) as { n: number }).n;
  console.log(`[forget-probe] fact_topics orphan count for fact_id=${factId}: ${orphanTopics}`);
  assert(orphanTopics === 0, "no orphan fact_topics rows after durable-delete");

  // 5d: B1 — source message content is byte-identical to what was seeded
  const msgRow = db.query<{ content: string }, string>("SELECT content FROM messages WHERE id = ?").get(msgId);
  const sourceIntact = msgRow?.content === SOURCE_CONTENT;
  console.log(`[forget-probe] source message content byte-intact: ${sourceIntact}  <-- B1 structural invariant`);
  console.log(`[forget-probe] source message content: ${JSON.stringify(msgRow?.content)}`);
  assert(sourceIntact, "B1: source message content byte-intact (fact-forget never scrubs messages)");
  console.log("");

  // 5e: fact is absent from GET /memory/thread/:id distilledFacts (HTTP surface check)
  const threadRes = await fetch(
    `http://127.0.0.1:${PORT}/memory/thread/${encodeURIComponent(threadId)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  assert(threadRes.status === 200, `GET /memory/thread/:id returned 200, got ${threadRes.status}`);
  const threadBody = await threadRes.json() as { distilledFacts: { fact: string }[] };
  const factAbsentFromHttp = !threadBody.distilledFacts.some((f) => f.fact === FACT_TEXT);
  console.log(`[forget-probe] fact absent from GET /memory/thread/:id distilledFacts: ${factAbsentFromHttp}`);
  assert(factAbsentFromHttp, `fact "${FACT_TEXT}" is absent from the thread's distilledFacts via HTTP`);
  console.log("");

  verifyStore.close();

  // ── Step 6: PROBE PASSED banner ───────────────────────────────────────────
  console.log("╔══════════════════════════════════════════════════════════════════════════════╗");
  console.log("║  PROBE PASSED                                                               ║");
  console.log("║  • POST /memory/forget (target_type:fact) returned 204                     ║");
  console.log(`║  • distilled_facts row ${factId.slice(0, 8)}… is GONE             ║`);
  console.log(`║  • fact_fts count (${String(ftsCount).padEnd(3)}) === distilled_facts count (${String(distilledCount).padEnd(3)}) — trigger OK  ║`);
  console.log("║  • no orphan fact_topics rows (AFTER DELETE trigger fired)                  ║");
  console.log("║  • source message content byte-intact (B1 invariant)                       ║");
  console.log("║  • fact absent from GET /memory/thread/:id distilledFacts (HTTP check)     ║");
  console.log("║  Paste this stdout into the PR body = Strike-5 EXECUTED evidence (v2-04). ║");
  console.log("╚══════════════════════════════════════════════════════════════════════════════╝");
  console.log("");

  await cleanup();
  process.exit(0);

} catch (err) {
  console.error(
    `[forget-probe] PROBE FAILED — unexpected error:\n  ${err instanceof Error ? err.message : String(err)}`,
  );
  if (err instanceof Error && err.stack) {
    console.error(err.stack);
  }
  await cleanup();
  process.exit(1);
}
