import { test, expect } from "bun:test";
import { tmpdir } from "node:os";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { MemoryStore } from "./store.js";
import { WriteGate } from "./write-gate.js";
import { RuleBasedScanner } from "./scanner/memory-scanner.js";
import { REDACTION_MARKER } from "./schema.js";
import { normalizeFactText } from "./providers/smart-distiller-provider.js";

function freshStore() {
  const dir = mkdtempSync(join(tmpdir(), "mf01-"));
  return { store: new MemoryStore({ dataDir: dir }), dir };
}

test("createThread + appendMessages persist to SQLite and the JSONL mirror", () => {
  const { store, dir } = freshStore();
  const t = store.createThread();
  store.appendMessages(t, [{ role: "user", content: "deploy script is yeet.sh" }], "sess-1");
  const tail = store.readThreadTail(t, 10);
  expect(tail).toEqual([{ role: "user", content: "deploy script is yeet.sh" }]);
  const mirror = join(dir, "threads", `${t}.jsonl`);
  expect(existsSync(mirror)).toBe(true);
  expect(readFileSync(mirror, "utf8")).toContain("yeet.sh");
  store.close();
});

test("appendMessages assigns monotonic turn_index across calls", () => {
  const { store } = freshStore();
  const t = store.createThread();
  store.appendMessages(t, [{ role: "user", content: "a" }], "s1");
  store.appendMessages(t, [{ role: "user", content: "b" }, { role: "assistant", content: "c" }], "s2");
  expect(store.readThreadTail(t, 10)).toEqual([
    { role: "user", content: "a" },
    { role: "user", content: "b" },
    { role: "assistant", content: "c" },
  ]);
  store.close();
});

test("readThreadTail respects the limit and returns the most recent N in order", () => {
  const { store } = freshStore();
  const t = store.createThread();
  for (let i = 0; i < 5; i++) store.appendMessages(t, [{ role: "user", content: `m${i}` }], "s");
  expect(store.readThreadTail(t, 2)).toEqual([
    { role: "user", content: "m3" },
    { role: "user", content: "m4" },
  ]);
  store.close();
});

test("threadExists distinguishes a minted thread from an unknown id", () => {
  const { store } = freshStore();
  const t = store.createThread();
  expect(store.threadExists(t)).toBe(true);
  expect(store.threadExists("nope")).toBe(false);
  store.close();
});

// ---- MF-02: distilled_facts + distillation_events store methods ----

test("insertDistilledFacts + readDistilledFacts round-trips facts", () => {
  const { store } = freshStore();
  store.insertDistilledFacts(
    [{ fact: "deploy is yeet.sh", provenance: "m-1", scope: "cross-thread", expiry: null, confidence: 1, authored_by: "machine" }],
    "dumb-tail",
  );
  const got = store.readDistilledFacts(10);
  expect(got.length).toBe(1);
  expect(got[0]!.fact).toBe("deploy is yeet.sh");
  expect(got[0]!.provenance).toBe("m-1");
  store.close();
});

test("dropDistilledFactsByProvenance removes only the matching-provenance rows", () => {
  const { store } = freshStore();
  store.insertDistilledFacts([
    { fact: "a", provenance: "m-1", scope: "cross-thread", expiry: null, confidence: 1, authored_by: "machine" },
    { fact: "b", provenance: "m-2", scope: "cross-thread", expiry: null, confidence: 1, authored_by: "machine" },
  ], "dumb-tail");
  expect(store.dropDistilledFactsByProvenance("m-1")).toBe(1);
  expect(store.readDistilledFacts(10).map((f) => f.fact)).toEqual(["b"]);
  store.close();
});

test("dropDistilledFactsForThread removes thread-level provenance row", () => {
  const { store } = freshStore();
  const t = store.createThread();
  store.insertDistilledFacts([
    { fact: "thread summary", provenance: `thread:${t}`, scope: "cross-thread", expiry: null, confidence: 0.5, authored_by: "machine" },
    { fact: "unrelated", provenance: "m-other", scope: "cross-thread", expiry: null, confidence: 1, authored_by: "machine" },
  ], "fixed-marker");
  expect(store.dropDistilledFactsForThread(t)).toBe(1);
  const remaining = store.readDistilledFacts(10);
  expect(remaining.length).toBe(1);
  expect(remaining[0]!.provenance).toBe("m-other");
  store.close();
});

test("dropAllDistilledFacts clears the entire projection table", () => {
  const { store } = freshStore();
  store.insertDistilledFacts([
    { fact: "a", provenance: "x", scope: "cross-thread", expiry: null, confidence: 1, authored_by: "machine" },
    { fact: "b", provenance: "y", scope: "cross-thread", expiry: null, confidence: 1, authored_by: "machine" },
  ], "dumb-tail");
  store.dropAllDistilledFacts();
  expect(store.readDistilledFacts(10).length).toBe(0);
  store.close();
});

test("insertDistillationEvent records a row even with 0 facts (5b)", () => {
  const { store } = freshStore();
  const t = store.createThread();
  store.insertDistillationEvent(t, "dismiss", 0, "dumb-tail");
  const evs = store.readDistillationEvents(t);
  expect(evs.length).toBe(1);
  expect(evs[0]!.facts_produced).toBe(0);
  store.close();
});

test("readDistillationEvents returns rows for a thread ordered by created_at", () => {
  const { store } = freshStore();
  const t = store.createThread();
  store.insertDistillationEvent(t, "dismiss", 3, "dumb-tail");
  store.insertDistillationEvent(t, "dismiss", 5, "dumb-tail");
  const evs = store.readDistillationEvents(t);
  expect(evs.length).toBe(2);
  expect(evs[0]!.facts_produced).toBe(3);
  expect(evs[1]!.facts_produced).toBe(5);
  store.close();
});

test("readDistillationEvents includes created_at as a non-null integer timestamp", () => {
  const { store } = freshStore();
  const t = store.createThread();
  const before = Date.now();
  store.insertDistillationEvent(t, "dismiss", 2, "v1");
  const after = Date.now();
  const evs = store.readDistillationEvents(t);
  expect(evs.length).toBe(1);
  expect(typeof evs[0]!.created_at).toBe("number");
  expect(evs[0]!.created_at).toBeGreaterThanOrEqual(before);
  expect(evs[0]!.created_at).toBeLessThanOrEqual(after);
  store.close();
});

test("readThreadMessagesForDistill returns ids and redacts tombstoned content", () => {
  const { store } = freshStore();
  const gate = new WriteGate(store, new RuleBasedScanner());
  const t = store.createThread();
  const [aliveId] = store.appendMessages(t, [{ role: "user", content: "alive message" }], "s1");
  const [deadId] = store.appendMessages(t, [{ role: "user", content: "secret to forget" }], "s2");
  gate.forget(deadId!, { actor: "user", authored_by: "human" });
  const rows = store.readThreadMessagesForDistill(t);
  expect(rows.length).toBe(2);
  const alive = rows.find((r) => r.id === aliveId);
  const dead = rows.find((r) => r.id === deadId);
  expect(alive!.content).toBe("alive message");
  expect(dead!.content).toBe(REDACTION_MARKER);
  store.close();
});

// ---- MF-03 Task 2: quarantine marker + lookup, human-correction precedence, 5e distilled delete-guard ----

test("recordQuarantine + isMessageQuarantined round-trips a quarantine marker", () => {
  const { store } = freshStore();
  const t = store.createThread();
  const [mid] = store.appendMessages(t, [{ role: "user", content: "x" }], "s1");
  expect(store.isMessageQuarantined(mid!)).toBe(false);
  store.recordQuarantine({ target_id: mid!, rule: "injection-directive" });
  expect(store.isMessageQuarantined(mid!)).toBe(true);
  expect(store.readQuarantineMarkers().length).toBe(1);
  store.close();
});

test("readThreadTail: a human correction wins over a later machine correction (5e precedence)", () => {
  const { store } = freshStore();
  const t = store.createThread();
  const [mid] = store.appendMessages(t, [{ role: "user", content: "deploy is deploy.sh" }], "s1");
  const db = store.rawDb();
  // human correction first
  db.query("INSERT INTO mutations (id, target_message_id, kind, actor, reason, replacement_content, authored_by, created_at) VALUES (?,?,?,?,?,?,?,?)")
    .run(crypto.randomUUID(), mid!, "correction", "user", null, "deploy is yeet.sh", "human", Date.now());
  // later machine correction tries to clobber
  db.query("INSERT INTO mutations (id, target_message_id, kind, actor, reason, replacement_content, authored_by, created_at) VALUES (?,?,?,?,?,?,?,?)")
    .run(crypto.randomUUID(), mid!, "correction", "agent", null, "deploy is robot.sh", "machine", Date.now() + 10);
  expect(store.readThreadTail(t, 10)).toEqual([{ role: "user", content: "deploy is yeet.sh" }]);
  store.close();
});

test("insertDistilledFacts refuses to drop a human-authored distilled fact on a machine rebuild (5e guard)", () => {
  const { store } = freshStore();
  // seed a human-authored distilled fact directly
  store.rawDb().query("INSERT INTO distilled_facts (id, fact, provenance, scope, expiry, confidence, authored_by, derived_at, distiller_version) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(crypto.randomUUID(), "human pinned fact", "m-h", "cross-thread", null, 1, "human", Date.now(), "manual");
  store.dropAllDistilledFacts(); // a machine re-derive drops the projection...
  expect(store.readDistilledFacts(10).some((f) => f.fact === "human pinned fact")).toBe(true); // ...but the human fact survives
  store.close();
});

// ---- MF-04 Task 1: readDistilledFactsForThread scope-filter SQL ----

test("readDistilledFactsForThread: cross-thread facts are returned for ANY thread (DoD #2)", () => {
  const { store } = freshStore();
  const tA = store.createThread();
  const tB = store.createThread();
  const [midA] = store.appendMessages(tA, [{ role: "user", content: "cross msg" }], "s1");
  store.insertDistilledFacts(
    [{ fact: "cross-thread fact", provenance: midA!, scope: "cross-thread", expiry: null, confidence: 1, authored_by: "machine" }],
    "dumb-tail",
  );
  // admitted for both threads
  const sliceA = store.readDistilledFactsForThread(tA, 10);
  const sliceB = store.readDistilledFactsForThread(tB, 10);
  expect(sliceA.some((f) => f.fact === "cross-thread fact")).toBe(true);
  expect(sliceB.some((f) => f.fact === "cross-thread fact")).toBe(true);
  store.close();
});

test("readDistilledFactsForThread: global-scope facts cross into any thread (DoD #2)", () => {
  const { store } = freshStore();
  const tA = store.createThread();
  const tB = store.createThread();
  const [midA] = store.appendMessages(tA, [{ role: "user", content: "global msg" }], "s1");
  store.insertDistilledFacts(
    [{ fact: "global note", provenance: midA!, scope: "global", expiry: null, confidence: 1, authored_by: "machine" }],
    "dumb-tail",
  );
  const sliceB = store.readDistilledFactsForThread(tB, 10);
  expect(sliceB.some((f) => f.fact === "global note")).toBe(true);
  store.close();
});

test("readDistilledFactsForThread: thread-local message-provenance fact is hidden from other thread (DoD #1)", () => {
  const { store } = freshStore();
  const tA = store.createThread();
  const tB = store.createThread();
  const [midA] = store.appendMessages(tA, [{ role: "user", content: "private" }], "s1");
  store.insertDistilledFacts(
    [{ fact: "local-only fact", provenance: midA!, scope: "thread-local", expiry: null, confidence: 1, authored_by: "machine" }],
    "dumb-tail",
  );
  // hidden from B
  const sliceB = store.readDistilledFactsForThread(tB, 10);
  expect(sliceB.some((f) => f.fact === "local-only fact")).toBe(false);
  store.close();
});

test("readDistilledFactsForThread: thread-local message-provenance fact IS returned for its own origin thread (DoD #1)", () => {
  const { store } = freshStore();
  const tA = store.createThread();
  store.createThread(); // tB unused but minted to prove isolation
  const [midA] = store.appendMessages(tA, [{ role: "user", content: "private" }], "s1");
  store.insertDistilledFacts(
    [{ fact: "local-only fact", provenance: midA!, scope: "thread-local", expiry: null, confidence: 1, authored_by: "machine" }],
    "dumb-tail",
  );
  // shown to own thread
  const sliceA = store.readDistilledFactsForThread(tA, 10);
  expect(sliceA.some((f) => f.fact === "local-only fact")).toBe(true);
  store.close();
});

test("readDistilledFactsForThread: thread-level provenance ('thread:<id>') thread-local is hidden from B, shown to A", () => {
  const { store } = freshStore();
  const tA = store.createThread();
  const tB = store.createThread();
  store.insertDistilledFacts(
    [{ fact: "thread-level local", provenance: `thread:${tA}`, scope: "thread-local", expiry: null, confidence: 0.5, authored_by: "machine" }],
    "fixed-marker",
  );
  const sliceA = store.readDistilledFactsForThread(tA, 10);
  const sliceB = store.readDistilledFactsForThread(tB, 10);
  expect(sliceA.some((f) => f.fact === "thread-level local")).toBe(true);
  expect(sliceB.some((f) => f.fact === "thread-level local")).toBe(false);
  store.close();
});

test("readDistilledFactsForThread: NULL-scope fact is treated as cross-thread (defensive default)", () => {
  const { store } = freshStore();
  const tA = store.createThread();
  const tB = store.createThread();
  // Insert a row with NULL scope directly via rawDb
  store.rawDb().query(
    "INSERT INTO distilled_facts (id, fact, provenance, scope, expiry, confidence, authored_by, derived_at, distiller_version) VALUES (?,?,?,?,?,?,?,?,?)",
  ).run(crypto.randomUUID(), "null-scope fact", "m-null", null, null, 1, "machine", Date.now(), "dumb-tail");
  const sliceA = store.readDistilledFactsForThread(tA, 10);
  const sliceB = store.readDistilledFactsForThread(tB, 10);
  expect(sliceA.some((f) => f.fact === "null-scope fact")).toBe(true);
  expect(sliceB.some((f) => f.fact === "null-scope fact")).toBe(true);
  store.close();
});

// ---- chunk 02: replaceProjection + expiry filter (D7) + author ordering (D6) ----

test("replaceProjection: drops machine facts, keeps human facts, inserts clean set and event rows atomically (5e)", () => {
  const { store } = freshStore();
  const t = store.createThread();

  // seed: one machine fact + one human fact
  store.rawDb().query(
    "INSERT INTO distilled_facts (id, fact, provenance, scope, expiry, confidence, authored_by, derived_at, distiller_version) VALUES (?,?,?,?,?,?,?,?,?)",
  ).run(crypto.randomUUID(), "old machine fact", "m-old", "cross-thread", null, 1, "machine", Date.now(), "v0");
  store.rawDb().query(
    "INSERT INTO distilled_facts (id, fact, provenance, scope, expiry, confidence, authored_by, derived_at, distiller_version) VALUES (?,?,?,?,?,?,?,?,?)",
  ).run(crypto.randomUUID(), "human pinned", "thread:human", "cross-thread", null, 1, "human", Date.now(), "manual");

  const clean = [
    { fact: "new machine fact", provenance: "m-new", scope: "cross-thread" as const, expiry: null, confidence: 1, authored_by: "machine" as const },
  ];
  const events = [{ threadId: t, trigger: "reprojection", factsProduced: 1 }];

  store.replaceProjection(clean, "v1", events);

  const allFacts = store.readDistilledFacts(20);

  // old machine fact must be gone
  expect(allFacts.some((f) => f.fact === "old machine fact")).toBe(false);
  // human fact must survive (5e)
  expect(allFacts.some((f) => f.fact === "human pinned")).toBe(true);
  // new clean fact must be present
  expect(allFacts.some((f) => f.fact === "new machine fact")).toBe(true);
  // event row must have landed
  const evs = store.readDistillationEvents(t);
  expect(evs.length).toBe(1);
  expect(evs[0]!.trigger).toBe("reprojection");
  expect(evs[0]!.facts_produced).toBe(1);
  expect(evs[0]!.distiller_version).toBe("v1");

  store.close();
});

test("replaceProjection: pre-existing human-authored fact is preserved after replace (5e human guard)", () => {
  const { store } = freshStore();
  const t = store.createThread();

  store.rawDb().query(
    "INSERT INTO distilled_facts (id, fact, provenance, scope, expiry, confidence, authored_by, derived_at, distiller_version) VALUES (?,?,?,?,?,?,?,?,?)",
  ).run(crypto.randomUUID(), "human fact stays", "thread:human2", "cross-thread", null, 1, "human", Date.now(), "manual");

  // replace with an empty clean set
  store.replaceProjection([], "v1", [{ threadId: t, trigger: "reprojection", factsProduced: 0 }]);

  const allFacts = store.readDistilledFacts(20);
  expect(allFacts.some((f) => f.fact === "human fact stays")).toBe(true);

  store.close();
});

test("readDistilledFactsForThread: excludes a fact with expiry <= Date.now() (D7)", () => {
  const { store } = freshStore();
  const tA = store.createThread();

  const pastExpiry = Date.now() - 1000; // already expired
  const futureExpiry = Date.now() + 60_000; // not yet expired

  store.rawDb().query(
    "INSERT INTO distilled_facts (id, fact, provenance, scope, expiry, confidence, authored_by, derived_at, distiller_version) VALUES (?,?,?,?,?,?,?,?,?)",
  ).run(crypto.randomUUID(), "expired fact", "m-exp", "cross-thread", pastExpiry, 1, "machine", Date.now() - 2000, "v1");
  store.rawDb().query(
    "INSERT INTO distilled_facts (id, fact, provenance, scope, expiry, confidence, authored_by, derived_at, distiller_version) VALUES (?,?,?,?,?,?,?,?,?)",
  ).run(crypto.randomUUID(), "live fact", "m-live", "cross-thread", futureExpiry, 1, "machine", Date.now(), "v1");
  store.rawDb().query(
    "INSERT INTO distilled_facts (id, fact, provenance, scope, expiry, confidence, authored_by, derived_at, distiller_version) VALUES (?,?,?,?,?,?,?,?,?)",
  ).run(crypto.randomUUID(), "null expiry fact", "m-null-exp", "cross-thread", null, 1, "machine", Date.now(), "v1");

  const slice = store.readDistilledFactsForThread(tA, 20);

  expect(slice.some((f) => f.fact === "expired fact")).toBe(false);
  expect(slice.some((f) => f.fact === "live fact")).toBe(true);
  expect(slice.some((f) => f.fact === "null expiry fact")).toBe(true);

  store.close();
});

test("readDistilledFactsForThread: human-authored fact appears before machine fact in the slice (D6 ordering)", () => {
  const { store } = freshStore();
  const tA = store.createThread();
  const now = Date.now();

  // Insert machine fact first (earlier derived_at) and human fact second (later derived_at)
  // Without D6 ordering, the machine fact would appear first by derived_at DESC.
  // With D6, human must precede machine regardless of derived_at.
  store.rawDb().query(
    "INSERT INTO distilled_facts (id, fact, provenance, scope, expiry, confidence, authored_by, derived_at, distiller_version) VALUES (?,?,?,?,?,?,?,?,?)",
  ).run(crypto.randomUUID(), "machine fact", "m-mach", "cross-thread", null, 1, "machine", now + 100, "v1");
  store.rawDb().query(
    "INSERT INTO distilled_facts (id, fact, provenance, scope, expiry, confidence, authored_by, derived_at, distiller_version) VALUES (?,?,?,?,?,?,?,?,?)",
  ).run(crypto.randomUUID(), "human fact", "thread:human3", "cross-thread", null, 1, "human", now, "manual");

  const slice = store.readDistilledFactsForThread(tA, 20);

  const humanIdx = slice.findIndex((f) => f.fact === "human fact");
  const machineIdx = slice.findIndex((f) => f.fact === "machine fact");

  expect(humanIdx).toBeGreaterThanOrEqual(0);
  expect(machineIdx).toBeGreaterThanOrEqual(0);
  // human must come before machine
  expect(humanIdx).toBeLessThan(machineIdx);

  store.close();
});

// ---- MAJOR-1: recency ordering via replaceProjection with > RETRIEVE_SLICE_N facts ----

/**
 * Regression test for the recency-inversion bug:
 *   - replaceProjection stamped Date.now() per-row inside the insert loop.
 *   - readDistilledFactsForThread ordered by derived_at DESC with no tie-breaker.
 *   - When the loop crosses a ms boundary, later-inserted (= OLDER) rows get a
 *     larger derived_at → DESC ranks them FIRST → LIMIT 20 fills with the OLDEST
 *     facts and drops the newest.
 * Fix: single `now` before the loop + `rowid ASC` stable tie-breaker.
 * Deterministic-RED requirement: 200 facts ensure the insert loop crosses a ms
 * boundary reliably under the unfixed code (tested by running without fix).
 */
test("replaceProjection: readDistilledFactsForThread LIMIT 20 returns the NEWEST facts in newest-first order (recency-inversion regression)", () => {
  const FACT_COUNT = 500; // large enough to cross ms boundary reliably (200 stays in 1ms; 500 spans 2ms)
  const SLICE_N = 20;     // mirrors RETRIEVE_SLICE_N
  const { store } = freshStore();
  const t = store.createThread();

  // Build facts in newest-first order (index 0 = newest, index FACT_COUNT-1 = oldest).
  // scope='cross-thread' so all facts are injectable for forThreadId=t.
  // The provider would iterate threads newest-first and produce facts in this order,
  // so index 0 is the most-recently-active thread's fact.
  const facts = Array.from({ length: FACT_COUNT }, (_, i) => ({
    fact: `fact-${i}`,
    provenance: `thread:prov-${i}`,
    scope: "cross-thread" as const,
    expiry: null,
    confidence: 1,
    authored_by: "machine" as const,
  }));

  // replaceProjection is the production path that had the per-row Date.now() bug.
  // Insert via the real replaceProjection (exercises the write path under test).
  store.replaceProjection(facts, "test", [{ threadId: t, trigger: "reprojection", factsProduced: facts.length }]);

  const slice = store.readDistilledFactsForThread(t, SLICE_N);

  // Assertions:
  // 1. Exactly SLICE_N rows returned.
  expect(slice.length).toBe(SLICE_N);
  // 2. The slice must be the NEWEST facts (indices 0..19) — NOT the oldest.
  //    Under the bug, the slice would be filled with the OLDEST facts (high indices).
  const sliceFacts = slice.map((r) => r.fact);
  for (let i = 0; i < SLICE_N; i++) {
    expect(sliceFacts).toContain(`fact-${i}`);
  }
  // 3. None of the oldest facts (beyond SLICE_N) should be in the slice.
  for (let i = SLICE_N; i < FACT_COUNT; i++) {
    expect(sliceFacts).not.toContain(`fact-${i}`);
  }
  // 4. Order within the slice: newest-first (fact-0 before fact-1, etc.).
  //    rowid ASC insertion order = provider's newest-first order, so fact-0 has lower rowid.
  const idx0 = sliceFacts.indexOf("fact-0");
  const idx19 = sliceFacts.indexOf("fact-19");
  expect(idx0).toBeGreaterThanOrEqual(0);
  expect(idx19).toBeGreaterThanOrEqual(0);
  expect(idx0).toBeLessThan(idx19);

  store.close();
});

// ---- chunk 04: forgotten_facts store primitives (Step 2 — RED first) ----

test("recordForgottenFact inserts a row keyed on normalized text", () => {
  const { store } = freshStore();
  store.recordForgottenFact({ raw_text: "Favourite Colour: Blue.", provenance: "m1,m2", actor: "user", reason: "hatch-forget", authored_by: "human" });
  expect(store.isForgottenNormalizedText(normalizeFactText("favourite colour: blue"))).toBe(true);
  store.close();
});

test("readForgottenFacts returns normalized + raw + provenance for the layers", () => {
  const { store } = freshStore();
  store.recordForgottenFact({ raw_text: "X", provenance: "p", actor: "u", authored_by: "human" });
  const rows = store.readForgottenFacts();
  expect(rows[0]!.normalized_text).toBe(normalizeFactText("X"));
  expect(rows[0]!.raw_text).toBe("X");
  expect(rows[0]!.provenance).toBe("p");
  store.close();
});

test("clearForgottenByNormalizedText removes the un-forget row(s)", () => {
  const { store } = freshStore();
  store.recordForgottenFact({ raw_text: "likes tea", provenance: "p", actor: "u", authored_by: "human" });
  const removed = store.clearForgottenByNormalizedText(normalizeFactText("likes tea"));
  expect(removed).toBeGreaterThan(0);
  expect(store.isForgottenNormalizedText(normalizeFactText("likes tea"))).toBe(false);
  store.close();
});

test("deleteMachineFactsByForget deletes by provenance OR normalized text, never a human row", () => {
  const { store } = freshStore();
  store.insertDistilledFacts([
    { fact: "fav colour: blue", provenance: "m1,m2", scope: "cross-thread", expiry: null, confidence: 1, authored_by: "machine" },
  ], "smart");
  // Insert a human row with same text directly (bypassing insertDistilledFacts authored_by forcing)
  store.rawDb().query(
    "INSERT INTO distilled_facts (id, fact, provenance, scope, expiry, confidence, authored_by, derived_at, distiller_version) VALUES (?,?,?,?,?,?,?,?,?)",
  ).run(crypto.randomUUID(), "fav colour: blue", "different", "cross-thread", null, 1, "human", Date.now(), "manual");
  const n = store.deleteMachineFactsByForget("m1,m2", normalizeFactText("fav colour: blue"));
  expect(n).toBe(1); // machine row gone
  const rows = store.readDistilledFacts(50);
  expect(rows.some((r) => r.authored_by === "human")).toBe(true); // human row survives
  store.close();
});

test("deleteMachineFactsByForget catches a comma-joined row by TEXT when provenance differs (no purge-miss)", () => {
  const { store } = freshStore();
  store.insertDistilledFacts([
    { fact: "User favourite colour is blue", provenance: "x,y,z", scope: "cross-thread", expiry: null, confidence: 1, authored_by: "machine" },
  ], "smart");
  // forgotten with a DIFFERENT provenance shape but the same normalized text
  const n = store.deleteMachineFactsByForget("m1", normalizeFactText("User favourite colour is blue"));
  expect(n).toBe(1);
  store.close();
});

test("hasHumanFactWithNormalizedText returns true only when a human fact matches", () => {
  const { store } = freshStore();
  store.rawDb().query(
    "INSERT INTO distilled_facts (id, fact, provenance, scope, expiry, confidence, authored_by, derived_at, distiller_version) VALUES (?,?,?,?,?,?,?,?,?)",
  ).run(crypto.randomUUID(), "likes tea", "h-prov", "cross-thread", null, 1, "human", Date.now(), "manual");
  expect(store.hasHumanFactWithNormalizedText(normalizeFactText("likes tea"))).toBe(true);
  expect(store.hasHumanFactWithNormalizedText(normalizeFactText("no such fact"))).toBe(false);
  store.close();
});

// v2-04: countFactsFedByMessages tests removed. countFactsFedByMessages was the
// option-B cofed-count helper; it was removed in v2-04 along with option B.

// ---- MINOR-1: readDistilledFactsForThread origin-thread resolved in code ----

test("MINOR-1: a thread-local fact with comma-joined provenance injects into its origin thread (resolved in code)", () => {
  const { store } = freshStore();
  const tOrigin = store.createThread();
  const [a] = store.appendMessages(tOrigin, [{ role: "user", content: "alpha" }], "s");
  const [b] = store.appendMessages(tOrigin, [{ role: "assistant", content: "beta" }], "s");
  store.insertDistilledFacts([
    { fact: "thread-local agg", provenance: `${a},${b}`, scope: "thread-local", expiry: null, confidence: 1, authored_by: "machine" },
  ], "smart");

  const here = store.readDistilledFactsForThread(tOrigin, 20);
  expect(here.some((f) => f.fact === "thread-local agg")).toBe(true);

  const other = store.createThread();
  const there = store.readDistilledFactsForThread(other, 20);
  expect(there.some((f) => f.fact === "thread-local agg")).toBe(false); // private stays home
  store.close();
});

// ── v2-02: Task 1 — additive schema (fact_fts, fact_topics, sync trigger, thread_distill_state, replaced_facts) ──

test("v2-02 schema: new tables/index/trigger created additively on a fresh store", () => {
  const { store, dir } = freshStore();
  const db = store.rawDb();
  // FTS5 virtual table must exist (this line throws loudly if FTS5 is absent in bun:sqlite)
  const fts = db.query("SELECT name FROM sqlite_master WHERE name = 'fact_fts'").get();
  expect(fts).not.toBeNull();
  const topics = db.query("SELECT name FROM sqlite_master WHERE name = 'fact_topics'").get();
  expect(topics).not.toBeNull();
  const trig = db.query("SELECT name FROM sqlite_master WHERE type='trigger' AND name='trg_distilled_facts_ad'").get();
  expect(trig).not.toBeNull();
  const dstate = db.query("SELECT name FROM sqlite_master WHERE name = 'thread_distill_state'").get();
  expect(dstate).not.toBeNull();
  const rfacts = db.query("SELECT name FROM sqlite_master WHERE name = 'replaced_facts'").get();
  expect(rfacts).not.toBeNull();
  store.close();

  // Re-open the SAME dir (existing-store path): must not throw (idempotent IF NOT EXISTS)
  const reopened = new MemoryStore({ dataDir: dir });
  expect(reopened.rawDb().query("SELECT name FROM sqlite_master WHERE name='fact_fts'").get()).not.toBeNull();
  reopened.close();
});

// ── v2-02: Task 2 — insertFact ──

test("v2-02 insertFact returns a stable id and writes fact_fts + fact_topics", () => {
  const { store } = freshStore();
  const id = store.insertFact({
    fact: "User's name is Lior", canonical: "user name lior", provenance: "thread:t1",
    scope: "cross-thread", expiry: null, confidence: 1, authored_by: "machine",
    topics: ["about-user", "relationships"],
  }, "smart-v2");
  expect(typeof id).toBe("string");
  const db = store.rawDb();
  const df = db.query("SELECT fact FROM distilled_facts WHERE id = ?").get(id) as { fact: string };
  expect(df.fact).toBe("User's name is Lior");
  const fts = db.query("SELECT canonical FROM fact_fts WHERE fact_id = ?").get(id) as { canonical: string };
  expect(fts.canonical).toBe("user name lior");
  const tags = db.query("SELECT topic FROM fact_topics WHERE fact_id = ? ORDER BY topic").all(id) as { topic: string }[];
  expect(tags.map((t) => t.topic)).toEqual(["about-user", "relationships"]);
  store.close();
});

// ── v2-02: Task 3 — updateFactById, recordReplacedFact, appendToFactById, deleteFactById ──

test("v2-02 updateFactById REPLACEs the row in place (same id), refreshes fact_fts, and records the replaced text", () => {
  const { store } = freshStore();
  const id = store.insertFact({
    fact: "User has 3 siblings", canonical: "user 3 siblings", provenance: "thread:t1",
    scope: "cross-thread", expiry: null, confidence: 1, authored_by: "machine", topics: ["about-user"],
  }, "smart-v2");
  store.updateFactById(id, {
    fact: "User has 2 siblings", canonical: "user 2 siblings", confidence: 1, topics: ["about-user", "family"],
  }, { actor: "machine", reason: "contradiction" }, "smart-v2");
  const db = store.rawDb();
  const df = db.query("SELECT fact FROM distilled_facts WHERE id = ?").get(id) as { fact: string };
  expect(df.fact).toBe("User has 2 siblings");
  const fts = db.query("SELECT canonical FROM fact_fts WHERE fact_id = ?").all(id) as { canonical: string }[];
  expect(fts.length).toBe(1);
  expect(fts[0]!.canonical).toBe("user 2 siblings");
  const tags = (db.query("SELECT topic FROM fact_topics WHERE fact_id = ? ORDER BY topic").all(id) as { topic: string }[]).map((t) => t.topic);
  expect(tags).toEqual(["about-user", "family"]);
  const replaced = store.readReplacedFacts(id);
  expect(replaced.some((r) => r.replaced_text === "User has 3 siblings")).toBe(true);
  store.close();
});

test("v2-02 recordReplacedFact standalone records text without an update", () => {
  const { store } = freshStore();
  const id = store.insertFact({
    fact: "keep", canonical: "keep", provenance: "thread:t1",
    scope: "cross-thread", expiry: null, confidence: 1, authored_by: "machine", topics: ["x"],
  }, "smart-v2");
  store.recordReplacedFact(id, "older text", { actor: "machine", reason: "audit" });
  expect(store.readReplacedFacts(id).some((r) => r.replaced_text === "older text")).toBe(true);
  store.close();
});

test("v2-02 appendToFactById appends until the cap, then refuses (returns false past APPEND_LIST_CAP)", () => {
  const { store } = freshStore();
  const id = store.insertFact({
    fact: "User likes: tea", canonical: "user likes tea", provenance: "thread:t1",
    scope: "cross-thread", expiry: null, confidence: 1, authored_by: "machine", topics: ["preferences"],
  }, "smart-v2");
  // APPEND_LIST_CAP = 8; initial fact has 1 item, so 7 more fits before refusal
  for (let i = 1; i < 8; i++) {
    expect(store.appendToFactById(id, `item${i}`, `user likes item${i}`)).toBe(true);
  }
  expect(store.appendToFactById(id, "overflow", "user likes overflow")).toBe(false);
  store.close();
});

test("v2-02 deleteFactById removes the row and (via trigger) its fact_fts + fact_topics rows", () => {
  const { store } = freshStore();
  const id = store.insertFact({
    fact: "ephemeral", canonical: "ephemeral", provenance: "thread:t1",
    scope: "cross-thread", expiry: null, confidence: 1, authored_by: "machine", topics: ["x", "y"],
  }, "smart-v2");
  expect(store.deleteFactById(id)).toBe(true);
  const db = store.rawDb();
  expect(db.query("SELECT 1 FROM distilled_facts WHERE id = ?").get(id)).toBeNull();
  expect(db.query("SELECT 1 FROM fact_fts WHERE fact_id = ?").get(id)).toBeNull();
  expect(db.query("SELECT 1 FROM fact_topics WHERE fact_id = ?").get(id)).toBeNull();
  store.close();
});

// ── v2-02: Task 4 — BM25 candidate-fetch ──

test("v2-02 fetchCandidates surfaces a contradicting fact carrying a DIFFERENT topic tag (tags WIDEN, never filter)", () => {
  const { store } = freshStore();
  store.insertFact({
    fact: "User has 3 siblings", canonical: "user has 3 siblings family", provenance: "thread:t1",
    scope: "cross-thread", expiry: null, confidence: 1, authored_by: "machine", topics: ["about-user"],
  }, "smart-v2");
  store.insertFact({
    fact: "User has 2 siblings", canonical: "user has 2 siblings family", provenance: "thread:t2",
    scope: "cross-thread", expiry: null, confidence: 1, authored_by: "machine", topics: ["relationships"],
  }, "smart-v2");
  const candidates = store.fetchCandidates("user has siblings family");
  const facts = candidates.map((c) => c.fact);
  expect(facts).toContain("User has 3 siblings");
  expect(facts).toContain("User has 2 siblings");
  const a = candidates.find((c) => c.fact === "User has 3 siblings")!;
  expect(typeof a.id).toBe("string");
  expect(a.topics).toEqual(["about-user"]);
  store.close();
});

test("v2-02 fetchCandidates returns at most CANDIDATE_TOP_K rows and tolerates punctuation in the query", () => {
  const { store } = freshStore();
  for (let i = 0; i < 15; i++) {
    store.insertFact({
      fact: `fact ${i} about deployment`, canonical: `fact ${i} about deployment`, provenance: "thread:t1",
      scope: "cross-thread", expiry: null, confidence: 1, authored_by: "machine", topics: ["projects"],
    }, "smart-v2");
  }
  const candidates = store.fetchCandidates("deployment: the (script)?");
  expect(candidates.length).toBeLessThanOrEqual(10); // CANDIDATE_TOP_K = 10
  expect(candidates.length).toBeGreaterThan(0);
  store.close();
});

// ── v2-02: Task 5 — count-equality SYNC GATE (one test per delete path) + mutation marker ──

function assertDerivedInSync(store: MemoryStore): void {
  const db = store.rawDb();
  const dfCount = (db.query("SELECT COUNT(*) AS n FROM distilled_facts").get() as { n: number }).n;
  const ftsCount = (db.query("SELECT COUNT(*) AS n FROM fact_fts").get() as { n: number }).n;
  expect(ftsCount).toBe(dfCount);
  const orphans = (db.query(
    "SELECT COUNT(*) AS n FROM fact_topics WHERE fact_id NOT IN (SELECT id FROM distilled_facts)",
  ).get() as { n: number }).n;
  expect(orphans).toBe(0);
}

function seedTwoFacts(store: MemoryStore): { a: string; b: string } {
  const a = store.insertFact({ fact: "fact A", canonical: "fact a", provenance: "thread:tA",
    scope: "cross-thread", expiry: null, confidence: 1, authored_by: "machine", topics: ["x"] }, "smart-v2");
  const b = store.insertFact({ fact: "fact B", canonical: "fact b", provenance: "thread:tB",
    scope: "cross-thread", expiry: null, confidence: 1, authored_by: "machine", topics: ["y", "z"] }, "smart-v2");
  return { a, b };
}

test("v2-02 SYNC GATE: deleteFactById keeps fact_fts == distilled_facts, no orphan topics", () => {
  const { store } = freshStore();
  const { a } = seedTwoFacts(store);
  store.deleteFactById(a);
  assertDerivedInSync(store);
  store.close();
});

test("v2-02 SYNC GATE: dropDistilledFactsByProvenance keeps derived tables in sync", () => {
  const { store } = freshStore();
  seedTwoFacts(store);
  store.dropDistilledFactsByProvenance("thread:tA");
  assertDerivedInSync(store);
  store.close();
});

test("v2-02 SYNC GATE: dropDistilledFactsForThread keeps derived tables in sync", () => {
  const { store } = freshStore();
  seedTwoFacts(store);
  store.dropDistilledFactsForThread("tB");
  assertDerivedInSync(store);
  store.close();
});

test("v2-02 SYNC GATE: dropAllDistilledFacts (migration wipe) keeps derived tables in sync", () => {
  const { store } = freshStore();
  seedTwoFacts(store);
  store.dropAllDistilledFacts();
  assertDerivedInSync(store);
  store.close();
});

test("v2-02 SYNC GATE: deleteMachineFactsByForget keeps derived tables in sync", () => {
  const { store } = freshStore();
  const { a } = seedTwoFacts(store);
  store.deleteMachineFactsByForget("thread:tA", "no-text-match");
  assertDerivedInSync(store);
  expect(store.rawDb().query("SELECT 1 FROM distilled_facts WHERE id = ?").get(a)).toBeNull();
  store.close();
});

test("v2-02 SYNC GATE: updateFactById REPLACE leaves exactly one fact_fts row (no desync)", () => {
  const { store } = freshStore();
  const { a } = seedTwoFacts(store);
  store.updateFactById(a, { fact: "fact A2", canonical: "fact a2", confidence: 1, topics: ["x", "w"] },
    { actor: "machine", reason: "test" }, "smart-v2");
  assertDerivedInSync(store);
  store.close();
});

test("v2-02 mutation marker: appendMessages bumps marker; bumpThreadMarker also bumps", () => {
  const { store } = freshStore();
  const t = store.createThread();
  expect(store.readThreadMarker(t)).toBe(0);
  store.appendMessages(t, [{ role: "user", content: "hi" }], "s1");
  expect(store.readThreadMarker(t)).toBe(1);
  store.appendMessages(t, [{ role: "user", content: "again" }], "s2");
  expect(store.readThreadMarker(t)).toBe(2);
  store.bumpThreadMarker(t); // simulates the edit/forget bump site
  expect(store.readThreadMarker(t)).toBe(3);
  store.close();
});

test("v2-02 distilled_through: advanceDistilledThrough records the marker the distiller covered", () => {
  const { store } = freshStore();
  const t = store.createThread();
  store.appendMessages(t, [{ role: "user", content: "hi" }], "s1");
  store.advanceDistilledThrough(t, store.readThreadMarker(t));
  const state = store.readThreadDistillState(t);
  expect(state.marker).toBe(1);
  expect(state.distilled_through).toBe(1);
  store.close();
});

test("v2-02 write-gate integration: edit bumps the thread marker", () => {
  const { store } = freshStore();
  const gate = new WriteGate(store, new RuleBasedScanner());
  const t = store.createThread();
  const [mid] = store.appendMessages(t, [{ role: "user", content: "original" }], "s1");
  const markerAfterAppend = store.readThreadMarker(t);
  gate.edit(mid!, "revised content", { actor: "user", authored_by: "human" });
  expect(store.readThreadMarker(t)).toBe(markerAfterAppend + 1);
  store.close();
});

test("v2-02 write-gate integration: forget bumps the thread marker", () => {
  const { store } = freshStore();
  const gate = new WriteGate(store, new RuleBasedScanner());
  const t = store.createThread();
  const [mid] = store.appendMessages(t, [{ role: "user", content: "to forget" }], "s1");
  const markerAfterAppend = store.readThreadMarker(t);
  gate.forget(mid!, { actor: "user", authored_by: "human" });
  expect(store.readThreadMarker(t)).toBe(markerAfterAppend + 1);
  store.close();
});

// ── v2-05: rebuildDerivedForHumanFacts + ensureDistilledThroughTurnColumn ────

test("v2-05: rebuildDerivedForHumanFacts indexes a human fact that has no derived rows", () => {
  const { store } = freshStore();
  const db = store.rawDb();
  db.query(
    "INSERT INTO distilled_facts (id, fact, provenance, scope, expiry, confidence, authored_by, derived_at, distiller_version) VALUES ('h1','User pins: name is Lior','thread:t','cross-thread',NULL,1,'human',1,'pre-v2')",
  ).run();
  expect((db.query("SELECT COUNT(*) AS n FROM fact_fts").get() as { n: number }).n).toBe(0);
  const n = store.rebuildDerivedForHumanFacts("v2-05-migration");
  expect(n).toBe(1);
  const dfCount = (db.query("SELECT COUNT(*) AS n FROM distilled_facts").get() as { n: number }).n;
  const ftsCount = (db.query("SELECT COUNT(*) AS n FROM fact_fts").get() as { n: number }).n;
  expect(ftsCount).toBe(dfCount);
  expect(store.fetchCandidates("lior").some((c) => c.id === "h1")).toBe(true);
  store.close();
});

test("v2-05: rebuildDerivedForHumanFacts is idempotent (no duplicate derived rows on re-run)", () => {
  const { store } = freshStore();
  const db = store.rawDb();
  db.query(
    "INSERT INTO distilled_facts (id, fact, provenance, scope, expiry, confidence, authored_by, derived_at, distiller_version) VALUES ('h1','name is Lior',NULL,'cross-thread',NULL,1,'human',1,'pre-v2')",
  ).run();
  store.rebuildDerivedForHumanFacts("v2-05-migration");
  store.rebuildDerivedForHumanFacts("v2-05-migration");
  expect((db.query("SELECT COUNT(*) AS n FROM fact_fts WHERE fact_id='h1'").get() as { n: number }).n).toBe(1);
  store.close();
});

test("v2-05: ensureDistilledThroughTurnColumn adds the column to a pre-v2-03 shaped table, then no-ops", () => {
  const dir = mkdtempSync(join(tmpdir(), "mf-prev203-"));
  const raw = new Database(join(dir, "memory.sqlite"));
  raw.exec("CREATE TABLE thread_distill_state (thread_id TEXT PRIMARY KEY, marker INTEGER NOT NULL DEFAULT 0, distilled_through INTEGER NOT NULL DEFAULT 0);");
  raw.query("INSERT INTO thread_distill_state (thread_id, marker, distilled_through) VALUES ('t', 3, 2)").run();
  raw.close();
  const store = new MemoryStore({ dataDir: dir });
  expect(store.ensureDistilledThroughTurnColumn()).toBe(true);
  expect(store.ensureDistilledThroughTurnColumn()).toBe(false);
  const row = store.rawDb().query("SELECT distilled_through_turn FROM thread_distill_state WHERE thread_id='t'").get() as { distilled_through_turn: number };
  expect(row.distilled_through_turn).toBe(-1);
  store.close();
});
