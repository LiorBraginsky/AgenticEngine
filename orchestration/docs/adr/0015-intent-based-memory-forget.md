---
status: proposed
date: 2026-06-13
deciders: [lior]
tags: [adr, memory, forget, distiller, provenance, tombstone, intent-routing, transparency]
---

# ADR-0015: Intent-based memory forget — separate fact-forget record + option-B source escape

## Status

`proposed` — **agent-authored during a frontier (fable) design pass** (PIPELINE §11),
triggered by a hard-review finding on memory-quality chunk 03. Bus seams q#004–007 ruled by
the conductor (`.conveyor/bus/a/00{4,5,6,7}-*.md`).

> **Hard-to-reverse tier (PIPELINE Finding #5).** This introduces a new durable store
> mechanism, changes the user-facing forget *dispatch* contract, and creates a cross-cutting
> contract the queued **2c (agent memory-action tools)** will build on. Therefore it takes the
> **full §5.2 ADR-acceptance gate**: Lior accepts before any merge — **no async shortcut, no
> auto-merge.** It rides the forget-flow decompose PR alongside
> [[../specs/2026-06-13-forget-flow]] (which carries the mechanics) and the re-decomposed
> chunk files.

## Context

ADR-0012 decision **5a** ("a view / edit / **forget** escape hatch — the user can always see,
correct, and delete what the agent remembers") and **5e** (human-authored memory wins) were
implemented in MF-05 over the **DumbTail** distiller. DumbTail assumed a distilled fact's
`provenance` is a **single `messages.id`** and a fact's text ≈ its source message's text (a
verbatim copy). On those assumptions the forget machinery dispatched **by provenance SHAPE**:
`Hatch.forget` (`hatch.ts:82`) routes a UUID-shaped target to `WriteGate.forget` (hard-scrub
the source message) and anything else to `forgetFact`. "The fact *was* the message", so
scrubbing the source removed the fact — correct then.

The memory-quality pass shipped **`SmartDistillerProvider`** (chunk 03, non-default). A smart
fact breaks both assumptions: it (a) **aggregates** sources → `provenance` is **comma-joined
ids**; (b) is **canonical / derived** ("favourite colour: blue") — NOT a copy of any message.
A hard-review found the forget flow is therefore **dead code / actively harmful** for smart
facts, and goes LIVE the instant the default flips to smart (chunk 06):

- **MAJOR-2** — a single-source smart fact's `provenance` is a bare UUID → shape-dispatch
  hard-**scrubs the source message** when the user asks to forget a *derived* fact. This is
  the exact source-deletion coupling **Lior rejected at the memory-quality §4 sign-off**.
- **MAJOR-1** — for a multi-source fact the §4 "best-effort layers" are dead: the tombstone
  stored the comma-joined string, the layer checks provenance per-component, and the fact's
  text row was purged at forget time → a forgotten fact re-derives with zero layers firing.

Two structural roots: **(1) dispatch by shape, not intent**; **(2) no durable fact identity**
(neither `distilled_facts.id` nor `provenance` survives a re-projection). The §4 frame
(signed by Lior) stands: the agent reads *injected facts*, not the raw archive, so **deleting
a fact already stops the agent using it**; the source remaining is intended; only
*re-derivation* by the generative distiller is the leak to mitigate. memory-quality §4 also
recorded that **"forget fact" may offer "also forget source messages" as an optional hard
escape** — this ADR makes that escape real.

## Decision

### 1. Dispatch memory-forget by explicit caller INTENT, not by provenance shape.

Three intent-named operations replace the shape heuristic, exposed as named `Hatch` methods
and selected by an HTTP `target_type` discriminator (q#004):

| Operation | Hatch method | Guarantee |
|---|---|---|
| forget a **message** | `forgetMessage(messageId, …)` → `WriteGate.forget` | **HARD** scrub (unchanged) |
| forget a **fact** | `forgetFact(factText, provenance, …)` | **BEST-EFFORT** suppression, **no scrub** |
| forget a fact **+ its sources** | `forgetFactAndSources(factText, provenance, …)` | **HARD** (opt-in escape) |

`POST /memory/forget` carries `target_type:"message"|"fact"` (+ `also_forget_sources?:bool`);
`history.html` sends the shape per button. (`isMessageId` is **deleted as a router**; it
survives only as a defensive assertion inside the message path.)

### 2. The separate-artifact invariant (load-bearing — frozen by q#004).

**Fact-forget and message-forget use SEPARATE durable artifacts that never cross:**

- **redaction tombstone** = a `mutations` row (`kind='tombstone'`) keyed on a real
  `messages.id`; **scrubs `messages.content`**. Written ONLY by `WriteGate.forget`.
- **fact-forget record** = a new `forgotten_facts` row keyed on the fact's **normalized
  text**; **touches no message, scrubs nothing.** Written ONLY by the fact path.

The fact path **touches neither `messages` nor `mutations` and never calls `tombstoneFact`**;
the `isMessageId`-throw stays on the message path. Therefore **no client-sent `target_type`,
bug, or future caller can make a fact-forget scrub a message or write a redaction tombstone** —
safety is *structural*, not a review obligation. This **designs out MAJOR-2 / the
"view-says-forgotten / disk-says-plaintext" breach** by construction. (It also resolves the
conceptual conflation that caused the breach: the old code reused `mutations` for both.)

### 3. Durable fact-forget record + an HONEST best-effort ceiling.

A fact-forget (i) **immediately purges** the matching live machine `distilled_facts` row(s),
and (ii) records `{normalized_text, raw_text, provenance}` into `forgotten_facts` so the next
re-projection can suppress the re-derived equivalent **even after the live row is gone**.

The suppression is **best-effort, exactly as §4 signed — and is described at that honest
level** (q#005(b)): **one real layer + two nudges, NOT "three layers of defense."**

- **Text match (the one real layer):** drop a machine candidate whose normalized text matches
  a `forgotten_facts.normalized_text`.
- **Provenance-set match (opportunistic):** fires only when the LLM happens to re-emit the same
  source set — rare, because provenance is unstable across re-projections (structural root 2).
  Not marketed as defense.
- **LLM exclusion (soft nudge):** forgotten texts passed as "do not re-emit" instructions; a
  generative model can ignore it.

A generative distiller can still rephrase a forgotten fact under fresh wording — **this is not
a hard guarantee and is not claimed as one.** Robust *conversational* fact-forget remains
roadmap **2c**.

### 4. Human precedence cuts both ways (5e-aware, q#005(c) + chunk-02 D6).

`forgotten_facts` is **machine-fact suppression only.** The precedence chain is frozen so the
blindspot cannot return: **human-authored fact (D6, never dropped) ▷ human un-forget (a human
authoring/editing a matching fact clears the `forgotten_facts` row) ▷ machine fact-forget
record (text-match suppression) ▷ machine re-derivation.** The text-match filter must not
suppress a candidate when a human-authored fact with the same normalized text exists.

### 5. Option B — "also forget source messages" is a first-class, intent-gated HARD escape.

On explicit opt-in, `forgetFactAndSources` enumerates the fact's `isMessageId` provenance
components and hard-scrubs each via the existing `WriteGate.forget`. A `thread:<id>`-shaped
provenance is a **no-op with a clear message** (never a whole-thread scrub). The UI confirm
surfaces the **source-message count AND the count of other facts those messages feed** — so the
collateral loss §4 warned about is explicit, visible, and intended, never silent or default.

### 6. 2c plugs into the same contract.

The future agent memory-action tool calls `Hatch.forgetFact(factText, provenance,
ctx={actor:'agent', authored_by:'machine'}, …)` — the SAME durable record, **no source scrub**
(option B stays human-gated; an agent must not destroy history on a conversational "forget").
5e still refuses a machine forget of a human-authored fact. This ADR only **reserves the
seam**; 2c is out of scope here.

## Consequences

**Positive**
- Forgetting a derived fact no longer destroys real conversation history (MAJOR-2 gone by
  construction).
- The §4 best-effort suppression actually fires for smart facts (MAJOR-1 gone), tested on the
  production boundary (not a fabricated shape — Strike-4).
- Intent is explicit at every layer; 2c inherits a clean, safe contract.
- Safety is structural (separate tables), not dependent on review vigilance or client trust.

**Negative / accepted limits (named, not latent)**
- `forgotten_facts` grows unbounded (dogfood-scale fine; human re-authorship = natural
  eviction; the future summarization tier can compact it).
- Pure-machine over-suppression: two different machine facts normalizing equal → one is
  benignly suppressed (no data loss; source intact; re-statable + human-pinnable).
- Fact-forget remains best-effort against a generative distiller — by design, not a regression.

**New runtime coupling (PIPELINE §7.1, flagged at decompose)**
- `WriteGate` becomes a writer of `forgotten_facts`, which `SmartDistillerProvider.distill`
  reads — a new shared-mutable-state edge. The forget→distill interleave is
  eventually-consistent (a forget lands in the next run; the immediate purge covers the live
  slice in the gap). Not a livelock.

## Alternatives considered

- **Relax the `isMessageId`-throw and dispatch on a client-sent `target_type` alone**
  (the naive intent fix) — **rejected** (grill B1): it relocates the only safety check into
  shared client JS, reopening the view/disk-divergence breach a wrong/stale `target_type`
  would trigger. The separate-table invariant is strictly safer at no extra cost.
- **Reuse `mutations` (`kind='fact_tombstone'`) for fact-forget** — **rejected** (q#005a): it
  re-creates the very conflation that caused the breach and inherits the advisory-FK hack.
- **A single `forget(target, {targetType, alsoForgetSources})` param object** — **rejected**
  (q#004): a boolean trap; named methods read better and give 2c an explicit contract.
- **Couple fact-forget to source-deletion (hard fact-forget always)** — **rejected by Lior at
  the memory-quality §4 sign-off**: destroys real history to remove a derived fact. Option B
  is the *opt-in* version of this, never the default.

## Relationship to other ADRs

- **[[0012-conversation-and-memory-model]]** — **extends** 5a (view/edit/forget) and 5e
  (human precedence); does NOT contradict them. This ADR specifies how 5a's *forget* behaves
  for generative-distiller facts, and makes 5e's precedence bidirectional (un-forget).
- **[[0013-daemon-memory-write-http-surface-caller-auth]]** — the `POST /memory/forget` route
  this contract dispatches through is the token-gated write surface 0013 established; the
  `target_type`/`also_forget_sources` fields are **additive** to that HTTP body (not a frozen
  wire envelope — `@agentic/protocol` and `mock-agent.ts` are untouched).

## Related

- [[../specs/2026-06-13-forget-flow]] — the mechanics + verification + re-decomposition.
- [[../specs/2026-06-12-memory-quality]] §4 — the guarantee this delivers for smart facts.
- `orchestration/.conveyor/bus/a/00{4,5,6,7}-*.md` — the conductor rulings.
- [[../PIPELINE]] §5.2 (acceptance gate), §7.1 (runtime coupling), Finding #5 (ADR-in-PR tier).
