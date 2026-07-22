# memory-fix-pass — post-2d demo findings (D1-lang · D2 · D4) + mechanical tail — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this task-by-task. Steps use `- [ ]` checkboxes.

**Goal:** Land the 4 routed post-2d fixes (backlog §D-post): D4 provenance-on-REPLACE, D1-lang + D2 prompt steering, and the 3-item mechanical tail — all mechanical, no behavioral demo gate.

**Architecture:** Daemon-internal only. D4 rides the single shared `applyFactOp` replace seam + the `updateFactById` store primitive (covers BOTH distiller and tool paths at once). D1-lang/D2 are prompt-asset edits to the capability-PRESENT self-concept + the `memory_remember` tool description only. The tail is three independent behavior-identical refactors/guards.

**Tech Stack:** Bun + TypeScript, `bun:test`, bun:sqlite, onnxruntime-web (already installed).

## Global Constraints

- **No new runtime dependencies.** (ADR gate — none needed here.)
- **Frozen surfaces byte-unchanged:** `@agentic/protocol` and the mock reducer. No step touches them.
- **Capability-ABSENT system prompt byte-identical to pre-change** — do NOT edit `MEMORY_SELF_CONCEPT` / `COMPOSED_SYSTEM_PROMPT`. Only `MEMORY_SELF_CONCEPT_WITH_ACTIONS` (which the SEARCH variant composes from automatically).
- **Language-agnostic wording** — name NO specific language anywhere (Lior 2026-07-14 positioning ruling). Canonical stays English by design (distiller key — untouched).
- **5e human-fact protection untouched** — D4 affects machine-fact replaces only (`applyFactOp` already demotes human targets to `new`; `editFactById` is a separate primitive and stays as-is).
- **OUT (deliberate §7.2 scope cut — do NOT build):** query-pool dilution above-cap, 7-seq-calls vs 30s handshake, O2/O3 observations, Memory-window replace-history render. Watch-only.
- **Gates (all must pass):** `bun run typecheck` (0), `bun run lint:strict` (0), `bun test` (green — incl. embedding degrade tests), frozen-surface `git diff` empty.

---

## Reality check
*(Grounded in reading the real files at HEAD. Behavioral claims flagged "requires test to confirm" — code-reading is not runtime proof.)*

**Seam 1 — D4 (provenance on REPLACE):**
- Both write paths converge on ONE seam. The distiller passes `provenance = "thread:${threadId}"` to `applyFactOp` (`distiller-registration.ts:179,223`); the tool path passes `provenance = "thread:${ctx.threadId}"` (`memory-action-port.ts:203,253`). So `applyFactOp`'s `input.provenance` is ALREADY the *replacing* thread for both.
- `applyFactOp`'s replace lane (`apply-fact-op.ts:90-98`) calls `store.updateFactById(targetId, { ...base }, …)` where `base = { fact, canonical, topics, confidence }` — **provenance is NOT passed**.
- `updateFactById` (`store.ts:1098-1118`) `UPDATE distilled_facts SET fact, confidence, distiller_version, derived_at` — **does NOT write `provenance`.** ⇒ on REPLACE the row keeps the ORIGINAL thread's provenance. This is the D4 defect. Fixing `applyFactOp` + `updateFactById` covers BOTH paths (verified single seam). *Requires the RED-first test to confirm the observable value flips A→B.*
- **⚠️ Correction to the chunk/ruling wording (load-bearing, reconciled to frozen ADR-0012 §4 + Lior option A):** the chunk says "prior value+provenance is already recorded via `replaced_facts`" and the RED test says "replaced_facts row carries A + old text." **The `replaced_facts` table has NO provenance column** — schema is `id, fact_id, replaced_text, actor, reason, created_at` (`schema.ts:155-162`; `recordReplacedFact` `store.ts:1085-1089`). It records the prior **text** only. This is exactly consistent with ADR-0012 §4 ("a REPLACE records the replaced fact's **text** — a destructive change is visible and recoverable, never silent", line 174-175) and with Lior's **option A** (chain = option B, declined). So the D4 test asserts **old TEXT in `replaced_facts` + new provenance = B**; it must NOT assert an old-provenance column (there isn't one), and we must NOT add one (that would be option B, declined). The original thread attribution is intentionally not separately chained — Lior's ruling.
- History-ordering is already safe: `updateFactById`'s tx runs `recordReplacedFact` (old text) BEFORE the `UPDATE`. The fix must keep that order (append provenance to the SAME UPDATE, do not reorder).

**Seam 2 — D1-lang / D2 (steering):**
- `composeSystemPrompt(false)` returns `COMPOSED_SYSTEM_PROMPT` byte-for-byte; `(true[, false])` returns `COMPOSED_SYSTEM_PROMPT_WITH_ACTIONS`; `(true, true)` appends the search addendum (`system-prompt.ts:132-135`). A dedicated byte-identical test already exists (`system-prompt.test.ts:253`). Editing only the WITH_ACTIONS constant keeps the absent variant byte-identical and auto-propagates into the SEARCH variant (composed from WITH_ACTIONS).
- The `memory_remember` tool description already says "in the user's own language" twice (`memory-action-tools.ts:59,66`) — D1-lang is a *strengthening* of existing text, not net-new. `memory-action-tools.test.ts` asserts only structure (names/kinds/schema/required), NOT byte-exact description strings — so tightening the description breaks no existing test. *Requires new substring tests to confirm the strengthened wording.*
- Behavioral effect (LLM actually mirroring language / not acting unprompted) is LLM-fuzzy — proven in daily dogfood, NOT in this pass (chunk DoD item 5: no demo gate). Tests are prompt-content substring assertions only.

**Seam 3 — mechanical tail:**
- **3a predicate:** the visibility rule is duplicated. `store.readDistilledFactsForThread` phase-2 (`store.ts:617-634`) filters expiry-in-SQL + thread-local-in-code via `originThreadsForProvenance`. `MemoryActionPort.search` fact-leg (`memory-action-port.ts:313-318`) re-checks expiry + thread-local inline. Both consume `DistilledFactRow` (store candidates; `readFactById` return, `store.ts:1225-1228`). Extractable into ONE `MemoryStore.isFactVisibleToThread(row, threadId, now)` — behavior-identical (SQL pre-filter makes the predicate's expiry check a no-op at the store call site). *Requires existing 5f/search suites staying green to confirm behavior preserved.*
- **3b doWarmup:** `warmup()` single-flights via `this.loading` and resets it to `null` in `finally` (`local-wasm-embedding-provider.ts:57-65`). A SECOND sequential `warmup()` after the first completed sees `loading===null` → calls `doWarmup()` again → builds a second `InferenceSession` (`:67-83`, no `ready` guard). `embed()` already guards concurrent races; the gap is sequential post-ready re-warm. Fix = `if (this.ready) return;` at the top of `doWarmup`. *Requires the spy-count test to confirm.*
- **3c arg-parse:** `const SUITE = suiteArg === "--suite=2d" ? "2d" : "core"` (`memory-demo-harness.ts:70-71`) is fail-OPEN: any `--suite=<other>` silently → core (the 2026-07-21 confusion). Absent flag defaulting to core is documented/intended (`:25-28`) and stays. The harness runs its body on import (no `import.meta.main` guard), so a testable seam needs a tiny extracted pure helper. Tests in `scripts/` ARE discovered by `bun test` (precedent: `scripts/backfill-embeddings.test.ts`).

**No open questions.** All rulings pre-taken (D4 = option A; D1-lang; D2). Nothing blocks; not routing anything to Lior.

---

## Steps

### Task 1: D4 — REPLACE flips provenance to the replacing thread

**Files:**
- Modify: `packages/daemon/src/memory/store.ts` (`UpdateFactInput` ~L42-47; `updateFactById` ~L1098-1118)
- Modify: `packages/daemon/src/memory/apply-fact-op.ts` (replace lane ~L90-98)
- Test: `packages/daemon/src/memory/apply-fact-op.test.ts`, `packages/daemon/src/memory/memory-action-port.daemon.test.ts`, `packages/daemon/src/memory/store.test.ts`

**Interfaces:**
- Produces: `UpdateFactInput.provenance?: string` (optional; when omitted, provenance is left unchanged — protects existing callers + keeps `editFactById` separation).

- [ ] **Step 1 — Write the failing test (shared seam).** In `apply-fact-op.test.ts`:
```ts
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
```
*(Adapt seed/helper names to the real store API — `insertFact`/`readReplacedFacts` shapes must match what exists; if a helper is missing, use the smallest existing equivalent. The assertion contract is fixed: provenance flips to B, old text survives in `replaced_facts`.)*

- [ ] **Step 2 — Run it, verify RED.** `bun test packages/daemon/src/memory/apply-fact-op.test.ts` → the provenance assertion FAILS (`thread:${threadA}` returned).

- [ ] **Step 3 — Implement.** In `store.ts`, add optional field to `UpdateFactInput`:
```ts
export interface UpdateFactInput {
  fact: string;
  canonical: string;
  confidence: number;
  topics: string[];
  provenance?: string; // D4 (memory-fix-pass): when set, REPLACE re-stamps provenance to the replacing thread; omitted ⇒ unchanged.
}
```
In `updateFactById`, keep `recordReplacedFact` BEFORE the UPDATE (unchanged), and branch the UPDATE on provenance:
```ts
this.recordReplacedFact(id, prior.fact, ctx);
if (u.provenance !== undefined) {
  this.db.query(
    "UPDATE distilled_facts SET fact = ?, confidence = ?, distiller_version = ?, derived_at = ?, provenance = ? WHERE id = ?",
  ).run(u.fact, u.confidence, distillerVersion, Date.now(), u.provenance, id);
} else {
  this.db.query(
    "UPDATE distilled_facts SET fact = ?, confidence = ?, distiller_version = ?, derived_at = ? WHERE id = ?",
  ).run(u.fact, u.confidence, distillerVersion, Date.now(), id);
}
```
In `apply-fact-op.ts` replace lane, pass provenance through:
```ts
store.updateFactById(
  targetId,
  { ...base, provenance: input.provenance }, // D4: re-stamp provenance to the replacing thread
  { actor, reason: input.reason ?? "apply-replace" },
  actor,
);
```

- [ ] **Step 4 — Verify GREEN.** `bun test packages/daemon/src/memory/apply-fact-op.test.ts` → PASS.

- [ ] **Step 5 — Add the tool-path test (proves the seam covers `replaces_ordinal`).** In `memory-action-port.daemon.test.ts`, seed a machine fact with `provenance: thread:A`, build a turn ctx `{ threadId: B, ordinalMap: Map([[1, id]]), actionsUsed: 0 }`, call `port.remember(ctx, { fact: "<changed value>", replaces_ordinal: 1, expected_text: "<old>" })`, then assert `store.readFactById(id)!.provenance === "thread:B"`. Run → PASS (rides the same fix). *(Use the real ctx shape from the existing port tests.)*

- [ ] **Step 6 — Add the store-primitive guard test.** In `store.test.ts`: (a) `updateFactById` WITH `provenance` sets it; (b) WITHOUT `provenance` leaves the prior value unchanged. Run → PASS (guards existing callers + the `editFactById` provenance-immutability contract, `store.ts:1131`).

- [ ] **Step 7 — Commit.** `git add -A && git commit -m "fix(memory): D4 — REPLACE re-stamps provenance to the replacing thread (machine facts); replaced_facts keeps old text"`

---

### Task 2: D1-lang + D2 steering (capability-PRESENT lane only)

**Files:**
- Modify: `packages/daemon/src/providers/system-prompt.ts` (`MEMORY_SELF_CONCEPT_WITH_ACTIONS` ~L84-104)
- Modify: `packages/daemon/src/providers/memory-action-tools.ts` (`memory_remember` description ~L57-71)
- Test: `packages/daemon/src/providers/system-prompt.test.ts`, `packages/daemon/src/providers/memory-action-tools.test.ts`

- [ ] **Step 1 — Write the failing prompt-content tests.** In `system-prompt.test.ts`, add a describe block:
```ts
describe("memory-fix-pass §D-post: D1-lang + D2 steering (capability-PRESENT only)", () => {
  const present = composeSystemPrompt(true).toLowerCase();

  test("D1-lang: present prompt steers language mirroring (language-agnostic)", () => {
    expect(present).toContain("same language the user used");
    expect(present).toContain("mirror the user's language");
    expect(present).toContain("never switch to a different language");
  });

  test("D2: present prompt forbids unprompted cleanup (propose-then-consent)", () => {
    expect(present).toContain("only change memory the user actually asked");
    expect(present).toContain("do not forget or rewrite them on your own");
    expect(present).toContain("ask whether to clean it up");
    expect(present).toContain("act only after they agree");
  });

  test("capability-ABSENT prompt carries NEITHER steering (byte-identity guard)", () => {
    const absent = composeSystemPrompt(false).toLowerCase();
    expect(absent).not.toContain("same language the user used");
    expect(absent).not.toContain("do not forget or rewrite them on your own");
    // and the standing byte-identity test at :253 still asserts === COMPOSED_SYSTEM_PROMPT
  });

  test("names NO specific language (positioning ruling)", () => {
    for (const w of ["ukrainian", "english", "українськ", "spanish", "german"]) {
      expect(present).not.toContain(w);
    }
  });
});
```
In `memory-action-tools.test.ts`:
```ts
test("D1-lang: memory_remember description steers same-language storage (language-agnostic)", () => {
  expect(MEMORY_ACTION_TOOLS.memory_remember.description.toLowerCase()).toContain("same language the user used");
});
```
*(Substring literals must match the implemented clause byte-for-byte, lowercased. If the worker adjusts wording in Step 3, update these assertions in lockstep — the CONTRACT is: language-mirroring + no-unprompted-cleanup present in the capability-present prompt, absent from the capability-absent one, no specific language named.)*

- [ ] **Step 2 — Run, verify RED.** `bun test packages/daemon/src/providers/system-prompt.test.ts packages/daemon/src/providers/memory-action-tools.test.ts` → new tests FAIL (substrings absent).

- [ ] **Step 3 — Implement the prompt clauses.** In `system-prompt.ts`, insert into `MEMORY_SELF_CONCEPT_WITH_ACTIONS` immediately BEFORE the `'The user can always view, edit, and delete …'` line:
```ts
  'Always write the facts you remember, and your replies, in the same language the user used in their most recent message — mirror the user\'s language and never switch to a different language on your own. ' +
  'Only change memory the user actually asked you to change this turn. If you notice other remembered facts that look wrong, duplicated, or contradictory, do not forget or rewrite them on your own — tell the user what you noticed and ask whether to clean it up, and act only after they agree. ' +
```
In `memory-action-tools.ts`, tighten `memory_remember`: change the description phrase `"is the note text in the user's own language."` → `"is the note text, written in the same language the user used in this turn."` and the `fact` property description `"The fact text to remember, in the user's language."` → `"The fact text to remember, in the same language the user used in this turn."`
*(Keep the existing q#014-E boundary text intact; this ADDS steering, does not remove honesty clauses.)*

- [ ] **Step 4 — Verify GREEN + no regressions.** `bun test packages/daemon/src/providers/` → all PASS, including the pre-existing `composeSystemPrompt(false) === COMPOSED_SYSTEM_PROMPT` (`:253`), the WITH_ACTIONS composition-formula test (`:261`), and the AND_SEARCH `startsWith(WITH_ACTIONS)` test (`:314`).

- [ ] **Step 5 — Commit.** `git add -A && git commit -m "fix(memory): D1-lang + D2 steering — mirror user's language, no unprompted memory cleanup (capability-present lane only)"`

---

### Task 3: Mechanical tail (3 independent fixes)

**Files:**
- Modify: `packages/daemon/src/memory/store.ts` (new `isFactVisibleToThread`; refactor `readDistilledFactsForThread`)
- Modify: `packages/daemon/src/memory/memory-action-port.ts` (search fact-leg ~L304-319)
- Modify: `packages/daemon/src/memory/embedding/local-wasm-embedding-provider.ts` (`doWarmup` ~L67)
- Create: `packages/daemon/scripts/harness-args.ts`; Modify: `packages/daemon/scripts/memory-demo-harness.ts` (~L70-72)
- Test: `packages/daemon/src/memory/store.test.ts`, new `packages/daemon/src/memory/embedding/local-wasm-embedding-provider.test.ts`, new `packages/daemon/scripts/harness-args.test.ts`

**Interfaces:**
- Produces: `MemoryStore.isFactVisibleToThread(row: DistilledFactRow, threadId: string, now: number): boolean`
- Produces: `resolveSuite(args: string[]): "core" | "2d"` (throws `Error` on unknown `--suite=` value)

#### 3a — `isFactVisibleToThread` extraction (behavior-identical)

- [ ] **Step 1 — Characterization test.** In `store.test.ts`:
```ts
test("isFactVisibleToThread: cross-thread/global/null visible; expired hidden; thread-local only from origin", () => {
  const store = freshStore();
  const now = Date.now();
  const base = { id: "x", fact: "f", confidence: 1, authored_by: "machine" } as const;
  expect(store.isFactVisibleToThread({ ...base, scope: "cross-thread", provenance: "thread:A", expiry: null } as any, "B", now)).toBe(true);
  expect(store.isFactVisibleToThread({ ...base, scope: null, provenance: "thread:A", expiry: null } as any, "B", now)).toBe(true);
  expect(store.isFactVisibleToThread({ ...base, scope: "cross-thread", provenance: "thread:A", expiry: now - 1 } as any, "B", now)).toBe(false);
  expect(store.isFactVisibleToThread({ ...base, scope: "thread-local", provenance: "thread:A", expiry: null } as any, "B", now)).toBe(false);
  expect(store.isFactVisibleToThread({ ...base, scope: "thread-local", provenance: "thread:A", expiry: null } as any, "A", now)).toBe(true);
  store.close();
});
```
*(Match the real `DistilledFactRow` shape + provenance encoding used by `originThreadsForProvenance`.)*

- [ ] **Step 2 — Run, verify RED.** Method undefined → FAIL.

- [ ] **Step 3 — Implement + refactor both call sites.** Add to `MemoryStore`:
```ts
/** Shared fact-visibility predicate (5f + expiry) — ONE rule for readDistilledFactsForThread AND
 *  MemoryActionPort.search (memory-fix-pass; kills the drift the chunk-05 reviewer flagged).
 *  Visible iff not expired AND (scope cross-thread/global/unknown OR thread-local with an origin
 *  thread == threadId). Behavior-identical to both prior inline copies. */
isFactVisibleToThread(row: DistilledFactRow, threadId: string, now: number): boolean {
  if (row.expiry !== null && row.expiry <= now) return false;
  const scope = row.scope ?? "cross-thread";
  if (scope === "thread-local") {
    return this.originThreadsForProvenance(row.provenance ?? "").includes(threadId);
  }
  return true;
}
```
Replace `readDistilledFactsForThread` phase-2 loop (keep the SQL expiry pre-filter + ordering):
```ts
const filtered: DistilledFactRow[] = [];
for (const row of candidates) {
  if (this.isFactVisibleToThread(row, forThreadId, now)) filtered.push(row);
  if (filtered.length >= limit) break;
}
return filtered;
```
Replace the `memory-action-port.ts` search fact-leg inline expiry+scope block (`:313-318`) with:
```ts
if (row === null) continue; // deleted mid-turn
if (!this.store.isFactVisibleToThread(row, ctx.threadId, Date.now())) continue; // 5f + expiry (shared predicate)
results.push(this.toHit("fact", "remembered fact", row.fact));
```
*(Preserve the exact prior semantics at each call site — the SQL pre-filter + ordering in the store path, the `row === null` deleted-mid-turn guard in the port path. If the real code's variable names differ, match them; behavior must be identical.)*

- [ ] **Step 4 — Verify GREEN + behavior preserved.** `bun test packages/daemon/src/memory/store.test.ts packages/daemon/src/memory/memory-action-port.daemon.test.ts` → all existing 5f / search-isolation suites PASS untouched + the new characterization test PASSES.

- [ ] **Step 5 — Commit.** `git commit -am "refactor(memory): extract shared isFactVisibleToThread predicate (store + port search); behavior-identical"`

#### 3b — `doWarmup` ready early-exit

- [ ] **Step 6 — Failing spy test.** Create `packages/daemon/src/memory/embedding/local-wasm-embedding-provider.test.ts`:
```ts
import { test, expect, spyOn } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as ort from "onnxruntime-web";
import { XlmRobertaTokenizer } from "./tokenizer.js";
import { LocalWasmEmbeddingProvider } from "./local-wasm-embedding-provider.js";

test("doWarmup early-exits when already ready — a second warmup builds no second InferenceSession", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "warmup-guard-"));
  const modelDir = join(dataDir, "models", "multilingual-e5-small");
  mkdirSync(join(modelDir, "onnx"), { recursive: true });
  writeFileSync(join(modelDir, "tokenizer.json"), "{}");
  writeFileSync(join(modelDir, "onnx", "model_quantized.onnx"), "stub");

  const createSpy = spyOn(ort.InferenceSession, "create").mockImplementation(async () => ({} as unknown as ort.InferenceSession));
  const tokSpy = spyOn(XlmRobertaTokenizer, "fromFile").mockImplementation(async () => ({} as unknown as XlmRobertaTokenizer));
  try {
    const p = new LocalWasmEmbeddingProvider({ dataDir });
    await p.warmup();
    await p.warmup(); // second, post-ready — must NOT rebuild
    expect(createSpy).toHaveBeenCalledTimes(1); // RED (pre-fix): 2
  } finally {
    createSpy.mockRestore();
    tokSpy.mockRestore();
  }
});
```
*(Adapt the constructor options + model-dir layout + mocked symbol names to what the real provider actually loads. The CONTRACT: two sequential `warmup()` calls ⇒ exactly one `InferenceSession.create`.)*

- [ ] **Step 7 — Run, verify RED.** `bun test packages/daemon/src/memory/embedding/local-wasm-embedding-provider.test.ts` → `create` called 2×.

- [ ] **Step 8 — Implement.** First line inside `doWarmup` (before `try`):
```ts
private async doWarmup(): Promise<void> {
  if (this.ready) return; // early-exit: a prior warmup already built the session (backlog §D-post)
  try {
```

- [ ] **Step 9 — Verify GREEN.** Re-run Step 7 command → `create` called 1×. Also `bun test packages/daemon/src/memory/embedding/` → degrade suite green.

- [ ] **Step 10 — Commit.** `git commit -am "fix(embedding): doWarmup early-exit when already ready (no second InferenceSession)"`

#### 3c — demo-harness arg-parse fail-closed

- [ ] **Step 11 — Failing helper test.** Create `packages/daemon/scripts/harness-args.test.ts`:
```ts
import { test, expect } from "bun:test";
import { resolveSuite } from "./harness-args.js";

test("resolveSuite: unknown --suite value throws (fail-closed, no silent core)", () => {
  expect(() => resolveSuite(["--suite=bogus"])).toThrow("unknown --suite");
});
test("resolveSuite: absent flag defaults to core (documented default preserved)", () => {
  expect(resolveSuite([])).toBe("core");
});
test("resolveSuite: valid values pass through", () => {
  expect(resolveSuite(["--suite=2d"])).toBe("2d");
  expect(resolveSuite(["--suite=core"])).toBe("core");
});
```

- [ ] **Step 12 — Run, verify RED.** `bun test packages/daemon/scripts/harness-args.test.ts` → module missing / fails.

- [ ] **Step 13 — Implement.** Create `packages/daemon/scripts/harness-args.ts`:
```ts
/** Fail-closed --suite parse for memory-demo-harness (backlog §D-post): an unknown value ERRORS
 *  instead of silently running the core suite (the 2026-07-21 --suite=2d-on-main confusion).
 *  Absent flag → "core" (the documented default). */
export function resolveSuite(args: string[]): "core" | "2d" {
  const suiteArg = args.find((a) => a.startsWith("--suite="));
  if (suiteArg === undefined) return "core";
  const val = suiteArg.slice("--suite=".length);
  if (val !== "core" && val !== "2d") {
    throw new Error(`unknown --suite value "${val}" (expected: core | 2d)`);
  }
  return val;
}
```
In `memory-demo-harness.ts`, replace lines ~70-72 with:
```ts
import { resolveSuite } from "./harness-args.js"; // (add to the import block at top)
// … at the CLI-args site:
let SUITE: "core" | "2d";
try {
  SUITE = resolveSuite(args);
} catch (err) {
  console.error(`[demo-harness] FATAL: ${err instanceof Error ? err.message : String(err)}. Refusing to silently run the core suite.`);
  process.exit(1);
}
console.log(`[demo-harness] suite: ${SUITE}`);
```
(Leave `--mode=` parsing unchanged — out of scope. Match the real arg-source variable name — `args` may be `process.argv.slice(2)` or similar.)

- [ ] **Step 14 — Verify GREEN.** `bun test packages/daemon/scripts/harness-args.test.ts` → PASS. Manual sanity (optional): `bun run packages/daemon/scripts/memory-demo-harness.ts --suite=bogus` exits non-zero with the FATAL line before booting.

- [ ] **Step 15 — Commit.** `git commit -am "fix(harness): fail-closed --suite parse (unknown value errors, no silent core)"`

---

### Task 4: Full gates

- [ ] **Step 1 — Typecheck.** `bun run typecheck` → 0 errors.
- [ ] **Step 2 — Lint strict.** `bun run lint:strict` → 0 warnings.
- [ ] **Step 3 — Full test.** `bun test` → green (includes embedding degrade tests + all 5f/search suites).
- [ ] **Step 4 — Frozen-surface diff.** `git diff --stat main -- packages/protocol` → empty; confirm the mock reducer file unchanged. (No step touched them.)
- [ ] **Step 5 — Commit any lint fixups**, push the `chunk/memory-fix-pass-01` branch, open PR per crawl §11.4 (conductor re-verifies + merges on all-green). PR body notes: drains the memory-fix-pass folder; queue head next = 2e thread-forget.

---

## ADR worthy: no

- **D4** is a routed demo-finding with the semantic already ruled by Lior (AskUserQuestion 2026-07-22, option A). It is consistent with the existing ADR-0012 provenance model ("every fact carries provenance to its source; a REPLACE records the replaced fact's **text**", §4 line 174-175) and does NOT reopen it — option B (a provenance chain) was explicitly declined, so no superseding decision is created. Fact source-independence (ADR-0012 rider) is untouched: provenance *attribution* ≠ fact *lifecycle*.
- **D1-lang / D2** are prompt-asset steering edits inside the ADR-0016 capability-present lane — no new tool, plane, or wire change.
- **Tail** items are internal refactors/guards (no dependency, protocol, or boundary change). ADR-0017's embedding lane is unchanged in shape.
- **Closeout doc note (NOT an ADR):** at merge, update `memory-backlog.md §D-post` — mark D4 resolved (option A: provenance follows the replacing thread; `replaced_facts` keeps prior **text** only, old-thread chain intentionally not built), and mark the `isFactVisibleToThread` / arg-parse / doWarmup items done. This is doc-curator/ledger reconciliation, not a new ADR.

## Status: Implementation + review COMPLETE — ready-to-merge (conductor merges per crawl §11.4)

- Tasks 1–3 implemented RED-first (commits `3b437cd`, `112e788`, `b06a523`, `789f71f`, `0ff5843`, lint-fixup `da328e8`).
- Gates (orchestrator-verified, command evidence): `typecheck` 0 · `lint:strict` 0 · `bun test` **815 pass / 0 fail** (80 files; +14 new tests over main's 801) · frozen `packages/protocol` byte-unchanged · no reducer/mock in diff.
- `engine-reviewer` vs `main`: **0 blockers** (all 4 seams confirmed; 1 non-blocking Nit = D2-sentence vs passing-change REPLACE, LLM-fuzzy dogfood-watch, no change required).
- All DoD items MECHANICAL — no behavioral demo gate (chunk DoD item 5; reviewer confirmed daemon-internal, no UI/wire surface).
- **Post-merge (conductor):** archive chunk + plan (§4.4), reconcile `memory-backlog.md §D-post` (D4 resolved = option A; `isFactVisibleToThread` / `doWarmup` / arg-parse done), queue head → 2e thread-forget.
