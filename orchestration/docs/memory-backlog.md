---
title: Memory — backlog & deferred work (single source of truth)
status: living
created: 2026-06-16
owner: lior
purpose: One place that captures everything PROPOSED-but-not-yet-built in the memory area, so the next session (or a future Lior) finds it all without relying on chat history. Chat is disposable; this doc is canonical.
related:
  - adr/0012-conversation-and-memory-model.md (the north-star + the "memory transparency day-one" mandate)
  - adr/0015-intent-based-memory-forget.md (forget contract; decision 5 superseded)
  - specs/2026-06-13-memory-distiller-v2.md (what shipped)
  - roadmap.md ("Memory — next" — the high-level pointer to this doc)
---

# Memory — backlog & deferred work

> **Walk-away-safe.** Everything we discussed and deferred about memory lives here, grouped and
> pointed-to. Created at the **memory-distiller-v2 closeout (2026-06-16)** by consolidating items that
> were scattered across specs, ADRs, archived chunk notes, bus rulings, the conductor journal, and the
> conversation. If you shut the machine for days, a fresh chat can rebuild full context from this file +
> `roadmap.md` + ADR-0012.

## Where we are (SHIPPED, the baseline)

**memory-distiller-v2 (memory-quality 2a + 2b) — SHIPPED 2026-06-16** (PRs #71+#72 merged to `main`).
Incremental delta distiller (op new/append/replace), durable forget-by-id, suppress-only normalized
dedup, stable replace-on-change, all-facts candidate-pool below a cap (BM25 only as the above-cap
fallback), self-concept module (agent knows it cannot self-forget), language preservation, and the
`MEMORY_DEBUG` (distill/retrieve/forget/inject) + headless demo-harness dev-env. **Backend only.** The
user views/edits/forgets via the loopback **`history.html`** page (browser), NOT in the overlay.
Spec: `specs/2026-06-13-memory-distiller-v2.md` (status: implemented).

**Update 2026-07-10 — Theme A (`memory-transparency-ui`) SHIPPED:** the user now views / edits /
forgets memory **in the overlay** (tray → "Open Memory…"), not only via the loopback `history.html`
page — which stays as the no-install browser fallback. See §A below.

The structure is sound for single-user dogfood. Everything below is **deferred / not-yet-built**.

---

## Deferred backlog (grouped by theme)

### A. Transparency & control — the user SEES and CONTROLS memory  ⭐ Lior's #1 vision item
> Vision (ADR-0012 + memory `project_conversational_interaction_model`): *"the user never directly
> contacting the super-chat is the single most expensive mistake."* Build view/edit/forget +
> provenance + expiry day-one. Today this exists ONLY as the browser `history.html` page.
>
> **→ SHIPPED 2026-07-10** — the `memory-transparency-ui` feature (Theme A) shipped: chunks
> 01–05 merged + Lior's joint §6.1 live demo signed. Spec (now `implemented`) =
> `specs/archive/2026-07-02-memory-transparency-ui.md`. The two bullets below (in-answer
> provenance affordance + token revocation) are what remains carved out / deferred.

- **In-overlay memory UI + tray-icon shell + history.html UX tails** — ✅ **SHIPPED 2026-07-10**
  (Theme A). Tray icon status + "Open Memory…" window (no token paste, ADR-0006 p.4 un-deferred);
  in-overlay threads/facts VIEW with per-fact thread-level provenance; distilled-fact-text EDIT
  (durable human "yours" badge, survives restart) + message-correction (session-local tag);
  "release the reference" FORGET (fact-delete, sources untouched); expiry/confidence shown only
  when non-default; honest locked/401/daemon-down states; and the browser `history.html` fallback
  tails (🔒 locked instead of false "Loading…", zsh-`%`/whitespace token-trim). Chunks archived in
  `chunks-todo/archive/memory-transparency-ui/`.
- **In-answer "where did this come from?" provenance affordance** — **CARVED OUT to its own design
  task** (Lior 2026-07-02): weigh pros/cons of dragging fact→thread linkage through live answers —
  Lior's concern is memory UX overcomplication. ⚠️ ADR-0012 **5a names it MANDATORY** — this is a
  recorded deliberate revisit, NOT a silent drop; the design task owns reconciling with (or amending)
  ADR-0012. Anchor: forget stays "release the reference" (fact-delete only, sources untouched).
  *Lives:* `specs/2026-06-04-memory-foundation.md` §7 (5a-open), ADR-0012 5a.
- **Expiry / confidence per fact — decision RECORDED 2026-07-02: leave as-is, do NOT build.** The DB
  columns exist and `retrieve` filters `WHERE expiry IS NULL OR expiry > now`, but the distiller
  hardcodes `expiry: null` / `confidence: 1` — dormant. Ruling: no scoring/decay until Lior's own
  fact base shows stale-fact pain; columns stay (cheap); the in-overlay UI shows these fields only
  when non-default. *Lives:* 2026-07-02 spec (display rule); verified dormant in code 2026-06-16.
- **Token revocation / rotation — noted 2026-07-09 (chunk-03 demo, item 4).** Deleting the
  auth-token FILE mid-session does not lock live windows: both overlay and daemon hold the bearer
  in memory from startup, and file deletion is not revocation (standard bearer semantics; the
  at-load 🔒 locked state works). If revocation ever matters (multi-user, or a leaked-token drill):
  daemon re-reads/rotates the token + rejects stale bearers → live sessions drop. ADR-0013 polish;
  low priority for single-user loopback. *Lives:* here + chunk-03 DONE ledger line.

### B. Conversational forget / memory-action tools  (roadmap 2c)
- **2c — agent memory-action tools.** Today the agent can only *say* "I can't forget — use History"
  (the self-concept module). **2c gives it a real tool** so "forget what I said about X" / "remember Y"
  actually act mid-conversation (wires to `Hatch.forget`/recall). A NEW class of *side-effecting* action
  tools (distinct from UI-render tools). *Deferred:* needs an ADR-0002/0005 closed-set extension + a
  poisoning-surface review (ADR-0012 5d). Shares a design+ADR pass with 2d. *Lives:* roadmap "Memory —
  next"; relay-001; v2-01/04/07/08/09 chunk notes. **This is Lior's "забути що я казав про X без
  адмінки" lever.**

### C. Content erase — thread-forget  (roadmap 2e)
- **thread-forget** — forget a WHOLE conversation (content-erase), the chosen replacement for the
  dropped per-message message-forget. Scrubs the thread's messages (reuses the dormant, already-built
  `WriteGate.forget` hard-scrub primitive). **⚠️ RULING CHANGE (Lior 2026-07-10, ADR-0012 rider
  Ruling 2 — fact source-independence): thread-forget does NOT delete the thread's facts.** Facts
  change/disappear ONLY via manual edit / prompted edit (2c) / explicit fact-forget; the earlier
  "deletes its facts" sketch here is SUPERSEDED. *Deferred:* its own feature; pairs with
  2d (a forgotten topic could otherwise resurface via message-search). *Lives:* ADR-0012 rider
  2026-07-10; `specs/2026-06-13-memory-distiller-v2.md` §1/§3.6; roadmap.

### D. Retrieval quality — semantic candidate-fetch  (roadmap 2d)  ⭐ the root fix
- **2d — on-demand archive retrieval + SEMANTIC (embeddings) candidate-fetch.** The PROPER
  cross-language / reworded retrieval. The current BM25 (matching the user's Ukrainian tail against the
  English LLM canonical) is why the demo-3 colour-change duplicated; the all-facts-below-cap pool is the
  cheap stopgap. **2d (embeddings) supersedes BOTH** once the corpus outgrows "pass them all." First cut
  could be FTS5 keyword search over the message archive; vector/embeddings as a swappable provider.
  *Deferred:* embeddings install complexity on Bun (`onnxruntime-node`/`setCustomSQLite` — see gotchas)
  + premature at single-user scale. *Lives:* roadmap; `specs/2026-06-13-memory-distiller-v2.md` §1; q#008;
  `research/2026-06-13-memory-similarity-approaches.md`.
- **2d shape = HYBRID retrieval (BM25 + embeddings) — Lior direction 2026-07-10** (recorded at the
  memory-transparency-ui joint demo, on the accepted-as-known v2 dedup ceiling). When memory-quality work
  resumes, 2d should combine lexical BM25 with semantic embeddings (not embeddings-only) so exact-term
  matches and cross-language/reworded matches both land — the dedup ceiling (a cross-language re-derivation
  slipping past normalized dedup) is the concrete miss a hybrid ranker is meant to close.
- **REMOVE message-edit — DECIDED (Lior 2026-07-10, final), EXECUTION scheduled at the 2d pass.**
  Ruled same-day after the rider acceptance: with fact-edit shipped as the real "correct what the
  agent remembers" lever, the archive message-correction surface (chunk-03) is pointless ("бестолковий")
  — per fact source-independence it feeds nothing downstream. End state: **archive = read-only
  immutable history; memory (facts) = the editable surface.** Removal is deliberately deferred to the
  2d design pass (no urgency; it blocks nothing) — when 2d starts, add a removal chunk: strip the
  message Edit affordance from the overlay + history.html, retire the `/memory/edit` message branch
  (keep `target_type:"fact"`), keep the append-only mutation/correction machinery in the store
  (immutable-history primitive, ADR-0015 B1 — it predates the UI and other things sit on it).
  *Lives:* here; ADR-0012 rider 2026-07-10 Ruling 1 removal-note.

### E. What's remembered / fact richness
- **Complex corrections & deletion-via-statement — NOT specced (open case).** Replace currently fires
  only on a single-attribute USER contradiction ("colour is now green"). Unhandled / untested: *"I don't
  work in IT anymore"* (a deletion expressed as a statement — should it forget the work fact?), partial
  edits, multi-fact statements. The distiller has no defined behavior here. **This is a case-set Lior
  likely had in mind — capture it before designing E.** *Lives:* nowhere yet — recorded here.
- **Kind-typed / structured fact fields** (entity / preference / count with typed values) — **RULED OUT**
  for now (see Ruled-out below), but explicitly "additive-later if a semantic query engine lands."
- **Topic-based fact consolidation («append-механізм») — anticipated, NOT designed (Lior 2026-07-10,
  at the 2c spec sign-off).** When facts get grouped/merged by topic, the mutation machinery is the
  2c-extracted `applyFactOp` core (spec 2026-07-10 D7a-bis rider): the replace lane is expected to be
  reused, plus a DISTINCT consolidation/append-style op added as a new handler. The 2c build keeps the
  core simple-but-extensible for exactly this; design the op itself when topic-grouping work starts.
  *Lives:* spec 2026-07-10-memory-action-tools D7a-bis rider + chunk-01 design note; here.

### F. Injection architecture — variant B
- **Variant B — render facts into the SYSTEM prompt** instead of `[remembered]` user-messages.
  Architecturally cleaner per-turn injection; pairs with 2c/2d. *Deferred:* from v2-08 — the
  `[remembered]`-as-messages format is load-bearing across the system prompt + provenance-stamp + tests;
  too big a rewrite for the recall fix (variant A — re-inject every turn — shipped instead). *Lives:*
  roadmap; conductor journal; v2-08/09 chunk notes.

### G. Adjacent — north-star route (not strictly "memory polish", but the super-chat vision is coupled)
- **Text continuation affordance** — Live Card (inline reply on the answer) vs Continuation Pill
  (re-summon with a context pill). A build-time choice deliberately left open. *Lives:* ADR-0012;
  `project_conversational_interaction_model`; roadmap route part 2.
- **Voice parity** — co-equal voice+text ("both just add a turn to a thread"). *Lives:* ADR-0007; roadmap Phase 4.
- **Concurrent threads / background tasks** (gotcha #45) — multiple live threads + long-running work; the
  single-session `inFlight` guard blocks new input while the agent works. *Lives:* `project_concurrent_
  session_context_model`; open-questions Q12.

---

## Ruled out (do NOT re-propose without revisiting the recorded "why")

- **Kind-typed structured fact fields** — rejected (nothing consumes types today; injection flattens to
  text; precision comes from WHERE/WHEN structure is computed, not schema types). Revisit only if a
  semantic query engine lands. [q#001 Sub-1]
- **Option B: "forget fact AND its source messages"** (dual-delete hard-escape) — SUPERSEDED. v2's durable
  fact-delete + no-re-derivation makes the source-scrub redundant. [ADR-0015 decision 5; relay-005]
- **Per-message message-forget as a user path** — DROPPED. The agent uses FACTS, not raw archive;
  fact-delete already removes it from the agent's view. Replaced by **thread-forget** (§C). [v2 spec §3.6]
- **Global re-projection distiller (the original 2b)** — proven UNSTABLE on Lior's 2026-06-13 demo
  (facts churned/reordered/vanished); re-architected to the incremental distiller that shipped.
- **Finer (message-level) provenance** — CLOSED 2026-07-02 (was §A, deferred since v2-06): no concrete
  benefit identified — thread-level provenance suffices for "where from", and the finer-forget upside
  died with per-message forget (already ruled out above). Revisit only if a real "dig deeper" need
  shows up in dogfood.

---

## Open cases worth capturing before the next design pass
*(these have no home in any spec yet — they would be lost if not written here)*
1. **Complex corrections** (§E): negation / deletion-via-statement ("I don't work in IT anymore"),
   partial edits, multi-fact statements. No defined distiller behavior.
2. **Expiry / confidence are dormant** (§A): plumbing exists, values hardcoded — decide if/when facts
   should age or be confidence-weighted, or rip the dead columns.
3. **Recall-usage A′ tail** (LLM-fuzzy): the structural turn-2+ loss was fixed (v2-08); the residual is
   the model occasionally not USING an injected fact. Asymptotic; 2c (tool-based recall) is the likely
   lever. *Lives:* roadmap.
4. **Archive-summarization tier**: the O(archive) scaling trigger; also the point at which the
   candidate-fetch flips from all-facts → semantic (2d). *Lives:* roadmap; spec §3.3 D8.
5. ~~**Should message-edit re-trigger fact derivation?**~~ **MOOT (Lior 2026-07-10, same day):**
   message-edit itself is decided-for-removal (§D) — with no message-edit there is no re-derivation
   question. Kept struck-through for the record only.

---

## Vision anchor (read this first when picking up)
The north star is in **ADR-0012** + the memory `project_conversational_interaction_model`:
one agent · co-equal voice+text · **agent paradigm, not chatbot** (ephemeral widgets, not a chat log) ·
memory = "super-chat" (threads distill into a persistent store; new threads draw on it) · and the
**day-one transparency mandate**: keep memory invisible by default BUT build view/edit/forget +
provenance + (recoverable, explicit) distillation + never-overwrite-human + thread-isolation. The single
costliest mistake to avoid: an opaque always-injecting store the user can't inspect (churn + poisoning
surface). **Theme A above is the direct execution of that mandate and is the least-built part of it.**

---

## Suggested next step
**Theme A SHIPPED 2026-07-10** (`memory-transparency-ui`; chunks 01–05 + joint §6.1 demo signed).
The queue now, in rough order: **2c (conversational forget)** — Lior re-confirmed 2026-07-02 as the
small next feature; then the **in-answer provenance affordance design task** (carved out of Theme A —
see §A); then **2d — HYBRID retrieval (BM25 + embeddings; §D, Lior 2026-07-10)** once the corpus
outgrows all-facts-below-cap.
