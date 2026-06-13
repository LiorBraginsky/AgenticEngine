import { test, expect } from "bun:test";
import { tmpdir } from "node:os";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
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

test("purgeLiveMachineFactsByForget deletes by provenance OR normalized text, never a human row", () => {
  const { store } = freshStore();
  store.insertDistilledFacts([
    { fact: "fav colour: blue", provenance: "m1,m2", scope: "cross-thread", expiry: null, confidence: 1, authored_by: "machine" },
  ], "smart");
  // Insert a human row with same text directly (bypassing insertDistilledFacts authored_by forcing)
  store.rawDb().query(
    "INSERT INTO distilled_facts (id, fact, provenance, scope, expiry, confidence, authored_by, derived_at, distiller_version) VALUES (?,?,?,?,?,?,?,?,?)",
  ).run(crypto.randomUUID(), "fav colour: blue", "different", "cross-thread", null, 1, "human", Date.now(), "manual");
  const n = store.purgeLiveMachineFactsByForget("m1,m2", normalizeFactText("fav colour: blue"));
  expect(n).toBe(1); // machine row gone
  const rows = store.readDistilledFacts(50);
  expect(rows.some((r) => r.authored_by === "human")).toBe(true); // human row survives
  store.close();
});

test("purgeLiveMachineFactsByForget catches a comma-joined row by TEXT when provenance differs (no purge-miss)", () => {
  const { store } = freshStore();
  store.insertDistilledFacts([
    { fact: "User favourite colour is blue", provenance: "x,y,z", scope: "cross-thread", expiry: null, confidence: 1, authored_by: "machine" },
  ], "smart");
  // forgotten with a DIFFERENT provenance shape but the same normalized text
  const n = store.purgeLiveMachineFactsByForget("m1", normalizeFactText("User favourite colour is blue"));
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

test("countFactsFedByMessages returns how many OTHER distilled facts a set of source messages feed", () => {
  const { store } = freshStore();
  store.insertDistilledFacts([
    { fact: "f1", provenance: "m1,m2", scope: "cross-thread", expiry: null, confidence: 1, authored_by: "machine" },
    { fact: "f2", provenance: "m2,m3", scope: "cross-thread", expiry: null, confidence: 1, authored_by: "machine" },
    { fact: "self", provenance: "m1", scope: "cross-thread", expiry: null, confidence: 1, authored_by: "machine" },
  ], "smart");
  // facts fed by {m1} excluding the fact being forgotten ("self")
  expect(store.countFactsFedByMessages(["m1"], "self")).toBe(1); // f1 also feeds on m1
  store.close();
});

// ---- MINOR-2 NIT: countFactsFedByMessages null-provenance guard ----

test("m2.2 RED: countFactsFedByMessages throws when a machine row has NULL provenance (f.provenance.split on null)", () => {
  const { store } = freshStore();
  // Seed a NULL-provenance machine row via rawDb (bypasses insertDistilledFacts typed input)
  store.rawDb().query(
    "INSERT INTO distilled_facts (id, fact, provenance, scope, expiry, confidence, authored_by, derived_at, distiller_version) VALUES (?,?,?,?,?,?,?,?,?)",
  ).run(crypto.randomUUID(), "null-prov fact", null, "cross-thread", null, 1, "machine", Date.now(), "v0");

  // This should NOT throw after the fix (m2.3: null-provenance guard)
  // Without the fix: f.provenance.split is called on null → TypeError
  expect(() => store.countFactsFedByMessages(["m1"], "other")).not.toThrow();
  store.close();
});

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
