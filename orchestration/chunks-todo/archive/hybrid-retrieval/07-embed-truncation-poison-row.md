> 🗄️ ARCHIVED 2026-07-21 — done. Historical record; do not edit.

# Chunk 7: embed truncation + poison-row isolation (demo-found defect D3)

**Status:** done — hybrid-retrieval 2d SHIPPED + CLOSED 2026-07-21 (PR #103; feature demo-signed §6.1; see specs/archive/2026-07-13-hybrid-retrieval.md)
**Created:** 2026-07-17
**Phase:** hybrid-retrieval (2d)
**Estimated size:** small (~half day)
**Depends on:** 03–05 merged; found live at the §6.1 demo (chunk-06 BLOCKED-on-demo continues after this fix)

## Provenance (§7.2 defect-routing, NOT new scope)

**Live failure on Lior's REAL store (2026-07-16, first boot with the model present):**
```
[embedding] local-wasm embed failed (failed to call OrtRun(). ERROR_CODE: 1, ... BroadcastIterator::Append ...
Attempting to broadcast an axis by a dimension other than 1. 512 by 25308); degrading to lexical-only
```
A real archived message (~25k tokens — a pasted blob from the 2c injection demo) exceeds the
model's 512-position window; NO truncation is applied at the tokenizer seam (`tokenizer.ts` builds
with `tokenizerConfig: {}` ⇒ no `model_max_length`), so `session.run` throws; and because
`embed()` is all-or-nothing per batch, ONE poison row nulls its whole batch and blocks later rows
each drain kick ⇒ embedding is effectively DEAD on any real archive containing one long message.
This is EXACTLY the chunk-03 conductor-reviewer MINOR (predicted verbatim) that chunk-04 deferred
as "short fixtures, off-path, non-gating" — the deferral judgment was wrong for real data.

## Task

1. **Truncation at the tokenizer seam:** cap encoded inputs to the model's max positions (512 —
   read from config if available, else constant with a comment). Mean-pool over the truncated
   window. Document the honest tradeoff in a comment: long texts are represented by their first
   ~512 tokens; chunking/windowed-averaging = OUT (future, only if golden-set-class evidence
   demands it — §7.2 rationale: minimal fix for the starvation defect, not a quality feature).
2. **Per-text failure isolation in `embed()`:** a row that still fails (any cause) is isolated —
   skip it (null/skip marker for THAT text), never null the whole batch; the drain proceeds to
   later rows. The chunk-03 reviewer sketch ("skip/zero-vector the poison row") is the shape;
   prefer skip-and-record over zero-vector (a zero vector poisons cosine ranking).
3. **Drain non-starvation:** with (1)+(2), verify the real-world scenario: a backlog containing a
   >512-token message embeds (truncated) and everything after it drains. If a row fails
   permanently, it must not wedge the drain forever (skip-per-pass is acceptable; a retry-cap is
   optional — do not gold-plate).
4. **Regression tests (RED-first, real sqlite + fixture provider where possible; the ORT-error
   class needs the real WASM path — a daemon-test with the real model is NOT required, simulate
   the throw at the provider seam):** (a) >512-token text ⇒ embeds truncated, no throw; (b) a
   throwing text in a batch ⇒ that row skipped, siblings embedded; (c) drain over a backlog with
   one poison row ⇒ later rows drained.
5. **After the fix, verify `backfill-embeddings` completes on a store shaped like Lior's** (long
   message present) — the demo's step-2 command must work.

## DoD

- [ ] **[mechanical]** RED-first: the three regression tests fail pre-fix, green post-fix.
- [ ] **[mechanical]** Full gates: typecheck 0 · `lint:strict` 0 · `bun test` green ·
      degrade suite green · frozen byte-diff empty.
- [ ] **[mechanical]** No product-behavior change outside the embedding path (ranker/ports/wire
      untouched).
- [ ] NO new behavioral gate — the pending chunk-06 §6.1 live demo (items 1b/2 re-run) is the
      behavioral proof and it resumes after this merges.

## Orchestrator brief (read by the orchestrator from this file)

```
implement chunk 07 (embed truncation + poison-row isolation) of hybrid-retrieval per this file.
Authority: accepted spec 2026-07-13-hybrid-retrieval.md (§0.1 local-WASM lane; D3 drain design) +
the chunk-03 conductor-reviewer MINOR (PR #99 comment) + the live failure quoted above.
Files (expected): packages/daemon/src/memory/embedding/tokenizer.ts (truncation),
local-wasm-embedding-provider.ts (per-text isolation), embedding-drain.ts (only if needed for
non-starvation), tests colocated. Small chunk — do not gold-plate (no chunking, no retry-queue).
On DONE: ready-to-merge per crawl §11.4 (conductor re-verifies + merges); then the conductor
resumes the chunk-06 demo runway (backfill + items 1b/2).
```
