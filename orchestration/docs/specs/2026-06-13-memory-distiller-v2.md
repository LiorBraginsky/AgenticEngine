---
title: Memory Distiller v2 — incremental, stable-id, FTS5-similarity (the stability pivot)
status: draft
date: 2026-06-13
deciders: [lior]
feeds: memory-quality
implements: adr/0012-conversation-and-memory-model (+ the 2026-06-13 re-derivability AMENDMENT, proposed)
supersedes: specs/2026-06-12-memory-quality.md §3.2 D4–D5 + §3.3 D8 (GLOBAL re-projection STRATEGY) and §3.4 (the parked default-flip, chunk 06)
refines: specs/2026-06-13-forget-flow.md §2/§4 (how forget behaves in the INCREMENTAL, stable-id era)
cites: research/2026-06-13-memory-similarity-approaches.md (the FTS5 verdict)
route-part: 1 (corrective re-architecture of 2b — the distiller STRATEGY, triggered by Lior's 2026-06-13 live demo)
tags: [spec, memory, distiller, incremental, stability, fts5, topic-tags, forget, language, re-derivability]
---

# Memory Distiller v2 — spec (incremental + stable-id + FTS5)

> **Pipeline placement.** Frontier (fable) **design + decompose** pass (PIPELINE §11), triggered by
> Lior's 2026-06-13 LIVE demo of the shipped 2b distiller. The demo proved that **global
> re-projection + a non-deterministic LLM = UNSTABLE memory** — every dismiss re-derived the WHOLE
> projection, so facts visibly **churned (reworded), reordered, and DISAPPEARED** ("a forget re-wrote
> every fact; a reload showed a different, smaller set"). For a *memory* feature this is
> disqualifying: "my name is Lior" must stay put. Lior pivoted 2b's distiller from GLOBAL
> RE-PROJECTION to **INCREMENTAL**. This spec is that re-architecture.
>
> **Decision provenance.** Research-first (engine-researcher report cited below) → seams routed UP via
> the dev-bus (PIPELINE §11.4), ruled by the conductor — **q#008** (scope + semantic tech), **q#009**
> (the ADR-0012 amendment wording), **q#010** (incremental mechanics), **q#011** (store shape +
> migration). Rulings in `.conveyor/bus/a/00{8,9}-*.md` + `a/01{0,1}-*.md`. An adversarial grill pass
> (engine-reviewer design-critic, this pass) found **B1/B2/B3 (blockers) + M1–M5 + m1–m4**; all are
> folded inline and tagged `[grill Bn/Mn/mn]`.
>
> **§5.2 gate (NOT signed yet).** This spec is `draft`; the **ADR-0012 re-derivability amendment**
> (`proposed`) rides the same PR. Both are **Lior's §5.2 acceptance gate** — hard-to-reverse tier
> (it amends the memory north-star's HARD INVARIANT and reworks a 2c-facing contract). **No
> auto-merge.** The conductor escalates spec + amendment to Lior together.
>
> **What CARRIES OVER from the merged build (01–05), untouched in shape:** the storage shape
> (`messages`/`mutations`/`distilled_facts`/`distillation_events`/`quarantine_markers`/`forgotten_facts`),
> the 2a self-concept module (`system-prompt.ts`) — *amended* here for one gap, the forget
> intent-dispatch + separate-table B1 invariant (ADR-0015), the per-fact security scan, the
> `resolveAnthropicKey`/`clientFactory` DI, the never-throw port contract, and the MAJOR-3 promise
> queue. **What is REPLACED:** the global-re-projection STRATEGY in `smart-distiller-provider.ts` +
> the `replaceProjection` DELETE-all apply in `distiller-registration.ts`. **What SIMPLIFIES:**
> fact-forget (now a durable delete of a stable-id row).

---

## 1. Purpose & scope

**Fix the instability defect** exposed by Lior's 2026-06-13 demo, and fold the four demo findings.

**In scope (2b re-architecture, backend/agent — no in-overlay UI dependency; demo on `history.html`):**
- Replace the global-re-projection distiller with an **incremental, stable-id** distiller.
- A **FTS5 fact-similarity layer** (per the research) to make "find the contradicting/related fact"
  tractable — the same layer 2d will reuse.
- **Topic-tags** grouping related facts (additive schema).
- **forget simplification** for the incremental, stable-id era (carries the ADR-0015 contract).
- **The four demo findings** (§3.7): stability (the headline), the 2a "cannot self-forget" prompt
  gap, distiller **language preservation**, and an **executed end-to-end forget probe**.

**Out of scope (recorded, with WHY — PIPELINE §7.2):**
- **2d retrieval** (archive RAG over `messages`) — **the NEXT feature** (q#008). The fact-side FTS5
  built here is reused by 2d; 2d adds the message-archive side + (per research) local embeddings,
  where Bun/macOS `sqlite-vec`/`onnxruntime-node` complexity is warranted by the harder use case.
  **NOT folded in now** (q#008 — folding it drags embedding-install complexity in prematurely).
- **Local embeddings / hosted embedding API** — DEFERRED to 2d (research verdict; q#008). FTS5 + the
  LLM-already-in-the-distill-call cover the contradiction/dedup task at dogfood scale.
- **In-overlay memory UI** — separate follow-on (unchanged from the 2026-06-12 scope SPLIT).
- **2c (agent memory-action tools / conversational forget)** — still queued. The self-concept fix
  (§3.6) is the *honest deferral* of it, not the capability.
- **Promoting the two research gotchas** (`setCustomSQLite`, `onnxruntime-node`+Bun) to
  `known-gotchas.md` — recommended to the conductor (they bite 2d, not this pass).

---

## 2. Frame carried (locked elsewhere, not re-decided here)

- **ADR-0012** north-star (one agent that remembers; two stores; transparency 5a–f) — **AMENDED** here:
  its HARD INVARIANT moves from *re-derivable projection* to *stateful, stability-guaranteed, auditable,
  forgettable, best-effort-replayable* (§3.5 / the proposed amendment). The amendment is Lior's gate.
- **ADR-0015 / forget-flow spec**: intent-dispatch, the **separate-table B1 invariant** (fact-forget
  touches neither `messages` nor `mutations`, never calls `tombstoneFact`), and the **HARD
  message-forget** guarantee are **carried unchanged**. Only fact-forget's *internals* simplify (§3.6).
- **Research report** `2026-06-13-memory-similarity-approaches.md`: FTS5/BM25 over `distilled_facts`
  is the right NOW; embeddings are the right 2d tool, deferred. This spec's similarity layer (§3.4)
  is designed FROM that report.
- **Frozen surfaces:** `@agentic/protocol` and the `mock-agent.ts` reducer — **byte-unchanged**. The
  **`MemoryProvider` port is NOT frozen** (confirmed: only the two above are; memory-quality §2). Its
  redefinition here is a deliberate, §7.1-flagged behavioral-contract change [grill B3].

---

## 3. Spec decisions

### 3.1 — V1: the incremental DELTA port (q#010; [grill B2/M1/M5])

**D-V1.** `MemoryProvider.distill(store, threadId)` no longer returns the complete projection. It
returns a **delta** describing how the just-ended conversation changes the fact store:

```ts
interface FactOp {
  op: "new" | "append" | "replace";
  fact: string;            // user-language DISPLAY text (language preserved — §3.6 finding 3)
  canonical: string;       // normalized match key for FTS5/dedup (§3.4 / [grill m4])
  topics: string[];        // coarse LLM-assigned tags (§3.5)
  targetOrdinal?: number;  // 1..K index into the candidate list the LLM was shown (NOT a uuid — [grill B2])
  expectedTargetText?: string; // the candidate text the LLM reasoned about (optimistic-concurrency — [grill M5])
}
interface DistillDelta {
  threadId: string;             // the trigger thread
  ops: FactOp[];
  distilledThroughMarker: number; // the per-thread mutation marker this delta covers ([grill M4])
}
```

- **Reads ONLY the just-ended thread, and only its messages SINCE the last distill** (the new tail —
  not the whole thread), so a re-adopted/extended thread is processed incrementally without
  reprocessing old messages [grill M4]. First distill of a thread = its whole (tombstone/quarantine-
  honored) message set. Same tombstone-/quarantine-honored reads as today.
- **Candidate fetch is FTS5/BM25 over the FULL `distilled_facts` corpus** (§3.4), top-K, passed to
  the LLM as `{ordinal: 1..K, fact, topics}`. The LLM proposes, per candidate fact, an `op` +
  `targetOrdinal` (a small integer it copies back — far more reliable than echoing an opaque uuid
  [grill B2]) + `canonical` + `topics` + the user-language `fact`.
- **The LLM call + FTS5 fetch run OUTSIDE any transaction** (the grill-#6 / §7.1 seam preserved); the
  registration applies the delta in ONE small synchronous tx.
- **`distilled_facts.id` is now STABLE across dismisses.** This stable id + the targeted delta is the
  structural basis of stability (q#010).

### 3.2 — V2: asymmetric-risk apply, LLM-judged + rule-gated destructive path (q#010; [grill B2/M5])

**D-V2.** REPLACE is destructive (loses a fact); APPEND/NEW are additive. The LLM **proposes** the op;
the **destructive path is rule-gated** — the irreversible decision never rests on LLM confidence alone:

1. **Resolve `targetOrdinal` → real `distilled_facts.id`** server-side. Out-of-range / unresolvable →
   **demote to `new`** (non-destructive default) [grill B2].
2. **Optimistic-concurrency check** [grill M5]: the resolved target's CURRENT `fact` text must equal
   `expectedTargetText` (what the LLM saw). A concurrent queued run may have changed the target's text
   while this run computed outside-tx → **mismatch ⇒ conflict ⇒ demote to non-destructive**
   (keep-both / `new`). (Stable ids mean `targetOrdinal` still *points* at the row, but its text may
   have moved — "latest-wins" is a dead v1 invariant; the new invariant is *concurrent same-target
   deltas resolve non-destructive on conflict*.)
3. **Human precedence (5e):** machine **NEVER** replaces a human-authored fact. A REPLACE targeting a
   human row → demote to non-destructive.
4. **Auditability:** a REPLACE **records the replaced fact's text** (durably, recoverable in History) —
   the replaced fact is visible, not silently gone.
5. **Default non-destructive:** when the LLM is uncertain it must propose `append` or `new`, never
   `replace`. Stability favours keeping a redundant fact over destroying a true one.

**APPEND** appends to the targeted fact (same ordinal-resolve + concurrency check). **List growth is
bounded** [grill m1]: past N items (architect-tuned) the distiller emits a `new` fact (or a summary)
rather than growing one fact unbounded — an over-long concatenated fact both dilutes BM25 and eats the
bounded `retrieve` slice.

> **Failure mode A — false contradiction → wrong destructive REPLACE.** Mitigated by the
> high-confidence-only gate + the concurrency/human/audit guards above. A wrong replace is *recoverable*
> (replaced text recorded) and *bounded* (never a human fact).
> **Failure mode B — missed contradiction → duplicate/stale fact.** A NAMED accepted limit (q#010):
> the candidate fetch + canonical-form prompting make it rare; the residual is a redundant fact the
> user deletes via the hatch (research: "a UX inconvenience, not a correctness defect"). **Critically,
> B1's full-corpus fetch — not tag-scoping — is what keeps B rare** (see §3.4).

### 3.3 — V3: stable id, no DELETE-all, idempotence (q#010; [grill M1/M4])

**D-V3a. No DELETE-all on the happy path.** `replaceProjection` / `dropAllDistilledFacts` leave the
per-dismiss path entirely. The delta-apply uses **targeted** `insert` / `update-by-id` / `append-by-id`
/ `record-replaced`. (`dropAllDistilledFacts` survives ONLY for the explicit one-time migration — §3.8.)

**D-V3b. Idempotence guard keyed on a MUTATION MARKER, not `last_active_at`** [grill M4]. A per-thread
**monotonic mutation counter** that bumps on `appendMessages` **AND `edit` AND `forget`** (today only
`appendMessages` bumps `last_active_at`, so an edit/forget would be invisible to a timestamp guard).
The distiller skips a thread whose marker is unchanged since its `distilledThroughMarker`; otherwise it
distills only the new slice. Natural convergence backstops it: a re-stated candidate finds its own
existing fact via FTS5 → the LLM proposes a no-op/append, never a duplicate. **Re-distilling the same
unchanged conversation must NEVER duplicate — tested.**

**D-V3c. The apply tx is all-or-nothing AND advances the guard INSIDE it** [grill M1]. `bun:sqlite`
rolls a throwing tx back; the `distilledThroughMarker` advance is part of the SAME tx, so a partial
apply can never mark a thread "distilled" while its facts didn't land (the silent-fact-loss door M1
warned about). On failure → guard not advanced → **the next dismiss retries the same thread** (the
archive is lossless ⇒ nothing lost). The chunk-02 never-drop *intent* is preserved, but its mechanism
changes (§3.3 D-V3d).

**D-V3d. The never-drop failure path is re-purposed, not deleted** [grill M1]. Under incremental there
is no projection to drop; `recordReprojectionFailure`'s "surviving projection size" number is
meaningless. Re-purpose it to record a per-thread **`distill-failed`** event (re-using the chunk-05
`trigger` param) carrying the *attempted op count* (or no count), `console.error`, and rethrow so
`index.ts` logs the non-fatal error. **Truncation** (chunk-05's `reprojection-truncated`) is far less
likely now (the LLM output is one conversation's delta, not the whole archive) but the `stop_reason`
guard is KEPT defensively → `distill-truncated`.

**D-V3e. Batch-dismiss = N independent incremental distills** (one per dismissed thread); the
**MAJOR-3 promise-queue is KEPT** — it now serializes concurrent **same-fact** deltas, and D-V2's
optimistic-concurrency check is what makes that serialization correct (not "latest-wins").

### 3.4 — V4: the FTS5 fact-similarity layer (q#008; research; [grill B1/M2/m4])

**D-V4a. FTS5/BM25, NOT embeddings** (q#008; research report §1). Rationale, cited: FTS5 is already in
`bun:sqlite` (zero new dep, zero-infra); <1 ms over hundreds of rows; because facts are **LLM-produced
in canonical form** the lexical-overlap assumption holds; the residual synonym/antonym gap (blue≠red,
likes≠dislikes) is judged by **the LLM already in the distill call** over the FTS5 hits. Local
embeddings carry stacked Bun/macOS install risks; hosted (Voyage) conflicts with ADR-0011 + privacy.
Maps to ADR-0012 d.6 ("vector retrieval = swappable provider, not a v1 bet").

**D-V4b. Topic-tags WIDEN recall; they NEVER filter** [grill B1 — corrects q#010/q#011 "scoped to
topic-tag"]. **FROZEN INVARIANT: the contradiction-detection candidate set is never *reduced* by a
topic-tag.** BM25 runs over the **full** `distilled_facts` corpus; tags are a recall-widening /
re-rank *hint* only. Reason: tags are LLM-assigned per-call, non-deterministically — if "3 siblings"
(`#about-user`) and "2 siblings" (`#relationships`) were compared only within a shared tag, the
contradiction the pivot exists to fix would be **structurally hidden** and both facts would survive
forever (strictly worse than v1, which at least saw both in one digest). *This is a grill-driven
correction to the conductor's q#010/q#011 wording — flagged for Lior at §5.2.*

**D-V4c. Match on CANONICAL, display in USER LANGUAGE** [grill m4 + finding 3]. The FTS5 column indexes
the `canonical` match key; `distilled_facts.fact` holds the user-language display text. This reconciles
"canonical for BM25 dedup" (research) with "preserve the user's language" (finding 3) — otherwise
preserving the language defeats the very canonicalization BM25 relies on. Match/dedup on canonical;
inject/display in the user's language.

**D-V4d. The FTS5 index can never desync** [grill M2 — §7.1]. Implementation: a standalone FTS5 table
`fact_fts(fact_id UNINDEXED, canonical, topic)`. Inserts/updates are written **in code** at fact
insert/update (where `canonical` is available — a SQL trigger can't compute it). **Deletes go through an
`AFTER DELETE ON distilled_facts` trigger** (`DELETE FROM fact_fts WHERE fact_id = old.id`) so the
index stays consistent across **every** delete path — `WriteGate.forget`'s
`dropDistilledFactsByProvenance`/`dropDistilledFactsForThread`, `purgeLiveMachineFactsByForget`, the
REPLACE record-and-remove, and the migration wipe — without trusting each call site to remember. **DoD
[frozen]:** after every delete path, `COUNT(fact_fts) == COUNT(distilled_facts)` and no orphan rows.

### 3.5 — V5: topic tags (q#011; [grill B1])

**D-V5.** The LLM assigns **coarse** tags at distill, as a `topics:[]` field per candidate (same call,
no extra round-trip). Controlled-ish prompt-nudged vocabulary (e.g. `#about-user`, `#preferences`,
`#projects`, `#relationships`), lowercase kebab — a retrieval **hint**, not a taxonomy (approximate is
fine; do not over-engineer). **Additive schema, NO ALTER** (dodges the §7 gotcha): a separate
`fact_topics(fact_id TEXT, topic TEXT)` join via `CREATE TABLE IF NOT EXISTS` + index, keyed on the
now-stable `distilled_facts.id` (one fact → many tags). Cleaned on fact-delete by the same delete
trigger as FTS5 (or explicit delete in each path; FK stays OFF per the store's design) [grill M2]. Tags
**never reduce** the candidate set (§3.4 D-V4b).

### 3.6 — forget under incremental + the demo findings (conductor "forget simplifies"; [grill M3/M4])

**D-V6a. fact-forget = durable delete of the stable-id row.** Because facts are no longer re-derived
wholesale, deleting a fact's stable-id row makes it **stay gone** — forget becomes a *durable delete*,
**strictly STRONGER** than the old best-effort-against-re-derivation. The ADR-0015 **separate-table B1
invariant, intent dispatch, and HARD message-forget are carried UNCHANGED.**

**D-V6b. `forgotten_facts` is RETAINED, narrower** [grill M3]. Its only remaining job is suppressing
re-derivation across the **replay / re-adoption** window (a forgotten fact's source thread is still in
the archive; if that thread is ever re-distilled, the fact could re-derive). Layer-T (canonical
text-match) runs **per-candidate at distill, before apply**. Two NAMED limits (best-effort ceiling,
§4 carried):
- **Un-forget on genuine re-statement / human re-pin.** A high-confidence FRESH conversational
  re-statement of a forgotten fact (the same asymmetric machinery) — or a human edit/re-pin — clears
  the `forgotten_facts` row; otherwise forget stays sticky until the user re-pins via the hatch. (This
  keeps stability honest: "never silently vanishes" applies to a *genuine new* statement.)
- **Cross-lingual gap** [grill m4/M3]: a fact forgotten in English won't normalize-match a re-derived
  Ukrainian canonical. Layer-T is best-effort and cross-lingual is out of its reach — **named, not
  silently broken.**

**D-V6c. message-forget drops derived facts — fix the comma-joined miss** [grill M4].
`dropDistilledFactsByProvenance` matches provenance by **exact string** and MISSES a comma-joined
provenance (the same MAJOR-1-class bug `purgeLiveMachineFactsByForget` already fixed). Fix it to match
by **component** so a message-forget removes facts derived from that message even in an aggregate
provenance.

**D-V6d. 2a self-concept fix — "cannot self-forget"** [finding 2]. The chunk-01 `MEMORY_SELF_CONCEPT`
tells the agent the *user* can delete via History but does NOT forbid the agent from *claiming to have
forgotten*. The demo agent lied "Done! I forgot your name" (it has no such tool — that's 2c). Add an
explicit frozen clause: **"You cannot modify, delete, or forget your own memory. Never claim to have
forgotten, changed, or deleted something you remember — only the user can, via the History page."**
Honest deferral; the actual conversational-forget capability stays 2c. (Edits `system-prompt.ts`; the
existing five D1 requirements remain.)

**D-V6e. Language preservation** [finding 3]. The distiller emitted English facts for a Ukrainian user.
The system prompt instructs: **emit `fact` (display) in the user's language**; `canonical` may
normalize for matching (§3.4 D-V4c). Tested: a Ukrainian conversation yields a Ukrainian display fact.

### 3.7 — The stale-build finding (finding 4)

The demo's `GET /memory/cofed` 404 / "no scrub" was almost certainly a **stale build** (that route is
new in chunk 04; `main`'s handler is correct and dispatches `forgetFactAndSources`). **Do NOT "fix"
correct code.** But the incremental redesign reworks the forget flow anyway, so: keep option-B + cofed
correct, and add an **EXECUTED end-to-end probe** through the real `history.html → HTTP → Hatch` path
(§5) so a future demo can't be fooled by a stale build.

### 3.8 — Migration (q#011; [grill m2])

**D-V8.** A **one-time, explicit, logged** migration script (NOT auto-on-startup): **wipe machine
`distilled_facts`** (known-bad: churned + wrong-language per the demo); **HUMAN facts preserved** (5e —
never wiped); rebuild `fact_fts` + `fact_topics` for any surviving rows. The **ordered-replay**
(re-distill conversation-by-conversation chronologically to reseed with tags + canonical + correct
language — the §3.5/amendment *replayability*) is **OPTIONAL**; "wipe + let new conversations re-distill
forward" is an equally-fine default (Lior has a backup + already chose a clean reset). The script
**reports `forgotten_facts` rows with zero match during replay** (observable resurrection risk —
[grill m2]) and is **verified on a real sqlite** (q#011 rider). Ships as a script/probe the user runs
deliberately.

---

## 4. The re-derivability AMENDMENT (ADR-0012 HARD INVARIANT) — summary (full text in the ADR)

The proposed amendment (q#009; `proposed`; Lior accepts at §5.2) — headline first:

- **STABILITY (the new headline guarantee):** *a distilled fact persists UNCHANGED until (a) a
  genuinely-contradicting new fact replaces it, (b) the user edits it, or (c) the user/forget removes
  it. It never silently rewords, reorders, or vanishes across dismisses.* This is the user-facing
  promise the demo proved missing, and it is what the whole pivot buys.
- **Archive stays lossless + immutable** (the invariant that actually matters — unchanged).
- **The fact store becomes a STATEFUL, incrementally-accumulated derived store — NOT pure f(archive)**
  (path-dependent: which fact replaced which, in what order).
- **Supporting properties:** **auditable** (provenance + recorded-replaced-text, 5c); **forgettable**
  (5a — now a DURABLE delete); **best-effort REPLAYABILITY** (re-distillation conversation-by-
  conversation is an explicit admin action for swap/recovery/migration — NOT a per-dismiss invariant;
  non-deterministic, lossy of forget-history).
- **Preserved:** transparency 5a–f, human-precedence 5e (now trivial — nothing re-derives over human
  facts), thread-isolation 5f. **Given up:** "disposable / regenerable-identically" — the store is now
  **durable state to back up + migrate** like any state.
- **m3 fold:** the amendment chunk MUST rewrite the now-false doc comments/tests that assert strict
  re-derivability (`memory-provider.ts:4/21-22` "re-derivable / re-run the projection",
  `dropAllDistilledFacts`'s "swap-proof / machine rebuild" purpose) — not leave silent contradictions.

---

## 5. Verification model (PIPELINE §6; Strike-4/5; q#011 rider)

- **Real SQLite + real daemon path; the ONLY permitted stub is the LLM `clientFactory`** (network
  boundary). No mocked store / injection point.
- **THE STABILITY TEST (the headline, new)** [finding 1]: with a **deterministic stub/echo LLM**,
  seed a fact ("User's name is Lior"), then run **N dismisses** that each re-distill threads producing
  the same/overlapping candidates → assert the fact's row **id is unchanged**, its text is
  **byte-identical**, the injected slice **order is stable**, and **no fact vanished**. (RED on the v1
  global-reprojection strategy.) Run on a **FRESH store** (matches how the feature ships, q#011 rider).
- **Idempotence test** [grill M4]: re-distill an unchanged thread → zero new/changed facts. Re-adopt a
  thread + 2 new messages + re-dismiss → only the new facts, no dups.
- **Asymmetric-risk tests** [grill B2/M5]: out-of-range `targetOrdinal` → demote to `new`; a
  concurrency-conflict (target text changed) → non-destructive fallback; machine never replaces a human
  fact; a REPLACE records the replaced text.
- **FTS5 sync DoD** [grill M2]: `COUNT(fact_fts) == COUNT(distilled_facts)` + no orphan `fact_topics`
  after each delete path (forget-fact, message-forget, REPLACE, migration-wipe).
- **B1 full-corpus invariant** [grill B1]: a contradicting fact with a DIFFERENT topic-tag is still
  surfaced as a candidate (tags don't filter).
- **forget tests (carried + simplified)**: B1 no-downgrade (carried from ch04 — fact-forget never
  scrubs/writes `mutations`); fact-forget durable delete *stays gone* across a re-dismiss with an echo
  stub; message-forget HARD (carried); comma-joined message-forget drops the aggregate-derived fact
  [grill M4]; cross-lingual Layer-T gap is a documented limit (not a failing test).
- **Language test** [finding 3]: a Ukrainian conversation → a Ukrainian display fact.
- **One EXECUTED real-API probe** (Strike-5; output in the PR) on a FRESH store: a real conversation →
  incremental distill → stable facts; and an **end-to-end forget probe through the real
  `history.html → HTTP → Hatch` path** [finding 4] (option-B + cofed proven, not stale-build-fooled).
- **The migration script gets its own real-sqlite check** (q#011 rider — it touches
  `~/.agentic-engine/memory.sqlite`).
- **Behavioral DoD = Lior's LIVE feature-closing demo** (§6.1, non-negotiable): (1) meta-question →
  truthful memory ownership AND **no false "I forgot that"** [finding 2]; (2) structured recall →
  precise answer + provenance link; (3) **STABILITY live**: dismiss several times → "my name is Lior"
  and other facts **stay put** (no churn/reorder/vanish); (4) forget a fact (durable, source intact);
  (5) message-forget (hard) + option-B (with the co-fed confirm); (6) a Ukrainian turn → a Ukrainian
  fact. **Demo env:** ANTHROPIC key (Keychain), `LLM_PROVIDER=anthropic-api`, the incremental provider
  active.

---

## 6. Swap-proof story under incremental [grill B3]

The port redefinition (full-projection → delta) breaks the two other providers and the swap-proof test.
Resolution (decided, written here):
- **Retire `FixedMarkerProvider`** — it existed only as the swap-proof second leg.
- **Adapt `DumbTailProvider` to the delta port** as **op:`'new'`-only** (no contradiction detection
  without an LLM), **idempotence-guarded** so it doesn't duplicate. It remains the **keyless fallback**
  (no resolvable key ⇒ dumb-tail with the loud log — daemon stays up, quality degrades not
  availability) AND the swap-proof second leg.
- **The swap-proof test changes meaning** [grill m3]: from "two providers produce equivalent full
  projections" to "**both providers honor the delta-port + stability contract**" (stable ids, no
  DELETE-all, idempotent). The `MemoryProvider` port doc + the now-false re-derivability comments are
  rewritten as part of the amendment/foundation chunk.

---

## 7. §7.1 runtime-coupling notes (flag at decompose)

1. **Port redefinition** (full-projection → delta) is a behavioral-contract change rippling through
   `distiller-registration.ts` (the three-phase DELETE-all apply → targeted delta apply + never-drop
   re-purpose), `memory-provider-selector.ts`, and both other providers [grill B3/M1]. Named DoD: the
   swap-proof test rewrite.
2. **FTS5 + `fact_topics` ↔ `distilled_facts` sync** across all ~5 delete paths — solved structurally
   by the `AFTER DELETE` trigger + the count-equality DoD [grill M2]. Unchanged method signatures hide
   an expanded contract — do not trust review vigilance.
3. **`WriteGate`(forget) ↔ distiller candidate-fetch** — eventually-consistent (carried from chunk 04);
   the immediate purge covers the live slice; the next distill's Layer-T covers re-derivation.
4. **Idempotence guard ↔ `edit`/`forget`** — the mutation marker must bump on edit/forget, not just
   append [grill M4]; this couples the human-edit/forget paths to the distiller's skip decision.
5. **MAJOR-3 queue semantics** — "latest-wins" is replaced by "non-destructive-on-conflict"; the
   optimistic-concurrency check (D-V2) is the mechanism [grill M5].

---

## 8. Re-decomposition (chunks-todo/memory-quality/) — supersedes the parked chunk 06

Strictly sequential (shared store + port + the candidate-fetch contract). The parked
`06-default-flip-and-demo.md` (the global-reprojection default flip) is **SUPERSEDED** — do NOT revive
it. The v2 build:

| # | Chunk | Establishes | Depends on |
|---|---|---|---|
| **v2-01** | self-concept "cannot self-forget" (2a-bis) + language-preservation prompt | D-V6d clause added to `MEMORY_SELF_CONCEPT`; the distiller language-preservation instruction (prompt only) | none (independent — ships value first) |
| **v2-02** | incremental store foundation | additive `fact_topics` + `fact_fts` (FTS5, canonical col) + `AFTER DELETE` sync trigger; stable-id delta-apply store primitives (insert-returning-id, update-by-id, append-by-id, record-replaced, BM25 full-corpus candidate-fetch, fact-delete cleans derived tables); mutation-counter; count-equality DoD. NO distiller logic. | v2-01 |
| **v2-03** | the incremental distiller (delta port) | `MemoryProvider` port → delta; `SmartDistiller` rewrite (read-new-tail, canonical+display+topics+op+targetOrdinal+expectedText); registration delta-apply (guard-in-tx, never-drop re-purpose, optimistic-concurrency); **FixedMarker retired + DumbTail adapted (delta op:'new') + swap-proof test rewritten** (B3); the **STABILITY test** + **EXECUTED probe** on a fresh store | v2-02 |
| **v2-04** | forget simplification + end-to-end probe | fact-forget = durable delete (stable id); `forgotten_facts` narrowed + Layer-T per-candidate + un-forget; `dropDistilledFactsByProvenance` comma-joined fix; carried B1/HARD message-forget; **EXECUTED `history.html→HTTP→Hatch` forget probe** (finding 4); cross-lingual limit named | v2-03 |
| **v2-05** | migration + default cutover + closing demo | one-time migration script (wipe-machine/human-preserved/optional-replay/resurrection-report, real-sqlite check); flip default → incremental; no-key fallback keeps suite green; **Lior LIVE demo** (§5, stability headline) | v2-04 |

Each chunk file: `Status: todo`, `## Orchestrator brief`, per-chunk scope rationale, the §7.1 notes it
touches, real-I/O + EXECUTED-probe posture, behavioral DoD escalated to v2-05. **v2-04/v2-05 ride the
§5.2 acceptance** (do not start the build before Lior accepts the spec + amendment).

---

## 9. Open at build (architect-time, NOT spec-frozen)

- `K` (candidate top-K), the canonical-normalization algorithm, the BM25 query construction, the
  append-list cap `N`, the high-confidence REPLACE threshold encoding, the exact `topics` vocabulary.
- The mutation-counter representation (a `threads` counter column needs an ALTER → use a separate
  `thread_distill_state(thread_id, marker, distilled_through)` additive table instead — architect's
  call, but **no ALTER on the live sqlite**).
- The `fact_fts` exact DDL (standalone vs external-content; trigram availability is UNVERIFIED in Bun's
  SQLite per the research — confirm at build) and whether `fact_topics` cleanup is trigger or explicit.
- Whether `DumbTailProvider` survives adaptation or is also retired if the delta adaptation isn't cheap
  (§6 — keep ONE production impl + one test-double either way).

## Related

- [[../adr/0012-conversation-and-memory-model]] — the north-star; **AMENDED** here (proposed) — re-derivable → stability.
- [[2026-06-12-memory-quality]] — the shipped 2a + the global-reprojection 2b this **supersedes** (§3.2 D4/D5, §3.4).
- [[2026-06-13-forget-flow]] · [[../adr/0015-intent-based-memory-forget]] — the forget contract this **refines** for the incremental era.
- [[../research/2026-06-13-memory-similarity-approaches]] — the FTS5 verdict this similarity layer is built FROM.
- `orchestration/.conveyor/bus/a/00{8,9}-*.md` + `a/01{0,1}-*.md` — the conductor rulings (q#008–011).
- [[../PIPELINE]] §3 (spec), §5.2 (sign-off + ADR acceptance), §6 (verified-done), §7.1/§7.2, §11/§11.4 (the conveyor + bus), §7.4 (the research lane).
