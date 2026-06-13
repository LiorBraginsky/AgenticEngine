---
title: Forget-flow redesign — smart-fact era (corrective pass on memory-quality §4)
status: draft
date: 2026-06-13
deciders: [lior]
feeds: memory-quality
implements: adr/0015-intent-based-memory-forget
extends: adr/0012-conversation-and-memory-model (5a/5e — clarifies, does not contradict)
refines: specs/2026-06-12-memory-quality.md §4 (how best-effort fact-forget is DELIVERED for smart facts)
route-part: 1 (quality pass — corrective, triggered by a hard-review finding on chunk 03)
tags: [spec, memory, forget, distiller, provenance, tombstone, intent-routing]
---

# Forget-flow redesign — spec (DRAFT — bus rulings q#004–007 folded; awaiting Lior §5.2)

> **Pipeline placement.** Frontier (fable) **design + decompose** pass (PIPELINE §11),
> triggered mid-feature by a hard-review finding on memory-quality chunk 03. Redesigns the
> **forget contract** for the smart-fact era so the §4-signed guarantees are delivered
> *properly* and adds the §4 "optional hard escape" (option B). The bus seams (q#004–007)
> are **ruled by the conductor** (decisions in `.conveyor/bus/a/00{4,5,6,7}-*.md`); this spec
> + ADR-0015 now go to **Lior at §5.2** for acceptance — this changes a forget contract 2c
> will build on → **hard-to-reverse tier**, full ADR-acceptance gate, no async shortcut, **no
> auto-merge** (PIPELINE Finding #5).
>
> **Refines memory-quality §4.** This is the same guarantee §4 signed — *forget a fact =
> best-effort; forget a message = hard; "also forget source" = optional hard escape* — it
> specifies **how that best-effort is actually DELIVERED for SMART facts** (where the
> chunk-03 implementation was dead code). It does NOT contradict §4; it makes it real.
>
> **Adversarial-grill pass folded (engine-reviewer, 2026-06-13).** Findings B1 (BLOCKER),
> M1–M4, m1–m3, n1 are folded inline and tagged `[grill Bn/Mn]`. The headline fold:
> **fact-forget and message-forget use SEPARATE durable artifacts** — `mutations`
> (`kind='tombstone'`) is the MESSAGE-**redaction** artifact ONLY; the new `forgotten_facts`
> is the FACT-**suppression** artifact ONLY. They never cross. This is what makes intent
> routing safe (B1) and resolves the conceptual conflation (n1).
>
> **Scope guard lifted, consciously.** The accepted memory-quality spec §1 said "no chunk may
> touch `history-page.ts`". **This corrective pass lifts that guard** — the broken thing *is*
> the forget UI, and option B's control lands in `history.html` (not a new overlay surface).
> The in-overlay memory UI stays OUT of scope; the demo surface remains `history.html`.

## 0. Terminology (n1 — keep these distinct)

- **redaction tombstone** — a `mutations` row, `kind='tombstone'`, keyed on a real
  `messages.id`. **Scrubs `messages.content`.** Written ONLY by `WriteGate.forget` (message
  path). `isMessageTombstoned` / tombstone-honored reads key off this.
- **fact-forget record** — a `forgotten_facts` row, keyed on the fact's **normalized text**.
  **Touches no message, scrubs nothing.** Written ONLY by the fact path. The best-effort
  suppression layers read this.

A fact-forget NEVER produces a redaction tombstone. A message-forget NEVER produces a
fact-forget record. (The old code conflated them through `mutations` — the root of B1.)

---

## 1. Why this pass exists (the hard-review finding)

memory-quality chunks 01–03 are MERGED. Chunk 03 shipped `SmartDistillerProvider`
(non-default). A hard-review found the **human-facing forget flow was built for the OLD
distiller (DumbTail) and silently breaks for SMART facts** — dormant now (smart is
non-default), **LIVE the instant chunk 04 flips the default**. Hard preconditions for the flip.

**Why DumbTail's forget flow doesn't transfer.** DumbTail assumed (1) a fact's `provenance` =
a SINGLE message id, and (2) a fact's text ≈ its source message's text (verbatim). So
"UUID-shaped provenance → scrub the source message" was *correct* (the fact WAS the message).
SmartDistiller breaks both: a smart fact (a) aggregates sources → `provenance` is
**comma-joined ids**; (b) is **canonical/derived** ("favourite colour: blue"), NOT a copy of
any message.

### Confirmed defects (code-traced)

- **MAJOR-2 — fact-forget HARD-SCRUBS the source message.** `history-page.ts:381` sends
  `f.provenance`. For a **single-source** smart fact that's a bare UUID → `Hatch.forget`
  (`hatch.ts:82`) routes it via `isMessageId` to `WriteGate.forget` → permanent
  `messages.content` scrub. A derived fact's "forget" irreversibly destroys real conversation
  history — **the source-deletion coupling Lior REJECTED at §4 sign-off.**
- **MAJOR-1 — the §4 best-effort layers are DEAD CODE on the production path.** For a
  **multi-source** fact `provenance="id1,id2"` → `forgetFact`→`tombstoneFact("id1,id2")`
  stores the joined string; the layer-1 check (`smart-distiller-provider.ts:367`) tests
  `isFactTombstoned("id1")`/`("id2")` **per-component** → never matches. Layers 2/3 read text
  from `distilled_facts`, but `dropDistilledFactsByProvenance` **purged that row at forget
  time** → no text. A forgotten smart fact **re-derives with zero layers firing.** (Tests
  passed only because they fabricate `tombstoneFact("thread:<id>")` — a shape smart never
  emits. Strike-4.)
- **MINOR-1 — thread-local smart facts inject into NO thread.** `readDistilledFactsForThread`
  (`store.ts:209`) joins `m.id = df.provenance`; a comma-joined provenance matches no single
  `messages.id` → the `thread-local` branch can't fire → fact silently invisible.
- **MINOR-3 — output-truncation LIVELOCK.** `SMART_MAX_TOKENS=1024`, no `stop_reason` check.
  The fact set (LLM **output**) grows with the archive; once it outgrows the cap → truncated
  JSON → `parseFacts` throws → `reprojection-failed` → "retry next disconnect" fails
  identically forever → the projection **freezes**.

### Structural root (frames the redesign)

1. **Dispatch by SHAPE, not INTENT.** `isMessageId(target)` conflates "this string is a
   message id" with "the user wants to scrub a message."
2. **No durable fact identity.** Neither `distilled_facts.id` nor `provenance` survives a
   re-projection (DELETE+INSERT with fresh uuids; the LLM re-assigns provenance freely). A
   durable fact-forget must key on the **normalized fact text** the user actually forgot,
   captured **at forget time**.

---

## 2. The redesigned forget contract

| Operation | Guarantee | What it does |
|---|---|---|
| **forget a MESSAGE** | **HARD** (unchanged) | `WriteGate.forget` — redaction tombstone + hard-scrub `messages.content`. |
| **forget a FACT** | **BEST-EFFORT** (§4 as signed) | fact-forget record ONLY — **no scrub, no mutations row**; purge the live row + record durably so re-projection's layers fire. |
| **forget a FACT + "also forget source(s)"** | **HARD** (opt-in) | the §4 **optional hard escape** (option B): fact-forget record PLUS a hard-scrub of each source message, behind an explicit, distinct, confirmed action — never the default. |

### D-A. Intent-based dispatch — with the data-layer backstop KEPT [grill B1] · [q#004]

Dispatch by explicit intent at every layer; **but the un-bypassable data-layer invariant
stays** — because a wrong/lying `target_type` must NEVER downgrade a message hard-scrub to a
no-scrub fact-forget (the "view-says-forgotten / disk-says-plaintext" breach
`store.ts:255-256` documents).

- **The invariant (server-side, un-bypassable):** the **fact path touches neither `messages`
  nor `mutations`.** It writes only `forgotten_facts` + purges machine `distilled_facts`
  rows. Therefore the `isMessageId`-throw in `WriteGate.forget`'s message path and in
  `store.tombstoneFact` **STAYS** — fact-forget simply *no longer calls* `tombstoneFact`. No
  `target_type` value can make the fact path scrub or write a redaction tombstone. B1 is
  **designed out**, not relocated into client JS.
- **Hatch** exposes intent-named methods:
  - `forgetMessage(messageId, ctx, reason)` → `WriteGate.forget` (HARD; `isMessageId` asserts
    inside).
  - `forgetFact(factText, provenance, ctx, reason)` → fact-forget record + purge, **no scrub**.
  - `forgetFactAndSources(factText, provenance, ctx, reason)` → fact-forget record + scrub each
    source (option B; D-C).
- **HTTP** `POST /memory/forget` body gains `target_type: "message" | "fact"` (+ optional
  `also_forget_sources`). `handleForget` dispatches; `HTTP_CTX` stays `authored_by:"human"`.
  The body shape is a de-facto contract — documented at the route [grill n2].
- **history.html**: message "Forget" sends `{target_type:"message", target:msgId}`; fact
  "Forget fact" sends `{target_type:"fact", fact_text, provenance}` (+ option B control, D-C).

> ☆ Alternative (q#004): single `forget(target,{targetType,alsoForgetSources})` param object
> — fewer methods, but a bool flag is easier to misuse + reads worse for 2c. Named methods +
> the separate-table invariant is the rec.

### D-B. Durable fact-forget record — make the layers actually fire [grill M1/M2] · [q#005]

Fact-forget does two decoupled jobs: **(1) immediate purge** (delete the matching live
machine row(s) now); **(2) durable suppression** (so the next re-projection suppresses the
re-derived equivalent, independent of the live row).

**New `forgotten_facts` table** (additive — `CREATE TABLE IF NOT EXISTS` creates a MISSING
table on an existing sqlite; no ALTER), captured AT forget time:

```
CREATE TABLE IF NOT EXISTS forgotten_facts (
  id               TEXT PRIMARY KEY,
  normalized_text  TEXT NOT NULL,   -- normalizeFactText(raw) — the load-bearing match key
  raw_text         TEXT NOT NULL,   -- what the user saw + forgot (layer-3 exclusion, display)
  provenance       TEXT,            -- as-forgotten (opportunistic layer-1 + audit)
  actor TEXT, reason TEXT, authored_by TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_forgotten_norm ON forgotten_facts(normalized_text);
```

**Immediate purge** matches the live row by the full forgotten identity —
`DELETE FROM distilled_facts WHERE (provenance = ? OR normalizeFactText(fact)=?)
AND authored_by != 'human'` (handles the comma-joined exact-string AND the text, so a
comma-joined row is not missed — fixes the M3.2/M4 purge-miss).

**The layers, honestly ranked** [grill M1]:
- **Layer-T (text) — the ONE real best-effort layer.** In `distill()` drop a machine
  candidate whose `normalizeFactText(fact)` ∈ `forgotten_facts.normalized_text`. Sourced from
  the durable table (not a deleted row).
- **Layer-P (provenance) — opportunistic, NOT marketed as defense.** Normalized
  provenance-SET equality against `forgotten_facts.provenance`. By root-cause #2 provenance is
  unstable, so this fires rarely; it costs nothing and occasionally helps. NOT set-intersection
  (one source feeds many facts → would over-suppress). Down-ranked to "opportunistic/audit."
- **Layer-X (LLM exclusion) — soft nudge.** `forgotten_facts.raw_text` as "do not re-emit"
  instructions. A generative model can ignore it.

**5e-aware filter + the human-precedence chain [grill M2 + q#005 rider].** Layer-T runs
*before* the replace and is `authored_by`-blind today — it would suppress even a later
HUMAN-authored fact with the same text. The fix is stated as a single coherent precedence
chain so a future reader can't reintroduce the blindspot:

1. **`forgotten_facts` is MACHINE-fact suppression ONLY.** A human-authored fact is **never**
   entered into it (the fact path that writes it carries `authored_by`; human facts are not
   forgotten via this mechanism — a human removes a human fact by other means, and human rows
   survive the replace per chunk-02 **D6** `authored_by != 'human'`).
2. **Layer-T must NOT suppress a candidate if a human-authored `distilled_fact` with the same
   normalized text exists.** Human-wins-at-injection (chunk-02 D6 / ADR-0012 5e) governs: a
   human re-pin always beats a machine forget.
3. **Un-forget on human re-authorship.** When a human authors/edits a fact whose normalized
   text matches a `forgotten_facts` row, that row is **cleared** — explicit human action lifts
   the suppression. (This is the deliberate inverse of D6: human precedence cuts both ways.)

This keeps `forgotten_facts` strictly below human authority in the precedence order:
**human-authored fact (D6, never dropped) ▷ human un-forget (clears the record) ▷ machine
fact-forget record (Layer-T suppression) ▷ machine re-derivation.**

#### Accepted limits (named, not blind) [q#005 rider]

- **`forgotten_facts` grows unbounded.** A consciously-accepted scaling limit (like D8's
  O(total archive)) — dogfood scale fine; human re-authorship is the natural eviction. The
  same future summarization tier (§1) that bounds the archive can compact this.
- **Pure-machine over-suppression.** Two genuinely different machine facts that normalize to
  the same text → forgetting one benignly suppresses the other. Within the §4 best-effort
  ceiling: no data loss (the source is intact; the fact can be re-stated + human-pinned to
  un-forget). Robust *conversational* un-forget is roadmap 2c.

> ☆ Alternatives (q#005): (a) reuse `mutations` (kind='fact_tombstone') — REJECTED, it
> re-creates the B1 conflation; (b) canonicalize provenance at DERIVE time so Layer-P is
> stable — pairs with, doesn't replace, Layer-T; deferred unless Layer-P proves worth it.

### D-C. Option B — the optional hard escape [grill M3] · [q#004]

On explicit opt-in (`also_forget_sources:true`), after the fact-forget record:
- enumerate sources = `provenance.split(",")` filtered to `isMessageId`; hard-scrub each via
  the **existing** `WriteGate.forget(messageId)` (reused, not re-implemented);
- **`thread:<id>`-shaped provenance** (FixedMarker shape; smart doesn't emit it) → option B is
  a **no-op with a clear message** ("this fact has no specific source messages to delete"),
  NOT a whole-thread scrub (too broad). [grill M3.1]
- **co-fed blast radius surfaced** [grill M3.2]: the confirm shows the **source-message count
  AND the count of OTHER facts those messages feed** (a cheap COUNT over `distilled_facts`
  whose provenance contains each id) — so "informed intent" is actually informed, not
  hand-waved. Plain "Forget fact" NEVER scrubs.

### D-D. MINOR-1 — thread-local injection fix [grill m1] · [folds into q#005]

`m.id = df.provenance` can't match a comma-joined provenance. Rec (over the `substr` SQL
hack): **resolve the origin-thread set in code** — split provenance, take message-id
components, look up their `thread_id`s — and filter; this handles the `thread:<id>` shape
uniformly and is clearer than SQL surgery on a frozen-write-path read. **Named assumption:**
a thread-local fact's "origin thread" = the thread(s) of its message-id components (for a
mis-scoped cross-thread aggregate this is approximate — acceptable, thread-local is distiller
judgment, D10). A tombstoned source keeps its row (forget scrubs content, not the row) → the
join still resolves [grill m1, confirmed OK].

### D-E. MINOR-3 — truncation guard + headroom [grill m2] · [q#006]

- `distill()` checks `response.stop_reason`; on `"max_tokens"` it **throws
  `SmartDistillError("truncated")`** → routes through chunk-02's existing **Phase-1 catch /
  `recordReprojectionFailure`** (never-drop, prior projection intact, byte-preserved). The
  ONLY delta: `recordReprojectionFailure` gains a **`trigger` param** so the event row reads
  `reprojection-truncated` (distinct from `reprojection-failed`). **§7.1 FLAG:** this is a
  *behavioral* contract change to chunk-02's frozen failure handler
  (`distiller-registration.ts`) — additive trigger value, stays within the never-drop
  invariant; called out at decompose.
- **Raise `SMART_MAX_TOKENS`** to headroom (≈4096–8192). **Stated plainly: this is a runway
  extension, NOT the cure** — at O(total archive) the cap is eventually re-hit; the real fix is
  the **summarization tier** (spec §1 out-of-scope). Truncation is now the **named trigger**
  for that tier. Headroom + the guard make the wall *observable and non-corrupting*, which is
  what unblocks the flip.

### D-F. retrieve() F1 backstop under the new semantics [grill M4]

`retrieve` (`smart-distiller-provider.ts:424`) currently filters live rows by
`isFactTombstoned(provenance)` (reads `mutations`). Under separate tables, a fact-forget
writes `forgotten_facts`, not `mutations`. Fix: `retrieve` filters live rows through **BOTH**
`isMessageTombstoned`/`isFactTombstoned` (the message-redaction superset) **AND** a
`forgotten_facts` normalized-text check (defense-in-depth covering the window between a forget
and the next re-projection, in case the immediate purge missed a row). The immediate purge is
best-effort-immediate; this backstop + the re-projection layers are the durable guarantee.

---

## 3. §7.1 runtime coupling (flag at decompose) [grill M4]

NEW shared-mutable-state edge: **`WriteGate` becomes a WRITER of `forgotten_facts`, which
`SmartDistillerProvider.distill` READS** to build the layers — two handlers that share no
state today. The chunk plan flags this (§7.1). The forget→distill interleave is
**eventually-consistent**: a forget landing after distill read the table but before its commit
is excluded *next* run; the immediate purge covers the live slice in the gap. Not a livelock,
documented. (MAJOR-3's promise-queue serializes re-projections; a `POST /memory/forget` is not
on that queue — its `forgotten_facts` INSERT is atomic, so the next distill sees a consistent
snapshot.)

## 4. 2c-awareness (don't build it; don't preclude it)

2c (agent memory-action tools) lets the AGENT forget conversationally. The contract is shaped
so 2c plugs into the SAME semantics: the agent calls `Hatch.forgetFact(factText, provenance,
ctx={actor:'agent', authored_by:'machine'}, …)` — same durable record, **no source scrub**
(option B stays human-gated; an agent must not destroy history on a conversational "forget");
5e still refuses a machine forget of a human-authored fact. Seam noted only.

---

## 5. Seams — RULED by the conductor (bus q#004–007, decided_by: jimmy)

| q# | Seam | Ruling (verbatim outcome) |
|---|---|---|
| **q#004** | Forget API shape (D-A dispatch + D-C option-B + 2c-compat) | **APPROVED** named methods + `target_type` + the **separate-table invariant FROZEN** (fact path touches neither `messages` nor `mutations`, never calls `tombstoneFact`; `isMessageId`-throw stays on the message path) + option-B mechanics incl. co-fed-count confirm. |
| **q#005** | Durable fact-forget record (D-B + MINOR-1) | **APPROVED (a)(b)(c).** New `forgotten_facts` (reject `mutations` reuse). Honest layer ranking (text=real; provenance/LLM=nudges; **do NOT say "3 layers"**). 5e-aware filter + un-forget tied to D6 precedence. MINOR-1 resolved in-code. |
| **q#006** | MINOR-3 + chunking | **APPROVED.** stop_reason→`SmartDistillError("truncated")`→ never-drop path w/ distinct `trigger="reprojection-truncated"`; `recordReprojectionFailure` gains a `trigger` param (§7.1, not frozen, additive — keep a never-drop test); raise cap as runway. **Chunking:** forget-contract = ONE chunk (incl. option-B), B1 as named DoD + no-downgrade test; **MINOR-3 = its OWN small chunk**; flip+demo LAST. |
| **q#007** | ADR-worthiness + spec placement | **APPROVED** new **ADR-0015** `status: proposed` (hard-to-reverse tier, Lior accepts, no auto-merge) + this new spec file cross-referencing §4 + the honest layer ranking. |

---

## 6. Verification posture (PIPELINE §6; Strike-4/5)

Real SQLite + real daemon path; ONLY stub = the LLM `clientFactory`. Tests exercise the PROD
boundary (Strike-4): forget through the **real Hatch→HTTP-body→WriteGate path** with
smart-shaped provenance (bare UUID + comma-joined) — NOT fabricated `thread:<id>` shapes.

- **B1 / no-downgrade [headline]:** `{target_type:"fact", target:<bare-msg-uuid>}` →
  `messages.content` byte-INTACT AND no `mutations` row written (the fact path can't scrub).
  And `{target_type:"message"}` still scrubs. (RED today — MAJOR-2 scrubs.)
- **Layer-T fires on the PROD shape:** forget a smart fact → SMART re-projection with an
  **echo stub** clientFactory re-emitting it → suppressed by `forgotten_facts.normalized_text`
  (RED without the durable record). Do NOT let Layer-P carry the RED [grill M1].
- **5e-aware filter:** a human-authored fact with matching normalized text is NOT suppressed;
  human re-authorship clears the `forgotten_facts` row (un-forget) [grill M2].
- **Option B:** forget-fact + also_forget_sources → source scrubbed; plain fact-forget leaves
  it intact; `thread:<id>` fact → option-B no-op with message [grill M3].
- **MINOR-1:** a thread-local multi-source fact IS injected into its origin thread.
- **MINOR-3:** stub `stop_reason:"max_tokens"` → distinct `reprojection-truncated` event +
  prior projection intact (no silent corruption) [grill m2].
- **One EXECUTED real-API probe** for the forget round-trip (Strike-5; output in PR).
- **Behavioral DoD = Lior's LIVE demo** at the LAST chunk, extended with forget steps.

---

## 7. Re-decomposition (chunks-todo/memory-quality/) — per q#006 ruling

Both new chunks land BEFORE the flip+demo chunk (renumbered LAST). Strictly sequential
(shared daemon + store + forget contract). q#006 ruling: forget contract = ONE coherent chunk
(incl. option-B); MINOR-3 = its OWN small chunk (different concern + isolates the §7.1 handler
change); 04↔05 relative order is independent (kept 04 first as the headline contract).

| # | Chunk | Establishes | Depends on |
|---|---|---|---|
| **04** | forget-flow contract | D-A dispatch (separate-table invariant, B1) + D-B durable `forgotten_facts` record + honest layers + 5e-aware filter/un-forget + **D-C option-B hard escape** + D-D MINOR-1 + D-F retrieve backstop. **B1 = a named DoD gate** with a dedicated "fact-forget never touches `messages`/`mutations`/`tombstoneFact`" no-downgrade test. | 03 |
| **05** | truncation guard (MINOR-3) | D-E: `stop_reason` guard → `SmartDistillError("truncated")` → never-drop path w/ distinct `reprojection-truncated`; `recordReprojectionFailure` gains a `trigger` param (§7.1, additive); raise `SMART_MAX_TOKENS` runway; record the summarization-tier trigger. | 03 (independent of 04) |
| **06** | default flip + closing demo | (renumbered old 04) `MEMORY_PROVIDER`→smart; no-key fallback green; Lior LIVE demo incl. the forget steps (§6). | 04 + 05 |

Each chunk: `Status: todo`, `## Orchestrator brief`, per-chunk scope rationale, §7.1
runtime-coupling note, real-I/O + EXECUTED-probe posture, behavioral DoD = Lior's live demo.

---

## Related

- [[../adr/0015-intent-based-memory-forget]] — the contract this spec implements (`proposed`).
- [[2026-06-12-memory-quality]] §4 — the guarantees this pass *delivers* for smart facts.
- [[../adr/0012-conversation-and-memory-model]] — 5a view/edit/forget + 5e; the forget
  contract this extends (does not contradict).
- `orchestration/.conveyor/bus/{q,a}/00{4,5,6,7}-*.md` — this spec's decision record.
- [[../PIPELINE]] §5.2 (sign-off), §7.1 (runtime coupling), Finding #5 (ADR-in-PR tiering).
