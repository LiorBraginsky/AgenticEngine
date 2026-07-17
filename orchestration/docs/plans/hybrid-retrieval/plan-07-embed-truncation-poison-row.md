# Chunk hybrid-retrieval/07 — embed truncation + poison-row isolation (demo-found defect D3) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this task-by-task. Steps use checkbox (`- [ ]`) syntax. All test-cycle steps follow `superpowers:test-driven-development`: red → green → commit.

**Goal:** Make write-time embedding survive a real archive that contains an over-length message: truncate encoded inputs to the model's 512-position window at the tokenizer seam, and isolate any still-failing row inside the drain so one poison row never nulls its batch or wedges the drain — restoring embedding on Lior's real store (D3, live failure 2026-07-16).

**Architecture:** Daemon-side only, entirely within `packages/daemon/src/memory/embedding/`. Truncation is a pure, model-family-local cap in the tokenizer seam (`tokenizer.ts`). Failure isolation + non-starvation live in the stateless drain (`embedding-drain.ts`) — deliberately NOT in `embed()`, to keep the ADR-0017-fixed `EmbeddingProvider` port contract byte-unchanged (see `## Approaches`). No ranker / port / wire / store-signature change.

**Tech Stack:** TypeScript on Bun 1.3.x, `bun:sqlite`, `@lenml/tokenizers@3.7.2` (XLM-R tokenizer seam), `onnxruntime-web@1.27.0` (model `Xenova/multilingual-e5-small`, 512 positions, dims 384). CI has no model — all new tests run against a fixture/test-double at the provider seam.

## Global Constraints

- **Docs are truth.** Authority = accepted spec `orchestration/docs/specs/2026-07-13-hybrid-retrieval.md` (§0.1 local-WASM lane; §3.3 D3 drain design) + `ADR-0017` (accepted 2026-07-14; binding) + the chunk file `orchestration/chunks-todo/hybrid-retrieval/07-embed-truncation-poison-row.md` (frozen yardstick — Scope + DoD) + the chunk-03 conductor-reviewer MINOR (PR #99) + the quoted live failure.
- **`EmbeddingProvider.embed()` contract is FROZEN and byte-unchanged.** `embed(texts): Promise<Float32Array[] | null>`; `null` = the WHOLE call unavailable; NEVER throws (spec §3.2 D2a; ADR-0017 decision 1; `embedding-provider.ts:18-20`). This chunk does NOT widen it (see `## Approaches` / `## ADR worthy`).
- **No product-behavior change outside the embedding path.** Ranker (`hybrid-ranker.ts`), all provider ports, and the wire stay untouched (chunk DoD, `[mechanical]`). Frozen surfaces byte-unchanged: `@agentic/protocol`, the mock reducer.
- **No new dependency.** No chunking, no retry-queue, no persisted failure marker, no new external surface (chunk anti-gold-plating). Small chunk (~half day).
- **CI reality:** the full suite MUST stay green with NO embedding provider / no model present; CI never downloads the model. The real-model truncation proof is an EXPLICIT, mechanical backfill run (Task 3), not a CI test and not a new behavioral gate.
- **Commands:** tests `bun test <path>`; typecheck `bun run typecheck`; lint `bun run lint:strict` (0 warnings); repo-wide `bun test`. Branch `chunk/hybrid-07-embed-truncation-poison-row`; never commit on `main`. Commit per task with trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## Reality check (§6.1 — anchors re-read from current source; no runtime fact asserted from code-reading)

Every anchor below was read this pass. Structural (code-path-exists) facts are stated plainly; every BEHAVIORAL/runtime claim is marked **[requires runtime/test confirmation]** — code-reading and prior PASS records are not evidence (PIPELINE §6.1).

**Seam 1 — truncation (`packages/daemon/src/memory/embedding/tokenizer.ts`):**
- `fromFile` (`:29-33`) builds with `TokenizerLoader.fromPreTrained({ tokenizerJSON, tokenizerConfig: {} })` — **the config is literally empty**, so no `model_max_length` and no truncation option reaches the tokenizer.
- `encode` (`:38-41`) returns `{ inputIds: encoded.input_ids, attentionMask: encoded.attention_mask }` with **no cap** — the full token sequence is returned regardless of length. (Structural.)
- `local-wasm-embedding-provider.ts embedOne` (`:163-199`) builds `input_ids`/`attention_mask`/`token_type_ids` tensors of shape `[1, seqLen]` where `seqLen = inputIds.length` (`:167,:169-171`), then `session.run` (`:173`). The model has 512 position embeddings.
- **Runtime consequence** — an input over 512 positions makes `session.run` throw an ORT broadcast error («512 by 25308»), and `embed()`'s outer catch (`:155-160`) turns that into a whole-batch `null`. This is **the observed live failure of 2026-07-16** (quoted verbatim in the chunk `## Provenance`) — cited as observed runtime evidence, not asserted here.
- The model's own `tokenizer_config.json` declares `model_max_length: 512` (recorded in plan-03 Reality check line 45), but because `tokenizerConfig: {}` is passed, that value is not loaded — so the fix uses a **named constant** (`= 512`) with a comment, per chunk item 1 ("read from config if available, else a named constant").
- **Note:** `local-wasm-embedding-provider.ts` needs NO change for truncation — `embedOne` consumes whatever `encode()` returns, so capping inside `encode()` upstream fixes it. Truncation stays fully in the tokenizer seam (the file the top-of-file comment already designates as "the one place naming the concrete lib").

**Seam 2 — the item-2 return-type question (THE critical design question; resolved):**
- The port is `embed(texts: string[]): Promise<Float32Array[] | null>` (`embedding-provider.ts:20`). The doc comment `:18-20` is explicit: *"NEVER throws — any I/O/inference failure resolves to `null` for the WHOLE call."* The element type is non-null `Float32Array`. Spec §3.2 D2a and ADR-0017 decision 1 fix the same shape.
- **`null` is BATCH-level, not element-level.** The current type does **NOT** accommodate a per-element skip. Skip-and-record (the chunk's stated preference over zero-vector) at the `embed()` seam would require WIDENING the return to `(Float32Array | null)[] | null` — a change to the ADR-0017-fixed + spec-frozen port contract AND to a "port" the chunk DoD says must stay "untouched."
- **Consumer positional dependency (why widening ripples):** the drain relies on `pending[i] ↔ vectors[i]` and dereferences `vectors[i]!` (`embedding-drain.ts:117,:128`). A same-length array with a dropped element would misalign ids→vectors; the only in-contract same-length sentinel is a zero vector, which the chunk rejects (poisons cosine). So per-element skip and the frozen type are mutually exclusive.
- **Query-side consumers are already null-safe** and are NOT forced to change either way: `hybrid-ranker.ts:65-67` does `const embedded = await provider.embed([query]); const q = embedded?.[0]; if (!q) return [];` (guards batch-null AND element-falsy). `embed-probe.ts:43` and `fixture-embedding-provider.test.ts` use batch-level `!`. So the only consumer that assumes non-null elements is the drain — which is in-path.
- **Resolution (see `## Approaches`):** do NOT widen the port. Achieve the chunk's OBSERVABLE item-2 intent (poison row skipped, siblings embedded, drain proceeds, embedding not DEAD) by isolating at the drain. The port contract stays byte-identical.

**Seam 3 — the drain (`packages/daemon/src/memory/embedding/embedding-drain.ts`):**
- `drainOnce` (`:106-134`) has two near-identical legs. Facts: scan `pendingFactEmbeddings` (`:112`), `await provider.embed(...)` (`:114`), **`if (vectors === null) break;`** (`:115`), else upsert each (`:116-119`). Messages: same shape (`:122-131`), null-break `:126`.
- **The `break` on a null batch is exactly the defect's second half:** one poison row → whole batch `null` → `break` → the entire leg stops → every later pending row is left unembedded on each kick (chunk `## Provenance`: "blocks every later row each drain kick"). (Structural.)
- `pendingFactEmbeddings(modelId, limit)` / `pendingMessageEmbeddings(modelId, limit)` return the first `limit` pending rows (a row lacking a current-`model_id` vector) — "pending is a query" (`:16-24` doc). No exclusion-set param.
- The drain single-flight + rerun (`:82-104`) and `kick`/`stop` (`:50-72`) are untouched by this chunk.
- **Wedge risk if done naively:** a skip-and-leave-pending fix without an exclusion guard would make the inner `for(;;)` scan re-return the poison row forever (it stays pending) → infinite loop = a hung daemon. Task 2's design guards this (skipped-this-pass set + break-on-zero-progress). **[requires runtime/test confirmation]** via Task 2 test (c) (a wedge would hang → `bun test` timeout).

**Existing tests that must stay green** (`embedding-drain.test.ts`): null-provider no-op (`:47`), null-returning `embed()` leaves rows pending (`:60`), happy-path 3+2 (`:74`), scrub-mid-drain interleave (`:97`), restart-safety batchSize-2 (`:145`), kick debounce (`:184`), stop (`:201/:217`). The Task-2 `drainLeg` refactor is backward-compatible with all of these (traced in Task 2). **[requires runtime/test confirmation]** — re-run the suite.

**Backfill (`packages/daemon/scripts/backfill-embeddings.ts`):** `runBackfill(store, provider)` builds `message_fts` then runs `new EmbeddingDrain(store, provider).drain()` to completion (`:58-64`); reports `factsPendingAfter`/`messagesPendingAfter` (`:72-75`); the CLI (`:80-106`) prints `BACKFILL OK` iff pending-after is 0. This is the demo's step-2 command; Task 3 verifies it completes on a store with a >512-token message.

**Deviations from the chunk's "expected files":** the chunk brief's expected-files list named `local-wasm-embedding-provider.ts` (isolation) and implied `fixture-embedding-provider.ts`. This plan touches NEITHER: (1) truncation is upstream in `tokenizer.ts`, so `local-wasm-*` needs no change; (2) isolation is in the drain (Option E, port-preserving), so `embed()` is unchanged; (3) the poison test-double is a test-local provider (mirroring the existing `dyingProvider`/`nullEmbedProvider` doubles at `embedding-drain.test.ts:36,:156`), keeping the shared fixture clean. This narrower blast radius is deliberate and honors the DoD "ranker/ports untouched."

---

## Approaches (the item-2 return-type fork — the one genuine design decision)

**Option D — widen `embed()` to `Promise<(Float32Array | null)[] | null>` (isolate "in embed()", literal chunk item-2 reading).**
- Pros: cleanest semantics; a failed text is a per-element `null`; the drain just skips null elements; no batch re-embedding; matches the chunk's "skip marker for THAT text" wording literally.
- Cons: **reopens the ADR-0017-fixed + spec-§3.2-frozen port contract** and contradicts the port doc `:18-20` ("resolves to `null` for the WHOLE call"); **touches a "port," which the chunk DoD forbids** ("ranker/ports/wire untouched"); requires an ADR-0017 rider (§5.2 human gate) — disproportionate for a ~half-day demo-found bugfix on a plane accepted 3 days prior; ripples into the drain (`vectors[i]!` becomes a lie) and any future non-null-element assumption.
- ☆ This is the "clean-but-ceremony" path — it is genuinely defensible IF a stakeholder wants per-element semantics as a durable contract; then it is ADR-worthy (see below).

**Option E — keep the frozen port; isolate at the drain (RECOMMENDED).**
- Mechanism: on a `null` batch, retry the batch's texts one-at-a-time to isolate the offender; a text that still fails is recorded skipped-THIS-PASS (never a zero vector) and left pending; a batch that embeds nothing stops the leg (provider truly down, or all-poison). A per-pass `skipped` set filtered out of every subsequent scan guarantees progress + termination (non-starvation).
- Pros: **port contract byte-unchanged** (no ADR touch, no freeze/§5.2 gate); blast radius = `embedding-drain.ts` + tests only (+ `tokenizer.ts` for item 1); achieves the chunk's OBSERVABLE item-2 intent (siblings embed, drain proceeds, embedding not DEAD); fits "no change outside the embedding path" and "don't gold-plate."
- Cons: isolation lives in the drain, not literally in `embed()`; on a poison hit the first contaminated batch re-embeds its members singly (bounded — only the first batch containing each poison; ≤ hundreds of rows at dogfood scale); `embed()` still transiently nulls a contaminated batch (recovered by the drain) — i.e. Option E does not deliver the literal "embed() never nulls the batch," only the observable outcome.

**Chosen Approach: Option E.** Decisive because (1) ADR-0017 is binding and freshly accepted — reopening its decision-1 port shape for a bugfix needs a superseding ADR, which is disproportionate; (2) the chunk DoD's `[mechanical]` "ports untouched" gate outranks item-2's prose location-hint ("in embed()"); (3) item 1 (truncation) already removes the KNOWN poison cause, so item-2 isolation is defense-in-depth for residual failures — the drain is the right home for "skip this row, leave it pending"; (4) it keeps the whole change inside the embedding path with zero contract risk. **Loud flag (not silent coding-around):** if the orchestrator/Lior reads chunk item-2 as MANDATING per-element `null` in `embed()`, that is Option D → an ADR-0017 rider + a scope change → route back before executing. This plan proceeds on Option E.

---

## ADR worthy: no

The fix stays entirely within the accepted `EmbeddingProvider` contract: `embed()`'s return type (`Promise<Float32Array[] | null>`, ADR-0017 decision 1 / spec §3.2 D2a / `embedding-provider.ts:20`) is **byte-unchanged**; truncation is an internal implementation detail of the local-WASM adapter's tokenizer seam (already documented as swappable/family-specific in `tokenizer.ts`); isolation + non-starvation are drain internals; no new dependency, boundary, or wire/protocol surface. This is `§7.2` defect-routing, not new scope. **No new ADR, no ADR rider.**

**The one flag (per the chunk's critical design question):** the *alternative* Option D — widening `embed()` to `(Float32Array | null)[] | null` for true per-element isolation — WOULD require an ADR-0017 rider (it reopens the ADR-fixed port shape and touches a DoD-frozen port). It is **rejected here in favor of the in-contract Option E.** If Option D is later chosen, flip this to `ADR worthy: yes — recommended title: "ADR-0017 rider: EmbeddingProvider.embed() per-element skip semantics"` and route to `adr-curator`.

---

## File structure

**Modified (all in `packages/daemon/src/memory/embedding/`):**
- `tokenizer.ts` — add `MODEL_MAX_POSITIONS = 512` + a pure exported `truncateEncoding(...)` helper + comment; `encode()` returns the truncated encoding.
- `embedding-drain.ts` — refactor `drainOnce`'s two legs into a shared `drainLeg(scan, upsert)` that isolates poison rows (per-text retry on a null batch) and guarantees non-starvation (skipped-this-pass set + break-on-zero-progress); update the class doc-comment.

**New tests:**
- `packages/daemon/src/memory/embedding/tokenizer.test.ts` — item-4 test (a) (pure truncation cap).

**Modified tests:**
- `packages/daemon/src/memory/embedding/embedding-drain.test.ts` — item-4 tests (b) + (c) + a test-local `poisonBatchProvider` double.
- `packages/daemon/scripts/backfill-embeddings.test.ts` — item-5 store-shape wiring guard (fixture lane).

**Untouched (asserted):** `embedding-provider.ts` (the port), `local-wasm-embedding-provider.ts`, `fixture-embedding-provider.ts`, `hybrid-ranker.ts`, `store.ts`, all of `@agentic/protocol`, the mock reducer.

---

## Steps

### Task 1: Truncation at the tokenizer seam (chunk item 1 + item-4 test a)

**Files:**
- Create: `packages/daemon/src/memory/embedding/tokenizer.test.ts`
- Modify: `packages/daemon/src/memory/embedding/tokenizer.ts`

**Interfaces:**
- Produces: `export const MODEL_MAX_POSITIONS: number` (= 512); `export function truncateEncoding(ids: WordPieceIds, maxPositions?: number): WordPieceIds`.

- [ ] **Step 1.1 — Write the failing test.** Create `tokenizer.test.ts`:
```ts
import { test, expect } from "bun:test";
import { truncateEncoding, MODEL_MAX_POSITIONS } from "./tokenizer.js";

test("truncateEncoding caps a >512-token encoding to MODEL_MAX_POSITIONS (first-N), aligning ids+mask", () => {
  const n = 25308; // the live-failure token count (D3 demo 2026-07-16)
  const ids = {
    inputIds: Array.from({ length: n }, (_, i) => i),
    attentionMask: Array.from({ length: n }, () => 1),
  };
  const out = truncateEncoding(ids);
  expect(out.inputIds.length).toBe(MODEL_MAX_POSITIONS);
  expect(out.attentionMask.length).toBe(MODEL_MAX_POSITIONS);
  expect(out.inputIds[0]).toBe(0);                            // head-of-doc preserved
  expect(out.inputIds[MODEL_MAX_POSITIONS - 1]).toBe(MODEL_MAX_POSITIONS - 1);
});

test("truncateEncoding leaves an at/under-cap encoding unchanged (same reference)", () => {
  const ids = { inputIds: [0, 5, 9, 2], attentionMask: [1, 1, 1, 1] };
  expect(truncateEncoding(ids)).toBe(ids);                    // no copy when nothing to cut
});
```

- [ ] **Step 1.2 — Run it, verify RED.** Run: `bun test packages/daemon/src/memory/embedding/tokenizer.test.ts`. Expected: FAIL — `truncateEncoding` / `MODEL_MAX_POSITIONS` are not exported.

- [ ] **Step 1.3 — Implement the cap.** In `tokenizer.ts`, above the `XlmRobertaTokenizer` class, add:
```ts
/**
 * The model's max position count. XLM-RoBERTa / `Xenova/multilingual-e5-small` has 512
 * position embeddings; a longer sequence makes `session.run` throw an ONNX Runtime broadcast
 * error ("512 by <N>") — the live D3 failure this chunk fixes (real archive, 2026-07-16).
 *
 * The model's `tokenizer_config.json` declares `model_max_length: 512`, but this file loads
 * with `tokenizerConfig: {}` (no truncation config reaches the lib), so we cap explicitly here.
 *
 * HONEST TRADEOFF: a text longer than 512 tokens is represented by its FIRST ~512 tokens only.
 * Chunking / windowed-averaging is deliberately OUT (spec §7.2 — this is the minimal starvation
 * fix, not a retrieval-quality feature; revisit only on golden-set-class evidence). The trailing
 * EOS is intentionally not re-appended — mean-pool over the head window is well-defined for e5.
 */
export const MODEL_MAX_POSITIONS = 512;

/** Cap an encoding to the model's max positions (first-N tokens). Pure + exported so the cap
 *  is unit-testable without loading the model (CI has no model files). */
export function truncateEncoding(ids: WordPieceIds, maxPositions = MODEL_MAX_POSITIONS): WordPieceIds {
  if (ids.inputIds.length <= maxPositions) return ids;
  return {
    inputIds: ids.inputIds.slice(0, maxPositions),
    attentionMask: ids.attentionMask.slice(0, maxPositions),
  };
}
```
Then change `encode()` to apply it (and extend its doc-comment noting the cap):
```ts
  /** Tokenize `text` into ids + attention mask, capped to MODEL_MAX_POSITIONS (long texts are
   *  represented by their first ~512 tokens — see truncateEncoding). Caller pre-applies the e5
   *  "passage:"/"query:" prefix. May throw; the adapter's `embed()` wraps every call site. */
  encode(text: string): WordPieceIds {
    const encoded = this.tokenizer(text) as { input_ids: number[]; attention_mask: number[] };
    return truncateEncoding({ inputIds: encoded.input_ids, attentionMask: encoded.attention_mask });
  }
```

- [ ] **Step 1.4 — Run it, verify GREEN.** Run: `bun test packages/daemon/src/memory/embedding/tokenizer.test.ts`. Expected: PASS (both tests). Then `bun run typecheck` (0) and `bun run lint:strict` (0).

- [ ] **Step 1.5 — Commit.**
```bash
git add packages/daemon/src/memory/embedding/tokenizer.ts packages/daemon/src/memory/embedding/tokenizer.test.ts
git commit -m "fix(memory): truncate embed inputs to the model's 512-position window at the tokenizer seam (hybrid-retrieval chunk-07, D3)" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

> **Runtime note:** that truncation prevents the ORT broadcast throw end-to-end with the REAL model is a behavioral fact — **[requires runtime confirmation]** via Task 3's executed backfill run, not asserted from this unit test (which exercises only the pure cap; the fixture/CI path has no ORT).

---

### Task 2: Drain-level poison-row isolation + non-starvation (chunk items 2 + 3 + item-4 tests b, c)

**Files:**
- Modify: `packages/daemon/src/memory/embedding/embedding-drain.test.ts`
- Modify: `packages/daemon/src/memory/embedding/embedding-drain.ts`

**Interfaces:**
- Consumes: `MemoryStore.pendingFactEmbeddings/pendingMessageEmbeddings/upsertFactEmbedding/upsertMessageEmbedding` (unchanged), `encodeVector`, `EmbeddingProvider.embed` (unchanged frozen contract).
- Produces: no public signature change (`kick`/`drain`/`stop`/`DrainResult` unchanged); private `drainLeg` added, `drainOnce` refactored to call it.

- [ ] **Step 2.1 — Write the failing tests + the test-double.** In `embedding-drain.test.ts`, add near the existing `nullEmbedProvider` helper:
```ts
/** Mimics local-wasm's all-or-nothing batch failure on a "poison" text: a batch CONTAINING
 *  the poison resolves null (as embed() does when session.run throws — simulating the ORT-error
 *  class at the provider seam, chunk-07 item 4); a singleton non-poison resolves its fixture
 *  vector; a singleton poison resolves null. This is the input the drain's per-text isolation
 *  must recover from. NOTE: the drain embeds the RAW fact/content text (DOC_PREFIX is applied
 *  inside local-wasm, not by the drain), so `poison` here is the raw stored text. */
function poisonBatchProvider(poison: string, modelId = "poison-fixture"): EmbeddingProvider {
  const fixture = new FixtureEmbeddingProvider({ modelId });
  return {
    id: "poison",
    modelId,
    dims: fixture.dims,
    embed: async (texts: string[]) => (texts.includes(poison) ? null : fixture.embed(texts)),
  };
}
```
Then add the two RED tests:
```ts
// ── Poison-row isolation (chunk-07 item 2) ────────────────────────────────────────────
test("a poison text in a batch: that row is skipped, its siblings still embed (RED pre-fix: the leg aborted)", async () => {
  const { store } = fresh();
  store.insertFact(baseFact({ fact: "good-a", canonical: "good-a" }), "dumb-tail");
  const poisonId = store.insertFact(baseFact({ fact: "POISON", canonical: "POISON" }), "dumb-tail");
  store.insertFact(baseFact({ fact: "good-b", canonical: "good-b" }), "dumb-tail");

  const provider = poisonBatchProvider("POISON");
  const result = await new EmbeddingDrain(store, provider).drain();

  expect(result.factsEmbedded).toBe(2); // good-a + good-b embedded despite the poison sibling
  expect(store.pendingFactEmbeddings(provider.modelId, 10).map((r) => r.id)).toEqual([poisonId]);
  store.close();
});

// ── Non-starvation over a paged backlog (chunk-07 item 3) ─────────────────────────────
test("backlog with one poison row FIRST: every later row still drains and the pass terminates (RED pre-fix; a naive skip would wedge)", async () => {
  const { store } = fresh();
  const poisonId = store.insertFact(baseFact({ fact: "POISON", canonical: "POISON" }), "dumb-tail");
  const goodIds = ["g1", "g2", "g3", "g4"].map((f) => store.insertFact(baseFact({ fact: f, canonical: f }), "dumb-tail"));

  const provider = poisonBatchProvider("POISON");
  const drain = new EmbeddingDrain(store, provider, { batchSize: 2 }); // force multi-page paging

  const result = await drain.drain(); // MUST return — a wedge hangs → bun test timeout

  expect(result.factsEmbedded).toBe(4); // all four goods drained, poison at the front notwithstanding
  expect(store.pendingFactEmbeddings(provider.modelId, 10).map((r) => r.id)).toEqual([poisonId]);
  void goodIds;
  store.close();
});
```

- [ ] **Step 2.2 — Run them, verify RED.** Run: `bun test packages/daemon/src/memory/embedding/embedding-drain.test.ts`. Expected: the two new tests FAIL — pre-fix the null batch hits `if (vectors === null) break;` so `factsEmbedded === 0` (not 2 / not 4) and all rows stay pending. The existing tests still pass.

- [ ] **Step 2.3 — Implement `drainLeg` and refactor `drainOnce`.** Replace `drainOnce` (`embedding-drain.ts:106-134`) with:
```ts
  private async drainOnce(): Promise<DrainResult> {
    const provider = this.provider!;
    const factsEmbedded = await this.drainLeg(
      (limit) => this.store.pendingFactEmbeddings(provider.modelId, limit).map((p) => ({ id: p.id, text: p.fact })),
      (id, vec) => this.store.upsertFactEmbedding(id, provider.modelId, provider.dims, encodeVector(vec)),
    );
    const messagesEmbedded = await this.drainLeg(
      (limit) => this.store.pendingMessageEmbeddings(provider.modelId, limit).map((p) => ({ id: p.id, text: p.content })),
      (id, vec) => this.store.upsertMessageEmbedding(id, provider.modelId, provider.dims, encodeVector(vec)),
    );
    return { factsEmbedded, messagesEmbedded };
  }

  /**
   * Drain one corpus leg to completion, ISOLATING poison rows (spec §3.3 D3 drain design;
   * chunk-07 items 2+3). `embed()` is all-or-nothing per call (frozen port contract, ADR-0017
   * dec.1 — a batch resolves `null` on ANY per-text failure), so on a `null` batch we retry the
   * batch's texts ONE AT A TIME to isolate the offender. A text that still fails is recorded as
   * skipped-THIS-PASS (never written as a zero vector — that would poison cosine ranking) and
   * left pending — it simply won't join the cosine leg; the lexical leg still finds it (D3b
   * "missing embedding = graceful"). NON-STARVATION: skipped ids are filtered out of every
   * subsequent scan this pass, so the loop always makes progress and terminates; if a whole
   * batch embeds NOTHING (provider genuinely unavailable, or all remaining rows poison) the leg
   * stops — no wedge. Skipped rows are re-attempted on the NEXT drain kick (skip-per-pass; a
   * persisted retry-cap is deliberately NOT built — chunk-07 anti-gold-plating).
   */
  private async drainLeg(
    scan: (limit: number) => { id: string; text: string }[],
    upsert: (id: string, vec: Float32Array) => "written" | "skipped",
  ): Promise<number> {
    const provider = this.provider!;
    const skipped = new Set<string>();
    let embedded = 0;
    for (;;) {
      const pending = scan(this.batchSize).filter((r) => !skipped.has(r.id));
      if (pending.length === 0) break; // nothing left but already-skipped rows this pass
      const vectors = await provider.embed(pending.map((r) => r.text));
      if (vectors !== null) {
        pending.forEach((row, i) => {
          if (upsert(row.id, vectors[i]!) === "written") embedded++;
        });
        continue;
      }
      // A batch resolved null: EITHER the provider is unavailable, OR >=1 poison row nulled it.
      // Isolate by embedding one text at a time.
      let wroteAny = false;
      for (const row of pending) {
        const single = await provider.embed([row.text]);
        const vec = single?.[0];
        if (!vec) {
          skipped.add(row.id); // still fails alone -> skip-this-pass, leave pending
          continue;
        }
        if (upsert(row.id, vec) === "written") embedded++;
        wroteAny = true;
      }
      if (!wroteAny) break; // provider down OR all remaining are poison -> stop this leg
    }
    return embedded;
  }
```
Also update the class doc-comment (`:15-26`): replace the line "or when `provider.embed()` resolves `null` mid-run (provider went unavailable — stop that leg, ...)" with wording that reflects the new behavior, e.g.: *"A `null` batch is no longer a blanket leg-stop: the drain retries the batch's texts singly to isolate a poison row (chunk-07 items 2+3), skipping only the row(s) that still fail and continuing with the rest; a batch that embeds nothing at all stops the leg (provider truly unavailable or all-poison — non-starvation, no wedge)."*

- [ ] **Step 2.4 — Run the suite, verify GREEN.** Run: `bun test packages/daemon/src/memory/embedding/embedding-drain.test.ts`. Expected: PASS — the two new tests plus ALL pre-existing tests (null-provider no-op, null-returning `embed()` leaves rows pending, happy-path 3+2, scrub-mid-drain interleave, restart-safety, kick debounce, stop). Then `bun run typecheck` (0) + `bun run lint:strict` (0).

> **Backward-compat trace (why the pre-existing tests stay green):** null-provider → `drain()` returns early (`:83`), `drainLeg` never runs. null-returning `embed()` (1 fact) → null batch → 1 singleton retry → null → skip → `wroteAny=false` → break → `{0,0}`, fact still pending (matches `:60`). happy-path → non-null batches → batch upsert (matches `:74`). scrub interleave → non-null batch, per-row upsert; the scrubbed row's in-tx re-check returns `"skipped"` → not counted (matches `:97`). restart-safety (dying provider, batchSize 2) → first batch real (2 written), later batches null → singletons null → skip → break; some rows pending; fresh drain finishes (matches `:145`).

- [ ] **Step 2.5 — Commit.**
```bash
git add packages/daemon/src/memory/embedding/embedding-drain.ts packages/daemon/src/memory/embedding/embedding-drain.test.ts
git commit -m "fix(memory): isolate a poison embed row in the drain instead of nulling the whole leg (hybrid-retrieval chunk-07, D3)" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Backfill verification + full gates + PR evidence (chunk item 5 + DoD)

**Files:**
- Modify: `packages/daemon/scripts/backfill-embeddings.test.ts`
- (verification only) full-suite gates, frozen byte-diff, the executed real-model backfill run.

- [ ] **Step 3.1 — Add the store-shape wiring guard (fixture lane).** In `backfill-embeddings.test.ts`, add:
```ts
test("runBackfill completes on a real-archive shape (a >512-token message present) — fixture lane wiring guard", async () => {
  const { store, gate } = fresh();
  const t = store.createThread();
  const longContent = Array.from({ length: 30000 }, (_, i) => `w${i}`).join(" "); // well over the 512 window
  gate.appendTurn(t, [{ role: "user", content: longContent }, { role: "user", content: "short one" }], "s1", CTX);
  store.insertFact(baseFact(), "dumb-tail");

  const report = await runBackfill(store, new FixtureEmbeddingProvider(), { quiet: true });

  expect(report.messagesEmbedded).toBe(2);
  expect(report.factsEmbedded).toBe(1);
  expect(report.messagesPendingAfter).toBe(0);
  expect(report.factsPendingAfter).toBe(0);
  store.close();
});
```
> This guards backfill+drain wiring on a real-archive shape. It does **NOT** exercise truncation or the ORT throw (the fixture neither tokenizes nor runs ONNX). It is green pre- and post-fix by design — the truncation runtime proof is Step 3.3. **NOTE:** adapt the helper names (`fresh`, `CTX`, `baseFact`, `runBackfill`, `FixtureEmbeddingProvider`) to whatever the existing `backfill-embeddings.test.ts` already imports/defines — do not invent new fixtures.

- [ ] **Step 3.2 — Run it + the full daemon suite, verify GREEN + degrade.** Run: `bun test packages/daemon/scripts/backfill-embeddings.test.ts` (PASS). Then the degrade/gate sweep:
  - `bun test packages/daemon/` — green.
  - `EMBEDDING_PROVIDER=none bun test packages/daemon/src/memory/embedding/` — green (lexical-only degrade path unaffected).
  - The 2d glass-box degrade suite (per the chunk DoD "degrade suite green") — green.
  - `bun run typecheck` → 0; `bun run lint:strict` → 0; `bun test` (repo-wide) → green.

- [ ] **Step 3.3 — Execute the real-model backfill (the chunk item-5 mechanical verification — NOT a Lior demo).** Seed a throwaway store containing a >512-token message, then run the demo's step-2 command against the real local-WASM provider (first run downloads the model). Adapt the exact store/gate constructor calls to the real APIs (mirror what `backfill-embeddings.ts` / the daemon boot does); the shape:
```bash
TMP=$(mktemp -d)
# seed a store with a >512-token message + a fact (adapt constructor calls to real APIs)
bun run <seed-script-using-MemoryStore+WriteGate: append a 30k-word message, insert one fact, close>
AGENTIC_EMBED_AUTODOWNLOAD=1 bun run --cwd packages/daemon backfill-embeddings -- --data-dir "$TMP"
```
**Expected (paste stdout into the PR):** NO `BroadcastIterator ... 512 by <N>` error; the long message embeds (truncated); `report: {... "factsPendingAfter":0, "messagesPendingAfter":0, "providerAvailable":true}`; `BACKFILL OK`. **[requires runtime confirmation]** — this executed run is the behavioral evidence that truncation fixes the D3 throw end-to-end; do not claim it from code-reading. (If the model download is not feasible on the build machine, escalate — this is the required item-5 proof; the fixture guard in 3.1 is not a substitute.)

- [ ] **Step 3.4 — Frozen byte-diff.** Run: `git diff --stat origin/main -- packages/protocol packages/daemon/src/mock-agent.ts packages/daemon/src/providers/mock-provider.ts` → EMPTY. Also confirm `embedding-provider.ts`, `local-wasm-embedding-provider.ts`, `fixture-embedding-provider.ts`, `hybrid-ranker.ts` are unchanged: `git diff --stat origin/main -- packages/daemon/src/memory/embedding/embedding-provider.ts packages/daemon/src/memory/embedding/local-wasm-embedding-provider.ts packages/daemon/src/memory/embedding/fixture-embedding-provider.ts packages/daemon/src/memory/embedding/hybrid-ranker.ts` → EMPTY (proves "ports/ranker untouched"). (Adapt the frozen-surface paths if the repo's actual mock-reducer/protocol paths differ.)

- [ ] **Step 3.5 — Open the PR.** Branch `chunk/hybrid-07-embed-truncation-poison-row` pushed; `gh pr create` targeting `main`. PR body includes, as actually-run output: (1) the three RED→green tests (a: tokenizer cap; b: poison isolation; c: non-starvation) with a note each was RED pre-fix; (2) the Step-3.3 real-model backfill stdout (no ORT throw, `BACKFILL OK`); (3) gates: typecheck 0 / lint:strict 0 / `bun test` green / degrade suite green / frozen byte-diff empty; (4) a one-line note that the `EmbeddingProvider` port contract is byte-unchanged (Option E). End with the standard Claude Code attribution line.

- [ ] **Step 3.6 — Commit + hand off.**
```bash
git add packages/daemon/scripts/backfill-embeddings.test.ts
git commit -m "test(memory): backfill wiring guard on a real-archive shape (>512-token message) (hybrid-retrieval chunk-07)" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git push -u origin chunk/hybrid-07-embed-truncation-poison-row
```
On DONE: ready-to-merge per crawl §11.4 (conductor re-verifies + merges); then the conductor resumes the chunk-06 §6.1 demo runway (backfill + items 1b/2). **No new behavioral gate is introduced by this chunk** (chunk DoD) — chunk-06's pending §6.1 live demo is the behavioral proof and resumes after this merges.

---

## Self-review (author)

- **Chunk-task coverage:** item 1 (truncation @ tokenizer seam, honest-tradeoff comment, config-vs-constant resolved to constant) → Task 1; item 2 (per-text isolation, skip-not-zero-vector) → Task 2 (Option E, drain-level — the item-2 return-type fork is resolved in-contract; see `## Approaches`/`## ADR worthy`); item 3 (non-starvation, skip-per-pass, no retry-cap gold-plating) → Task 2 `drainLeg` (skipped-set + break-on-zero-progress); item 4 RED-first (a)(b)(c) → Tasks 1+2; item 5 (backfill completes on a Lior-shaped store, mechanical) → Task 3.3.
- **DoD coverage:** RED-first three tests fail pre-fix / green post-fix (Tasks 1–2); full gates (Task 3.2); no product-behavior change outside the embedding path — ports/ranker/wire byte-unchanged, proven by the Step-3.4 byte-diff; no new behavioral gate (Task 3.6).
- **Anti-gold-plating held:** no chunking, no retry-queue, no persisted failure marker, no new dependency, no port widening, no store-signature change, no new external surface.
- **Honesty (§6.1):** every runtime/behavioral claim (truncation prevents the throw end-to-end; the drain drains past a poison row; the drain never wedges) is marked **[requires runtime/test confirmation]** and pinned to an executed test or the Step-3.3 backfill run — none asserted from code-reading.
- **Placeholder scan:** none — every code step shows complete code; every command shows expected output.
- **Loud flag preserved:** the item-2 → Option-D widening path (ADR-worthy) is documented, not silently coded around; route back if item-2 is read as mandating per-element `null` in `embed()`.

## Status: review-complete — ready-to-merge (crawl §11.4: conductor re-verifies + merges)

**Execution record (all 3 tasks done + review-clean):**
- Task 1 (truncation @ tokenizer seam) — commit `dbaaac1`. RED→green (`tokenizer.test.ts` 2 pass).
- Task 2 (drain poison-isolation + non-starvation, Option E) — commit `e76cca7`. RED→green (2 new tests + all 8 pre-existing drain tests green).
- Task 3 (backfill wiring guard + gates + real-model run) — commit `eed036c`. **Real-model backfill = `BACKFILL OK`** on a store with a >512-token message (model cached from Lior's 2026-07-16 demo): no `BroadcastIterator … 512 by N` throw, 0 pending — direct end-to-end proof D3 is fixed.
- Review fixes (comment-honesty: honest drainLeg non-starvation caveat + accurate test note) — commit `103093766`.

**engine-reviewer verdict:** essentially clean — 0 Critical / 0 Major; 2 Minor (drainLeg comment-overclaim → fixed as honest comment per option (a); real-model evidence → captured in PR body) + 2 Nit (1 skipped as unreachable-defensive; 1 test-comment → fixed). All 5 risk areas positively confirmed (termination invariant SOLID/no-wedge, concurrency preserved, frozen contract byte-unchanged, truncation correct, tests genuine).

**Closeout gates (orchestrator-independent, tip `103093766`):** typecheck 0 · lint:strict 0 · `bun test` 801/0 · degrade(`EMBEDDING_PROVIDER=none`) 801/0 · frozen byte-diff EMPTY (protocol/mock-reducer/mock-agent/embed-port/local-wasm/fixture/ranker/store) · diff scope = 5 embedding-path files only.

**No new behavioral gate** (chunk DoD): chunk-06's pending §6.1 live demo (items 1b/2 re-run) is the behavioral proof and resumes after this merges.
