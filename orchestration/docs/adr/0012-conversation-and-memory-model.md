---
status: accepted
date: 2026-06-04
deciders: [lior]
tags: [adr, conversation, memory, interaction, threads, dual-modality, agent-paradigm]
---

# ADR-0012: Conversation & Memory Model — threads, super-chat, dual-modality, agent paradigm

## Status

`accepted` — with a **PROPOSED AMENDMENT 2026-06-13** (incremental distiller: *stability over strict
re-derivability*; see the "Amendment 2026-06-13" section below). The amendment is `proposed` and rides
the memory-distiller-v2 design PR to **Lior's §5.2 acceptance gate** (hard-to-reverse tier — it changes
this ADR's HARD INVARIANT). Until accepted, decision 6's "re-derivable projection" framing stands as
written; the amendment, once accepted, supersedes that framing as described below.

## Context

Everything shipped so far is **single-turn**: Walking Skeleton v0, the LLM text-reply slice ([[0009-text-display-only-ui-primitive]], [[0010-pluggable-llm-provider-abstraction]], [[0011-llm-auth-and-subscription-strategy]]), and an overlay UX pass ([[0006-dual-hotkey-2zone-ux]] Amendment 2026-06-03) all model one question → one answer. The session is opened, answered, and dismissed. The product now needs a stable, **multi-turn conversational interaction model** — the thing the user actually lives inside day to day.

[[0001-interaction-pattern]] deliberately deferred this. Its decision-point 4/6 made sessions ephemeral with **no cross-session memory in MVP**, and its Option C ("persistent buddy") was rejected as a v2-sized problem to keep MVP scope sane. That deferral has now come due. This ADR commits the **model**; it does not commit to building all of it at once (see Phasing).

Two 2026-06-04 research efforts fed this decision and are the rationale of record (kept in project memory, not duplicated here):

1. A **behavioral / interaction-UX study** of how a launcher-style agent should take turns, expose continuation, and surface memory.
2. A **competitor / prior-art study** (Hermes, OpenClaw, and comparables) on what these products got right and — more loudly — what they got wrong, especially around opaque memory.

The forces in play: keep the **launcher feel** (fast, low-chrome, not a chat window); stay in the **agent/widget paradigm** ([[0002-ui-as-tool-calls]], [[0005-ui-contract-closed-set]]) rather than drifting into "ChatGPT in the corner"; give the agent **continuity** without making memory an opaque, always-injecting black box — which the prior-art study identifies as the category's single biggest churn driver and a real security surface.

## Decision

**Adopt a single north-star: "one agent, talked to two ways, that remembers." One agent; co-equal voice + text input unified as "add a turn to a thread"; output is ephemeral widgets (not a chat log); memory is a persistent "super-chat" that the user reaches only through threads.**

Concretely:

1. **One agent.** The user always talks only to *it*. There is no notion of picking a model, a persona, or a sub-agent at the interaction surface.

2. **Dual-modality input — co-equal and first-class.** **Voice and text** are both primary. Underneath they are the *same* operation: "add a turn to a thread." This is **one behavioral contract with two affordances** (an open mic vs a text-reply affordance), explicitly **not** two divergent turn-taking implementations that drift apart. (Voice's MVP shape stays as in [[0007-voice-mvp-strategy]]: push-to-talk, cloud STT first; this ADR makes voice a co-equal *turn*, not a bolted-on side input.)

3. **Agent paradigm, not chatbot.** Output is **ephemeral UI widgets** ([[0002-ui-as-tool-calls]], [[0005-ui-contract-closed-set]]), **not** a persistent scrolling chat log. A conversation is **bounded task-continuation**, not an endless message thread. This preserves the [[0006-dual-hotkey-2zone-ux]] two-zone surface and the "rule of three" dismiss policy (its 2026-06-03 amendment) rather than introducing a transcript surface.

4. **Memory = a persistent "super-chat."** Each conversation is a **thread**. A thread **distills** into the super-chat; new threads **draw on** the super-chat for continuity.
   - **Within-thread = multi-turn** — the thread's own messages give the agent short-term, in-conversation context.
   - **Cross-thread continuity = the super-chat** — the distilled substrate that survives across threads.
   - **The user interacts with THREADS.** The super-chat is the continuity *substrate*, not a surface the user is dropped into. This is what keeps the launcher feel: you start a thread, not "resume the one infinite chat."

5. **Memory transparency — non-negotiable, research-backed.** The super-chat is **invisible by default** (this is what preserves the launcher feel). But the following are **built from day one even though default-hidden** — they are not "later":
   - **(a) A view / edit / forget escape hatch.** The user can always see, correct, and delete what the agent remembers.
   - **(b) Distillation is explicit, visible, and recoverable** — never a silent best-effort or a pre-compaction flush. A thread consolidating into the super-chat is an observable event, not a side effect.
   - **(c) Provenance + scope + expiry/confidence tags on every distilled fact.** Every remembered item knows where it came from, how broadly it applies, and when/how confidently it should still be trusted.
   - **(d) Security-scanning of memory writes before they enter the prompt.** Nothing is auto-injected into a future thread without passing a write-time scan.
   - **(e) Never auto-overwrite human-authored entries.** What the user wrote or corrected is sacred against silent machine clobbering.
   - **(f) Thread-isolation against cross-thread bleed.** One thread's working context does not silently leak into another except through the distilled, scanned, tagged super-chat path.

   **Rationale:** an opaque, always-injecting memory is the category's **#1 churn driver** (the prior-art study: users leave when the agent silently loses — or silently misremembers — context). It is *also* a **memory-poisoning surface**: one wrong or poisoned distilled fact auto-injects into *every* future thread, i.e. a persistent invisible backdoor. That **chains** with the known **CSWSH localhost-daemon exposure** ([[../known-gotchas]] #31): a crafted non-browser client that can reach the daemon could plant a distilled "fact" that then re-injects forever. Transparency (a–f) is the mitigation that keeps memory from becoming a write-once, inject-everywhere attack primitive.

6. **Memory storage shape — two stores, start simple.** An **uncapped, searchable archive** (the super-chat itself) plus a **small, bounded distilled slice** injected at thread start. The source of truth starts deliberately boring: **SQLite + plain files**. **Vector / graph retrieval is a swappable provider, not a v1 bet** — the same posture as [[0010-pluggable-llm-provider-abstraction]] takes for providers. We do not couple the model to a particular retrieval engine.

### Deliberately left open (build-time decision)

- **The exact TEXT reply affordance** — an inline **"Live Card" reply** on the focused widget vs a **re-summoned "Continuation Pill"** input — is **not decided here**. It is a build-time decision for the relevant roadmap part, informed by the interaction-UX research. Both stay inside the agent/widget paradigm (decision 3); neither is a persistent chat box.

### Explicitly NOT decided here (so a future reader does not over-read this)

- **The full distillation mechanics** (when a thread consolidates, exact retrieval/scoping/privacy rules) — committed in shape (decision 5b/5c), settled in detail per roadmap part.
- **A2UI / AG-UI as a UI wire format for OUR closed-set primitives** — **not adopted** (see Alternatives; [[0005-ui-contract-closed-set]] already renders our primitives cross-frontend natively). **BUT** rendering **external / third-party rich widgets** (a Spotify or weather mini-app *not* composed of our primitives) is a **genuinely open question** — see [[../open-questions]] Q11; A2UI is a live candidate *there*, not closed forever.
- **Concurrent threads + background tasks** — the *model* anticipates multiple threads, but the concurrent/background runtime is the last roadmap part ([[../known-gotchas]] #45), not this ADR.

## Consequences

### Positive

- **A stable conversational north-star** the next several builds aim at, instead of bolting multi-turn onto a single-turn skeleton ad hoc.
- **Keeps the launcher feel** — threads + invisible-by-default memory means the daily surface stays "summon, ask, get a widget," not "open the chat app."
- **Stays inside the proven paradigm** — widgets out, closed-set primitives, two-zone overlay all hold; no transcript surface to design, theme, and maintain.
- **Memory is auditable from day one** — the transparency hatch (5a–f) means a wrong fact is visible and removable, not a silent permanent corruption.
- **Defuses the poisoning↔CSWSH chain early** — write-time scanning + provenance + no-silent-overwrite turn the highest-leverage attack (plant-once, inject-forever) into a detectable, reversible event.
- **Cheap to start, not painted into a corner** — SQLite + files ships fast; the swappable retrieval provider keeps the door open for vectors/graphs without a rewrite.
- **Voice and text cannot drift** — one behavioral contract for "add a turn" means a fix or feature lands for both modalities at once.

### Negative

- **The transparency machinery is real work shipped before it visibly pays off** — provenance tags, write-scanning, the view/edit/forget hatch, and isolation all exist from day one while being hidden by default. This is upfront cost against a non-obvious benefit (it's insurance).
- **Distillation correctness is hard** — "what is worth remembering, scoped how" is an open, evergreen problem; getting it wrong shows up as either forgetfulness or noise in every future thread.
- **A second persistence layer** (the two stores) is engine state beyond the ephemeral sessions [[0001-interaction-pattern]] assumed — lifecycle, migration, and "forget" semantics all have to be correct.
- **The undecided reply affordance** means the next build still owes a UX call; this ADR does not de-risk that choice, only frames it.

### Trade-offs accepted

- We accept **the cost of building transparency (5a–f) before it visibly pays off**, in exchange for **not shipping an opaque memory** — the exact mistake the prior-art study says drives the category's churn and opens the poisoning surface.
- We accept **a deliberately boring storage start (SQLite + files)** in exchange for **shipping the model now** and keeping advanced retrieval a **swappable** later choice, not a v1 bet.
- We accept **threads-as-the-only-handle** (the super-chat is never a surface the user lives in) in exchange for **preserving the launcher feel** over a familiar-but-paradigm-breaking chat window.
- We accept **committing the model while phasing the build**, in exchange for a stable target the roadmap parts can each build straight onto.

### What we'll regret in 6 months (predict it now)

> [TODO: Lior — your prediction. Candidate regrets: "distillation was too eager / too lazy and every thread felt either amnesiac or cluttered," or "we over-built the transparency hatch for a memory layer users never inspected — should have shipped the archive first and added tags/scanning only once memory was actually load-bearing," or "the inline-vs-pill reply affordance we deferred turned out to be the load-bearing UX decision and deferring it cost us a release."]

## Alternatives Considered

### Option A: Pure "task-refiner" (no reply affordance)

**What it was:** the agent only takes a one-shot request and refines it into a result; there is no first-class way to *reply* and continue — you re-summon and re-ask.

**Why not:** Lior rejected it. It cannot express genuine multi-turn task-continuation, which is the whole point of this ADR. The chosen model is a **hybrid** that keeps the agent/widget paradigm while adding a real continuation turn.

### Option B: Pure "ChatGPT-thread-in-the-corner"

**What it was:** a persistent scrolling chat transcript living in the overlay corner; the conversation *is* the message log.

**Why not:** Lior rejected it. It breaks the agent/widget paradigm ([[0002-ui-as-tool-calls]], [[0005-ui-contract-closed-set]]) and the launcher feel — it turns the product into a chat app in a small window. The chosen model keeps output as **ephemeral widgets** and the conversation as **bounded task-continuation**, not an endless thread.

### Option C: Variability via a mode toggle (task-refiner vs chat) as the *primary* mechanism

**What it was:** ship both behaviors and let the user flip a mode switch to choose how the agent converses.

**Why not:** ~95% of users never change defaults, so a toggle pays its complexity cost for almost no one — while **taxing the launcher's hot path** with a decision on every interaction. Opaque auto-mode-sensing is worse (it makes the agent's behavior unpredictable). Instead: **a strong smart default + one-keystroke reversibility + at most one proactivity-LEVEL dial.** Reversibility, not up-front mode selection, is the right lever.

### Option D: "User never directly contacts memory" (fully opaque, no escape hatch)

**What it was:** memory is entirely behind the curtain — the agent remembers and injects, the user never sees, edits, or forgets anything.

**Why not:** this is **the** transparency anti-pattern the industry reversed in 2025–26 (the prior-art study). It is the #1 churn driver (silent loss/misremembering) and the poisoning surface that chains with CSWSH ([[../known-gotchas]] #31). Decision 5 is the direct repudiation: invisible **by default**, but always **view/edit/forget-able**, with provenance, scanning, and no silent overwrite.

### Option E: Adopt A2UI / AG-UI as the UI wire format

**What it was:** use an emerging agent-UI interchange format (A2UI / AG-UI) as the engine ↔ frontend UI contract.

**Why not (for OUR primitives):** **not adopted** as the wire format for the closed-set we draw ourselves. [[0005-ui-contract-closed-set]] already delivers cross-frontend rendering via **per-frontend native renderers** of a closed primitive set — swapping in an external wire format would re-litigate a settled, working decision, and A2UI was **single-sourced** in the research (insufficient corroboration for a load-bearing dependency on our core contract).

**The part that stays OPEN, however:** ADR-0005's closed-set cleanly covers widgets *we* compose, but it only weakly answers **external / third-party rich widgets** — a Spotify widget, a weather mini-app, "calling a little program into the overlay" — which are *not* built from our primitives (its `custom_content` sanitized-HTML escape hatch is the current, limited answer). For *that* surface, **A2UI or a sandboxed mini-app model is a live candidate**, to be **researched when the plugin / external-widget layer is built** ([[../open-questions]] Q11). So this is "not adopted for our own primitives now," **not** "A2UI is closed forever" — per the team's standing rule not to reflex-reject a relevant direction just because it touches an accepted ADR.

## Amendment 2026-06-13 (proposed): Incremental distiller — STABILITY over strict re-derivability

> **Status:** `proposed` — Lior accepts at §5.2 (hard-to-reverse tier). Agent-drafted in a frontier
> (fable) design pass; conductor blessed the wording (bus q#009, `decided_by: jimmy`); the acceptance
> is Lior's. Rides the same PR as [[../specs/2026-06-13-memory-distiller-v2]] (the mechanics).

### Why amend

Decision 6 committed the distilled slice as a **disposable, re-derivable projection** of the lossless
archive. The memory-quality build honored that literally: the smart distiller returned the COMPLETE
projection over the whole archive and the store did DELETE-all + INSERT every dismiss. Met with a
**non-deterministic LLM**, literal re-derivability becomes **instability**: Lior's 2026-06-13 LIVE demo
showed facts **churning (rewording), reordering, and DISAPPEARING** across dismisses ("a forget re-wrote
every fact; a reload showed a different, smaller set"). For a *memory* feature this is disqualifying —
**"my name is Lior" must stay put.** The fix (memory-distiller-v2) makes distillation **incremental**:
distill only the just-ended conversation, find a contradicting/related existing fact (FTS5 + the LLM),
and **REPLACE only that one fact, APPEND same-kind, else add new — leaving all other facts untouched.**
Incremental facts are therefore a **stateful accumulation**, not a pure function of the archive; this
amendment makes that explicit and names the guarantee that replaces re-derivability.

### The amended HARD INVARIANT

1. **STABILITY (the new headline guarantee).** *A distilled fact persists UNCHANGED until (a) a
   genuinely-contradicting new fact replaces it, (b) the user edits it, or (c) the user/forget removes
   it. It never silently rewords, reorders, or vanishes across dismisses.* This is the user-facing
   promise the demo proved was missing, and it is what the whole pivot buys.

2. **The archive stays lossless + immutable** — UNCHANGED, and this is the invariant that actually
   matters. `messages`/`mutations` remain the source of truth; a forget hard-scrubs `messages.content`;
   the event/tombstone remains.

3. **The fact store is a STATEFUL, incrementally-accumulated DERIVED store — NOT a pure f(archive).**
   It is built one conversation at a time at dismiss; the current set is **path-dependent** (which fact
   replaced which, in what order). `distilled_facts.id` is **stable** across dismisses.

4. **Supporting properties (these REPLACE "disposable / regenerable-identically"):**
   - **Auditable** (preserves 5c): every fact carries provenance to its source messages, and a REPLACE
     records the replaced fact's text — a destructive change is visible and recoverable, never silent.
   - **Forgettable** (preserves 5a): a forget is now a **durable delete** of the stable-id row —
     **strictly STRONGER** than the old best-effort suppression against re-derivation.
   - **Best-effort REPLAYABILITY (not re-derivability):** because the archive is lossless, the fact
     store CAN be rebuilt by replaying distillation conversation-by-conversation in chronological order
     — but this is an **explicit admin action** (provider swap / corruption recovery / migration), NOT
     a per-dismiss invariant, and it is **non-deterministic** (LLM) and **lossy of forget-history**.

5. **Preserved unchanged:** transparency 5a–f; human-precedence 5e (now trivially honored — nothing
   re-derives over human facts); thread-isolation 5f; the two-stores shape (decision 6's storage
   sentence); the swappable-retrieval posture (FTS5 now over facts, embeddings deferred to the 2d
   retrieval feature — exactly "vector/graph retrieval is a swappable provider, not a v1 bet").

6. **Given up (named, not latent):** the property that the distilled slice is **disposable and
   regenerable-identically at any time**. The fact store is now **durable state** that must be backed
   up and migrated like any other state — including a **one-time migration** off the prior
   global-reprojection facts (memory-distiller-v2 §3.8).

### Consequences of the amendment

- **Positive:** stability (the headline); forget becomes durable + stronger; human facts are
  unassailable; the destructive path is rule-gated + auditable; no per-dismiss whole-archive LLM cost.
- **Negative / accepted:** the store is durable state (backup/migration burden); contradiction
  detection is best-effort (a missed contradiction → a redundant fact the user deletes — a UX
  inconvenience, not a correctness defect); replay is non-deterministic + lossy of forget-history.
- **What this obsoletes in the codebase** (the v2 build must reconcile, not leave as silent
  contradictions): the `DistilledFact` doc ("a re-derivable projection… Disposable"), the
  `MemoryProvider.distill` doc ("re-run the projection — no source-of-truth migration"), and
  `dropAllDistilledFacts`'s stated "swap-proof / machine rebuild" purpose all encode the old
  re-derivability assumption and are rewritten under this amendment.

### Relationship to the 6-month-regret TODO above

This amendment is, in part, the regret arriving early: the global re-projection was "too eager" in
exactly the way that TODO anticipated ("every thread felt cluttered / facts churned"). The pivot is the
correction, made before the feature shipped as default rather than after.

## Related

- [[../specs/2026-06-13-memory-distiller-v2]] — the incremental mechanics this amendment's invariant governs.
- [[0001-interaction-pattern]] — streaming sessions + the **cross-session memory it explicitly deferred** (decision-point 4/6, Option C rejected as v2). This ADR is where that deferral comes due and commits the memory model. Sessions remain the in-thread turn substrate.
- [[0002-ui-as-tool-calls]] — the **agent paradigm**: output is tool calls / widgets, not a chat-message channel. Decision 3 holds the line here.
- [[0005-ui-contract-closed-set]] — closed-set primitives (**widgets out**, no transcript surface); A2UI **not adopted for our primitives** (cross-frontend rendering is already native), but **external rich-widget rendering stays open** ([[../open-questions]] Q11).
- [[0006-dual-hotkey-2zone-ux]] — the **two-zone overlay** where threads and widgets live; the 2026-06-03 "rule of three" dismiss policy is the surface this model continues into multi-turn.
- [[0007-voice-mvp-strategy]] — the **voice modality**; this ADR promotes voice to a co-equal *turn* (decision 2) without changing the push-to-talk / cloud-STT-first MVP shape.
- [[0009-text-display-only-ui-primitive]] — the text answer is a **display-only widget**, not a message; multi-turn text continuation builds on this, not on a message channel.
- [[0010-pluggable-llm-provider-abstraction]] — the **swappable-provider posture** decision 6 borrows for memory retrieval (vector/graph as a provider, not a v1 bet).
- [[0011-llm-auth-and-subscription-strategy]] — part of the LLM text slice this ADR builds the conversational layer on top of.
- [[../roadmap]] — "**Conversation & Interaction Model**" section (locked 2026-06-04); this ADR is the model, that section is the **phased route** (memory foundation → text continuation affordance → voice parity → richer widgets → concurrent threads/background).
- [[../known-gotchas]] #31 — **CSWSH exposure**; the memory-poisoning surface (decision 5) **chains** with it.
- [[../known-gotchas]] #45 — concurrent threads / background tasks; the last roadmap part, anticipated by but **not decided in** this ADR.
- Project memory: `conversational-interaction-model` (behavioral-UX study) and `prior-art-findings` (Hermes / OpenClaw competitor study) — the rationale of record behind this ADR.
