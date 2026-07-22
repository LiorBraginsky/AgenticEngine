/**
 * MF-05 Tranche 1 real-I/O tests — Hatch façade + projection-tombstone + distillation_events.
 *
 * All tests use REAL SQLite, real store, real providers — NO mocked store or injection-point.
 * Follows the Strike-4 scar discipline: mocks/DI never bypass the production boundary.
 *
 * Sub-step T1.1: Hatch.view returns {messages, distilledFacts, distillationEvents}
 * Sub-step T1.2: projection-tombstone — forgetFact(thread-level provenance) survives re-derive
 * Sub-step T1.3: distillation_events includes zero-count rows (5b: "deliberately retained nothing")
 */
import { test, expect, beforeEach, afterEach } from "bun:test";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { MemoryStore } from "./store.js";
import { WriteGate } from "./write-gate.js";
import { RuleBasedScanner } from "./scanner/memory-scanner.js";
import { ConsolidationHook } from "./consolidation-hook.js";
import { DumbTailProvider } from "./providers/dumb-tail-provider.js";
import { registerDistiller } from "./distiller-registration.js";
import { Hatch } from "./hatch.js";
import { REDACTION_MARKER } from "./schema.js";
import { normalizeFactText } from "./providers/smart-distiller-provider.js";

// ─── Test fixtures ────────────────────────────────────────────────────────────

let store: MemoryStore;
let gate: WriteGate;
let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "mf05-hatch-"));
  store = new MemoryStore({ dataDir });
  gate = new WriteGate(store, new RuleBasedScanner());
});

afterEach(() => {
  store.close();
});

// ── B1 NAMED GATE: a fact-forget can NEVER scrub a message or write a tombstone ──
//
// v2-04: Hatch.forgetMessage and Hatch.forgetFactAndSources removed (D-V6a-bis, Ruling 2).
// The ONE user forget path is Hatch.forgetFact (durable delete, NO scrub).
// WriteGate.forget (the hard-scrub PRIMITIVE) is retained for the future THREAD-forget;
// its unit tests live in write-gate.test.ts.

test("B1 no-downgrade: forgetFact on a bare message-UUID provenance leaves messages.content byte-INTACT and writes NO mutations row", async () => {
  const hatch = new Hatch(store, gate);
  const threadId = store.createThread();
  const [mid] = store.appendMessages(threadId, [{ role: "user", content: "real conversation content" }], "s1");

  // Intent = forget a FACT whose (single-source smart) provenance is a bare UUID.
  // The fact path must NOT scrub the message and must NOT write a mutations row.
  hatch.forgetFact("favourite colour: blue", mid!, { actor: "user", authored_by: "human" });

  const db = store.rawDb();
  const msg = db.query("SELECT content FROM messages WHERE id = ?").get(mid!) as { content: string };
  expect(msg.content).toBe("real conversation content"); // byte-INTACT — never scrubbed
  const mut = db.query("SELECT id FROM mutations WHERE target_message_id = ?").get(mid!);
  expect(mut).toBeNull(); // NO redaction tombstone written by the fact path
});

// v2-04: "B1 no-downgrade: forgetMessage still scrubs" test removed — Hatch.forgetMessage
// removed in v2-04 per Ruling 2. The WriteGate.forget primitive scrub coverage lives in
// write-gate.test.ts (kept intact). forgetFactAndSources tests also removed.

// ─── T1.1: Hatch.view — archive + distilled facts + distillation events ──────

test("T1.1: view returns messages (roles/content) from real archive including tombstoned as REDACTION_MARKER", async () => {
  const hatch = new Hatch(store, gate);
  const hook = new ConsolidationHook(store);
  const dumbTail = new DumbTailProvider();
  registerDistiller(hook, store, dumbTail, new RuleBasedScanner());

  // Create thread with user + assistant turns
  const threadId = store.createThread();
  const [mid1] = store.appendMessages(threadId, [{ role: "user", content: "hello from user" }], "s1");
  store.appendMessages(threadId, [{ role: "assistant", content: "hello from assistant" }], "s1");

  // Tombstone the user message
  gate.forget(mid1!, { actor: "user", authored_by: "human" }, "test forget");

  // Dismiss → distill
  await hook.dismiss([threadId]);

  const result = await hatch.view(threadId);

  // Archive must include both messages — tombstoned as REDACTION_MARKER
  expect(result.messages.length).toBe(2);
  const userMsg = result.messages.find((m) => m.role === "user");
  expect(userMsg).toBeDefined();
  expect(userMsg!.content).toBe(REDACTION_MARKER);

  const assistantMsg = result.messages.find((m) => m.role === "assistant");
  expect(assistantMsg).toBeDefined();
  expect(assistantMsg!.content).toBe("hello from assistant");

  // Distilled facts must be present
  expect(Array.isArray(result.distilledFacts)).toBe(true);

  // Distillation events must include the reprojection event
  expect(result.distillationEvents.length).toBeGreaterThan(0);
  expect(result.distillationEvents[0]!.trigger).toBe("distill");
});

test("T1.1: view distilledFacts includes facts from the real store", async () => {
  const hatch = new Hatch(store, gate);
  const hook = new ConsolidationHook(store);
  const dumbTail = new DumbTailProvider();
  registerDistiller(hook, store, dumbTail, new RuleBasedScanner());

  const threadId = store.createThread();
  store.appendMessages(threadId, [{ role: "user", content: "deploy is yeet.sh" }], "s1");

  await hook.dismiss([threadId]);

  const result = await hatch.view(threadId);

  // Distilled facts should contain the fact from the dismissed thread
  expect(result.distilledFacts.some((f) => f.fact === "deploy is yeet.sh")).toBe(true);
});

// ─── T1.2: Hatch.forgetFact ───────────────────────────────────────────────────
//
// v2-04: T1.2(c) (Hatch.forgetMessage) removed — Hatch.forgetMessage removed (Ruling 2).
// WriteGate.forget scrub+tombstone coverage lives in write-gate.test.ts (intact).
//
// hybrid-retrieval chunk-01 (spec §3.7 R1): T1.2(b) (Hatch.edit → correction reflected in
// within-thread tail) removed — Hatch.edit itself is retired (dead code, sole caller was
// the now-removed HTTP message-edit branch). The identical WriteGate.edit-level behavior
// (correction appended, original NOT mutated, readThreadTail surfaces it — the COALESCE
// machinery, ADR-0015 B1, kept) is already covered directly in write-gate.test.ts
// ("edit appends a correction; the original message row is NOT mutated in place") and
// memory-integration.daemon.test.ts ("edit appends a correction; original message row is
// unchanged in place") — both untouched.

// ─── T1.2 LOAD-BEARING: projection-tombstone (S1 gap fill) ───────────────────
//
// THE critical test: forget a thread-level fact (provenance = "thread:<id>"),
// verify durable record + immediate purge.
// FixedMarkerProvider is retired (v2-03). We manually insert a thread-level fact
// to replicate the thread-provenance shape that the old FixedMarker used.

test("T1.2(a) LOAD-BEARING: forgetFact(thread-level provenance) — durable delete, row GONE, no forgotten_facts write", async () => {
  const hatch = new Hatch(store, gate);

  // Seed source thread with live messages (they stay live throughout)
  const threadId = store.createThread();
  store.appendMessages(threadId, [{ role: "user", content: "live message one" }], "s1");
  store.appendMessages(threadId, [{ role: "assistant", content: "live message two" }], "s1");

  // Manually insert a thread-level fact (provenance = "thread:<id>")
  const THREAD_FACT = `thread:${threadId} has 2 live messages`;
  const factId = store.insertFact({
    fact: THREAD_FACT,
    canonical: normalizeFactText(THREAD_FACT),
    provenance: `thread:${threadId}`,
    scope: "cross-thread",
    expiry: null,
    confidence: 0.5,
    authored_by: "machine",
    topics: [],
  }, "thread-level-test");

  const beforeForget = store.readDistilledFacts(50);
  const threadFact = beforeForget.find((f) => f.provenance === `thread:${threadId}`);
  expect(threadFact).toBeDefined(); // sanity: fact exists before forget

  // forgetFact via Hatch (v2-04: durable delete, NO forgotten_facts write)
  hatch.forgetFact(threadFact!.fact, `thread:${threadId}`, { actor: "user", authored_by: "human" });

  // Durably deleted from distilled_facts (row GONE, not suppressed)
  const db = store.rawDb();
  expect(db.query("SELECT 1 FROM distilled_facts WHERE id = ?").get(factId)).toBeNull();
  expect(store.readDistilledFacts(50).some((f) => f.provenance === `thread:${threadId}`)).toBe(false);

  // No forgotten_facts write on the durable-delete path (Ruling 1-b)
  expect(store.readForgottenFacts().length).toBe(0);
});

// ─── T1.2(d): No regression — WriteGate.forget primitive still works ─────────
//
// v2-04: Hatch.forget(messageId) tombstone-guard test removed (Hatch.forgetMessage removed).
// The WriteGate.forget primitive regression (direct gate.forget) is kept below.

test("WriteGate.forget(messageId) tombstones + scrubs but does NOT sweep facts (Ruling 2)", async () => {
  const hook = new ConsolidationHook(store);
  const dumbTail = new DumbTailProvider();
  registerDistiller(hook, store, dumbTail, new RuleBasedScanner());

  const threadId = store.createThread();
  const [mid] = store.appendMessages(threadId, [{ role: "user", content: "to be forgotten" }], "s1");
  await hook.dismiss([threadId]);

  expect(store.readDistilledFacts(50).some((f) => f.fact === "to be forgotten")).toBe(true);

  // Direct WriteGate.forget still works (not broken by T1.2 additions)
  gate.forget(mid!, { actor: "user", authored_by: "human" });

  // Ruling 2 (ADR-0012 rider): source erasure never sweeps facts — the derived fact survives.
  expect(store.readDistilledFacts(50).some((f) => f.fact === "to be forgotten")).toBe(true);
  const db = store.rawDb();
  const row = db.query("SELECT content FROM messages WHERE id = ?").get(mid!) as { content: string };
  expect(row.content).toBe(REDACTION_MARKER);
});

// ─── Fix-2: edit → distill → retrieve cross-thread (DoD #2 EDIT case) ───────
//
// DoD #2: "forgotten/edited item reflected in next thread's injection."
// The forget case was proven via cross-thread retrieve (load-bearing test above).
// This test closes the EDIT case honestly: seed thread A with a fact, edit it,
// distill thread A, retrieve for a NEW thread B — assert the CORRECTED content
// appears (not the original). Uses the real on-disk store + real provider; no mocks.
//
// hybrid-retrieval chunk-01 (spec §3.7 R1): edits via `gate.edit` directly (WriteGate.edit —
// the KEPT machinery, ADR-0015 B1), not the retired `Hatch.edit` façade. The behavior under
// test (a human correction propagates through distill into a DIFFERENT thread's injection
// slice) is unique coverage — preserved, just decoupled from the now-dead Hatch wrapper.

test("edit (WriteGate.edit) → distill → retrieve in new thread B reflects corrected content, not original", async () => {
  const hook = new ConsolidationHook(store);
  const dumbTail = new DumbTailProvider();
  registerDistiller(hook, store, dumbTail, new RuleBasedScanner());

  // Thread A: seed with a fact
  const threadA = store.createThread();
  const [mid] = store.appendMessages(threadA, [{ role: "user", content: "original fact for cross-thread" }], "sA");

  // Edit the message (human correction — authoritatively replaces original)
  gate.edit(mid!, "corrected fact for cross-thread", { actor: "user", authored_by: "human" });

  // Distill thread A — distiller reads the corrected content via readThreadMessagesForDistill
  await hook.dismiss([threadA]);

  // Thread B: retrieve injection slice — must see CORRECTED content, not original
  const threadB = store.createThread();
  const slice = await dumbTail.retrieve(store, threadB);

  const contents = slice.messages.map((m) => m.content).join(" ");
  expect(contents).toContain("corrected fact for cross-thread");
  expect(contents).not.toContain("original fact for cross-thread");
});

// ─── Fix-1 (updated for chunk 04): seam guard invariants ─────────────────────
//
// Under the new intent-dispatch API (chunk 04 / ADR-0015 decision 1):
//   - forgetFact(factText, provenance, ctx) accepts any factText including UUID-shaped
//     (UUID = a valid fact text, e.g. a session id). The UUID-shape guard was a
//     PROVENANCE guard in the old single-arg API; it is no longer needed because
//     intent dispatch routes messages to forgetMessage, not forgetFact.
//   - The structural B1 invariant is enforced by separate code paths: forgetFact
//     NEVER calls tombstoneFact, never touches messages or mutations.
//   - store.tombstoneFact still throws for UUID-shaped provenances (the store-level
//     guard survives as the defensive assertion ADR-0015 decision 1 says stays).

test("Fix-1: WriteGate.forgetFact does NOT call tombstoneFact — never touches mutations regardless of factText (v2-04: durable delete)", () => {
  // v2-04: forgetFact is a durable delete of distilled_facts rows. It does NOT write
  // to forgotten_facts (Ruling 1-b), does NOT write mutations, does NOT call tombstoneFact.
  const factText = "some fact text";
  const provenance = "thread:test-prov";
  gate.forgetFact(factText, provenance, { actor: "user", authored_by: "human" });
  const db = store.rawDb();
  const mutCount = (db.query("SELECT COUNT(*) AS n FROM mutations").get() as { n: number }).n;
  expect(mutCount).toBe(0); // no mutations row written
  // no forgotten_facts record (durable-delete path, Ruling 1-b)
  expect(store.readForgottenFacts().length).toBe(0);
});

test("Fix-1: MemoryStore.tombstoneFact still throws if provenance is a UUID-shaped message id (store-level defensive assertion survives)", () => {
  // The store-level guard is the surviving defensive assertion (ADR-0015 decision 1).
  // It prevents any future caller that bypasses the intent-dispatch layer.
  const uuid = crypto.randomUUID();
  expect(() => store.tombstoneFact(uuid, { actor: "user", authored_by: "human" })).toThrow(
    /use forget\(\) to tombstone\+scrub a message/i,
  );
});

// ─── T1.3: distillation_events — empty consolidation ─────────────────────────

test("T1.3: view().distillationEvents has a row with facts_produced===0 for a fully-tombstoned thread", async () => {
  const hatch = new Hatch(store, gate);
  const hook = new ConsolidationHook(store);
  const dumbTail = new DumbTailProvider();
  registerDistiller(hook, store, dumbTail, new RuleBasedScanner());

  // Create thread with a single message, tombstone it, then dismiss
  const threadId = store.createThread();
  const [mid] = store.appendMessages(threadId, [{ role: "user", content: "will be forgotten" }], "s1");
  gate.forget(mid!, { actor: "user", authored_by: "human" });

  // Dismiss: the only message is tombstoned, so distill produces 0 facts
  await hook.dismiss([threadId]);

  const result = await hatch.view(threadId);

  // Must have at least one distillation event with facts_produced = 0
  expect(result.distillationEvents.length).toBeGreaterThan(0);
  const zeroRow = result.distillationEvents.find((e) => e.facts_produced === 0);
  expect(zeroRow).toBeDefined();
  // "deliberately retained nothing" ≠ "silently lost"
  expect(zeroRow!.trigger).toBe("distill");
});

// ─── chunk-05 FACT-EDIT: Hatch.editFact ──────────────────────────────────────

test("Hatch.editFact: applies the new text, stamps authored_by='human', returns true", () => {
  const hatch = new Hatch(store, gate);
  const id = store.insertFact({
    fact: "colour blue", canonical: "colour blue", provenance: "thread:t",
    scope: "cross-thread", expiry: null, confidence: 1, authored_by: "machine", topics: [],
  }, "seed");

  const applied = hatch.editFact(id, "colour green", { actor: "user", authored_by: "human" });
  expect(applied).toBe(true);

  const row = store.rawDb().query("SELECT fact, authored_by FROM distilled_facts WHERE id = ?").get(id) as { fact: string; authored_by: string };
  expect(row.fact).toBe("colour green");
  expect(row.authored_by).toBe("human");
});

// ─── 2c chunk-01 (2B): Hatch.view() additive memoryActionEvents field ───────────────────

test("2B: Hatch.view returns memoryActionEvents populated from the store, thread-scoped", async () => {
  const hatch = new Hatch(store, gate);
  const threadId = store.createThread();
  const otherThreadId = store.createThread();

  store.recordMemoryActionEvent({ thread_id: threadId, action: "forget", outcome: "applied", fact_text: "fact X", actor: "agent" });
  store.recordMemoryActionEvent({ thread_id: otherThreadId, action: "remember", outcome: "applied", fact_text: "fact Y", actor: "agent" });

  const result = await hatch.view(threadId);
  expect(Array.isArray(result.memoryActionEvents)).toBe(true);
  expect(result.memoryActionEvents.length).toBe(1);
  expect(result.memoryActionEvents[0]!.fact_text).toBe("fact X");
  expect(result.memoryActionEvents[0]!.action).toBe("forget");
});

// ─── thread-forget (2e) chunk-02 Task 1: Hatch.forgetThread façade + view.thread meta ──────

test("Hatch.view carries additive thread meta; Hatch.forgetThread flips status to 'forgotten'", async () => {
  const hatch = new Hatch(store, gate);
  const t = store.createThread();
  gate.appendTurn(t, [{ role: "user", content: "hi" }], "s1", { actor: "user", authored_by: "human" });
  const before = await hatch.view(t);
  expect(before.thread).toEqual({ thread_id: t, status: "active", last_active_at: expect.any(Number) });
  expect(before.thread!.status).toBe("active");            // existing fields untouched (regression)
  expect(Array.isArray(before.distilledFacts)).toBe(true);
  expect(hatch.forgetThread(t, { actor: "user", authored_by: "human" })).toEqual({ ok: true });
  const after = await hatch.view(t);
  expect(after.thread!.status).toBe("forgotten");
  expect(after.messages.every((m) => m.content === REDACTION_MARKER)).toBe(true);
});
