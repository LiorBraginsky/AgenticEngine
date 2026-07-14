# Chunk 3: EmbeddingProvider port + vector/archive-lexical storage

**Status:** in-progress
**Created:** 2026-07-13
**Phase:** hybrid-retrieval (2d)
**Estimated size:** ~1–1.5 days
**Depends on:** none (03→04→05 chain) — GATED on spec acceptance (+ ADR-0017 if ruled)

> 🔓 **UNBLOCKED 2026-07-14 — Lior ruled q#018 = Lane A** (`.conveyor/bus/a/018-wasm-spike-fail.md`).
> Opening spike-1 proved transformers.js (v4 AND v2) unusable for WASM-only on Bun 1.3.4 (native
> `onnxruntime-node` / stub; #46 still OPEN). Lior authorized a **bounded `onnxruntime-web`-DIRECT
> spike** (manual tokenizer + mean-pool against a real WASM `InferenceSession`, bypassing
> transformers.js) — preserves the accepted §0.1 posture (no egress, zero-infra), no spec/ADR change.
> **Spike-2 in progress.** If spike-2 ALSO fails ⇒ STOP + re-escalate with measured data — **Lior
> declined to pre-authorize any fallback** (no B/Ollama or C/Voyage on the worker's own; he decides
> on spike-2's evidence). No `process.release.name` spoofing in product code (and if a hack is needed
> even to *test* viability, that is itself a finding to report). On spike-2 success: build chunk-03
> as specced (default adapter = direct-WASM) + a one-line §0.1 implementation note (q#018).

## Scope

**In (spec §3.2–3.3):**
- **OPENING SPIKE (time-boxed, a GATE not a task):** re-verify gotcha **#46** status
  (`oven-sh/bun#30431` open? installed Bun version?) AND prove transformers.js embeds one string
  on our Bun with the **WASM backend only** (no `onnxruntime-node` native addon loaded — assert
  it). **Spike fails ⇒ STOP, post BLOCKED, bus-escalate WITH the measured data** (what failed, on
  which Bun/OS, the error) — the PRE-FRAMED fallbacks are already agreed (spec §0.1, conductor
  q#017 rider 1): (i) Ollama opt-in local lane, (ii) hosted Voyage behind an explicit consent
  gate; the PICK is a recorded conductor/Lior decision — never a worker call, never a silent
  default flip.
- `EmbeddingProvider` port (spec D2a: `{id, modelId, dims, embed(texts) → Float32Array[]|null}`,
  never-throws) + registry Map + `EMBEDDING_PROVIDER` env selection + loud-log degrade — the
  `memory-provider-selector.ts:51-73` house pattern.
- **Default lane:** transformers.js WASM adapter (model per spec D2c constraints — MIT/Apache
  **confirmed from the model's PRIMARY card** [grill #14], multilingual, WASM-sized; exact pick
  architect-time, golden-set-gated in chunk-04). Model download = non-blocking background;
  model-load failure ⇒ the same `null` degrade (spec D2b [grill #11]).
- **The FIXTURE provider** (deterministic vectors) — the port's second implementation, used by
  every CI test. **Voyage is NOT built** (spec D2d [grill #7]) — document its adapter shape in the
  port's doc comment; its build is a fast-follow gated on the chunk-04 golden-set outcome.
- Storage (spec D3a): `fact_embeddings` + `message_embeddings` + `message_fts` (unicode61 —
  spec D1b provisional ruling) — additive CREATE IF NOT EXISTS.
- **The STATELESS drain** (spec D3b [grill #1/#2] — NOT an in-memory queue, NOT `whenIdle`):
  pending = "row lacking a current-`model_id` vector" (a query, restart-safe by construction);
  triggers = daemon startup + debounced kicks from `appendMessages`/distill-apply
  (`store.ts:930/961/995/1018`, `store.ts:211-238`; `message_fts` written sync in-tx); drain runs
  OUTSIDE any tx; **scrub-race guard: pending-scan excludes tombstoned rows AND each UPSERT
  re-checks tombstone status inside its own write tx**; a REPLACE deletes the stale vector in the
  mutation tx (row becomes pending again); missing embedding = lexical-only participation.
- Delete/scrub cleanup (spec D3b): additive `AFTER DELETE ON distilled_facts` trigger for
  `fact_embeddings` (do NOT edit `trg_distilled_facts_ad`); tombstone/scrub deletes the message's
  `message_embeddings` + `message_fts` rows in the scrub tx.
- Backfill script (spec D3c): one-time, logged, idempotent per `model_id`, tombstone-honoring —
  the `migrate-distiller-v2.ts` posture.

**Out:** (WHY — §7.2)
- **Native `onnxruntime-node` backend** — FORBIDDEN (gotcha #46, live crash on our platform).
- **sqlite-vec / any extension / ANN** — gotcha #47; brute-force BLOB is the spec ruling (D3a).
- **Voyage adapter build** — spec D2d [grill #7]: speculative egress surface; fast-follow IFF the
  golden set fails local models. **Ollama adapter** — documented pattern only; never default.
- **A persisted queue table** — spec D3b [grill #2]: pending-is-a-query is strictly simpler and
  restart-safe; do not add queue state.
- **The ranker/fusion itself** — chunk-04 (this chunk ends at "vectors exist and are queryable raw").
- **model download UX/progress** — dogfood scale; log lines suffice [spec §7].

## Done criteria

- [ ] **[mechanical]** SPIKE evidence in PR: #46 status quote + WASM-only embed run output
      (no native addon in `process.moduleLoadList`/equivalent assert).
- [ ] **[mechanical]** Suite green with NO provider configured (CI reality — degrade contract,
      spec §4.7); loud one-line log on degrade.
- [ ] **[mechanical]** Write-time lifecycle tests (fixture-vector provider): insert/update/append/
      REPLACE each produce/refresh exactly one embedding row; `model_id` stamped; mixed-model rows
      excluded from reads.
- [ ] **[mechanical]** Count-invariants: no orphan `fact_embeddings`/`message_embeddings`/
      `message_fts` after every delete/scrub path (the M2 DoD pattern).
- [ ] **[mechanical]** Scrub-mid-drain interleave test: scrub lands between the drain's scan and
      its upsert ⇒ NO vector row survives (RED without the in-tx re-check — spec [grill #1]).
- [ ] **[mechanical]** Restart-safety: kill the drain mid-batch, restart ⇒ remaining rows still
      pending and get embedded (pending-is-a-query proven, spec [grill #2]).
- [ ] **[mechanical]** Chosen model's license confirmed from its PRIMARY card (quote in PR —
      spec D2c [grill #14]).
- [ ] **[mechanical]** Backfill script run on a seeded real sqlite: idempotent second run = 0 new
      rows; scrubbed messages skipped.
- [ ] **[mechanical]** typecheck 0 · `lint:strict` 0 · frozen byte-diff empty.

## Orchestrator brief (read by the orchestrator from this file)

```
implement chunk 03 of hybrid-retrieval per orchestration/docs/specs/2026-07-13-hybrid-retrieval.md
§3.2 (EmbeddingProvider port) + §3.3 (storage + lifecycle). OPEN WITH THE SPIKE — it gates the chunk.

Files to touch:
- packages/daemon/src/memory/embedding/ (new: provider port, selector, wasm adapter, fixture
  provider, the stateless drain; Voyage = doc-comment shape only)
- packages/daemon/src/memory/schema.ts (additive tables + trigger)
- packages/daemon/src/memory/store.ts (drain kicks, message_fts writes, scrub cleanup incl.
  message_embeddings/message_fts delete, raw vector reads)
- packages/daemon/src/memory/write-gate.ts (scrub cleanup + the Ruling-2 doc-comment flag —
  spec §4.3 [grill #9]: 2e cannot reuse the primitive unchanged, its dropDistilledFacts* sweep
  contradicts ADR-0012 rider Ruling 2)
- packages/daemon/scripts/backfill-embeddings.ts (new)
- package.json (transformers.js dep — WASM backend pinned)

Done when: the Done criteria above hold. Spike failure = BLOCKED, not a workaround.

ADRs in scope: ADR-0012 decision 6 (executed); ADR-0017 if accepted (the provider plane + egress
posture — no hosted lane reachable without explicit opt-in); gotchas #46/#47 honored.
```

## Notes / Open questions

- §4.2 coupling: the drain runs outside any tx; `bun:sqlite` forbids tx nesting — verify the
  enqueue sits after commit, not inside.
