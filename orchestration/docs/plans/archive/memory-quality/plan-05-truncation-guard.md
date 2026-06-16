# Smart-distiller truncation guard (MINOR-3 livelock fix) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the smart-distiller livelock by throwing a *distinct* truncation error on `stop_reason:"max_tokens"` (never parsing the partial JSON), routing it through chunk-02's never-drop failure path with a distinct `trigger="reprojection-truncated"`, and raising `SMART_MAX_TOKENS` as runway (not cure).

**Architecture:** Two files. `smart-distiller-provider.ts` gains a `stop_reason` check after the Haiku call (before `parseFacts`) that throws a flagged `SmartDistillError`, plus a higher `SMART_MAX_TOKENS`. `distiller-registration.ts`'s `recordReprojectionFailure` gains an optional `trigger` param (default `"reprojection-failed"`, preserving chunk-02's contract byte-for-byte); the Phase-1 catch inspects the error and passes `"reprojection-truncated"` only for the truncation case, any other error keeps the default. The change is additive (free-text `distillation_events.trigger` column → no schema migration) and preserves the never-drop invariant.

**Tech Stack:** TypeScript on Bun; `@anthropic-ai/sdk` (Haiku, `claude-haiku-4-5`); `bun:sqlite` via `MemoryStore`; tests with `bun test`.

---

## Reality check

Read both source files and the spec at current HEAD (chunk 04 already merged). Confirmed shapes:

**`packages/daemon/src/memory/providers/smart-distiller-provider.ts`:**
- `SMART_MAX_TOKENS` is defined and **exported** at line 33: `export const SMART_MAX_TOKENS = 1024;` — current value **1024**, as the brief claims. Used at line 342 as `max_tokens: SMART_MAX_TOKENS`.
- `SMART_MODEL = "claude-haiku-4-5"` (line 32). Distiller calls `client.messages.create({ model, max_tokens, thinking:{type:"disabled"}, system, messages })` at lines 340–346.
- After the call, the code extracts text from the first text block (lines 349–355), **then** calls `parseFacts(rawText)` at line 358. **There is no `stop_reason` check anywhere** — confirmed. This is the defect: on `stop_reason:"max_tokens"` the body is truncated mid-JSON, `parseFacts` throws a generic `SmartDistillError("...not valid JSON...")`, which is indistinguishable from a real malformed-LLM response and routes to `reprojection-failed`.
- `SmartDistillError` is a class **defined in this file** (lines 62–67): `class SmartDistillError extends Error` with only a `message` arg; it sets `this.name = "SmartDistillError"`. It carries **no flag/kind today** — it is a bare `Error` subclass. It is **exported** and imported by the test file (line 18).
- Chunk 04's changes are present and confined to the suppression layers: `_getForgottenSuppression` (lines 406–423, reads `forgotten_facts`), Layer-X system-prompt injection (lines 329–338), Layer-T/Layer-P post-filters (lines 371–391), and the `retrieve()` backstop (lines 436–449). **None of chunk-04's logic is near the Haiku call site or `parseFacts`** — no logic collision with this chunk's `stop_reason` guard. §7.1 re-validation note (below) confirmed: 04 = suppression layers, 05 = stop_reason guard, disjoint regions of `distill()`.

**`packages/daemon/src/memory/distiller-registration.ts`:**
- `recordReprojectionFailure` is a **local closure** inside `doOneRun` (lines 64–72), not an exported function. Current signature: `(err: unknown, phase: string): void`. Body: reads surviving MACHINE projection size (`SELECT COUNT(*) ... WHERE authored_by != 'human'`), writes one event row per `dismissedThreadIds` via `store.insertDistillationEvent(id, "reprojection-failed", currentSize, provider.id)` — **the trigger is the hard-coded literal `"reprojection-failed"` at line 69** — then `console.error`.
- It is called from three catch blocks: Phase 1 distill (line 79, `"provider.distill"`), Phase 2 scan (line 103), Phase 3 replaceProjection (line 120). Each rethrows after recording.
- **The truncation→trigger mapping must happen at the Phase-1 catch only** (line 78–81), because only `provider.distill` can throw the truncation error. Phases 2/3 cannot produce a truncation error, so they keep the default.

**`store.insertDistillationEvent`** (store.ts:613): `(threadId, trigger, factsProduced, distillerVersion)` — `trigger` is a plain `string` written into the free-text `distillation_events.trigger` column (store.ts:616). Adding the value `"reprojection-truncated"` requires **no schema migration** — confirmed.

**`stop_reason` field shape (authoritative — `claude-api` skill):** `stop_reason` is a **top-level field on the response object** (`response.stop_reason`); the `"max_tokens"` value means the output hit the cap and "output may be incomplete." This is model-agnostic on the Messages API and applies to `claude-haiku-4-5`. (Code path exists; the runtime API value is documented, not demonstrated here — but this chunk's tests stub the client to *return* `stop_reason:"max_tokens"`, so the guard's behavior is verified mechanically without a live call.)

**Contradictions with the brief:** none. Every claim (cap=1024, no stop_reason check, generic-error livelock, hard-coded `reprojection-failed`, free-text column) is confirmed against HEAD.

**Behavioral-fact caveat (PIPELINE §6.1):** the chunk's DoD is entirely **[mechanical]** — there is no behavioral/UI criterion. The full feature-closing live demo is chunk 06. So nothing here requires a "requires runtime demo to confirm" tag; the `stop_reason` guard is verified by a stub that *returns* `max_tokens`, which exercises the production code path end-to-end except the real network call (the only permitted stub per spec §6 / Strike-4).

---

## ADR worthy: no

The chunk says NO new ADR and I find no frozen-contract conflict:
- **Additive trigger value** in the free-text `distillation_events.trigger` column → no schema migration (confirmed store.ts:616).
- **Optional param** on a *local closure* (`recordReprojectionFailure`) with a default that preserves chunk-02's exact behavior → no public-surface change.
- **Frozen surfaces untouched:** `@agentic/protocol` and `mock-agent.ts` are not in scope and stay byte-unchanged.
- This **implements** accepted ADR-0012 decision 5b ("Distillation is explicit, visible, and recoverable — never a silent best-effort") and spec §2 D-E / §5 q#006 ruling. The truncation-livelock is exactly the silent-corruption failure 5b forbids; the distinct `reprojection-truncated` event makes the wall observable. Implementing an accepted decision is not itself ADR-worthy.

The §7.1 flag (behavioral change to chunk-02's failure handler) is already raised in the chunk + spec and is handled by the never-drop regression test (Task 3); it is a *decompose flag*, not an ADR trigger.

---

## Design decisions (the three forks the brief flagged)

**1. How the catch distinguishes a truncation error from a generic parse/LLM error.**
**Decision: a boolean flag (`truncated: true`) on `SmartDistillError`, set via an optional constructor arg.** Not a subclass.
- Rationale: minimal (the chunk says "keep it minimal"). `SmartDistillError` is already the single error type the whole `distill()` path throws. A boolean discriminant is one line on the existing class and one `instanceof SmartDistillError && err.truncated` check in the catch — no new exported symbol, no widening of the import surface in tests, no `instanceof` chain ordering concerns. A subclass would also work but adds an exported type and a second `instanceof` the catch must order *before* the base check — more surface for the same discriminating power.
- Shape: `class SmartDistillError extends Error { readonly truncated: boolean; constructor(message: string, opts?: { truncated?: boolean }) { super(message); this.name = "SmartDistillError"; this.truncated = opts?.truncated ?? false; } }`. Existing call sites (`new SmartDistillError("...")` in `parseFacts`) keep working unchanged — `truncated` defaults to `false`, so generic parse errors correctly route to `reprojection-failed`.
- ☆ Alternative: dedicated subclass `SmartDistillTruncationError` — plus: nominal typing reads slightly clearer at the throw site; minus: extra exported symbol + the catch's `instanceof` checks must be ordered subclass-first (a subclass *is* a `SmartDistillError`), a foot-gun the flag avoids. Rejected for minimality.

**2. The exact `trigger` param shape on `recordReprojectionFailure`.**
**Decision:** add a **third positional optional param with a default literal**: `recordReprojectionFailure(err: unknown, phase: string, trigger: string = "reprojection-failed")`. The Phase-1 catch passes `"reprojection-truncated"` *only* when `err` is a truncation error; every other call site (Phase 1 non-truncation, Phase 2, Phase 3) omits the third arg and gets the unchanged default. Inside the closure, line 69's hard-coded `"reprojection-failed"` literal is replaced with the `trigger` param.
- Who passes the truncated value: the **Phase-1 catch block** (lines 78–81), which is the only catch that can see a truncation error. It computes the trigger inline: `const trigger = err instanceof SmartDistillError && err.truncated ? "reprojection-truncated" : "reprojection-failed";` then calls `recordReprojectionFailure(err, "provider.distill", trigger)`.
- Rationale: a defaulted trailing positional param means Phases 2 and 3 are byte-unchanged (no regression risk to chunk-02's contract). Keep the closure *dumb* (it just writes whatever trigger it's handed) and do the `instanceof` decision in the catch. This keeps the truncation knowledge at the one site that has the error in hand and keeps the helper a pure writer.

**3. New `SMART_MAX_TOKENS` value.**
**Decision: `4096`.** Rationale stated plainly in code + here: this is a **runway extension, NOT the cure**. At O(total archive) global re-projection (spec §3.3 D8), the JSON fact-array output grows monotonically and will eventually re-hit any fixed cap; the real fix is the future summarization tier (spec §1, out of scope). 4096 is the bottom of the spec's 4096–8192 band — chosen deliberately conservative because (a) it 4×'s the headroom (1024→4096), (b) Haiku output is billed per token so the higher *cap* costs nothing until actually needed, and (c) a lower cap still trips the now-correct guard sooner, surfacing the named summarization-tier trigger earlier rather than masking it behind a giant cap.

---

## File Structure

- **Modify** `packages/daemon/src/memory/providers/smart-distiller-provider.ts`
  - `SMART_MAX_TOKENS`: `1024` → `4096`, with a runway-not-cure comment.
  - `SmartDistillError`: add optional `truncated` flag.
  - `distill()`: after `client.messages.create(...)` and before text extraction / `parseFacts`, add a `stop_reason === "max_tokens"` guard that throws `new SmartDistillError("...", { truncated: true })`. Do **not** read/parse the response content on this branch.
- **Modify** `packages/daemon/src/memory/distiller-registration.ts`
  - `recordReprojectionFailure`: add `trigger: string = "reprojection-failed"` param; use it at the `insertDistillationEvent` call.
  - Phase-1 catch: compute `"reprojection-truncated"` vs default by `instanceof SmartDistillError && err.truncated`, pass as third arg.
  - Import `SmartDistillError` from `./providers/smart-distiller-provider.js`.
- **Modify** `packages/daemon/src/memory/providers/smart-distiller-provider.test.ts` — add Task-1 tests.
- **Modify** `packages/daemon/src/memory/distiller-registration.test.ts` — add Task-2 + Task-3 tests.

No new files; no new dependencies; frozen surfaces untouched.

> **Worker note (orchestrator):** the test snippets below are illustrative. Adapt them to the ACTUAL existing test-helper signatures in each file (`freshStore()` return shape, `echoClient`/stub helpers, the variable name the production code assigns `client.messages.create(...)` to). TDD RED→GREEN is the contract; the exact helper plumbing follows the file you find at HEAD.

---

## Tasks

### Task 1: `stop_reason` guard throws a distinct truncation error (provider unit)

**Files:**
- Test: `packages/daemon/src/memory/providers/smart-distiller-provider.test.ts`
- Modify: `packages/daemon/src/memory/providers/smart-distiller-provider.ts`

- [ ] **Step 1: Write the failing test.** Add a stub client returning `stop_reason:"max_tokens"` AND a syntactically-broken partial JSON body (proves the guard keys off `stop_reason` and does NOT depend on the body being parseable). One test: `distill` throws a `SmartDistillError` with `.truncated === true`. A second test: an ordinary parse failure (no `stop_reason`, non-JSON body) throws a `SmartDistillError` with `.truncated === false`. Adapt to the file's existing `freshStore()`/`echoClient` helpers.

```typescript
/** Stub that returns stop_reason:"max_tokens" plus a TRUNCATED (mid-array) JSON body. */
function maxTokensClient(): Anthropic {
  return {
    messages: {
      create: async () => ({
        stop_reason: "max_tokens",
        content: [{ type: "text", text: '[{"fact":"a","provenance":"p","scope":"cross-thread"' }],
      }),
    },
  } as unknown as Anthropic;
}

test("stop_reason guard: max_tokens throws a SmartDistillError flagged truncated (partial body NOT parsed)", async () => {
  const store = freshStore();
  const threadId = store.createThread();
  store.appendMessages(threadId, [{ role: "user", content: "hello" }], "s1");
  const provider = new SmartDistillerProvider({ client: maxTokensClient() });
  let caught: unknown;
  try { await provider.distill(store, threadId); } catch (e) { caught = e; }
  expect(caught).toBeInstanceOf(SmartDistillError);
  expect((caught as SmartDistillError).truncated).toBe(true);
  store.close();
});

test("SmartDistillError.truncated defaults to false for ordinary parse failures", async () => {
  const store = freshStore();
  const threadId = store.createThread();
  store.appendMessages(threadId, [{ role: "user", content: "hello" }], "s1");
  const provider = new SmartDistillerProvider({ client: echoClient("This is not JSON at all!") });
  let caught: unknown;
  try { await provider.distill(store, threadId); } catch (e) { caught = e; }
  expect(caught).toBeInstanceOf(SmartDistillError);
  expect((caught as SmartDistillError).truncated).toBe(false);
  store.close();
});
```

- [ ] **Step 2: Run test, verify it FAILS.** `bun test packages/daemon/src/memory/providers/smart-distiller-provider.test.ts -t "stop_reason guard"`. Expected FAIL: today no guard, so the body reaches `parseFacts` → generic `SmartDistillError`, `.truncated` is `undefined`, so `toBe(true)` fails.

- [ ] **Step 3: Add the `truncated` flag to `SmartDistillError`** (replace the class):

```typescript
export class SmartDistillError extends Error {
  /** True only for the output-truncation case (stop_reason:"max_tokens").
   *  Lets the Phase-1 catch route truncation to a DISTINCT trigger
   *  ("reprojection-truncated") vs a generic parse/LLM failure
   *  ("reprojection-failed"). Defaults false so existing throw sites
   *  (parseFacts) keep the generic-failure routing. */
  readonly truncated: boolean;
  constructor(message: string, opts?: { truncated?: boolean }) {
    super(message);
    this.name = "SmartDistillError";
    this.truncated = opts?.truncated ?? false;
  }
}
```

- [ ] **Step 4: Add the `stop_reason` guard in `distill()`** immediately after the `client.messages.create(...)` call and BEFORE text extraction / `parseFacts` (use the actual variable the result is assigned to):

```typescript
    // Output-truncation guard (ADR-0012 5b — distillation must be observable, never
    // silent corruption; spec §2 D-E / q#006). The fact set (LLM OUTPUT) grows
    // monotonically with the archive (global re-projection, O(total archive), D8);
    // once it outgrows max_tokens the JSON is truncated mid-array. Do NOT parse the
    // partial body — throw a DISTINCT truncation error so chunk-02's Phase-1 catch can
    // route it to trigger="reprojection-truncated" (the NAMED trigger for the future
    // summarization tier, spec §1) instead of the generic "reprojection-failed".
    if (response.stop_reason === "max_tokens") {
      throw new SmartDistillError(
        "[smart-distiller] LLM output hit the SMART_MAX_TOKENS cap (stop_reason=max_tokens); " +
          "the fact JSON is truncated. Not parsing the partial body. Raising the cap is runway, " +
          "not a cure — at O(total archive) the cap is eventually re-hit; the real fix is the " +
          "summarization tier (out of scope).",
        { truncated: true },
      );
    }
```

- [ ] **Step 5: Run the tests, verify PASS.** `bun test packages/daemon/src/memory/providers/smart-distiller-provider.test.ts` — new tests + all pre-existing smart tests green.

- [ ] **Step 6: Commit.**
```bash
git add packages/daemon/src/memory/providers/smart-distiller-provider.ts \
        packages/daemon/src/memory/providers/smart-distiller-provider.test.ts
git commit -m "feat(memory-quality): smart-distiller stop_reason guard throws flagged truncation error (chunk 05, MINOR-3)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `recordReprojectionFailure` gains a `trigger` param; Phase-1 catch maps truncation (registration unit)

**Files:**
- Test: `packages/daemon/src/memory/distiller-registration.test.ts`
- Modify: `packages/daemon/src/memory/distiller-registration.ts`

- [ ] **Step 1: Write the failing tests.** Import `SmartDistillError`. Three tests, each driving `hook.dismiss([t])` through `registerDistiller` with a fake `MemoryProvider`:
  1. provider throws `new SmartDistillError("truncated at cap", { truncated: true })` → a `reprojection-truncated` event row is written, NO `reprojection-failed`; prior MACHINE projection byte-intact (never-drop); `facts_produced` = surviving machine size.
  2. provider throws a plain `new Error("network blip")` → still `reprojection-failed`, NO `reprojection-truncated`.
  3. provider throws `new SmartDistillError("not valid JSON")` (no flag) → still `reprojection-failed`.

```typescript
import { SmartDistillError } from "./providers/smart-distiller-provider.js";

test("Phase-1 truncation error → distinct trigger='reprojection-truncated' (never-drop preserved)", async () => {
  const { store } = freshStore();
  const hook = new ConsolidationHook(store);
  store.insertDistilledFacts(
    [{ fact: "prior machine fact", provenance: "thread:prior", scope: "cross-thread", expiry: null, confidence: 1, authored_by: "machine" }],
    "smart",
  );
  const truncatingProvider: MemoryProvider = {
    id: "smart",
    distill: async () => { throw new SmartDistillError("truncated at cap", { truncated: true }); },
    retrieve: async () => [],
  };
  registerDistiller(hook, store, truncatingProvider, new RuleBasedScanner());
  const t = store.createThread();
  const errSpy = spyOn(console, "error").mockImplementation(() => {});
  try { await hook.dismiss([t]); } catch { /* rethrow expected */ }
  expect(errSpy).toHaveBeenCalled();
  errSpy.mockRestore();
  const evs = store.readDistillationEvents(t);
  expect(evs.some((e) => e.trigger === "reprojection-truncated")).toBe(true);
  expect(evs.some((e) => e.trigger === "reprojection-failed")).toBe(false);
  const facts = store.readDistilledFacts(50);
  expect(facts.some((f) => f.fact === "prior machine fact")).toBe(true);
  const truncEv = evs.find((e) => e.trigger === "reprojection-truncated")!;
  expect(truncEv.facts_produced).toBe(1);
  store.close();
});

test("non-truncation failure still writes 'reprojection-failed' (chunk-02 default unchanged)", async () => {
  const { store } = freshStore();
  const hook = new ConsolidationHook(store);
  const plainFailProvider: MemoryProvider = {
    id: "smart",
    distill: async () => { throw new Error("network blip"); },
    retrieve: async () => [],
  };
  registerDistiller(hook, store, plainFailProvider, new RuleBasedScanner());
  const t = store.createThread();
  const errSpy = spyOn(console, "error").mockImplementation(() => {});
  try { await hook.dismiss([t]); } catch { /* expected */ }
  errSpy.mockRestore();
  const evs = store.readDistillationEvents(t);
  expect(evs.some((e) => e.trigger === "reprojection-failed")).toBe(true);
  expect(evs.some((e) => e.trigger === "reprojection-truncated")).toBe(false);
  store.close();
});

test("a non-truncated SmartDistillError (generic parse failure) also keeps 'reprojection-failed'", async () => {
  const { store } = freshStore();
  const hook = new ConsolidationHook(store);
  const parseFailProvider: MemoryProvider = {
    id: "smart",
    distill: async () => { throw new SmartDistillError("not valid JSON"); },
    retrieve: async () => [],
  };
  registerDistiller(hook, store, parseFailProvider, new RuleBasedScanner());
  const t = store.createThread();
  const errSpy = spyOn(console, "error").mockImplementation(() => {});
  try { await hook.dismiss([t]); } catch { /* expected */ }
  errSpy.mockRestore();
  const evs = store.readDistillationEvents(t);
  expect(evs.some((e) => e.trigger === "reprojection-failed")).toBe(true);
  expect(evs.some((e) => e.trigger === "reprojection-truncated")).toBe(false);
  store.close();
});
```

- [ ] **Step 2: Run, verify the truncation test FAILS** (the two regression tests already PASS — intended; they guard the default). `bun test packages/daemon/src/memory/distiller-registration.test.ts -t "reprojection-truncated"`.

- [ ] **Step 3: Add the `trigger` param + Phase-1 mapping.**
  (a) Import: `import { SmartDistillError } from "./providers/smart-distiller-provider.js";`
  (b) Replace the `recordReprojectionFailure` closure:

```typescript
  // On any phase failure: read the surviving MACHINE projection size, write one event
  // row per dismissed thread, console.error, then the caller rethrows so index.ts logs
  // the non-fatal error. `trigger` defaults to chunk-02's "reprojection-failed"; the
  // Phase-1 catch passes "reprojection-truncated" for the output-truncation case so the
  // History distinguishes the truncation wall (spec §2 D-E) from a transient failure.
  // Additive: free-text distillation_events.trigger column → no schema migration.
  const recordReprojectionFailure = (
    err: unknown,
    phase: string,
    trigger: string = "reprojection-failed",
  ): void => {
    const currentSize = (store.rawDb()
      .query("SELECT COUNT(*) AS n FROM distilled_facts WHERE authored_by != 'human'")
      .get() as { n: number }).n;
    for (const id of dismissedThreadIds) {
      store.insertDistillationEvent(id, trigger, currentSize, provider.id);
    }
    console.error(`[distiller] ${phase} failed; existing projection preserved:`, err);
  };
```

  (c) Replace ONLY the Phase-1 catch:

```typescript
  } catch (err) {
    // Truncation (stop_reason:"max_tokens") → DISTINCT trigger; any other error keeps
    // the default. The truncation knowledge lives at the one site holding the error.
    const trigger =
      err instanceof SmartDistillError && err.truncated
        ? "reprojection-truncated"
        : "reprojection-failed";
    recordReprojectionFailure(err, "provider.distill", trigger);
    throw err; // surface so index.ts catch can log the non-fatal error
  }
```

  Leave the Phase-2 and Phase-3 catches **unchanged** (two-arg calls → default trigger).

- [ ] **Step 4: Run, verify PASS.** `bun test packages/daemon/src/memory/distiller-registration.test.ts` — all three new + every pre-existing registration test (chunk-02 failure-path tests still write `"reprojection-failed"`).

- [ ] **Step 5: Commit.**
```bash
git add packages/daemon/src/memory/distiller-registration.ts \
        packages/daemon/src/memory/distiller-registration.test.ts
git commit -m "feat(memory-quality): recordReprojectionFailure gains trigger param; map truncation to reprojection-truncated (chunk 05)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Raise `SMART_MAX_TOKENS` runway + end-to-end never-drop on the truncated path (integration)

**Files:**
- Test: `packages/daemon/src/memory/distiller-registration.test.ts`
- Modify: `packages/daemon/src/memory/providers/smart-distiller-provider.ts`

This ties the two halves through the **real** registration → store path with only the LLM client stubbed (spec §6 / Strike-4). The end-to-end test is the headline never-drop guard the §7.1 note mandates: prior projection byte-intact + truncated event row written + rethrow, with a *real* `SmartDistillerProvider` (not a hand-thrown error) reaching the guard via a stubbed `max_tokens` response.

- [ ] **Step 1: Write the failing E2E test.** Import the real `SmartDistillerProvider`. Seed a prior projection with 1 machine + 1 human fact; build the provider with a `max_tokens`-returning Anthropic stub; `registerDistiller`; append a message to a fresh thread; `hook.dismiss([t])`. Assert: error rethrown, BOTH prior facts byte-intact, `reprojection-truncated` row written, NO `reprojection-failed`.

```typescript
import { SmartDistillerProvider } from "./providers/smart-distiller-provider.js";

function maxTokensAnthropic() {
  return {
    messages: {
      create: async () => ({
        stop_reason: "max_tokens",
        content: [{ type: "text", text: '[{"fact":"x","provenance":"p"' }],
      }),
    },
  } as unknown as import("@anthropic-ai/sdk").Anthropic;
}

test("E2E never-drop on truncation: real SmartDistillerProvider + stubbed max_tokens → prior projection intact, reprojection-truncated written, error rethrown", async () => {
  const { store } = freshStore();
  const hook = new ConsolidationHook(store);
  store.insertDistilledFacts(
    [{ fact: "machine fact M", provenance: "thread:m", scope: "cross-thread", expiry: null, confidence: 1, authored_by: "machine" }],
    "smart",
  );
  store.rawDb().query(
    "INSERT INTO distilled_facts (id, fact, provenance, scope, expiry, confidence, authored_by, derived_at, distiller_version) VALUES (?,?,?,?,?,?,?,?,?)",
  ).run(crypto.randomUUID(), "human fact H", "thread:h", "cross-thread", null, 1, "human", Date.now(), "manual");
  const provider = new SmartDistillerProvider({ client: maxTokensAnthropic() });
  registerDistiller(hook, store, provider, new RuleBasedScanner());
  const t = store.createThread();
  store.appendMessages(t, [{ role: "user", content: "trigger a re-projection" }], "s1");
  const errSpy = spyOn(console, "error").mockImplementation(() => {});
  let caught: unknown = null;
  try { await hook.dismiss([t]); } catch (err) { caught = err; }
  expect(errSpy).toHaveBeenCalled();
  errSpy.mockRestore();
  expect(caught).not.toBeNull();
  const facts = store.readDistilledFacts(50);
  expect(facts.some((f) => f.fact === "machine fact M")).toBe(true);
  expect(facts.some((f) => f.fact === "human fact H")).toBe(true);
  const evs = store.readDistillationEvents(t);
  expect(evs.some((e) => e.trigger === "reprojection-truncated")).toBe(true);
  expect(evs.some((e) => e.trigger === "reprojection-failed")).toBe(false);
  store.close();
});
```
  (Adapt the human-fact seed to the actual `distilled_facts` column set + any `freshStore()` helper that already inserts human facts. If `crypto`/`Date.now` are awkward in the test harness, reuse whatever the file already does to seed a human fact.)

- [ ] **Step 2: Run, verify PASS** (Tasks 1+2 committed → guard fires + catch maps). `bun test packages/daemon/src/memory/distiller-registration.test.ts -t "E2E never-drop on truncation"`. The RED-without-the-guard relationship is already demonstrated by Task-1/Task-2 RED steps.

- [ ] **Step 3: Raise `SMART_MAX_TOKENS` (runway, not cure)** — replace the const + add the comment:

```typescript
/**
 * Cap on the LLM OUTPUT (the JSON fact array). RUNWAY, NOT A CURE.
 * The fact set grows monotonically with the archive (global re-projection is
 * O(total archive), spec §3.3 D8), so ANY fixed cap is eventually re-hit. Raising
 * it (1024 → 4096) buys dogfood headroom; the stop_reason guard in distill() makes
 * the wall OBSERVABLE and NON-CORRUPTING (trigger="reprojection-truncated"), which is
 * the NAMED trigger for the future summarization tier (spec §1, out of scope) — the
 * actual fix. Do not treat a higher cap as the solution.
 */
export const SMART_MAX_TOKENS = 4096;
```

- [ ] **Step 4: Verify the cap raise didn't break existing smart tests.** `bun test packages/daemon/src/memory/providers/smart-distiller-provider.test.ts` — existing tests assert on facts/triggers, not the `max_tokens` value.

- [ ] **Step 5: Full-suite + gates.** Each must exit 0:
  - `bun test`
  - `bun run lint:strict`
  - `bun run typecheck`
  Frozen surfaces byte-unchanged (sanity check, expect empty):
  - `git diff --stat -- packages/protocol/src` and the `mock-agent.ts` path → empty.

- [ ] **Step 6: Commit.**
```bash
git add packages/daemon/src/memory/providers/smart-distiller-provider.ts \
        packages/daemon/src/memory/distiller-registration.test.ts
git commit -m "feat(memory-quality): raise SMART_MAX_TOKENS to 4096 (runway) + E2E never-drop-on-truncation test (chunk 05)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## §7.1 coupling (re-validate at integration)

- `recordReprojectionFailure` is chunk-02's failure handler. The change is **additive**: a new trigger *value* (`"reprojection-truncated"`) in the existing free-text `distillation_events.trigger` column → **no schema migration**. The never-drop invariant is preserved: the truncated path still goes through the Phase-1 catch, never calls `replaceProjection`, so the prior projection stays byte-intact (Task 3 asserts this end-to-end with a real provider).
- **Chunk-02 contract preserved:** the pre-existing registration failure-path tests are untouched and still assert `"reprojection-failed"` — Task 2's defaulted param guarantees this; Task 2 Step 4 re-runs the whole file.
- **Chunk-04 re-validation:** chunk 04 (merged) touched `smart-distiller-provider.ts` only in the suppression layers — all in regions of `distill()` disjoint from the new `stop_reason` guard and disjoint from `SmartDistillError`/`SMART_MAX_TOKENS`. **No logic collision** (04 = suppression layers, 05 = stop_reason guard). The full `smart-distiller-provider.test.ts` run (Task 1 Step 5, Task 3 Step 4) is the integration re-validation: all chunk-04 Layer-T/5e/backstop tests must stay green alongside the new guard tests.

## Self-review

- **Spec coverage (§2 D-E, §5 q#006):** stop_reason guard → Task 1; throws a flagged truncation `SmartDistillError` → Task 1; routes through Phase-1 catch / `recordReprojectionFailure` with distinct `reprojection-truncated` → Task 2; `recordReprojectionFailure` gains `trigger` param (default unchanged) → Task 2; raise `SMART_MAX_TOKENS` as runway → Task 3; never-drop on truncated path (prior projection intact + truncated row + rethrow) → Tasks 2 + 3; existing smart tests + suite green → Task 3 Step 5. All DoD `[mechanical]` items mapped. No `[behavioral]` item this chunk (chunk 06 owns the demo).
- **Type consistency:** `SmartDistillError.truncated: boolean` everywhere; `recordReprojectionFailure(err, phase, trigger?)` third param `string` defaulting to `"reprojection-failed"`; `insertDistillationEvent(threadId, trigger, factsProduced, distillerVersion)` matches store.ts; `SMART_MAX_TOKENS = 4096`.

## Status: Done
