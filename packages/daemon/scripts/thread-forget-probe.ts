/**
 * thread-forget-probe — EXECUTED HTTP whole-conversation content-erase smoke probe
 * (Strike-5, thread-forget 2e chunk-02).
 *
 * ─── STRIKE-5 BANNER ─────────────────────────────────────────────────────────
 * Type-check alone is NOT evidence (PIPELINE.md §6.1, Strike-5).
 * This script must be RUN and its FULL stdout pasted into the PR body.
 * That pasted stdout IS the Strike-5 EXECUTED evidence.
 *
 * This script proves thread-forget through the REAL
 *   history.html → HTTP (target_type:"thread") → Hatch → WriteGate.forgetThread
 * path — the exact path a browser using history.html's "Forget conversation"
 * button exercises — and re-proves ADR-0012 rider Ruling 2 (facts survive
 * byte-identical; ZERO fact-table touches on this path).
 *
 * ─── Exact invocation command ────────────────────────────────────────────────
 *   bun run packages/daemon/scripts/thread-forget-probe.ts
 *
 * ─── What success looks like ──────────────────────────────────────────────────
 *   messages scrubbed: true
 *   facts intact (byte-identical): true
 *   archive leg empty (fts+vec): true
 *   fact leg still surfaces the fact: true
 *   husk (forgotten, title NULL): true
 *   mirror holds no plaintext: true
 *   HTTP surface honest (husk status + fact survives): true
 *   PROBE PASSED
 */

console.log("");
console.log("╔══════════════════════════════════════════════════════════════════════════════╗");
console.log("║  thread-forget-probe — Strike-5 EXECUTED evidence (thread-forget 2e, chunk-02) ║");
console.log("║  Proves whole-conversation content-erase through the REAL HTTP path:           ║");
console.log("║    history.html → POST /memory/forget (target_type:thread) → Hatch → scrub    ║");
console.log("║  Type-check alone is NOT evidence. This script must be RUN for DoD.            ║");
console.log("╚══════════════════════════════════════════════════════════════════════════════╝");
console.log("");

import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryStore } from "../src/memory/store.js";
import { HybridRanker } from "../src/memory/embedding/hybrid-ranker.js";

// ── helpers ───────────────────────────────────────────────────────────────────

function assert(condition: boolean, label: string, detail?: string): void {
  if (!condition) {
    console.error(`[thread-forget-probe] PROBE FAILED: ${label}${detail ? ` — ${detail}` : ""}`);
    process.exit(1);
  }
}

const tmpDir = mkdtempSync(join(tmpdir(), "thread-forget-probe-"));
let server: ReturnType<typeof import("../src/index.js").startDaemon> | null = null;

async function cleanup(): Promise<void> {
  if (server) {
    try { server.stop(true); } catch { /* ignore */ }
    server = null;
  }
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
}

process.on("exit", () => {
  if (server) { try { server.stop(true); } catch { /* ignore */ } }
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

try {
  // ── Step 1: env BEFORE daemon starts ──────────────────────────────────────
  process.env.AGENTIC_DATA_DIR = tmpDir;
  process.env.LLM_PROVIDER = "mock";
  process.env.EMBEDDING_PROVIDER = "none"; // deterministic — no model download, lexical-only

  // ── Step 2: pre-seed — thread + 2 messages + 1 cross-thread fact ──────────
  const seedStore = new MemoryStore({ dataDir: tmpDir });

  const threadId = seedStore.createThread("probe-thread");
  const seededIds = seedStore.appendMessages(
    threadId,
    [
      { role: "user", content: "secret one" },
      { role: "assistant", content: "secret two" },
    ],
    "probe-session",
  );
  if (seededIds.length !== 2) throw new Error(`appendMessages returned ${seededIds.length} ids, expected 2`);

  const factId = seedStore.insertFact(
    {
      fact: "user's name is Lior",
      canonical: "name lior",
      provenance: `thread:${threadId}`,
      scope: "cross-thread",
      expiry: null,
      confidence: 1,
      authored_by: "machine",
      topics: ["identity"],
    },
    "thread-forget-probe",
  );

  const factsBefore = JSON.stringify(
    seedStore.rawDb()
      .query("SELECT id, fact, authored_by, provenance FROM distilled_facts ORDER BY id")
      .all(),
  );

  const dbSeed = seedStore.rawDb();
  const ftsCountBefore = (dbSeed.query(
    "SELECT COUNT(*) AS n FROM message_fts WHERE message_id IN (SELECT id FROM messages WHERE thread_id = ?)",
  ).get(threadId) as { n: number }).n;
  const distilledCountBefore = (dbSeed.query("SELECT COUNT(*) AS n FROM distilled_facts").get() as { n: number }).n;

  console.log(`[thread-forget-probe] pre-seed: threadId=${threadId}`);
  console.log(`[thread-forget-probe] pre-seed: messageIds=${JSON.stringify(seededIds)}`);
  console.log(`[thread-forget-probe] pre-seed: factId=${factId}`);
  console.log(`[thread-forget-probe] pre-seed: message_fts rows for thread=${ftsCountBefore}, distilled_facts rows=${distilledCountBefore}`);
  console.log("");

  seedStore.close();

  // ── Step 3: startDaemon(0) + read disk auth token ─────────────────────────
  const { startDaemon } = await import("../src/index.js");
  server = startDaemon(0);
  const PORT = server.port!;

  const token = readFileSync(join(tmpDir, "auth-token"), "utf8").trim();

  console.log(`[thread-forget-probe] daemon started on port ${PORT}`);
  console.log(`[thread-forget-probe] auth token read from disk (${tmpDir}/auth-token): ${token.slice(0, 8)}…`);
  console.log("");

  // ── Step 4: POST the EXACT request history.html's "Forget conversation" sends ─
  const forgetBody = { target_type: "thread", thread_id: threadId };
  console.log(`[thread-forget-probe] POST /memory/forget body: ${JSON.stringify(forgetBody)}`);

  const res1 = await fetch(`http://127.0.0.1:${PORT}/memory/forget`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(forgetBody),
  });
  console.log(`[thread-forget-probe] POST /memory/forget → ${res1.status}`);
  assert(res1.status === 204, `expected 204, got ${res1.status}`);

  const res2 = await fetch(`http://127.0.0.1:${PORT}/memory/forget`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(forgetBody),
  });
  console.log(`[thread-forget-probe] POST /memory/forget (repeat) → ${res2.status}`);
  assert(res2.status === 204, `expected 204 (idempotent repeat), got ${res2.status}`);
  console.log("");

  // ── Step 5: reopen a fresh MemoryStore and verify durable structural proof ─
  const verifyStore = new MemoryStore({ dataDir: tmpDir });
  const db = verifyStore.rawDb();

  // 5a: messages scrubbed
  const msgs = db.query("SELECT content FROM messages WHERE thread_id = ?").all(threadId) as { content: string }[];
  const messagesScrubbed = msgs.length === 2 && msgs.every((m) => m.content === "[forgotten]");
  console.log(`[thread-forget-probe] messages scrubbed: ${messagesScrubbed}`);
  assert(messagesScrubbed, "every archived message row is [forgotten]");

  // 5b: facts intact (byte-identical)
  const factsAfter = JSON.stringify(
    db.query("SELECT id, fact, authored_by, provenance FROM distilled_facts ORDER BY id").all(),
  );
  const factsIntact = factsAfter === factsBefore;
  console.log(`[thread-forget-probe] facts intact (byte-identical): ${factsIntact}`);
  assert(factsIntact, "distilled_facts is byte-identical before/after (ADR-0012 rider Ruling 2)");

  // 5c: archive-search MISS — the lexical + vector legs over the archive are both empty for this thread
  const ftsCountAfter = (db.query(
    "SELECT COUNT(*) AS n FROM message_fts WHERE message_id IN (SELECT id FROM messages WHERE thread_id = ?)",
  ).get(threadId) as { n: number }).n;
  const vecCountAfter = (db.query(
    "SELECT COUNT(*) AS n FROM message_embeddings WHERE message_id IN (SELECT id FROM messages WHERE thread_id = ?)",
  ).get(threadId) as { n: number }).n;
  const archiveLegEmpty = ftsCountAfter === 0 && vecCountAfter === 0;
  console.log(`[thread-forget-probe] archive leg empty (fts+vec): ${archiveLegEmpty} (fts=${ftsCountAfter}, vec=${vecCountAfter})`);
  assert(archiveLegEmpty, "message_fts + message_embeddings rows for this thread are both gone");

  // 5d: fact leg still surfaces the fact (lexical-only ranker — EMBEDDING_PROVIDER=none ⇒ provider null)
  const ranker = new HybridRanker(verifyStore, null);
  const searchHits = await ranker.searchFacts("Lior name", 10);
  const factLegHits = searchHits.some((h) => h.id === factId);
  console.log(`[thread-forget-probe] fact leg still surfaces the fact: ${factLegHits}`);
  assert(factLegHits, "HybridRanker.searchFacts still surfaces the surviving fact");

  // 5e: husk — status='forgotten', title NULL
  const threadRow = db.query("SELECT status, title FROM threads WHERE thread_id = ?").get(threadId) as { status: string; title: string | null };
  const huskOk = threadRow.status === "forgotten" && threadRow.title === null;
  console.log(`[thread-forget-probe] husk (forgotten, title NULL): ${huskOk}`);
  assert(huskOk, `threads row is {status:${threadRow.status}, title:${JSON.stringify(threadRow.title)}}`);

  // 5f: mirror clean — no plaintext, redaction marker + thread_forget reason present
  const mirrorPath = join(tmpDir, "threads", `${threadId}.jsonl`);
  const mirror = readFileSync(mirrorPath, "utf8");
  const mirrorClean =
    !mirror.includes("secret one") &&
    !mirror.includes("secret two") &&
    mirror.includes("[forgotten]") &&
    mirror.includes("thread_forget");
  console.log(`[thread-forget-probe] mirror holds no plaintext: ${mirrorClean}`);
  assert(mirrorClean, "the per-thread JSONL mirror has no plaintext and records the thread_forget event");
  console.log("");

  verifyStore.close();

  // ── Step 6: GET /memory/thread/:id — HTTP surface honesty ────────────────
  const threadRes = await fetch(`http://127.0.0.1:${PORT}/memory/thread/${encodeURIComponent(threadId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert(threadRes.status === 200, `GET /memory/thread/:id returned 200, got ${threadRes.status}`);
  const threadBody = await threadRes.json() as {
    thread: { status: string } | null;
    messages: { content: string }[];
    distilledFacts: { id: string }[];
  };
  const httpHonest =
    threadBody.thread?.status === "forgotten" &&
    threadBody.messages.every((m) => m.content === "[forgotten]") &&
    threadBody.distilledFacts.some((f) => f.id === factId);
  console.log(`[thread-forget-probe] HTTP surface honest (husk status + fact survives): ${httpHonest}`);
  assert(httpHonest, "GET /memory/thread/:id shows the forgotten husk AND the surviving fact");
  console.log("");

  // ── Step 7: PROBE PASSED banner ───────────────────────────────────────────
  console.log("╔══════════════════════════════════════════════════════════════════════════════╗");
  console.log("║  PROBE PASSED                                                                  ║");
  console.log("║  • POST /memory/forget (target_type:thread) returned 204 (+ idempotent 204)    ║");
  console.log("║  • messages scrubbed, facts byte-identical (ADR-0012 rider Ruling 2)           ║");
  console.log("║  • archive leg (fts+vec) empty; fact leg still surfaces the fact               ║");
  console.log("║  • husk (status='forgotten', title NULL); mirror has no plaintext              ║");
  console.log("║  • GET /memory/thread/:id is honest (husk status + surviving fact)             ║");
  console.log("║  Paste this stdout into the PR body = Strike-5 EXECUTED evidence (chunk-02).   ║");
  console.log("╚══════════════════════════════════════════════════════════════════════════════╝");
  console.log("");

  await cleanup();
  process.exit(0);
} catch (err) {
  console.error(
    `[thread-forget-probe] PROBE FAILED — unexpected error:\n  ${err instanceof Error ? err.message : String(err)}`,
  );
  if (err instanceof Error && err.stack) {
    console.error(err.stack);
  }
  await cleanup();
  process.exit(1);
}
