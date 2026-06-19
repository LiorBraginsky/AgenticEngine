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

The structure is sound for single-user dogfood. Everything below is **deferred / not-yet-built**.

---

## Deferred backlog (grouped by theme)

### A. Transparency & control — the user SEES and CONTROLS memory  ⭐ Lior's #1 vision item
> Vision (ADR-0012 + memory `project_conversational_interaction_model`): *"the user never directly
> contacting the super-chat is the single most expensive mistake."* Build view/edit/forget +
> provenance + expiry day-one. Today this exists ONLY as the browser `history.html` page.

- **In-overlay memory UI** — view/edit/forget threads + distilled facts + provenance **inside the
  overlay** (not a separate browser page). *Deferred:* needs the **tray-icon + settings-overlay shell**
  prerequisite (ADR-0006 p.4; see `project_tray_icon_followup`). *Lives:* scope split in
  `specs/2026-06-12-memory-quality.md` §1 + `docs/2026-06-12-memory-quality-scope.md`. **The biggest
  gap vs the stated vision.**
- **In-overlay "where did this come from?" provenance affordance** — when the agent uses a remembered
  fact, a lightweight in-overlay "from where?" link into History. ADR-0012 **5a says MANDATORY**, but it
  shipped only as `history.html`. *Lives:* `specs/2026-06-04-memory-foundation.md` §7 (5a-open),
  ADR-0012 5a. Must be an ADR-0005 closed-set primitive if rendered in the overlay.
- **Finer (message-level) provenance** — provenance is currently **thread-level** (`thread:<id>`).
  Message-level would give better "dig deeper" links AND finer forget granularity. *Deferred:* from
  v2-06 (forget-by-id shipped instead; message-level explicitly punted). *Lives:* roadmap "Memory —
  next"; v2-06 chunk note.
- **Expiry / confidence per fact — DORMANT, not built.** The vision wanted decay/confidence tags. The
  DB columns exist and `retrieve` even filters `WHERE expiry IS NULL OR expiry > now`, BUT the distiller
  always writes `expiry: null` and `confidence: 1` (hardcoded, `distiller-registration.ts`). So **facts
  never expire and confidence is meaningless today.** Building real aging/decay + confidence scoring +
  surfacing them is unbuilt. *Lives:* ADR-0012 transparency mandate; verified dormant in code 2026-06-16.
- **history.html UX backlog** (move with the in-overlay UI follow-on): (1) shows a false "Loading…"
  instead of an explicit "🔒 paste your token to view" locked state; (2) auth-token trailing-`%`
  footgun (zsh artifact — should trim non-token chars). *Lives:* `docs/2026-06-12-memory-quality-scope.md`.

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
  `WriteGate.forget` hard-scrub primitive) + deletes its facts. *Deferred:* its own feature; pairs with
  2d (a forgotten topic could otherwise resurface via message-search). *Lives:* `specs/2026-06-13-
  memory-distiller-v2.md` §1/§3.6; roadmap.

### D. Retrieval quality — semantic candidate-fetch  (roadmap 2d)  ⭐ the root fix
- **2d — on-demand archive retrieval + SEMANTIC (embeddings) candidate-fetch.** The PROPER
  cross-language / reworded retrieval. The current BM25 (matching the user's Ukrainian tail against the
  English LLM canonical) is why the demo-3 colour-change duplicated; the all-facts-below-cap pool is the
  cheap stopgap. **2d (embeddings) supersedes BOTH** once the corpus outgrows "pass them all." First cut
  could be FTS5 keyword search over the message archive; vector/embeddings as a swappable provider.
  *Deferred:* embeddings install complexity on Bun (`onnxruntime-node`/`setCustomSQLite` — see gotchas)
  + premature at single-user scale. *Lives:* roadmap; `specs/2026-06-13-memory-distiller-v2.md` §1; q#008;
  `research/2026-06-13-memory-similarity-approaches.md`.

### E. What's remembered / fact richness
- **Complex corrections & deletion-via-statement — NOT specced (open case).** Replace currently fires
  only on a single-attribute USER contradiction ("colour is now green"). Unhandled / untested: *"I don't
  work in IT anymore"* (a deletion expressed as a statement — should it forget the work fact?), partial
  edits, multi-fact statements. The distiller has no defined behavior here. **This is a case-set Lior
  likely had in mind — capture it before designing E.** *Lives:* nowhere yet — recorded here.
- **Kind-typed / structured fact fields** (entity / preference / count with typed values) — **RULED OUT**
  for now (see Ruled-out below), but explicitly "additive-later if a semantic query engine lands."

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

## Suggested next step (when you return — not a commitment)
If finishing the *user-facing* memory promise matters most, the natural next feature is **Theme A
(transparency & control)** — specifically the in-overlay memory UI + the provenance affordance + a real
expiry/confidence decision — because it's the largest gap vs the stated vision and what a user actually
touches. **2c (conversational forget)** is the strong runner-up (it's the "забути про X" lever). 2d
(semantic retrieval) is the "proper" infra fix but is premature until the corpus grows. Decide via a
fresh brainstorm → spec → decompose when you're back.
