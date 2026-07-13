---
title: Hybrid retrieval (2d) — BM25 + embeddings via RRF, memory_search read tool, and the committed riders
status: draft
date: 2026-07-13
deciders: [lior]
feeds: hybrid-retrieval
implements: adr/0012-conversation-and-memory-model (decision 6 — "vector retrieval is a swappable provider" — EXECUTED here) + adr/0016-agent-memory-action-tools (decision 2 — the reserved `kind:read` slot, now consumed)
refines: specs/2026-06-13-memory-distiller-v2.md §3.4 (D-V4a "FTS5, NOT embeddings" — superseded for the ABOVE-CAP candidate lane only, per its own "the same layer 2d will reuse" forward pointer) + §3.6 D6b (the d5 consult gains a canonical axis)
carries: memory-backlog §D riders — message-edit REMOVAL (Lior 2026-07-10, final) · forgotten_facts canonical residual · d5 display-text residual · smart-distiller D6c flake fix · O2/O3 weigh-in
cites: research/2026-07-13-hybrid-retrieval-bm25-embeddings.md (supersedes the 2026-06-13 similarity report for the 2d question)
route-part: memory 2d (roadmap "Memory — next", queue head 2026-07-13)
tags: [spec, memory, retrieval, hybrid, bm25, embeddings, rrf, fts5, memory-search, privacy, egress]
---

# Hybrid retrieval (2d) — spec

> **Pipeline placement.** Frontier (fable) **design + decompose** pass (PIPELINE §11) for roadmap
> **2d**, picked by Lior 2026-07-13 («BM25+embeddings це важлива тема… пускай 2d») with an explicit
> research-first directive. The deep research report
> (`research/2026-07-13-hybrid-retrieval-bm25-embeddings.md`, cited/dated/version-stamped) is the
> load-bearing input; where a chunk depends on one of its versioned claims (gotcha #46-class facts
> rot), the chunk's DoD RE-VERIFIES at build time.
>
> **Decision provenance.** The two genuinely-open judgment seams (the privacy/default-lane fork and
> the ADR call, plus the search-result-targetability guardrail question) were routed UP the dev-bus —
> **q#017**. An adversarial grill pass (design-critic subagent) ran on this draft; findings folded
> inline, tagged `[grill …]`. The §5.2 gates (spec sign-off + ADR-0017 acceptance if ruled) are
> **Lior's** — the decompose PR does NOT merge before them.
>
> **Empirical inputs produced by THIS pass** (not assumptions): the FTS5 `unicode61` Cyrillic
> case-folding test (§3.1 — OBSERVED result, resolving the research's flagged ambiguity) and the
> full code-seam recon (file:line anchors throughout).

---

## 0. Decision points for sign-off (Lior — read these first)

1. **Privacy fork — the default embedding lane. ⚠️ q#017 sub-1 (conductor lean pending; drafted
   with the recommendation).** Embedding a fact/message means feeding its TEXT to a model. The three
   lanes, honestly:

   | Lane | What leaves the machine | Quality | Install weight | Risk |
   |---|---|---|---|---|
   | **local in-process, WASM** (transformers.js, `onnxruntime-web` backend; multilingual ONNX model) | **NOTHING** | unverified for UA (true of ALL lanes — §3.8 golden set decides) | one-time model download (~100–500 MB by model choice) | gotcha #46 is about the NATIVE backend; WASM avoids it, but the exact force-WASM-on-Bun steps are UNVERIFIED (research §9) → chunk-03 SPIKE gates it |
   | **hosted API** (Voyage `voyage-multilingual-2` — Anthropic's recommended third party; 50M tokens/mo free tier) | **every fact + every archived message text**, to a third party, under their retention/training terms (research §10 links) | likely strongest multilingual | zero | new data-egress surface for PERSONAL memory content; a separate API key to manage |
   | **local sidecar** (Ollama `bge-m3` / `nomic-embed-text-v2-moe`) | nothing | good | user must install+run Ollama — violates zero-infra (ADR-0012 posture) | opt-in only |

   **Recommendation (drafted-in): local-first — WASM in-process is the DEFAULT; the hosted lane is
   NOT BUILT up-front [grill #7]: the port's second implementation is the fixture provider (tests),
   Voyage stays a DOCUMENTED port shape built as a fast-follow IFF the golden set (§3.8) shows local
   UA quality is insufficient; Ollama is a documented opt-in lane.** Rationale: ADR-0012's
   local-first posture + the security-as-pitch moat (prior-art memory `project_prior_art_findings`)
   both say personal memory content should not egress by default — and building a production egress
   adapter for a lane that may never be selected is speculative surface at dogfood scale. The port
   makes the choice reversible per-install (env var); the golden set — not marketing — arbitrates
   quality. If WASM proves unbuildable at the chunk-03 spike, OR the golden set fails every local
   candidate model, the ladder is: escalate → Lior picks the hosted lane (its build + its egress
   consent become a deliberate step) — a §5.2 decision, not a worker call.

2. **`memory_search` results are READ-ONLY — NOT forget/replace-targetable. ⚠️ q#017 sub-3.**
   ADR-0016's guardrail package (d2/d7) bounds the poisoning blast radius to *this-turn injected*
   facts (≤3 actions/turn). Letting search results join the targetable ordinal map would widen d7 to
   "any machine fact reachable by search" — a guardrail change to an accepted, constitutive part of
   ADR-0016. **Recommendation: keep the targetable set = the injected slice, unchanged.** "Forget X"
   for an out-of-view fact still honestly defers to the Memory window even when search can SEE X —
   the tool answers questions; it does not extend the write surface. Revisit trigger (recorded): the
   fact corpus outgrowing `RETRIEVE_SLICE_N`=20 so far that Memory-window deferrals become a felt
   nuisance in dogfood — then an ADR-0016 amendment (full §5.2 gate) can widen targeting deliberately.

3. **Honest consequence — the archive becomes agent-reachable for the first time.** Today the agent
   sees only injected facts; 2d's `memory_search(scope:archive)` lets it read archive content
   on demand. THREE edges stated honestly, not hidden:
   - A **forgotten FACT's source conversation** remains searchable — this is BY DESIGN (ADR-0012
     rider Ruling 2: fact-forget releases the reference, never touches sources; the archive is
     lossless). The content-erase remedy is **2e thread-forget** (queued, backlog §C) — exactly the
     "pairs with 2d" coupling the backlog recorded. Until 2e ships, the only content-erase is none.
   - **Tombstoned/scrubbed content is NOT searchable** — search reads honor `mutations` tombstones
     the same way every archive read does today, AND a scrub deletes the message's embedding row
     (§3.3) so semantic search cannot rank scrubbed content either. **[grill #1 — the race is
     closed by design, not luck:** the async embed drain re-checks tombstone status INSIDE its
     upsert transaction and skips scrubbed rows, so a scrub landing mid-drain can never be
     re-materialized as a vector — §3.3 D3b.]
   - **[grill #6] A NEW second-order prompt-injection channel, named:** a poisoned PAST message
     (benign as history, injection as a search result) can re-enter the LLM context mid-turn via
     archive search. Mitigations, stated at their honest strength: search-result snippets pass the
     existing `RuleBasedScanner` (flagged snippets withheld with a typed note — defense-in-depth,
     not a guarantee); results are framed as quoted UNTRUSTED data in the `tool_result`, never as
     instructions; and the WRITE-side blast radius is unchanged (a steered same-turn forget is
     still bounded by d2/d7 — in-view ordinals, ≤3, machine-only, audited). The d7 ceiling
     statement in ADR-0016 gains a short dated RIDER recording this widened read surface — it
     rides this PR through the same §5.2 acceptance as this spec (⚠️ q#017 sub-3).

4. **ADR-0017 (if the conductor rules one is warranted — q#017 sub-2).** Proposed content: the
   **`EmbeddingProvider` provider PLANE** (the decision that outlives this feature — the same way
   ADR-0016 recorded the action-tool plane [grill #15]) + the egress posture (local default;
   hosted = a future explicit-opt-in lane with its own consent gate) + the vector lifecycle
   (write-time embed, `model_id` stamped, full re-embed as the swap migration). Tier per PIPELINE
   Finding #5: lean **decision-grade (hard-to-reverse)** — a new provider plane + a named future
   egress lane is closer to ADR-0016's tier than to a doc-style record [grill #15]; either way it
   rides this PR as `proposed` and Lior accepts together with this spec (same gate event).

---

## 1. Purpose & scope

**Close the cross-language / reworded retrieval defect class at its root.** BM25/FTS5 requires
shared tokens; a Ukrainian statement and its English LLM-canonical share none — this single gap is
the demo-3 duplicate-colour defect, the 2c chunk-05 root cause (canonical-language divergence), and
the accepted v2 dedup ceiling. Only the embedding half of a hybrid closes it (research §1/§6 —
by construction, not benchmark); RRF fusion lets that signal through without lexical score games.

**Two consumers of ONE hybrid ranker:**
- **(a) the AGENT** — an on-demand `memory_search` read tool on the ADR-0016 action-tool plane
  (the registry's `kind:read` slot — designed in 2c, built here), over facts AND the message archive.
- **(b) the DISTILLER** — semantic candidate-fetch superseding the BM25-only above-cap fallback in
  `fetchCandidates` (`store.ts:1135-1167`); the all-facts-below-cap pool stays (below the cap the
  LLM already sees everything — hybrid adds nothing there).

**In scope:**
- `EmbeddingProvider` port (swappable, ADR-0012 decision 6 executed) + vector storage (plain BLOB,
  brute-force cosine — gotcha #47 honored) + write-time embedding lifecycle + backfill (§3.2–3.3).
- The hybrid ranker: BM25 leg + cosine leg fused via RRF, over both corpora (§3.4–3.5).
- `message_fts` — the archive's lexical leg (FTS5 over `messages`, the first search surface the
  archive ever gets) (§3.3).
- `memory_search` on the ADR-0016 plane (§3.6).
- The golden-set eval as the acceptance instrument (§3.8) — no borrowed benchmark numbers exist for
  Ukrainian (research §3: UA is absent from MIRACL).
- **The committed riders** (§3.7): message-edit REMOVAL · `forgotten_facts` canonical axis + d5
  display residual · D6c flake fix.

**Out of scope (recorded, with WHY — PIPELINE §7.2):**
- **Re-ranking the per-turn INJECTED slice** (`retrieve`, `store.ts:499` — today plain
  `ORDER BY … LIMIT 20`, no ranking at all). OUT because the designed answer to "fact not in view"
  is the search TOOL (consumer a), and the slice outgrowing usefulness is the same future trigger
  ADR-0016 already names; re-ranking injection is a behavior change to every turn with its own
  eval burden — its own deliberate pass when the trigger fires.
- **sqlite-vec / LanceDB / any ANN index** — gotcha #47; corpus is 2–3 orders below the ~100k
  threshold; brute-force cosine in TypeScript is the correct v1 (research §5). Revisit trigger:
  archive corpus reaching tens of thousands of rows.
- **2e thread-forget** — its own feature (backlog §C); §0.3 records the honest interplay.
- **Variant B (system-prompt injection)** — untouched (backlog §F).
- **Semantic AUTO-suppression in d5/dedup** — REJECTED for v1: threshold-based fuzzy suppression
  can silently drop legitimate new facts (over-suppression is the exact class ADR-0015 called
  benign only because it was deterministic). The deterministic axes (canonical + display) are the
  riders; the fully-reworded-different-canonical slip remains a NAMED residual (§3.5).
- **O2 (injection-blob reply quality)** — weighed per the brief: NOT a 2d piece (it is
  answer/prompt-quality on the A′ tail, open-case #3); stays in backlog. **O3 (replace-steering
  miss)** — partially addressed: the hybrid candidate-fetch strengthens the dismiss-time
  replace-on-change safety net cross-language (§3.5); the agent-side steering miss itself is
  prompt-quality, not retrieval.
- **Embedding-model fine-tuning / reranker stage** — nothing at this corpus size justifies it
  (research §2); the golden set will show if the plain hybrid suffices.

---

## 2. Frame carried (locked elsewhere, not re-decided here)

- **ADR-0012 decision 6** — "uncapped searchable archive + small distilled slice; vector/graph
  retrieval is a swappable provider, not a v1 bet." 2d is that provider arriving, behind a port,
  swappable — the posture is EXECUTED, not changed. The STABILITY amendment is untouched: hybrid
  retrieval changes which facts are FOUND, never how facts mutate (all mutation still flows through
  the rule-gated `applyFactOp` machinery).
- **ADR-0012 rider Ruling 2 (fact source-independence)** — nothing in 2d creates a new fact-change
  path; search is read-only; §0.3 states the archive-reachability consequence honestly.
- **ADR-0016** — the action-tool plane admits read tools by design (decision 2); `memory_search`
  adds a ROW, not structure (`memory-action-tools.ts:22-30` `kind` slot; header note :13-15). The
  5d guardrail package is UNCHANGED (§0.2); read tools have no side effects, so d1–d7 do not widen.
- **ADR-0015 B1** — untouched; the message-edit removal (§3.7 R1) keeps the append-only mutation
  machinery (`WriteGate.edit`, `mutations` kind `'correction'`, `readThreadArchive` COALESCE) — the
  UI affordance and the HTTP message branch go, the primitive stays (it predates the UI and other
  things sit on it).
- **Distiller-v2 D-V4b full-corpus invariant** — carried: no retrieval hint (topic OR embedding)
  ever REDUCES the candidate set below what the lexical/all-facts lane would return; hybrid legs
  are UNION-then-rank (RRF), never intersection (§3.4).
- **Distiller-v2 D-V4c canonical/display split** — carried and now symmetrical: BM25 matches
  `canonical` (English key), the embedding leg matches the user-language DISPLAY text (§3.2) — the
  two legs cover the two axes the 2c chunk-05 fix taught us are BOTH identity surfaces.
- **ADR-0013/0014 auth posture** — no new HTTP/WS surface, no new caller. `memory_search` is
  in-process (provider → port), same as 2c. The hosted embedding lane (if opted in) is a new
  OUTBOUND client connection (daemon → Voyage), not a new inbound surface — named in ADR-0017.
- **Frozen surfaces:** `@agentic/protocol` + the mock reducer — byte-unchanged (byte-diff at PR
  time, per standing practice).

---

## 3. Spec decisions

### 3.1 — D1: hybrid = FTS5 BM25 + embedding cosine, fused by RRF (research forks 1–3, all resolved)

**D1a.** Per corpus (facts; archive messages), the ranker runs TWO legs and fuses by **Reciprocal
Rank Fusion** (`score(d) = Σ 1/(k + rank_leg(d))`, k=60 — the zero-tuning default, research §2):
lexical = FTS5 `bm25()`; semantic = brute-force cosine over stored vectors. RRF over weighted
blending because it needs NO score normalization (BM25 unbounded vs cosine [-1,1] — the most-cited
production pitfall) and no per-corpus alpha. Legs are computed independently, top-K each,
**UNION-then-rank** — a doc found by only one leg still ranks (complementary recall is the entire
mechanism: BM25 catches exact terms; the embedding leg alone carries UK↔EN).

**D1b. Tokenizer — EMPIRICALLY settled (this pass, 2026-07-13; Bun 1.3.4, SQLite 3.51.0):**
the research flagged `unicode61`'s Cyrillic case-folding as contested-in-docs. The 5-line
`bun:sqlite` test (scratch script, output recorded here — the OBSERVED result, not an assumption):

```
unicode61: 'привіт'→'Привіт' ✓  'ПРИВІТ'→'Привіт' ✓  'колір'→'КОЛІР' ✓  (all 5 case variants matched)
trigram:   available ✓; case-insensitive for Cyrillic ✓; BUT 'кольор' ↛ 'колір' (0 matches —
           trigram MATCH needs a shared CONTIGUOUS ≥3-char substring of the whole query, not any
           shared trigram) — trigram does NOT close same-language rewording either.
cross-script negative control: 'колір' never matches an English row ✓ (the root defect, confirmed).
```

**Ruling (PROVISIONAL until the chunk-04 re-run [grill #12]):** keep **`unicode61`** (the default)
for `fact_fts` AND the new `message_fts` — Cyrillic case-folding works on the observed platform;
trigram would buy only substring/typo matching at index-size cost while still not closing rewording
(observed above), and the embedding leg is what closes rewording anyway. The scratch script is
deliberately NOT committed (this pass ships zero product code); the observation above is the
recorded output, and **chunk-04's DoD re-runs the identical check on the build machine's
Bun/SQLite** (committing the check script then) — note `message_fts` will be the FIRST
production FTS surface indexing Cyrillic content (fact_fts indexes English canonicals), so the
re-verify is load-bearing, not ceremony.

### 3.2 — D2: the `EmbeddingProvider` port (swappable; ADR-0012 d.6 pattern; → ADR-0017 if ruled)

**D2a. Port shape** (mirrors the `MemoryProvider`/`AgentProvider` house pattern — thin interface +
registry Map + env selection + loud-log graceful fallback, `memory-provider-selector.ts:51-73`):

```ts
interface EmbeddingProvider {
  id: string;              // "local-wasm" | "voyage" | "ollama"
  modelId: string;         // stamped on every vector row (§3.3) — the swap-detection key
  dims: number;
  embed(texts: string[]): Promise<Float32Array[] | null>;  // null = unavailable; NEVER throws
}
```

Selected by `EMBEDDING_PROVIDER` env (default per §0.1: `local-wasm`); **absent/failed provider ⇒
`null` ⇒ every consumer degrades to lexical-only** — retrieval quality degrades, availability never
does (the keyless-fallback posture, carried). Batch-shaped API (`texts[]`) because backfill and
distill-time embed are naturally batched.

**D2b. Default lane = transformers.js, WASM backend, in-process.** Gotcha **#46** (open crash
`oven-sh/bun#30431`, macOS arm64, native `onnxruntime-node`) forbids the native backend; the WASM
backend (`onnxruntime-web`) has no native addon and is fast enough at hundreds-of-rows scale.
**The exact force-WASM-on-Bun mechanics are UNVERIFIED (research §9) → chunk-03 opens with a
time-boxed SPIKE**: prove embed-one-string works WASM-only on our Bun, no native addon loaded, and
RE-VERIFY #46's status (the issue may have closed/worsened — version-stamped facts rot). Spike
fails ⇒ STOP, escalate (§0.1 fallback ladder) — do not silently ship the native backend.
**Model download + offline [grill #11]:** the one-time model download is NON-BLOCKING (background;
lexical-only until ready); a model-load failure (offline, partial download) resolves to the SAME
`null` degrade as every other provider failure — availability never depends on the model being
present. (A transient-vs-permanent failure distinction is deliberately not built at this scale;
the degrade log line carries the error reason for observability.)

**D2c. Model choice is architect-time, golden-set-gated** (§3.8). Constraints fixed here: MIT/
Apache license **confirmed from the model's PRIMARY card at build time** — research §9 flags
multilingual-e5's MIT as single-source-clustered [grill #14]; jina-v3's CC-BY-NC is out
(research §3); multilingual with UA in pretraining
coverage (bge-m3 / multilingual-e5 family are the researched leads; LaBSE is disfavored — its
documented weakness is exactly our paraphrase-not-translation case); small enough for WASM
(quantized ONNX). `modelId` + `dims` are provider properties, so the choice is swappable later by
construction.

**D2d. The hosted lane (Voyage) is NOT built up-front [grill #7 — supersedes the earlier
built-in-chunk-03 draft].** The port's second implementation is the deterministic FIXTURE provider
(tests, §5); Voyage exists in this spec as a DOCUMENTED adapter shape (HTTP POST + key via the
existing Keychain secret pattern) and becomes a deliberate fast-follow chunk IFF the golden set
fails every local candidate model (§3.8 ladder → §0.1). Building a production egress adapter for a
lane that may never be selected is speculative surface at dogfood scale. When/if built: never
selected by default; selecting it is an explicit env/config act = the informed-consent line
(ADR-0017). Ollama: documented as a pattern (it is ~an HTTP adapter), NOT the default (zero-infra),
built only on real demand.

**D2e. What gets embedded — the user-language DISPLAY text**, for both facts (`distilled_facts.fact`)
and messages (`messages.content`). NOT the English `canonical`: canonical is a lossy keyword key;
the display text is the faithful semantic content, and cross-lingual mapping is the MODEL's job by
construction (research §1 — the mechanism, not the fusion, closes UK↔EN). The BM25 leg keeps
matching canonical — the two legs deliberately cover the two identity axes (D-V4c carried, §2).

### 3.3 — D3: vector + archive-lexical storage, write-time lifecycle (gotcha #47 honored)

**D3a. Tables (additive `CREATE TABLE IF NOT EXISTS`, no ALTER — the standing schema rule):**

```sql
fact_embeddings(fact_id TEXT PRIMARY KEY, model_id TEXT NOT NULL, dims INTEGER NOT NULL,
                vector BLOB NOT NULL, created_at INTEGER NOT NULL);
message_embeddings(message_id TEXT PRIMARY KEY, model_id TEXT NOT NULL, dims INTEGER NOT NULL,
                   vector BLOB NOT NULL, created_at INTEGER NOT NULL);
CREATE VIRTUAL TABLE message_fts USING fts5(message_id UNINDEXED, content);  -- unicode61 (D1b)
```

Brute-force cosine over `SELECT vector …` in TypeScript at query time; Float32 little-endian BLOB
encoding [architect-time detail]. **`model_id` stamped per row** — a future model swap is a
detectable, deliberate **full re-embed migration** (strategy 3 of research §8 — at our scale a
seconds-to-minutes batch, the realistic choice); mixed-model rows are EXCLUDED from the cosine leg
(never compare vectors across spaces), logged loudly.

**D3b. Write-time embedding via a STATELESS, restart-safe drain [grill #2 — redesigned; the
earlier "enqueue + whenIdle" draft is superseded: `whenIdle` is the distiller-completion barrier,
not a drain, and an in-memory queue would silently lose rows across restarts].** Embedding is I/O
(WASM inference / HTTP) and must NEVER sit inside a sync `bun:sqlite` transaction. Lifecycle:
- **There is NO queue to persist.** "Pending" is a QUERY, not state: *a row lacking a
  `fact_embeddings`/`message_embeddings` row for the current `model_id` is pending.* The drain
  (owned by the embedding module, daemon-side — the store keeps its "stores+matches, never
  computes" contract, `store.ts:26-28`) scans for pending rows and embeds them in batches.
  Restart-safe by construction: whatever wasn't embedded is still pending after a crash.
- **Drain triggers:** daemon startup + a debounced kick after `appendMessages` / after a distill
  apply (the write sites merely *kick* the drain — no ids handed over, no shared state). Runs
  outside any tx.
- **Scrub-race guard [grill #1 — BLOCKER closed by design]:** the drain's pending-scan EXCLUDES
  tombstoned/scrubbed rows, AND each UPSERT re-checks tombstone status INSIDE its own write tx
  (skip if scrubbed since the scan). A scrub landing mid-drain therefore cannot re-materialize a
  vector of scrubbed content — there is no window in which pre-scrub text lands after the scrub's
  delete. Tested with a deterministic interleave (§5).
- **facts:** insert/update/append (the same code sites that maintain `fact_fts` —
  `store.ts:930/961/995/1018`) kick the drain; a REPLACE's text change makes the row pending again
  (its stored vector no longer matches — implementation: delete the row's vector in the same
  mutation tx, cheap and deterministic).
- **messages:** `appendMessages` (`store.ts:211-238` — the single archive write path) writes
  `message_fts` rows SYNCHRONOUSLY in the same tx (cheap, no I/O — mirrors `writeFactDerived`)
  and kicks the drain for the embedding leg.
- **missing embedding = graceful:** a pending row simply does not participate in the cosine leg;
  the lexical leg still finds it. No blocking, no throw.
- **deletes:** an additive `AFTER DELETE ON distilled_facts` trigger cleans `fact_embeddings`
  (a NEW trigger; the existing `trg_distilled_facts_ad` is not edited); **a message
  tombstone/scrub DELETES its `message_embeddings` row and its `message_fts` row** in the scrub
  tx — scrubbed content must be unreachable by BOTH legs (§0.3).
- **count-invariant DoD (the M2 pattern carried):** after every delete/scrub path,
  no orphan `fact_embeddings`/`message_embeddings`/`message_fts` rows.

**D3c. Backfill = one-time, explicit, logged script** (the `migrate-distiller-v2.ts` posture):
builds `message_fts` for the existing archive synchronously, then batch-embeds all facts + messages
through the active provider. Idempotent (skips rows already embedded with the current `model_id`).
Tombstone-honoring (scrubbed messages are skipped). Run deliberately, not auto-on-startup.

### 3.4 — D4: the ranker contract

**D4a.** One shared module (`hybrid-ranker.ts`-shaped) exposing per-corpus search:
`searchFacts(query, k)` / `searchArchive(query, k)` → ranked `{id, score, legHits}` lists.
Leg top-K defaults: facts 20/leg, archive 50/leg — **flagged INFERRED, not cited** (research §2
found no small-corpus guidance); generous relative to corpus size, tuned against the golden set
[architect-time]. Query embedding computed once per call (provider `null` ⇒ lexical-only).

**D4b. Determinism + tie-breaks:** RRF ties broken by `rowid DESC` (the D6c-flake lesson, §3.7 R3 —
NO order-by without a total tie-break, anywhere in this feature). The ranker is pure given
(query, stored legs) — fixture-vector tests make it CI-deterministic (§5).

**D4c. B1 invariant carried (D-V4b):** legs UNION; no hint filters. A fact found by the lexical leg
alone (or cosine alone) is always eligible for the final top-K.

### 3.5 — D5: consumer (b) — the distiller candidate-fetch

**D5a.** `fetchCandidates` (`store.ts:1135`) keeps its shape: `total <= ALL_FACTS_CAP(=50)` ⇒
all-facts (unchanged — below the cap the LLM sees everything; hybrid adds nothing but cost);
**above the cap, the BM25-only lane is REPLACED by the hybrid ranker** (`searchFacts(tailText,
CANDIDATE_TOP_K)`). This supersedes distiller-v2 D-V4a's "NOT embeddings" for exactly this lane —
the supersession the v2 spec itself forecast ("2d supersedes both", `store.ts:16-24` comment).

**D5b. What this buys, stated precisely — INCLUDING the scale honesty [grill #4]:** above-cap, a
Ukrainian tail can now surface the English-canonical contradicting fact as a candidate (the
embedding leg carries it) → the LLM's replace-on-change actually SEES the fact it should replace →
the O3 safety-net and the demo-3 defect class close at the root. Below-cap behavior is
byte-identical — which means **at today's corpus (<`ALL_FACTS_CAP`=50 facts) consumer (b) is
dormant-by-design**: it is built for the trajectory the cap-comment (`store.ts:16-24`) already
forecast, not for today's row count. Consequences drawn honestly: (i) every consumer-(b) test AND
the golden-set distiller leg run on a **seeded >50-fact store** (otherwise they exercise nothing);
(ii) demo item 1's end-to-end REPLACE at today's natural scale is carried by 2c steering + the
chunk-05 two-axis dedup — the demo therefore includes a **seeded above-cap scenario** (glass-box
harness) so the embedding lane itself is what's being proven; (iii) if Lior's real fact count is
still far below 50 at build time, consumer (b) ships dormant and the search tool (consumer a) is
the part earning its keep immediately — stated so nobody mis-attributes the win.

**D5c. The deterministic dedup/suppression keys are the RIDERS' surface, not the ranker's:**
`factExistsByDedupKey` (already two-axis after 2c chunk-05) is untouched; the d5 D6b consult gains
the canonical axis (§3.7 R2). **NAMED residual (accepted):** a re-derivation that is BOTH
fully-reworded in display AND lands a different canonical still slips deterministic suppression;
semantic AUTO-suppression is rejected (§1 Out — over-suppression risk). The honest ceiling: hybrid
candidate-fetch makes the LLM *see* the near-duplicate (so it proposes replace/no-op instead), but
no deterministic gate hard-blocks that slip. Golden set measures how rare it is in practice.

### 3.6 — D6: consumer (a) — the `memory_search` read tool (ADR-0016 plane)

**D6a. Registry row, not structure — with the four seams SPECIFIED, not freelanced [grill #3]:**
- add `"memory_search"` to `MemoryActionToolName` + a `kind:"read"` row in `MEMORY_ACTION_TOOLS`
  (`memory-action-tools.ts:20/34` — the `satisfies` totality guard forces classification) + a
  `dispatchTool` branch (`anthropic-api-provider.ts:161-208`).
- **Result type:** the `MemoryActionResult` union WIDENS with a search variant
  (`{ok:true, action:"search", results: SearchHit[]}` — `SearchHit = {kind:"fact"|"archive", …}`);
  `serializeToolResult` handles it; the "de-facto 2d contract" comment at
  `memory-action-tools.ts:81` is updated, not silently outgrown.
- **Port wiring:** `MemoryActionPort`'s constructor dependency set (`store/gate/scanner`,
  `memory-action-port.ts:46-51`) gains the chunk-04 RANKER — constructed in `index.ts` before the
  port, same DI chain as today.
- Input schema: `{ query: string, scope?: "facts" | "archive" | "all" /* default "all" */ }`.
- Results (typed, never-throw — gotcha #9): top-N (cap ~8 [architect-time]).
  Tombstone/correction-honoring reads ONLY (the standing archive-read posture); quarantined
  content excluded; **snippets pass the `RuleBasedScanner` — flagged snippets are withheld with a
  typed note, and all result content is framed as quoted UNTRUSTED data in the `tool_result`,
  never as instructions [grill #6]**. Empty result ⇒ an honest typed "no matches" (the agent must
  say it doesn't know, not hallucinate).

**D6b. Read tools have NO durable audit event** — nothing changed, so audit-not-confirm does not
apply (ADR-0016 d(e) governs ACTIONS); observability = a `search` channel on `MEMORY_DEBUG` (the
existing env-gated glass-box pattern). **Caps [grill #3d — the draft's "write-cap semantics
unchanged" was self-contradictory]:** reads get their OWN counter — `MemoryActionTurnContext`
(today `ordinalMap`+`actionsUsed`) gains `searchesUsed`; `MEMORY_SEARCH_MAX_PER_TURN` (default 3
[architect-time]) is enforced independently of the write cap; and the loop's round backstop
(`anthropic-api-provider.ts:474`, today `rounds >= MEMORY_ACTIONS_MAX_PER_TURN`) is raised to
`MEMORY_ACTIONS_MAX_PER_TURN + MEMORY_SEARCH_MAX_PER_TURN` — so 3 searches can no longer exhaust
the rounds a legitimate write needs. Cap exceeded ⇒ typed refusal, loop proceeds to final text.

**D6c. Targeting honesty (§0.2):** search results carry NO ordinals and never join the forget/replace
map. The capability-conditional self-concept (2c D8 pattern) gains: the agent CAN search its memory
and archive; found-but-not-in-view facts are still Memory-window territory for forget/edit; it must
answer from search results with attribution ("з розмови від …" — the generic provenance line
posture, provenance-affordance spec) and never present a search hit as a currently-injected fact.

**D6d. Capability-conditional, both directions (the v2-01 lying-defect rule):** no provider port ⇒
no `memory_search` in `tools[]` ⇒ the self-concept never claims search. Lexical-only degrade
(embedding provider absent but port present) keeps the tool — results just come from one leg.

### 3.7 — D7: the committed riders (each with §7.2 scope-cut rationale)

**R1 — message-edit REMOVAL** *(Lior 2026-07-10, final, «бестолковий»; backlog §D scope; ADR-0012
rider Ruling 1 removal-note — "shipped-but-doomed, do not build on it").* End state: **archive =
read-only immutable history; memory (facts) = the editable surface.** Remove:
- overlay: the per-MESSAGE edit affordance — `buildEditControl` usage on message rows
  (`apps/overlay/src/memory/render.ts:83`, `MessageActions.onEdit` `render.ts:15-17`), the
  controller `editAction`/`editedIds` session-tag lane (`controller.ts:102-104/177-179`), and the
  `editMessage` HTTP client (`memory-write.ts:60-62`). **Fact-edit stays intact**
  (`onEditFact`/`editFact` — the 5a lever).
- `history.html`: the message "Edit" button + `doEdit` (`history-page.ts:369-376/550-616`).
- daemon: the `/memory/edit` MESSAGE branch (`http-routes.ts:258-270`) — `target_type:"fact"` KEEPS
  working (`:240-256`); a message-shaped body now gets 400 (the same posture the forget route
  already took, `:216-217`).
- **KEEP the machinery** (ADR-0015 B1): `WriteGate.edit`, `mutations` kind `'correction'`, the
  `readThreadArchive` COALESCE — already-recorded corrections keep rendering; the primitive
  predates the UI and other things sit on it. KEEP `Hatch.edit` only if a non-HTTP consumer exists
  at build time [architect-time: if HTTP was the sole caller, retire the hatch method too — dead
  code is the thing being removed].
- WHY here: the ruling itself pinned execution to the 2d pass; it blocks nothing and touches
  surfaces (overlay Memory window, history.html, http-routes) that no other 2d chunk touches.

**R2 — `forgotten_facts` canonical axis** *(2c chunk-01 flag, spec §3.6 rider; ledger PR #86;
in-code note `distiller-registration.ts:193-198`).* `forgotten_facts` gains a **`canonical`
column** (nullable), wired for BOTH store generations [grill #5 — the draft miscited
`ensureDistilledThroughTurnColumn` as "runtime-guarded"; it is migration-script-only]:
- **fresh stores:** `canonical TEXT` joins the `forgotten_facts` CREATE TABLE in `SCHEMA_DDL`
  (`schema.ts:92-101`);
- **existing stores (Lior's live dogfood db):** a PRAGMA-guarded idempotent ensure-column runs in
  the `MemoryStore` CONSTRUCTOR right after `SCHEMA_DDL` exec (`store.ts:182`) — the
  `ensureDistilledThroughTurnColumn` mechanics but with a wired always-run call site (the check is
  a one-time cheap PRAGMA; no separate migration script for one nullable column).

`MemoryActionPort.forget` writes it from the target's `fact_fts.canonical`; the D6b consult
(`distiller-registration.ts:189-203`) matches on **canonical OR display** (both axes — the exact
two-axis lesson of 2c chunk-05). Legacy NULL-canonical rows keep display-only matching (honest,
logged). The D6c prompt nudge is unchanged (soft layer). The `:193-198` limitation note is
REWRITTEN (its residual closes here — no stale contradictions, the m3 lesson).

**R3 — d5 display-text residual + D6c flake fix** *(same surface as R2 — closed together per the
backlog; flake = 3× observed, always first-run-after-install, ledger PR #90).*
- The display-axis residual closes as a side effect of R2's two-axis consult (display matching
  stays; canonical joins it).
- **Flake root (recon-confirmed):** `readForgottenFacts` (`store.ts:363-372`) orders by
  `created_at DESC` with NO tie-break; `recordForgottenFact` stamps `Date.now()` — a fast first
  run lands 15 loop-inserted rows in one millisecond, SQLite returns an arbitrary 10, the D6c test
  (`smart-distiller-provider.test.ts:441-464`, expects exactly the most-recent 10) flakes. **Fix:**
  `ORDER BY created_at DESC, rowid DESC` + de-collide the test's substring assert. Sweep the other
  two tie-break-less reads (`readDistillationEvents` `store.ts:783`, `readReplacedFacts`
  `store.ts:1027`) — **those two order ASC, so their tie-break is `, rowid ASC`** (matching the
  existing FIX-7 precedent `readMemoryActionEvents` `store.ts:1048`; a DESC rowid on an ASC read
  would interleave inconsistently [grill #10]). One class, one fix, direction-matched.

### 3.8 — D8: the golden-set eval — the acceptance instrument (research §3/§8/§9)

**No hard Ukrainian retrieval-quality number exists for ANY embedding model** (UA absent from
MIRACL) — so marketing claims decide nothing; **our own defects do.**

**D8a. Contents (fixture file, versioned in-repo):**
1. the demo-3 pair: «мій улюблений колір синій» ↔ canonical "favorite color blue", + the change
   case (зелений→синій → the contradicting fact must rank top-K for the REPLACE to fire);
2. the 2c chunk-01 16-rephrase-class matrix (connector words, case, punctuation, UK/EN swaps —
   reconstructed from the PR #86 verification record);
3. cross-language paraphrase pairs (UA statement ↔ EN paraphrase, NOT literal translation — the
   LaBSE-weakness case, deliberately);
4. negative controls (unrelated UA/EN pairs that must NOT rank top-3; the suppression-safety check).

**D8b. Two-layer instrument (honest split):**
- **CI layer (deterministic):** ranker/fusion/tie-break logic tested with FIXTURE vectors — no
  model download in CI, no flake.
- **Executed-eval layer (Strike-5 posture):** a `scripts/retrieval-golden-eval.ts` probe (the
  `memory-demo-harness.ts` family) runs the REAL default-lane model over the golden set **on a
  seeded >`ALL_FACTS_CAP` store** (below the cap the candidate path under test never runs —
  [grill #4]); its stdout goes in the chunk PR. **RED baseline first:** the probe proves BM25-alone
  FAILS the UK↔EN cases (the defect exists) before proving hybrid passes — evidence, not assertion.
- **Acceptance bar — PINNED to the real consumer cutoffs [grill #8, the anti-gameability fix]:**
  distiller leg = every §D8a-1/2 positive case ranks within **`CANDIDATE_TOP_K` (=10) of the FUSED
  list** (the cutoff the LLM actually sees); search leg = within the **result cap (~8)**. "Top-20
  per leg" is retrieval plumbing, never the bar. Zero negative-control violations at the same
  cutoffs. **Stated plainly: the golden set measures CANDIDATE-SURFACING; the end-to-end REPLACE
  firing is demo item 1's job** (§5) — a green eval + a failed demo means the miss is LLM steering
  (the O3 class), and that attribution is the point of splitting the two instruments. A model that
  fails the bar ⇒ try the next candidate model (D2c) ⇒ still failing ⇒ escalate the §0.1 fork (the
  hosted lane is the deliberate fallback for exactly this outcome).

---

## 4. §7.1 runtime-coupling notes (for the decomposer/orchestrator — flagged now)

1. **`fetchCandidates` above-cap lane swap** (D5a) — a behavioral contract change inside an
   unchanged method signature (the M2 lesson: signatures hide contracts). The distiller's v2 test
   suite must stay green; the new lane gets its own above-cap tests (cap is 50 — tests must seed >50
   facts or lower the constant via test seam [architect-time]).
2. **`appendMessages` ↔ the stateless drain** — the single archive write path gains a sync
   `message_fts` write inside its tx + a drain KICK (no shared queue state — pending is a query,
   D3b); the drain runs OUTSIDE any tx. Drain ↔ dismiss-distill can interleave — read/UPSERT on
   disjoint tables; no shared mutable row. Verify no tx nesting (bun:sqlite forbids it).
3. **Scrub path ↔ embeddings/FTS cleanup ↔ the drain race** — `WriteGate.forget` (tombstone scrub)
   must now also delete `message_embeddings` + `message_fts` rows, AND the drain's
   tombstone-re-check-in-upsert-tx (D3b) is what closes the scrub-mid-drain race [grill #1] —
   test the interleave deterministically. **⚠️ Ruling-2 trap flagged for 2e [grill #9]:** the kept
   primitive TODAY also sweeps derived facts (`write-gate.ts:98-99` `dropDistilledFactsByProvenance`
   / `dropDistilledFactsForThread`) — behavior ADR-0012 rider Ruling 2 (2026-07-10) forbids for
   source erasure ("source erasure never sweeps facts"). 2d does NOT fix that (no user path calls
   the primitive today) but the doc comment 2d adds MUST flag it: **2e cannot reuse this primitive
   unchanged** — its fact-sweep calls must be removed/reworked at 2e design time.
4. **`forgotten_facts` column + consult widening** (R2) — touches the 2c writer
   (`MemoryActionPort.forget`), the D6b consult, and the D6c/D6e clear paths; the precedence chain
   (human ▷ un-forget ▷ record ▷ re-derivation) is byte-carried, only the MATCH KEY widens.
5. **Registry/type growth + the loop-bound change** (D6a/D6b) — `MemoryActionToolName` AND
   `MemoryActionResult` unions widen; the `satisfies` table forces the row; `serializeToolResult`
   + the `memory-action-tools.ts:81` contract comment update together; the loop's round backstop
   RISES (write-cap + read-cap — a behavioral change to `advance()` hidden behind an unchanged
   port signature [grill #3]); the provider loop's `useTools` behavior must remain byte-identical
   when the port is absent (the 2c no-port ⇒ no-tools-key invariant re-asserted).
6. **message-edit removal** (R1) — overlay controller/session-tag state, history.html JS, and the
   HTTP branch change together; the overlay's `editedIds` render path dies with it. Tests asserting
   the message-edit flow are REMOVED (not skipped); the fact-edit tests are re-asserted untouched.
7. **EmbeddingProvider absent/failed ⇒ lexical-only** at EVERY consumer (ranker, search tool,
   candidate-fetch) — one degrade contract, asserted once per consumer (the keyless-fallback
   pattern; suite must be green with NO provider configured — CI has none).

---

## 5. Verification model (PIPELINE §6; Strike-4/5 honored)

- **Real SQLite + real daemon path;** permitted stubs = the LLM `clientFactory` AND the
  `EmbeddingProvider` (fixture vectors) — both network/model boundaries. No mocked store internals.
- **CI-deterministic:** ranker fusion/tie-breaks on fixture vectors; degrade-to-lexical when
  provider absent; count-invariants after every delete/scrub path; **the scrub-mid-drain
  interleave (scrub lands between the drain's scan and its upsert ⇒ NO vector row survives —
  RED without the in-tx re-check [grill #1])**; D6b two-axis consult (canonical hit with reworded
  display — RED without R2); D6c order fix (the 15-in-one-ms seed — RED without the tie-break);
  read-cap independence (3 searches + a write still fits the raised loop bound [grill #3]);
  scanner-flagged search snippet withheld with the typed note [grill #6]; message-edit 400 +
  fact-edit 204; frozen byte-diff empty.
- **EXECUTED probes (Strike-5 — output in the PR, actually run, not just written):**
  1. the golden-set eval (D8b) — RED BM25-baseline THEN hybrid pass, real model, fresh store;
  2. a real `memory_search` end-to-end call through the real provider loop (real LLM invokes the
     tool; archive + fact scopes);
  3. the unicode61 re-check (D1b) on the build machine;
  4. the #46 status re-verify (is `oven-sh/bun#30431` still open? what Bun is installed?) recorded
     in the chunk-03 PR text.
- **Behavioral DoD = Lior's LIVE feature-closing demo (§6.1, non-negotiable):**
  1. UK↔EN root-fix live, TWO scenes [grill #4 — so the embedding lane itself is what's proven]:
     (a) natural scale — state a fact in Ukrainian; restate/contradict it in English → no
     duplicate; the change → REPLACE, visible in the Memory window; (b) the SEEDED above-cap
     scene (demo-harness store, >`ALL_FACTS_CAP` facts) — the same UK↔EN contradiction where
     BM25-alone provably misses the candidate (the RED baseline) and the hybrid lane surfaces it
     → REPLACE fires. Scene (a) can pass on 2c steering alone; scene (b) is the feature thesis;
  2. «що я казав про X?» where X is NOT in the injected slice → the agent SEARCHES, answers with
     the archive/fact attribution, honestly;
  3. forget a fact → a REWORDED same-canonical re-derivation attempt stays suppressed (R2 live);
  4. message-edit is GONE (overlay + history.html), fact-edit still works with the durable badge;
  5. pull the provider (env unset) → everything still answers, lexical-only (degrade honesty).
- **Demo env:** ANTHROPIC key (Keychain), `LLM_PROVIDER=anthropic-api`, `EMBEDDING_PROVIDER`
  per §0.1 default, `MEMORY_DEBUG=action,distill,retrieve,forget,search`.

---

## 6. Decomposition (chunks-todo/hybrid-retrieval/) — 6 chunks

Riders first (independent, drain committed decisions); then the embedding lane bottom-up.

| # | Chunk | Establishes | Depends on |
|---|---|---|---|
| **01** | message-edit removal + D6c flake fix | R1 end-to-end (overlay + history.html + HTTP branch; machinery kept) + R3's tie-break fix + `rowid` hardening sweep | none |
| **02** | forgotten_facts canonical axis | R2: guarded-ALTER column, port.forget writes canonical, two-axis D6b consult, 16-rephrase + cross-language tests | none (01 recommended first — same test files) |
| **03** | EmbeddingProvider port + storage | #46 re-verify + WASM SPIKE (gate); port + registry + env + degrade; `fact_embeddings`/`message_embeddings`/`message_fts` + the stateless drain (restart-safe, scrub-race-guarded) + scrub-cleanup + backfill script; fixture-vector provider; Voyage = documented shape only [grill #7] | none |
| **04** | hybrid ranker + candidate-fetch | RRF ranker (both corpora); `fetchCandidates` above-cap lane swap; **golden-set eval EXECUTED (RED baseline → hybrid pass)**; unicode61 re-check | 03 |
| **05** | `memory_search` read tool | registry `kind:read` row + result-union widening + port read method (ranker DI) + loop dispatch; independent read-cap + raised loop bound [grill #3]; scanner-on-snippets + untrusted framing [grill #6]; capability-conditional self-concept + targeting honesty; ADR-0016 d7 rider rides the feature PR set; MEMORY_DEBUG `search`; real-API probe | 04 |
| **06** | e2e closeout + LIVE demo | full-path wiring proof; docs reconcile (backlog §D → shipped, roadmap tick, gotcha #46/#47 status notes); **Lior LIVE demo (§5 items 1–5)** | 05 |

01/02 are runtime-independent of 03–06 (disjoint tables/paths — §7.1-checked: the only shared
surface is `forgotten_facts` reads, which 03+ do not touch). Chunks do NOT start before Lior's
§5.2 spec sign-off (+ ADR-0017 acceptance if ruled).

---

## 7. Open at build (architect-time, NOT spec-frozen)

- Exact embedding model (D2c — golden-set-gated) + quantization + download/caching location.
- Leg top-K values, RRF k (=60 default), result caps, `MEMORY_SEARCH_MAX_PER_TURN`.
- Float32 BLOB encoding details; the embed-queue drain mechanics (whenIdle vs interval).
- `memory_search` result snippet shaping; the tool description wording (registry row is frozen).
- Whether `Hatch.edit` survives R1 (dead-code check at build).
- Above-cap test seeding strategy (real 51 facts vs injectable cap constant).

## Related

- [[../research/2026-07-13-hybrid-retrieval-bm25-embeddings]] — the load-bearing input (all forks + leans).
- [[../adr/0012-conversation-and-memory-model]] — decision 6 executed; STABILITY amendment untouched; rider Ruling 1 removal-note (R1) + Ruling 2 (§0.3).
- [[../adr/0016-agent-memory-action-tools]] — the plane; the `kind:read` slot consumed; guardrails unchanged (§0.2).
- [[../adr/0015-intent-based-memory-forget]] — B1 carried; the kept scrub primitive gains embedding cleanup (§4.3).
- [[2026-06-13-memory-distiller-v2]] — D-V4 carried/partially superseded (§3.5); the M2/B1/B2 lessons reused throughout.
- [[../memory-backlog]] §D (the charter + riders) · §C (2e interplay) · §B (O2/O3 weigh-in).
- [[../known-gotchas]] #46 (native onnxruntime crash — WASM lane + build-time re-verify) · #47 (sqlite-vec loading — brute-force BLOB instead) · #9 (typed results).
- `orchestration/.conveyor/bus/{q,a}/017-*.md` — the conductor ruling of record (privacy fork · ADR call · search targetability).
- [[../PIPELINE]] §3 (spec) · §5.2 (sign-off + ADR gate) · §6 (verified-done) · §7.1/§7.2 · §11 (the conveyor).
