import { test, expect } from "bun:test";
import { tmpdir } from "node:os";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { MemoryStore } from "./store.js";
import { WriteGate } from "./write-gate.js";
import { RuleBasedScanner } from "./scanner/memory-scanner.js";
import { REDACTION_MARKER } from "./schema.js";

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
