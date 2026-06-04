---
title: Memory Foundation — spec
status: accepted
date: 2026-06-04
deciders: [lior]
feeds: memory-foundation
implements: adr/0012-conversation-and-memory-model
route-part: 1
tags: [spec, memory, conversation, threads, distillation, transparency, super-chat]
---

# Memory Foundation — spec

> **Pipeline placement.** This is the CONDITIONAL `spec` stage (PIPELINE §3) for
> roadmap route part 1, *Memory foundation*. The design is thick — ADR-0012 left
> four load-bearing seams open that several chunks share — so we freeze them once
> here instead of re-deriving them per chunk. `status: draft` → Lior signs off
> (`accepted`, §5.2 gate) → `decompose-feature` reads this + writes chunk files
> into `chunks-todo/memory-foundation/`. **No chunk may re-litigate a decision
> frozen here without an ADR escalation.**

---

## 1. Purpose & scope

Build the **first part of the locked Conversation & Memory route** ([[../adr/0012-conversation-and-memory-model]]): the persistent **super-chat** + **thread** substrate, **within-thread multi-turn**, a **dumb-but-real cross-thread continuity** path, and the **seams** (not the full logic) for the transparency hatch (ADR-0012 decision 5a–f).

**In scope (this route):**
- Thread persistence — `thread` = durable record; the current ephemeral session = a per-turn runtime over it.
- Within-thread multi-turn (the agent sees prior turns of the same thread).
- The uncapped, searchable **archive** (the super-chat) as the lossless source of truth — SQLite + files.
- A **dumb v0 distiller** behind a **real swappable provider port** (ADR-0012 decision 6).
- **Distillation as an observable, recoverable consolidation EVENT** (ADR-0012 5b) — fired on thread-dismiss, recorded **even when nothing is retained**.
- The **four checkpoints** (write-gate · provider-port · injection-point · archive-as-truth) + the **5b consolidation-hook** as clean pass-throughs.
- The transparency tag **schema** (provenance / scope / expiry / confidence), stamped even by the dumb v0.
- The transparency-hatch **logic** (5a view/edit/forget · 5d write-scan · 5e no-overwrite · 5f isolation), each filling a foundation seam in its own sub-chunk. *(5b and 5c are not separate logic chunks: 5b = the consolidation-hook + event above; 5c = the tag schema above.)*

**Out of scope (deferred, with WHY):**
- **A smart distiller** — what's worth remembering, scoped how — OUT because it is the evergreen-hard problem ADR-0012 itself names in *"What we'll regret in 6 months"* (line 94). The v0 is deliberately dumb; the provider port makes the smart one a drop-in later.
- **Text continuation affordance** (inline "Live Card" vs "Continuation Pill") — OUT, that is route **part 2** (roadmap). This route makes turns *persist*; part 2 designs the *affordance* to add one.
- **Voice parity** (part 3), **richer widgets** (part 4), **concurrent threads / background** (part 5, gotcha #45) — OUT, later route parts.
- **The final hatch-UI surface pick** (overlay vs web-admin tab) — deferred to the 5a sub-chunk build (see §6); the foundation freezes only the transport-agnostic read/edit/forget API.

---

## 2. Frame carried from ADR-0012 (locked, not re-decided here)

- One agent; output = ephemeral widgets, not a chat log; conversation = bounded task-continuation.
- Memory = a persistent **super-chat**; the user interacts only via **threads**; the super-chat is the continuity *substrate*, invisible by default (launcher feel).
- **Two stores:** uncapped searchable archive + a small bounded distilled slice injected at thread start.
- **SQLite + plain files** first; **vector/graph retrieval is a swappable provider, not a v1 bet.**
- **Transparency (5a–f) is built from day one, default-hidden** — it is the mitigation for the memory-poisoning ↔ CSWSH chain (known-gotcha #31).

---

## 3. Spec decisions (resolved in the 2026-06-04 brainstorm)

### 3.1 — Thread ↔ session runtime model (Seam 1)

**Decision: thread = durable record; session = ephemeral per-turn runtime over it.**

- Each turn stays an ephemeral session — **ADR-0001 ephemerality and gotcha #30 (RAM/eviction) are untouched.**
- `session_start` gains an **additive optional `thread_id`** (frozen-envelope-safe — additive field, no new variant, no behavioral change to the 6-variant union; see §5).
- On `session_start{thread_id}`: the daemon loads the thread's recent messages into `ProviderSessionState.messages[]` (the seam already reserved for this — `provider.ts:5` "Multi-turn later = append more; NOT a rewrite").
- On turn end: the turn's messages are appended back to the **durable thread** through the write-gate (§3.3).
- No `thread_id` (or unknown id) ⇒ a **new thread** is minted — single-turn behavior is the degenerate case (one-turn thread), so nothing regresses.

> **§7.1 runtime-coupling note:** this changes *what the daemon does with session state at end* — today `index.ts:70` does `sessions.delete(sid)` and the state is gone. The wire stays frozen; the **behavioral** contract (state now also flushes to a durable thread) changes deliberately. This is the kind of behavioral drift the v0 02a-scar warns about, so it is called out explicitly and lives behind the write-gate, not scattered.

### 3.2 — Distillation scope + the HARD INVARIANT (Seam 4)

**Decision: full scaffold now, dumb distiller now, smart distiller later — gated by an invariant that makes "later" cheap and painless.**

The **hard invariant** (acceptance criteria for the whole route):

1. **Archive = source of truth; the distilled slice is a disposable, re-derivable PROJECTION of it — never a separate source of truth. No fact may exist only in the distilled layer.** **"Lossless" is redefined (Lior, frozen here per §5.2): the archive never loses its EVENT-HISTORY — every turn, edit, and forget is an immutable record — but it does NOT promise immortality of forgotten *user content*. forget hard-scrubs the referenced content (real erasure, not a soft hide) while the event + its tombstone remain (see §3.4 *Mutation model*). Lossless = the audit trail is complete, not that nothing can be erased — this is what lets real forget/privacy coexist with the #31 poisoning-audit guarantee.**
2. **Distillation + retrieval run behind a REAL provider port.** The dumb v0 is just one implementation conforming to the contract — never a hardcode that bypasses the port.
3. **The path "new distiller → re-derive the slice from the old, untouched archive" is real and TEST-COVERED already in v0.** This is the proof that swapping the distiller in 1–2 months = write a new provider + re-run the projection: no source-of-truth migration, no data loss, no painful rewrite.

> **Time stance (Lior):** deliberately spend the time **now** on the cleanliness of this boundary (real port + real re-derive + tests) so a future swap is minimal and painless. We want a **battle-tested seam, not a token interface.**

### 3.3 — The checkpoints (quartet + 5b hook) + the decompose rule (Seam 4, cont.)

**Principle: the SEAM lives in a foundation chunk; the LOGIC lives in its own sub-chunk.** (Same model as the distiller: real port now, real logic later.)

The foundation chunks MUST establish these checkpoints — the memory-path **quartet** plus the **5b consolidation-hook** (added by the grill) — as clean **pass-throughs**:

| Checkpoint | What it is | v0 state | Filled later by |
|---|---|---|---|
| **WRITE-GATE** | the single function every memory-write flows through | pass-through (no policy) | 5d scan · 5e no-overwrite |
| **PROVIDER-PORT** | retrieval + distillation behind a swappable interface | DumbTailProvider | smart distiller · 5f isolation (via scope tag) |
| **INJECTION-POINT** | the single place the distilled slice enters agent context | composes dumb slice | 5a hatch reads/edits exactly this |
| **ARCHIVE-AS-TRUTH** | invariant: distilled is re-derivable from the archive | enforced by the re-derive test | — (a standing invariant) |
| **CONSOLIDATION-HOOK** (5b) | the dismiss-lifecycle point where distillation fires + the `distillation_events` record | pass-through hook (`threads.status→dismissed`) + event table — chunk **01** | the distiller logic that fires on it — chunk **02**; 5a surfaces the event |

Each transparency requirement = **(seam now, logic in its own sub-chunk):**

- **5a hatch** → reads the injection-point + the read/edit/forget API over the archive, riding the **MUTATION-AS-APPEND seam** (§3.4) — whose **storage mechanism** (mutations table + tombstone + hard-scrub + tombstone-honoring within-thread read) is foundation **01**, while **tombstone-honoring re-derive + injection** is **02** (where re-derive/injection are born) / the API + UI + policy + provenance affordance is the 5a sub-chunk (§7).
- **5b distillation-as-event** → a **consolidation-hook** fired on `threads.status→dismissed` + the `distillation_events` table — both foundation **01** / the distiller emits the observable event, **even on empty consolidation** — **02** / surfaced by **5a**. The **dismiss-trigger is frozen**; an idle-timeout trigger is an optional architect-time addition (§7).
- **5d scan** → write-gate no-op (foundation) / the security scanner (later sub-chunk).
- **5e no-overwrite** → write-gate knows the `authored_by:human` flag (foundation) / the policy (later sub-chunk).
- **5f isolation** → provider-port + a `scope` tag (foundation) / the cross-thread-bleed rules (later sub-chunk) — which **read what the write-gate (5d/5e) admitted**, hence MF-04 sequences after MF-03 (§6 F2).

**Rules governing the decomposition (Lior, verbatim intent):**
- A later sub-chunk may **only fill** an existing seam — **never re-plumb** the write/inject path.
- If some 5x has nowhere to sit without surgery → that is a **bug in the foundation chunk**, not a reason to grow the later sub-chunk.
- **The reverse error is also forbidden:** do **not** spawn stub sub-chunks for beauty. A seam is justified ONLY where later filling would otherwise be *surgery* on a runtime route (write-path, inject-path, provider). For purely additive things — a new tag column, a new read-filter — a dedicated "foundation" seam is needless ceremony. **Checkpoint where there is a runtime route expensive to double-lay; not where there is merely a future field in a type.**

### 3.4 — Storage shape & tag schema (Seam 2)

Two stores, SQLite + files, **boring on purpose** (ADR-0012 decision 6). *Illustrative* — the architect refines exact columns/types at build:

- **`threads`** — `thread_id` (uuid pk), `created_at`, `last_active_at`, `status` (active/dismissed), optional `title`.
- **`messages`** *(the archive — append-only EVENT log; the source of truth)* — `id`, `thread_id` (fk), `turn_index`, `role` (user|assistant), `content` *(scrub-able by a forget tombstone — see Mutation model)*, `created_at`, `session_id` (the ephemeral session that produced it).
- **`mutations`** *(append-only; the edit/forget event history)* — `id`, `target_message_id` (fk), `kind` (`tombstone` | `correction`), `actor` (who), `reason` (why), `replacement_content` (for `correction`), `created_at`, `authored_by` (`human` | `machine`).
- **`distilled_facts`** *(the slice — a re-derivable projection; may be dropped & rebuilt)* — `id`, `fact`, **`provenance`** (source thread/message), **`scope`** (e.g. thread-local | cross-thread | global), **`expiry`** / **`confidence`**, **`authored_by`** (`human` | `machine`), `derived_at`, `distiller_version`.
- **`distillation_events`** *(append-only; thread-level observability — ADR-0012 5b; distinct from per-fact `derived_at`)* — `id`, `thread_id`, `trigger` (`dismiss` | …), `facts_produced` (count / refs), `distiller_version`, `created_at`. **Written on EVERY consolidation, even one that retains nothing** — the observable difference between "deliberately retained nothing" and "silently lost the thread" (the anti-churn essence of 5b).

**Mutation model — MUTATION-AS-APPEND (frozen here per §5.2 — a shared 01/02/5a contract, NOT an architect-time choice; this is the storage seam forget/edit needs so it does not become surgery later, per §3.3 rule #1):**
The archive is append-only at the EVENT level; user-facing edit/forget never mutate a turn in place.
- **forget** = an appended **tombstone** (`who` / `when` / `why`) referencing a `messages.id`, PLUS a **hard-scrub** of that row's `content` (replaced with a redaction marker — real erasure, not a soft hide). The turn row and the tombstone remain as immutable history.
- **edit** = an appended **correction** record (`mutations.kind = correction`) referencing the original (never in-place) — preserving append-only, the `authored_by:human` flag, and 5e no-overwrite.
- **re-derive AND the injection-point MUST honor tombstones** — a forgotten fact never re-appears in a rebuilt slice or in injected context.
- **forget purges the LIVE distilled slice too, not only the next re-derive (grill S2).** A forget must **immediately** invalidate (drop + mark for re-derive) any `distilled_facts` row whose `provenance` references the forgotten content — closing the window where a still-cached slice would inject a just-forgotten fact. (Tracking: a `mutations` row may target a distilled fact as well as a `messages.id`; the §3.4 invariant "no fact may exist only in the distilled layer" guarantees the re-derive can rebuild *everything except* what was forgotten.) The **mechanism seam** for this purge lives where the slice does — **chunk 02** (with the 01 tombstone) — and is covered by the **forget-survives-re-derive** test extended to assert the *live* slice, not only a rebuilt one.
This is what makes §4.2's *forget-survives-re-derive* test meaningful — and the **F1 split** keeps it honest: the **storage mechanism** (mutations table + tombstone + hard-scrub + tombstone-honoring **within-thread read**) lives in chunk **01**; **tombstone-honoring re-derive + injection** (and the forget-survives-re-derive **test**) live in **02** — *because re-derive and the injection-point are themselves born in 02, not 01*; the **API + UI + policy** live in **5a**.

**Files vs SQLite split** (architect-time detail): SQLite is the structured/searchable store; plain files (e.g. per-thread JSONL) serve as the human-readable mirror / export / audit surface. The **source-of-truth is the archive** regardless of which medium holds the canonical bytes — §3.2 invariant 1 (as redefined) governs.

### 3.5 — Transparency-hatch surface (Seam 3)

Per the §3.3 rule, the foundation freezes the **transport-agnostic, daemon-internal read/edit/forget API + the injection-point**; the **UI is the 5a sub-chunk**.

- **Lean (recorded, not frozen):** the hatch UI lives in the **web-admin "History" tab** ([[../architecture]] §3) — NOT the overlay. Rationale: a memory-management UI is exactly the "settings in the hot path" that ADR-0012 decision 3 / Option C warns against; the overlay stays a low-chrome launcher. The admin tab is already a planned parallel frontend; this gives it its first real job.
- **5a decides** the final surface + transport (admin-tab HTTP vs WS-additive vs overlay widget) at build, **filling** the foundation's daemon-internal API — without re-plumbing it.
- **Discoverability is NOT optional (5a-open, Lior — see §7):** a web-admin "History" tab as the *sole* surface satisfies the letter of 5a but not its spirit — memory invisible in daily use is the #1 churn driver (prior-art). 5a MUST also answer the **in-overlay provenance affordance** (agent used a remembered fact → a lightweight "from where?" → leads into History). Recorded so 5a cannot silently ship web-admin-only.

---

## 4. Verification model (PIPELINE §6, and the §6.1 scar)

**One-line rule (Lior): defer the *demo* to the end of the route; do NOT defer the real *boundary* — intermediate work is proven by real-I/O, not mocks.**

### 4.1 Route-closing live demo (behavioral, gated by Lior — §6.1)

ONE short live demo on macOS at the route's end (a couple-days route — per-chunk live demos are overkill). It runs through the **real overlay → daemon → store-on-disk path**, nothing stubbed:

1. summon → **new thread** → state a distinctive fact ("the deploy script is `yeet.sh`");
2. **same thread, next turn:** "what's the deploy script called?" → `yeet.sh` — *within-thread multi-turn, live*;
3. **dismiss** the overlay (the session dies; the thread persists + distills);
4. **re-summon → a NEW thread** → "remind me the deploy script?" → `yeet.sh` — *cross-thread continuity, live*.
5. *(once MF-05 / 5a has landed — resolves the §4.2 flag, option i)* open the hatch, **edit or forget** the fact → a fresh thread reflects the change — *transparency, live*.
6. *(MF-05)* the agent **uses** a remembered fact → the **in-overlay provenance affordance** appears → click → lands in History — *discoverability, live* (§3.5 / §7; this is the demo step that proves MF-05's `[behavioral]` provenance criterion).

### 4.2 Intermediate chunks → REAL-I/O proof (no per-chunk live demo)

- Proven by **real-I/O tests**: real SQLite + files, the real daemon path, **no mocked store / injection-point.** This is the substitute for a per-chunk demo and the **only defense against the mock-bypass blind spot** (the Strike-4 scar: `done` lied 4× because mocks/DI bypassed the production boundary).
- **Foundation gets ONE real-I/O smoke-probe**: a script that drives the real daemon → store once, *before any UI exists*. Not a demo — a proof of a live boundary that restores the "which chunk broke it" isolation we otherwise lose by deferring the demo to route end.
- The three **mechanical swap/integrity proofs**, all real-I/O (not mocked):
  - **swap-proof** — two providers re-derive the slice from the same untouched archive (§3.2 invariant 3);
  - **forget-survives-re-derive** — a forgotten fact stays gone after re-derivation (exercises the MUTATION-AS-APPEND tombstone + tombstone-aware re-derive *mechanism* established in chunk 01, §3.4);
  - **lossless integrity** — the **distill / re-derive cycle is read-only over the archive**: it never mutates `messages`/`mutations`. The archive changes *only* via an explicit mutation event (turn append / edit / forget). (NB: this is byte-stability **across distillation**, NOT across a forget — a forget *deliberately* hard-scrubs content per §3.2 invariant 1; the two must not be conflated into a whole-archive byte-equality assertion.)
  - **distillation-observable** (5b) — every consolidation emits a `distillation_events` record, *including one that retains nothing* (proves "deliberately retained nothing" is distinguishable from "silently lost the thread").

> **Flagged for Lior (§7.2):** the **5a hatch builds a *visible* UI**, and §6.1 says visible UI needs a live demo — which collides with "no per-chunk demo." Resolution options: **(i, recommended)** extend the route-closing demo with one *edit-a-fact / forget-a-fact* step once 5a lands (this is ADR-0012's "full route demo incl. hatch" as the *closing* demo); **(ii)** give 5a a single small standalone visual confirm as an explicit exception. Not decided here — surfaced for your call at 5a.

---

## 5. Wire / contract touch-points (the frozen-surface audit)

- **`session_start` gains an additive optional `thread_id: string`** — additive field on an existing variant, **not** a 7th envelope variant; the 6-variant discriminated union (envelope.ts) is untouched. Consistent with the D1/D3 "additive optional field, never a new type" posture already used for `trigger`/`source`.
- **The read/edit/forget API is daemon-internal** (a module boundary), transport deferred to 5a — so **no wire change is forced now** for the hatch.
- **Behavioral contract changes** (state flushes to a durable thread on end; distilled slice injected at start) are deliberate and localized to the write-gate / injection-point — **re-validate at integration time** per §7.1, since multiple chunks share this runtime even with disjoint files.

---

## 6. Proposed decomposition (for Lior's review — formalized into chunk files after the grill)

> Sizes are ~1 day. Dependencies are **runtime-coupled even where files are disjoint** (all chunks share the same daemon + memory store) — so the chain is **strictly sequential** (no parallel sub-chunks), and each chunk **re-validates its reality check at integration** (§7.1).

> **Chunk `#` = the FILE number** (execution order). The ADR transparency id each fills is in parentheses. **Crosswalk:** `03 = 5d/5e` · `04 = 5f` · `05 = 5a` (the ADR ids are NOT in execution order — 5a is logically "first-named" but built **last** because it reads the injection that 03+04 shape; see the F2 note). **NB (grill S4):** these chunk ids are scoped to *this route* — distinct from the LLM-slice's "chunk-03" (the `anthropic-api` adapter) referenced in `provider.ts`/`injector.ts` comments. Refer to them as **MF-01…MF-05** when grepping across routes.

| # | Chunk (fills) | Establishes / fills | Depends on | Size |
|---|---|---|---|---|
| **01** | Durable store + thread/session + within-thread multi-turn | SQLite+files store; `threads`/`messages`/`mutations`/`distillation_events`; `session_start{thread_id}`; load same-thread tail → multi-turn; **WRITE-GATE** (pass-through) + **ARCHIVE-AS-TRUTH**; **forget/edit storage SEAM** (MUTATION-AS-APPEND: tombstone + hard-scrub + tombstone-honoring **within-thread read**, §3.4); **5b CONSOLIDATION-HOOK** (pass-through on `threads.status→dismissed` + event table); tag-schema columns present; **real-I/O smoke-probe** | **none** | ~1 d |
| **02** | Distillation/retrieval seam + dumb distiller + cross-thread | **PROVIDER-PORT** (retrieve/distill); `DumbTailProvider`; **INJECTION-POINT**; `distilled_facts`; cross-thread continuity; **distiller fires the 5b consolidation EVENT** (even when empty) + **tombstone-honoring re-derive/injection** (F1); **swap-proof + forget + lossless + distillation-observable** tests | **01** | ~1–1.5 d |
| **03** (5d/5e) | Write-gate logic — scan + no-overwrite | fills WRITE-GATE: 5d security-scan of writes, 5e no-silent-overwrite of `authored_by:human`. "Scan before it enters the prompt" is only end-to-end provable once the injection path exists in 02 | **02** | ~1 d |
| **04** (5f) | Thread-isolation logic | fills PROVIDER-PORT + `scope` tag with cross-thread-bleed rules; reads what the write-gate (03) admitted | **03** | ~1 d |
| **05** (5a) | Hatch logic — view/edit/forget | fills injection-point + archive read/edit/forget **API + UI + policy** (storage mechanism already in 01); **surfaces `distillation_events` (5b)**; surface per §3.5 lean **+ mandatory in-overlay provenance affordance** (§7, ADR-0005 closed-set) | **04** | ~1 d |

- **5 chunks** (within the skill's ≤7 limit). **5d and 5e are merged into MF-03** (both fill the one write-gate, tightly coupled); the orchestrator may split them but neither may introduce a second write path.
- **§7.1 runtime coupling (grill F2) — MF-03 → MF-04 → MF-05 are NOT "parallel, no-coupling."** They form a **data-flow chain** on the same daemon + store: what 03 admits changes what 04 distills/scopes changes what 05 injects/surfaces. The `Depends on:` edges above are therefore **sequential** (03→02, 04→03, 05→04), not all-→02 — encoding the chain so a scheduler can't parallelize them. (The v0 02a scar: a shared-runtime baseline moved under a chunk and silently dead-coded it.) Disjoint files do **not** make them independent.
- The **route-closing live demo (§4.1)** exercises 01 + 02 capabilities (and, once 05 lands, the hatch + provenance steps); it gates the route's behavioral `done`. MF-03/04/05 close out on **real-I/O proof** (with the 05 visible-UI exception resolved into the closing demo, §4.1/§4.2).

---

## 7. Open at build / deferred

- **Smart distiller** — drop-in behind the provider port, later route maturity (§1 Out).
- **Exact `distilled_facts` retrieval scoping** (recency vs scope-match vs hybrid) — architect picks the v0 DumbTail behavior; the *port* is what's frozen, not the heuristic.
- **Additional consolidation triggers beyond dismiss** (e.g. an idle-timeout) — architect-time heuristic. **Frozen:** "consolidation = an observable event on thread-end (dismiss)" (5b). Anything *added* on top (idle-timer) is optional and must reuse the same hook + event record, not a second path.
- **Files-vs-SQLite canonical-byte split** (§3.4) — architect-time.
- **Final hatch surface + transport** (§3.5) — 5a-time; admin-tab is the recorded lean.
- **In-overlay memory discoverability (5a MUST answer, not optional)** — a web-admin "History" tab as the *sole* surface is the letter of 5a without its spirit (invisible memory = the #1 churn driver). 5a must ship an **in-overlay provenance affordance**: when the agent uses a remembered fact, a lightweight "from where?" leads into History. Not a blocker for this spec; recorded so 5a does not silently ship web-admin-only. (§3.5)
- **5a in-overlay affordance must be ADR-0005 closed-set (grill F5)** — the provenance affordance, if rendered in the overlay, must use an existing closed-set primitive; **a new overlay primitive needs Q2 / an ADR escalation**, not an ad-hoc widget. (Admin-tab surface is not bound by the overlay closed-set the same way.)
- **5a visible-UI demo treatment** (§4.2) — Lior's call at 5a.

---

## Related

- [[../adr/0012-conversation-and-memory-model]] — the model this spec builds route-part-1 of (decisions 4–6 + transparency 5a–f).
- [[../roadmap]] — "Conversation & Interaction Model" route; this is **part 1 (Memory foundation)**.
- [[../PIPELINE]] — §3 (spec conditional), §6.1 (behavioral demo), §7.1 (runtime-coupling), §7.2 (flag-vs-execute).
- [[../known-gotchas]] #29/#30 (context compaction / session RAM — the seam stays minimal), #31 (CSWSH ↔ poisoning chain the transparency hatch defuses), #45 (concurrent threads — a later route part).
- `provider.ts` — the `AgentProvider` port + `ProviderSessionState.messages[]` seam this builds the thread substrate onto.
- Project memory: `conversational-interaction-model`, `prior-art-findings`, `behavioral-dod-needs-runtime-proof` (the §4 verification stance).
