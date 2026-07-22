import { test, expect } from "bun:test";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { MemoryStore } from "./store.js";
import { applyFactOp } from "./apply-fact-op.js";
import { normalizeFactText } from "./normalize-fact-text.js";

function freshStore() {
  const dir = mkdtempSync(join(tmpdir(), "2c01-apply-fact-op-"));
  return new MemoryStore({ dataDir: dir });
}

// ─── Named DoD guard: applyFactOp never writes a watermark or a distill event ──

function assertNoDistillSideEffects(store: MemoryStore, threadId: string): void {
  expect(store.readDistillationEvents(threadId)).toEqual([]);
  const state = store.readThreadDistillState(threadId);
  expect(state.distilled_through).toBe(0);
  expect(state.distilled_through_turn).toBe(-1);
}

// ─── new: inserts (machine, cross-thread, thread:<id> provenance, stable id) ───

test("op:new inserts a machine cross-thread fact with thread provenance and returns a stable id", () => {
  const store = freshStore();
  const t = store.createThread();

  const r = applyFactOp(store, {
    op: "new",
    fact: "User's name is Lior",
    canonical: "user name is lior",
    topics: ["#about-user"],
    provenance: `thread:${t}`,
  }, "agent");

  expect(r.outcome).toBe("inserted");
  expect(r.factId).toBeDefined();

  const facts = store.readDistilledFacts(50);
  expect(facts.length).toBe(1);
  expect(facts[0]!.id).toBe(r.factId!);
  expect(facts[0]!.fact).toBe("User's name is Lior");
  expect(facts[0]!.authored_by).toBe("machine");
  expect(facts[0]!.scope).toBe("cross-thread");
  expect(facts[0]!.provenance).toBe(`thread:${t}`);

  assertNoDistillSideEffects(store, t);
  store.close();
});

// ─── new: exact-dup → deduped, no insert ───────────────────────────────────────

test("op:new exact-duplicate canonical → deduped, no second row inserted", () => {
  const store = freshStore();
  const t = store.createThread();

  store.insertFact({
    fact: "Lior likes coffee",
    canonical: "lior likes coffee",
    provenance: `thread:${t}`,
    scope: "cross-thread",
    expiry: null,
    confidence: 1,
    authored_by: "machine",
    topics: [],
  }, "seed");

  const r = applyFactOp(store, {
    op: "new",
    fact: "Lior likes coffee",
    canonical: "lior likes coffee",
    topics: [],
    provenance: `thread:${t}`,
  }, "agent");

  expect(r).toEqual({ outcome: "deduped" });
  expect(store.readDistilledFacts(50).length).toBe(1);

  assertNoDistillSideEffects(store, t);
  store.close();
});

// ─── replace: matching expectedTargetText → id stable + replaced_facts recorded ─

test("op:replace with matching expectedTargetText keeps id stable and records replaced text", () => {
  const store = freshStore();
  const t = store.createThread();

  const id = store.insertFact({
    fact: "favorite color blue",
    canonical: "favorite color blue",
    topics: [],
    provenance: `thread:${t}`,
    scope: "cross-thread",
    expiry: null,
    confidence: 1,
    authored_by: "machine",
  }, "seed");

  const r = applyFactOp(store, {
    op: "replace",
    fact: "favorite color red",
    canonical: "favorite color red",
    topics: [],
    provenance: `thread:${t}`,
    targetId: id,
    expectedTargetText: "favorite color blue",
  }, "agent");

  expect(r).toEqual({ outcome: "replaced", factId: id });

  const facts = store.readDistilledFacts(50);
  expect(facts.length).toBe(1);
  expect(facts[0]!.id).toBe(id);
  expect(facts[0]!.fact).toBe("favorite color red");

  const replaced = store.readReplacedFacts(id);
  expect(replaced.map((x) => x.replaced_text)).toContain("favorite color blue");

  assertNoDistillSideEffects(store, t);
  store.close();
});

// ─── replace: mismatched expectedTargetText → demoted (competing insert; original untouched) ──

test("op:replace with mismatched expectedTargetText demotes to a competing insert; original untouched", () => {
  const store = freshStore();
  const t = store.createThread();

  const id = store.insertFact({
    fact: "Lior likes coffee",
    canonical: "lior likes coffee",
    topics: [],
    provenance: `thread:${t}`,
    scope: "cross-thread",
    expiry: null,
    confidence: 1,
    authored_by: "machine",
  }, "seed");

  const r = applyFactOp(store, {
    op: "replace",
    fact: "Lior prefers tea over coffee",
    canonical: "lior prefers tea",
    topics: [],
    provenance: `thread:${t}`,
    targetId: id,
    expectedTargetText: "STALE TEXT THAT DOES NOT MATCH",
  }, "agent");

  expect(r.outcome).toBe("demoted-inserted");
  expect(r.factId).toBeDefined();
  expect(r.factId).not.toBe(id);

  const facts = store.readDistilledFacts(50);
  expect(facts.length).toBe(2);
  expect(facts.some((f) => f.id === id && f.fact === "Lior likes coffee")).toBe(true);
  expect(facts.some((f) => f.fact === "Lior prefers tea over coffee")).toBe(true);

  assertNoDistillSideEffects(store, t);
  store.close();
});

// ─── replace: targeting a human row → demoted (never overwrites human) ─────────

test("op:replace targeting a human-authored fact demotes to a competing insert; human fact unchanged", () => {
  const store = freshStore();
  const t = store.createThread();

  const humanId = store.insertFact({
    fact: "Lior's birthday is June 1",
    canonical: "lior birthday june 1",
    topics: [],
    provenance: `thread:${t}`,
    scope: "cross-thread",
    expiry: null,
    confidence: 1,
    authored_by: "human",
  }, "seed");

  const r = applyFactOp(store, {
    op: "replace",
    fact: "Lior's birthday is July 2",
    canonical: "lior birthday july 2",
    topics: [],
    provenance: `thread:${t}`,
    targetId: humanId,
    expectedTargetText: "Lior's birthday is June 1", // matches current text — only the human guard demotes
  }, "agent");

  expect(r.outcome).toBe("demoted-inserted");
  expect(r.factId).not.toBe(humanId);

  const facts = store.readDistilledFacts(50);
  expect(facts.some((f) => f.id === humanId && f.fact === "Lior's birthday is June 1" && f.authored_by === "human")).toBe(true);
  expect(facts.some((f) => f.fact === "Lior's birthday is July 2")).toBe(true);
  expect(facts.length).toBe(2);

  assertNoDistillSideEffects(store, t);
  store.close();
});

// ─── 2c chunk-01 review FIX 6: reason-string drift — the extracted replace must
// let each caller record ITS OWN reason (distiller: "distill-replace", port:
// "apply-replace"), restoring the pre-extraction behavior-preserving truth. ────

test("FIX6: op:replace with an explicit reason records THAT reason in replaced_facts", () => {
  const store = freshStore();
  const t = store.createThread();

  const id = store.insertFact({
    fact: "favorite color blue",
    canonical: "favorite color blue",
    topics: [],
    provenance: `thread:${t}`,
    scope: "cross-thread",
    expiry: null,
    confidence: 1,
    authored_by: "machine",
  }, "seed");

  applyFactOp(store, {
    op: "replace",
    fact: "favorite color red",
    canonical: "favorite color red",
    topics: [],
    provenance: `thread:${t}`,
    targetId: id,
    expectedTargetText: "favorite color blue",
    reason: "distill-replace",
  }, "distiller-v2");

  const replaced = store.readReplacedFacts(id);
  expect(replaced.length).toBe(1);
  expect(replaced[0]!.reason).toBe("distill-replace");

  store.close();
});

test("FIX6: op:replace with NO explicit reason defaults to 'apply-replace' (the port's reason)", () => {
  const store = freshStore();
  const t = store.createThread();

  const id = store.insertFact({
    fact: "favorite color blue",
    canonical: "favorite color blue",
    topics: [],
    provenance: `thread:${t}`,
    scope: "cross-thread",
    expiry: null,
    confidence: 1,
    authored_by: "machine",
  }, "seed");

  applyFactOp(store, {
    op: "replace",
    fact: "favorite color red",
    canonical: "favorite color red",
    topics: [],
    provenance: `thread:${t}`,
    targetId: id,
    expectedTargetText: "favorite color blue",
  }, "agent");

  const replaced = store.readReplacedFacts(id);
  expect(replaced.length).toBe(1);
  expect(replaced[0]!.reason).toBe("apply-replace");

  store.close();
});

// ─── append: within cap → appended + merged canonical searchable ──────────────

test("op:append within cap appends the item and merges canonical so an earlier term still finds the fact", () => {
  const store = freshStore();
  const t = store.createThread();

  const id = store.insertFact({
    fact: "User enjoys hiking",
    canonical: "user enjoys hiking",
    topics: [],
    provenance: `thread:${t}`,
    scope: "cross-thread",
    expiry: null,
    confidence: 1,
    authored_by: "machine",
  }, "seed");

  const r = applyFactOp(store, {
    op: "append",
    fact: "swimming",
    canonical: "swimming",
    topics: [],
    provenance: `thread:${t}`,
    targetId: id,
    expectedTargetText: "User enjoys hiking",
  }, "agent");

  expect(r).toEqual({ outcome: "appended", factId: id });

  const facts = store.readDistilledFacts(50);
  expect(facts.length).toBe(1);
  expect(facts[0]!.fact).toBe("User enjoys hiking; swimming");

  const hikingCandidates = store.fetchCandidates("hiking");
  expect(hikingCandidates.map((c) => c.id)).toContain(id);
  const swimmingCandidates = store.fetchCandidates("swimming");
  expect(swimmingCandidates.map((c) => c.id)).toContain(id);

  assertNoDistillSideEffects(store, t);
  store.close();
});

// ─── append: over cap → demote-insert ──────────────────────────────────────────

test("op:append over the append-list cap demotes to a competing insert", () => {
  const store = freshStore();
  const t = store.createThread();

  // Seed a fact already AT the append cap (8 items — see APPEND_LIST_CAP).
  const id = store.insertFact({
    fact: "a; b; c; d; e; f; g; h",
    canonical: "a b c d e f g h",
    topics: [],
    provenance: `thread:${t}`,
    scope: "cross-thread",
    expiry: null,
    confidence: 1,
    authored_by: "machine",
  }, "seed");

  const r = applyFactOp(store, {
    op: "append",
    fact: "i",
    canonical: "i",
    topics: [],
    provenance: `thread:${t}`,
    targetId: id,
    expectedTargetText: "a; b; c; d; e; f; g; h",
  }, "agent");

  expect(r.outcome).toBe("demoted-inserted");
  expect(r.factId).not.toBe(id);

  const facts = store.readDistilledFacts(50);
  // Original untouched
  expect(facts.some((f) => f.id === id && f.fact === "a; b; c; d; e; f; g; h")).toBe(true);
  // Competing insert landed
  expect(facts.some((f) => f.fact === "i")).toBe(true);
  expect(facts.length).toBe(2);

  assertNoDistillSideEffects(store, t);
  store.close();
});

// ─── memory-fix-pass D4: REPLACE re-stamps provenance to the replacing thread ──

test("D4: op:replace flips provenance to the replacing thread; replaced_facts keeps old text", () => {
  const store = freshStore();
  const threadA = store.createThread();
  const threadB = store.createThread();
  const id = store.insertFact({
    fact: "eyes are green", canonical: "eyes are green", topics: [],
    provenance: `thread:${threadA}`, scope: "cross-thread", expiry: null,
    confidence: 1, authored_by: "machine",
  }, "seed");

  const r = applyFactOp(store, {
    op: "replace", fact: "eyes are blue", canonical: "eyes are blue", topics: [],
    provenance: `thread:${threadB}`, targetId: id, expectedTargetText: "eyes are green",
  }, "agent");

  expect(r).toEqual({ outcome: "replaced", factId: id });
  expect(store.readFactById(id)!.provenance).toBe(`thread:${threadB}`); // was thread:A pre-fix (RED)
  expect(store.readReplacedFacts(id).map((x) => x.replaced_text)).toContain("eyes are green"); // history intact
  store.close();
});

// ─── chunk-05 (D1): cross-path dedup — tool canonical (user-language) vs
//     distiller canonical (English keyword) must still collapse to ONE fact ──
test("chunk-05 D1: tool-remembered fact + distiller re-derivation (ENGLISH canonical, case-variant display) ⇒ ONE fact, not a sibling", () => {
  const store = freshStore();
  const t = store.createThread();

  // 1. Tool-remember shape: the port has NO LLM, so canonical = normalizeFactText(display) — USER-LANGUAGE.
  const toolFact = "Мій улюблений напій - чай";
  applyFactOp(store, {
    op: "new",
    fact: toolFact,
    canonical: normalizeFactText(toolFact), // "мій улюблений напій - чай"
    topics: [],
    provenance: `thread:${t}`,
  }, "agent");
  expect(store.readDistilledFacts(50).length).toBe(1);

  // 2. Distiller re-derivation at dismiss: the smart distiller emits a LOWERCASED ENGLISH
  //    canonical (smart-distiller-provider.ts:117) with a case-variant user-language display.
  const r = applyFactOp(store, {
    op: "new",
    fact: "мій улюблений напій - чай",           // case-variant display (lowercase м)
    canonical: "user's favorite drink is tea",   // ENGLISH keyword — the real distiller shape
    topics: [],
    provenance: `thread:${t}`,
  }, "distiller-v2");

  expect(r.outcome).toBe("deduped");                    // PRE-FIX: "inserted" (the D1 bug)
  expect(store.readDistilledFacts(50).length).toBe(1);  // PRE-FIX: 2 (the case-dup)

  store.close();
});
