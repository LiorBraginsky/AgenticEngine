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
import { FixedMarkerProvider } from "./providers/fixed-marker-provider.js";
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
// Step 1 (RED): Tests use the FINAL intent-dispatch API (forgetFact/forgetMessage) which
// does NOT exist yet. This compile error is the correct RED — it pins the invariant before
// any production code moves. These tests go GREEN in Step 4.

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

test("B1 no-downgrade: forgetMessage still scrubs (the message path is unchanged)", async () => {
  const hatch = new Hatch(store, gate);
  const threadId = store.createThread();
  const [mid] = store.appendMessages(threadId, [{ role: "user", content: "scrub me" }], "s1");

  hatch.forgetMessage(mid!, { actor: "user", authored_by: "human" });

  const db = store.rawDb();
  const msg = db.query("SELECT content FROM messages WHERE id = ?").get(mid!) as { content: string };
  expect(msg.content).toBe(REDACTION_MARKER); // scrubbed
  const mut = db.query("SELECT id FROM mutations WHERE target_message_id = ? AND kind='tombstone'").get(mid!);
  expect(mut).not.toBeNull(); // redaction tombstone written
});

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
  expect(result.distillationEvents[0]!.trigger).toBe("reprojection");
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

// ─── T1.2: Hatch.forget — message target → existing WriteGate.forget ─────────

test("T1.2(c): Hatch.forget of a message id → tombstone + hard-scrub absent from next injection", async () => {
  const hatch = new Hatch(store, gate);
  const hook = new ConsolidationHook(store);
  const dumbTail = new DumbTailProvider();
  registerDistiller(hook, store, dumbTail, new RuleBasedScanner());

  const threadId = store.createThread();
  const [mid] = store.appendMessages(threadId, [{ role: "user", content: "secret fact" }], "s1");

  // Dismiss → distill (so fact is live in distilled_facts)
  await hook.dismiss([threadId]);
  expect(store.readDistilledFacts(50).some((f) => f.fact === "secret fact")).toBe(true);

  // Forget via Hatch (message-id route → existing WriteGate.forget)
  hatch.forget(mid!, { actor: "user", authored_by: "human" });

  // Immediately purged from live slice
  expect(store.readDistilledFacts(50).some((f) => f.fact === "secret fact")).toBe(false);

  // Re-derive: forgotten message should NOT re-appear
  store.dropAllDistilledFacts();
  const rederive = await dumbTail.distill(store, threadId);
  store.insertDistilledFacts(rederive.facts, "dumb-tail");
  expect(store.readDistilledFacts(50).some((f) => f.fact === "secret fact")).toBe(false);

  // Retrieve: injection slice must not contain the forgotten fact
  const freshThread = store.createThread();
  const slice = await dumbTail.retrieve(store, freshThread);
  expect(slice.some((m) => m.content.includes("secret fact"))).toBe(false);
});

test("T1.2(b): Hatch.edit → authored_by:human correction reflected in within-thread tail", async () => {
  const hatch = new Hatch(store, gate);

  const threadId = store.createThread();
  const [mid] = store.appendMessages(threadId, [{ role: "user", content: "original content" }], "s1");

  // Edit via Hatch
  hatch.edit(mid!, "corrected content", { actor: "user", authored_by: "human" });

  // Tail should reflect the human correction
  const tail = store.readThreadTail(threadId, 50);
  expect(tail.some((m) => m.content === "corrected content")).toBe(true);
  expect(tail.some((m) => m.content === "original content")).toBe(false);
});

// ─── T1.2 LOAD-BEARING: projection-tombstone (S1 gap fill) ───────────────────
//
// THE critical test: forget a thread-level FixedMarker fact (provenance = "thread:<id>"),
// then drop-all + re-derive with source turns STILL LIVE.
// The fact must NOT re-appear in distill output NOR in retrieve.
// This FAILS before the projection-tombstone hooks are added (proving the gap is real).

test("T1.2(a) LOAD-BEARING: forgetFact(thread-level provenance) survives drop+re-derive — NOT re-built", async () => {
  const hatch = new Hatch(store, gate);
  const hook = new ConsolidationHook(store);
  const fixedMarker = new FixedMarkerProvider();
  registerDistiller(hook, store, fixedMarker, new RuleBasedScanner());

  // Seed source thread with live messages (they stay live throughout)
  const threadId = store.createThread();
  store.appendMessages(threadId, [{ role: "user", content: "live message one" }], "s1");
  store.appendMessages(threadId, [{ role: "assistant", content: "live message two" }], "s1");

  // Dismiss → distill → FixedMarker produces a thread-level fact (provenance = "thread:<id>")
  await hook.dismiss([threadId]);
  const beforeForget = store.readDistilledFacts(50);
  const threadFact = beforeForget.find((f) => f.provenance === `thread:${threadId}`);
  expect(threadFact).toBeDefined(); // sanity: fact exists before forget

  // forgetFact via Hatch (distilled-fact-provenance route: "thread:<id>")
  hatch.forget(`thread:${threadId}`, { actor: "user", authored_by: "human" });

  // Immediately purged from live slice
  expect(store.readDistilledFacts(50).some((f) => f.provenance === `thread:${threadId}`)).toBe(false);

  // DROP all distilled_facts + RE-DERIVE with source turns STILL LIVE
  store.dropAllDistilledFacts();
  const rederive = await fixedMarker.distill(store, threadId);
  store.insertDistilledFacts(rederive.facts, "fixed-marker");

  // THE LOAD-BEARING ASSERTION: the thread-level fact must NOT re-appear
  expect(store.readDistilledFacts(50).some((f) => f.provenance === `thread:${threadId}`)).toBe(false);

  // Retrieve: the injection slice for a new thread must also be empty for this provenance
  const newThread = store.createThread();
  const slice = await fixedMarker.retrieve(store, newThread);
  expect(slice.some((m) => m.content.includes(`thread:${threadId}`))).toBe(false);
});

// ─── T1.2(d): No regression — MF-02/03 forget via message id still works ──────

test("T1.2(d) regression: Hatch.forget(messageId) → tombstone guard (5e) — machine cannot clobber human", async () => {
  const hatch = new Hatch(store, gate);

  const threadId = store.createThread();
  const [mid] = store.appendMessages(threadId, [{ role: "user", content: "human authored" }], "s1");

  // Machine attempt to forget a human-authored message: must be a no-op
  hatch.forget(mid!, { actor: "agent", authored_by: "machine" });

  // Content must be byte-intact
  const db = store.rawDb();
  const row = db.query("SELECT content FROM messages WHERE id = ?").get(mid!) as { content: string };
  expect(row.content).toBe("human authored");
});

test("T1.2(d) regression: WriteGate.forget(messageId) still tombstones and purges — existing path unchanged", async () => {
  const hook = new ConsolidationHook(store);
  const dumbTail = new DumbTailProvider();
  registerDistiller(hook, store, dumbTail, new RuleBasedScanner());

  const threadId = store.createThread();
  const [mid] = store.appendMessages(threadId, [{ role: "user", content: "to be forgotten" }], "s1");
  await hook.dismiss([threadId]);

  expect(store.readDistilledFacts(50).some((f) => f.fact === "to be forgotten")).toBe(true);

  // Direct WriteGate.forget still works (not broken by T1.2 additions)
  gate.forget(mid!, { actor: "user", authored_by: "human" });

  expect(store.readDistilledFacts(50).some((f) => f.fact === "to be forgotten")).toBe(false);
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

test("Fix-2: Hatch.edit → distill → retrieve in new thread B reflects corrected content, not original", async () => {
  const hatch = new Hatch(store, gate);
  const hook = new ConsolidationHook(store);
  const dumbTail = new DumbTailProvider();
  registerDistiller(hook, store, dumbTail, new RuleBasedScanner());

  // Thread A: seed with a fact
  const threadA = store.createThread();
  const [mid] = store.appendMessages(threadA, [{ role: "user", content: "original fact for cross-thread" }], "sA");

  // Edit the message (human correction — authoritatively replaces original)
  hatch.edit(mid!, "corrected fact for cross-thread", { actor: "user", authored_by: "human" });

  // Distill thread A — distiller reads the corrected content via readThreadMessagesForDistill
  await hook.dismiss([threadA]);

  // Thread B: retrieve injection slice — must see CORRECTED content, not original
  const threadB = store.createThread();
  const slice = await dumbTail.retrieve(store, threadB);

  const contents = slice.map((m) => m.content).join(" ");
  expect(contents).toContain("corrected fact for cross-thread");
  expect(contents).not.toContain("original fact for cross-thread");
});

// ─── Fix-1: forgetFact seam guard — UUID provenance must throw ───────────────

test("Fix-1: WriteGate.forgetFact throws if provenance is a UUID-shaped message id", () => {
  // A UUID (messages.id shape) passed to forgetFact must throw — the caller should
  // use WriteGate.forget instead. Passing a UUID here would write a tombstone row
  // keyed on a real messages.id WITHOUT hard-scrubbing content → view-says-forgotten /
  // disk-says-plaintext divergence (security invariant breach).
  const uuid = crypto.randomUUID();
  expect(() => gate.forgetFact(uuid, { actor: "user", authored_by: "human" })).toThrow(
    /use forget\(\) to tombstone\+scrub a message/i,
  );
});

test("Fix-1: WriteGate.forgetFact with UUID provenance does NOT write a mutations row", () => {
  const uuid = crypto.randomUUID();
  try {
    gate.forgetFact(uuid, { actor: "user", authored_by: "human" });
  } catch {
    // expected — confirm no mutations row was written
  }
  const db = store.rawDb();
  const row = db.query("SELECT id FROM mutations WHERE target_message_id = ?").get(uuid);
  expect(row).toBeNull();
});

test("Fix-1: MemoryStore.tombstoneFact throws if provenance is a UUID-shaped message id", () => {
  // Same invariant enforced at the store level so callers who bypass WriteGate also hit the guard.
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
  expect(zeroRow!.trigger).toBe("reprojection");
});
