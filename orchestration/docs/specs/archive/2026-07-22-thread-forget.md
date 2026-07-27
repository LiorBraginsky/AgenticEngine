> 🗄️ ARCHIVED 2026-07-28 — implemented. Historical record; do not edit.

---
title: Thread-forget (2e) — content-erase of a whole conversation
status: implemented — chunks 01–03 shipped (PRs #110/#111/#112 merged to main); Lior's live §6.1 feature-closing demo SIGNED 2026-07-28 (husk+banner · THE TRAP / Ruling 2 — fact survives AND is still injected into a new thread · audit-skeleton `[forgotten]` scrub · live-guard 409 · CANCEL; bonus: the agent honestly REFUSED an agent-side thread-forget and pointed at the Memory window — the deliberate §3.6 absence, live). Honest caveat: demo item 4's PURE archive-search miss was not strictly exercised (the surviving fact pre-empted `memory_search`, so the run shows retrieve-only) — archive-scrub proven indirectly via audit-`[forgotten]` + gone messages. Two observations + two accepted residuals routed to memory-backlog §C. (was: accepted — Lior 2026-07-22 (§5.2 sign-off via AskUserQuestion, §0.1–0.6 package AS RECOMMENDED — trigger both-surfaces · frozen confirm copy · husk · audit-skeleton scrub · live-guard 409 · no new ADR))
date: 2026-07-22
deciders: [lior]
feeds: thread-forget
implements: adr/0012-conversation-and-memory-model (rider 2026-07-10 Ruling 2 — fact source-independence, BINDING here) + adr/0015-intent-based-memory-forget (the RETAINED WriteGate hard-scrub primitive, consumed at thread level)
refines: specs/2026-06-13-memory-distiller-v2.md §3.6 (the recorded THREAD-forget sketch — its "delete its facts" half is SUPERSEDED by Ruling 2)
carries: memory-backlog §C (the charter); the ×2-flagged Ruling-2 trap (2d chunks 03/05; write-gate.ts:104-110)
route-part: memory 2e (roadmap "Memory — next", queue head 2026-07-22)
tags: [spec, memory, forget, thread, content-erase, scrub, tombstone, transparency]
---

# Thread-forget (2e) — spec

> **Pipeline placement.** Frontier (fable) **design + decompose** pass (PIPELINE §11) for roadmap
> **2e**, picked by Lior 2026-07-22 («го»). The user erases a WHOLE conversation's CONTENT — the
> successor to the dropped per-message message-forget (ADR-0015 decision 5 + the per-message user
> path, both superseded/dropped at v2). The complement of fact-forget: *release-the-reference*
> deletes a derived fact and never touches sources; *thread-forget* scrubs the SOURCE conversation
> and — per ADR-0012 rider Ruling 2 — **never touches facts**. Until now the only content-erase
> was none (2d spec §0.3 said it plainly); 2d's `memory_search` made the archive agent-reachable,
> so the erased-topic-resurfaces coupling backlog §C predicted is now live.
>
> **Decision provenance.** Full code-seam recon ran in this pass (file:line anchors throughout —
> verified against main @ `6785b35`). An adversarial design-critic pass ran on this draft BEFORE
> the bus ask; findings folded inline, tagged `[critic …]` (verdict: 0 BLOCKER / 2 MAJOR /
> 9 minor, all addressed). The five genuinely-open taste seams (§0.1–0.5) were routed UP the
> dev-bus as ONE batched ask and **RULED — q#019, ALL FIVE AS RECOMMENDED + 4 conductor riders**
> (`.conveyor/bus/a/019-trigger-and-erase-semantics.md`), folded inline, tagged `[q#019 rider n]`.
> The §5.2 spec sign-off is **Lior's** (§0.1–0.6 = the decision-points list); the decompose PR
> does NOT merge before it.
>
> **⚠️ THE TRAP, honored (flagged ×2 during 2d for this pass).** The dormant scrub primitive
> `WriteGate.forget` TODAY also sweeps derived facts (`write-gate.ts:111-112` —
> `dropDistilledFactsByProvenance` / `dropDistilledFactsForThread`), behavior ADR-0012 rider
> Ruling 2 (Lior, 2026-07-10) FORBIDS for source erasure: *"erasing or forgetting source content
> (a message today, a whole thread when 2e thread-forget lands) must NOT sweep the facts derived
> from it."* This spec builds thread-forget WITHOUT any fact-table touch (structurally, §3.1) and
> reconciles the per-message primitive to the same rule (§3.2). A scrubbed thread's facts LIVE ON;
> §3.5 designs the honest rendering of that state.

---

## 0. Decision points for sign-off (Lior)

> §0.1–0.5 were routed up the dev-bus as one batched ask (tightly-coupled trigger/semantics
> package) and **RULED q#019 — all five as recommended, + 4 riders folded below**; §0.6 is the
> ADR-tier call (conductor: agreed). Lior signs the §0.1–0.6 package here at §5.2.

### 0.1 — Trigger surface: Memory window (primary) + history.html (fallback parity)

Where the user forgets a conversation. **RULED (q#019): BOTH.**
- **Memory window, thread DETAIL view** (not the list row): the destructive control lives where
  the user is LOOKING at what they are about to erase — deliberate-destruction UX, and the
  message count for honest confirm copy is in scope at render time (the view payload passed to
  the render fns; the controller retains only `{kind, threadId}`, so the count is wired at
  render, not read from controller state [critic m6]). No control on list rows (mis-click
  surface, no content in view).
- **history.html parity**: the no-install fallback already carries the fact-forget arm→confirm
  pattern (`history-page.ts:447-514`); the thread-level button is the same POST with a different
  body — cheap, and the fallback stays honest (it must not silently lack the one content-erase).

### 0.2 — Confirm semantics: the house two-step arm→confirm, stronger copy — no new primitives

An irreversible content-erase, human-initiated from the UI. **RULED (q#019): the existing
two-step arm→confirm pattern** (fact-forget precedent: `actions.ts:19-36`, history 5s auto-reset
`history-page.ts:457-466`). **The confirm copy is a FROZEN user-facing contract [q#019 rider 3]**
— verbatim, with N = the REAL message count at confirm time:

> *"Erase this conversation's content (N messages)? Distilled facts remain. Cannot be undone."*
- **2c d1 tension, stated:** audit-not-confirm (ADR-0016 4e) was ruled for AGENT actions — the
  caller was the conversation itself and the substitute was the durable audit trail. THIS is a
  HUMAN-initiated destructive action from the sovereign UI surface: a confirm affordance here does
  not contradict d1 (different caller class), and the arm→confirm two-step is already the shipped
  house pattern for the destructive fact-forget. No modal, no typed-phrase ceremony (dogfood
  scale; the two-step + honest copy IS the safety, per `actions.ts:9`), no wire primitives.

### 0.3 — What "erased" looks like afterwards: a tombstoned HUSK, not a vanished row

**RULED (q#019): the thread row SURVIVES as an honest husk.** Mechanics either way are identical
(scrub + `threads.status`); the fork was list visibility + rendering.
- `threads.status → 'forgotten'` (additive value on the TEXT column, no schema change).
- **List view:** the row stays, badged (status already renders on overlay rows, `render.ts:40-44`).
- **Husk metadata must not leak content [q#019 rider 1 — FROZEN]:** everything the husk renders
  (list row, detail header) is a NEUTRAL label of the «erased conversation» class — never a
  content-derived string. Today `threads.title` is always NULL (recon: `createThread` is the only
  title write and always passes `undefined`, `thread-lifecycle.ts:92`), so nothing leaks; the
  scrub tx still sets `title = NULL` DEFENSIVELY so a future content-derived-title feature cannot
  silently reopen the leak, and both UIs render the husk under the neutral label (they already
  fall back from NULL title to the id — `render.ts:40`, `history-page.ts:288`). The §6.1 demo
  checks the husk for content leakage explicitly.
- **Detail view:** an explicit banner — *"You erased this conversation's content on <date>"* —
  instead of the N × `[forgotten]` message rows (they are pure noise; the banner is the honest
  render). Facts/events sections render per §3.5/§0.4.
- **Why husk over vanish:** surviving facts keep `provenance = "thread:<id>"` and the fact view
  renders it as a clickable jump (`fact-view.ts:15-21`, `render.ts:109-115`). With a vanished row
  that link lands on an empty view indistinguishable from a bug; with a husk it lands on the
  honest "erased" banner — exactly the "provenance now points at an erased conversation" render
  the charter asks to design. Also preserves 5b observability (the erase is an observable event,
  not a disappearance). history.html renders the same state (its detail already shows
  `[forgotten]` content; it gains the badge/banner cheaply).

### 0.4 — Scope of erase for the audit trail: scrub `fact_text` in place; keep the skeleton

`memory_action_events` rows are thread-keyed and carry RAW `fact_text` (2c d4 recoverability;
`schema.ts:166-175`) — they can quote what was discussed. The recoverability-vs-erasure fork:
- **RULED (q#019): on thread-forget, scrub the erased thread's `memory_action_events.fact_text`
  to `[forgotten]` in the same tx; keep the rows** (action/outcome/actor/timestamps survive).
  This mirrors the archive posture exactly — *the event remains, the content is erased*
  (ARCHIVE-AS-TRUTH, `schema.ts:1-6`) — and keeps ADR-0016 4e's audit function (actions stay
  VISIBLE on the husk) without content. Full-row delete erases the trace that actions happened
  (weakens the audit contract); keep-as-is leaks conversation-adjacent content past the erase.
- `distillation_events` rows (counts + trigger, NO content — `schema.ts:82-89`) are KEPT
  untouched. `replaced_facts` / `forgotten_facts` are FACT-side artifacts — untouched by
  construction (Ruling 2; §3.1 structural rule).

### 0.5 — Live-thread guard: refuse to erase a currently-live conversation (409)

`threads.status` is NOT a liveness signal (re-adoption of a known thread never flips status —
`thread-lifecycle.ts:71-84`; a crashed session strands rows 'active'). A scrub of the LIVE
adopted thread would be dishonest structurally: every subsequent turn APPENDS fresh unscrubbed
messages to the "erased" thread, and the in-flight turn is flushed to it on close
(`endTurn` at `index.ts:294`, close-flush `index.ts:307-319`) — the DB would silently
re-acquire plaintext after the erase [critic m1: the guard's rationale is the append/flush
legs, not a persistent RAM copy — `sessions` entries for completed turns are deleted
immediately, `index.ts:295`]. The user's "I erased it" mental model breaks silently.
**RULED (q#019): guard.**
- **The live-registry is a spec decision, not a build detail [critic MAJOR-1]:** there is no
  enumerable connection set in Bun.serve and `activeThreadId`/`touchedThreadIds` live only in
  per-socket `ws.data` — so `index.ts` maintains a module-level **`Map<threadId, refcount>`**:
  incremented when a socket binds/touches a thread (the `session_start` handling that sets
  `activeThreadId`/`touchedThreadIds`), decremented for that socket's threads in the `close`
  handler (`index.ts:304-342`). Refcount because one thread can be adopted by two sockets.
  `isThreadLive = (id) => (map.get(id) ?? 0) > 0` is passed into `MemoryHttpDeps` (additive
  dep). The check is point-in-time (no lock) — TOCTOU accepted at single-user scale, stated.
- The route returns **409 `{error:"thread_live"}`**. NB `http-routes.ts:29-32` reserves 409 for
  a *future non-human-actor 5e refusal* — `thread_live` is a DISTINCT 409 condition,
  differentiated by the `error` body; the header comment is updated when the branch lands
  [critic m7]. UI renders an honest "this conversation is open — close it first".
  Dismissed/stale-active-but-not-connected threads erase normally.
- §5 pins both sides: erase-while-live → 409; close → dismiss → the SAME thread then erases
  cleanly with **no post-erase re-flush of plaintext**.
- Rejected alternative: gate on `status === 'dismissed'` — wrong both directions (stale 'active'
  rows unerasable forever; a re-adopted 'dismissed' thread erasable while live).

### 0.6 — ADR check: NO new ADR, NO rider (recorded for the sign-off, not a bus fork)

Applying Finding #5 tiering: thread-forget **executes** two accepted decisions — ADR-0015's
retained hard-scrub primitive ("the future THREAD-forget content primitive reuses it", its
2026-06-13 status note) and ADR-0012 rider Ruling 2 (which *names* 2e and binds it). No accepted
decision changes. The §3.2 fact-sweep REMOVAL from `WriteGate.forget` is *reconciliation to an
already-accepted decision* (Ruling 2 forbids the behavior; the code carries the ×2-flagged trap
comment saying exactly this, `write-gate.ts:104-110`), not a new decision — the PIPELINE §7.2
"reconciliation" lane, executed at the decompose tier that owns it. The HTTP body widening is
additive on an ADR-0013 route (the same posture ADR-0015/fact-edit took — "additive to that HTTP
body, not a frozen wire envelope"). Wire + mock reducer: byte-untouched.

---

## 1. Purpose & scope

**Give the user the content-erase handle: forget a WHOLE conversation.** Scrub every message of a
thread (content + vectors + FTS + mirror plaintext) so the conversation is unreadable AND
unsearchable — by the user's surfaces and by the agent's `memory_search` — while **every distilled
fact derived from it lives on untouched** (Ruling 2), with an honest UI render of that state.

**In scope:**
- `WriteGate.forgetThread` — the thread-level scrub primitive, ONE atomic tx over all messages,
  reusing the per-message mechanics (tombstone + `REDACTION_MARKER` + `deleteMessageDerived`)
  with **zero fact-table touches** (§3.1).
- **Ruling-2 reconciliation** of the dormant per-message `WriteGate.forget`: the two fact-sweep
  calls are removed; the tests pinning the sweep flip to pin the OPPOSITE (§3.2).
- HTTP: additive `target_type:"thread"` on `POST /memory/forget` (Bearer, 401; ADR-0013), a
  `Hatch.forgetThread` façade, 404/400/409 taxonomy + idempotent re-erase (§3.3).
- Overlay Memory window: the forget-conversation affordance + confirm (§0.1/0.2), the erased
  husk/banner render, additive thread meta on the `hatch.view` payload (§3.4/3.5).
- history.html fallback parity (§0.1).
- **Erasure-completeness proof**: search no-resurface (both legs), distiller no-op, drain-race
  hold, mirror scrub — the §5 matrix.

**Out of scope (recorded, with WHY — PIPELINE §7.2):**
- **Deleting the thread's facts** — SUPERSEDED by ADR-0012 rider Ruling 2 (the backlog's earlier
  "deletes its facts" sketch is explicitly dead; memory-backlog §C carries the supersession).
- **Per-message forget** — ruled out at v2 (D-V6a-bis) and not resurrected; the user-facing
  content handle is the THREAD (ADR-0012 "the user interacts with threads").
- **Undo / recycle bin / soft-delete window** — the house forget contract is irreversible-with-
  honest-confirm (fact-forget precedent, `actions.ts:9` "the confirm IS the safety"); a retention
  window would be a new product decision with its own privacy surface. Revisit on real dogfood
  regret, not speculatively.
- **An agent-side `memory_forget_thread` action tool** — NO. ADR-0016's plane is a closed set;
  its d7 ceiling ("≤3 in-view fact deletions, each audited, text recoverable") is constitutive,
  and a whole-conversation content-erase is categorically beyond it (irreversible, not in-view,
  not recoverable). A prompt-injection must never be able to erase history. The Memory window is
  the sovereign surface for content-erase — same posture as ADR-0015 decision 6 ("an agent must
  not destroy history on a conversational 'forget'"). Absence is also the agent-side honesty
  answer (§3.6): no new tool, no self-concept clause.
- **Bulk forget ("erase everything / all conversations")** — one thread per action, matching the
  one-fact-per-forget blast-radius posture (2c d2). Revisit trigger: dogfood shows a real purge
  need (that is a different, bigger product decision — likely with its own export story).
- **Wire / frozen surfaces** — `@agentic/protocol` + mock reducer byte-unchanged; nothing here
  touches the wire (Memory window is daemon-HTTP + overlay render, the Theme-A pattern).
- **Title scrub** — moot today: `threads.title` is always NULL (only write is
  `createThread(undefined, …)`, `thread-lifecycle.ts:92`). §7.1 note pins that IF a future
  feature derives titles from content, title joins the scrub set (recorded in §3.1's matrix).
- ~~Blocking re-adoption of an erased thread id~~ — **pulled IN-scope as a small structural
  close [critic m2: the realistic vector is the same client re-sending the erased thread's own
  id, not a UUID collision]:** `beginTurn`'s known-thread branch adopts any existing id
  regardless of status (`thread-lifecycle.ts:72-84`), so a re-sent erased id would hydrate an
  all-`[forgotten]` tail and then `endTurn`-APPEND fresh plaintext onto the 'forgotten' husk —
  a "view says erased / disk grows new content" mini-breach. Close: an erased thread id is
  **not adoptable and not reusable** — `beginTurn` treats a `status='forgotten'` requested id
  as unknown AND mints a FRESH id (never `adoptId`-reuses the erased id — that INSERT would
  collide with the surviving husk PK). See §3.3a.

---

## 2. Frame carried (locked elsewhere, not re-decided here)

- **ADR-0012 rider Ruling 2 (fact source-independence)** — THE governing rule, quoted in the
  header. A fact changes/dies ONLY via manual edit / prompted edit (2c) / explicit fact-forget.
  This spec adds NO fact-change path; the STABILITY amendment invariant is untouched (facts
  persist byte-identical through a thread-forget — tested, §5).
- **ADR-0015** — the B1 separate-artifact invariant, EXTENDED symmetrically to the thread path:
  message/thread-forget writes `mutations` + scrubs `messages`, and **never touches
  `distilled_facts` / `forgotten_facts` / `fact_fts` / `fact_embeddings`** (post-§3.2 this holds
  structurally for BOTH scrub paths). Option B (forget-fact-AND-sources) stays dead — this is the
  reverse direction (forget sources, keep facts), not its resurrection. The retained hard-scrub
  primitive is consumed exactly as ADR-0015's status note anticipated.
- **ADR-0013** — thread-forget is a write: Bearer-gated `POST /memory/forget`, 401 on bad/missing
  token, `HTTP_CTX = {actor:"user", authored_by:"human"}` fixed server-side
  (`http-routes.ts:61`). The body widening is additive (no frozen surface).
- **ADR-0016** — untouched: no new tool, no registry row, no cap/ceiling change. `memory_search`
  keeps its contract; it simply finds nothing from an erased thread (§3.6).
- **ADR-0014** — the dismiss flow (`close(ws)` → `hook.dismiss`, `index.ts:304-342`) is
  unchanged; thread-forget is orthogonal to dismiss and guarded against the live thread (§0.5).
- **ARCHIVE-AS-TRUTH (memory-foundation §3.2 / `schema.ts:1-6`)** — carried at thread scale:
  message ROWS + tombstone mutations remain (the event history is immutable), CONTENT is erased
  (real erasure incl. the JSONL mirror). This is the per-message forget posture, thread-wide.
- **Frozen surfaces:** `@agentic/protocol` + the mock reducer — byte-unchanged (byte-diff at PR
  time, standing practice).

---

## 3. Spec decisions

### 3.1 — D1: `WriteGate.forgetThread(threadId, ctx, reason?)` — one atomic tx, zero fact touches

The new primitive, alongside (not wrapping N calls of) the per-message `forget`:

- **Resolve + guard:** unknown `threadId` → typed not-found (route maps to 404). Machine ctx →
  refused outright (defense-in-depth mirror of `editFact`'s stance, `write-gate.ts:222`): thread
  content-erase is human-only by construction; no production machine caller exists or is planned
  (the ADR-0016 out-of-scope above). 5e never blocks a human ctx (`write-gate.ts:76` guards
  machine only) — a human erases their own conversation including assistant turns, by design.
- **ONE `db.transaction` over the whole thread** [critic: atomicity is the point — a crash
  mid-loop must not leave a half-erased conversation]. For EVERY not-yet-tombstoned message of
  the thread: (a) INSERT the `mutations` tombstone row (same shape as the per-message path,
  `write-gate.ts:81-82`); (b) `UPDATE messages SET content = REDACTION_MARKER`; (c)
  `store.deleteMessageDerived(id)` — the 2d chunk-03 cleanup (`store.ts:1644-1647`, deliberately
  tx-less so it commits with the caller's tx, `write-gate.ts:84-90`). Already-tombstoned messages
  are SKIPPED → **idempotent**: a second forgetThread is a no-op that still returns success.
  Also in the SAME tx: (d) `threads.status → 'forgotten'` AND `title → NULL` (defensive —
  [q#019 rider 1]: no future content-derived title may survive an erase); (e) the §0.4
  audit-trail scrub (`memory_action_events.fact_text → REDACTION_MARKER` for this thread's rows,
  rows kept); (f) **correction-plaintext scrub [critic MAJOR-2]:** `mutations.replacement_content
  → REDACTION_MARKER` for `kind='correction'` rows targeting this thread's messages
  (`schema.ts:64` holds corrected text verbatim; the COALESCE read would resurface it,
  `store.ts:951-957`). Legacy-only content (`WriteGate.edit` lost its last production caller at
  the 2d message-edit removal) — but a completeness matrix may not silently skip a known
  content-bearing column.
- **THE ATOMIC-ERASE INVARIANT [q#019 rider 2 — named, frozen]:** steps (a)–(f) commit as ONE
  transaction — **no partial-erase state is ever observable** (a reader sees the thread either
  fully pre-erase or fully erased, DB-side). The mirror pass is the sole post-tx step (§3.1a
  crash-window note). Pinned by the §5 atomicity test.
- **After the tx** (same ordering discipline as the per-message path — DB first, then mirror,
  `write-gate.ts:93-102`): mirror handling (§3.1a); one `mirrorEvent` line
  (`{event:"thread_forget", actor, created_at}`) so the JSONL audit trail records the erase.
  **NO `bumpThreadMarker` [critic m5 — deliberate asymmetry with the per-message path]:**
  'forgotten' is a terminal state; there is no future incremental distill to inform, and bumping
  would manufacture the pointless "erased thread surfaces once in a dismiss batch as a no-op"
  condition. The distill no-op path is still pinned by test (§3.7 — it defends the
  dismiss-race window, not the bump).
- **STRUCTURAL Ruling-2 rule [the trap, designed out]:** `forgetThread` contains **no reference
  to `distilled_facts`, `forgotten_facts`, `fact_fts`, `fact_topics`, or `fact_embeddings`** —
  the same by-construction safety ADR-0015 B1 used (separate artifacts, not review vigilance).
  The §5 headline test pins it behaviorally: every fact row byte-identical across a forgetThread.
- **What dies / what survives (the erase matrix, frozen):**

| Artifact | Fate | Why |
|---|---|---|
| `messages.content` (all rows of the thread) | `[forgotten]` | the content-erase itself |
| `message_embeddings` / `message_fts` rows | DELETED in-tx | unsearchable by both legs (2d §0.3 carried) |
| `mutations.replacement_content` (corrections targeting this thread) | `[forgotten]`, rows kept | [critic MAJOR-2] legacy correction plaintext; COALESCE would resurface it |
| JSONL mirror `message` lines AND `edit`-event `replacement` fields | redacted in place (§3.1a) | "the mirror never holds plaintext after a forget" [critic MAJOR-2] |
| `memory_action_events.fact_text` (this thread) | `[forgotten]`, rows kept | §0.4 — event remains, content erased |
| message rows + `mutations` tombstones | KEPT | ARCHIVE-AS-TRUTH; the erase is observable |
| `threads` row | KEPT, `status='forgotten'`, `title=NULL` | §0.3 husk (neutral label, no content leak — rider 1); provenance links land honestly |
| `distillation_events` / `thread_distill_state` / `quarantine_markers` | KEPT untouched | no content (counts/markers); N1 posture carried |
| **ALL `distilled_facts` (+ fts/topics/embeddings) & `forgotten_facts` & `replaced_facts`** | **KEPT, byte-identical** | **Ruling 2 — facts are source-independent** |

### 3.1a — D1a: the mirror at thread scale

`redactMirrorMessage` is a per-message read-parse-rewrite of the per-thread JSONL
(`store.ts:1041-1059`); N calls = N full-file rewrites. Add a bulk `redactMirrorThread(threadId)`:
ONE pass that rewrites every `event:"message"` line's `content` **AND every `event:"edit"` line's
`replacement`** [critic MAJOR-2: the edit-event mirror line carries corrected plaintext verbatim,
`write-gate.ts:257`] to `REDACTION_MARKER`, preserving all lines otherwise (append-only audit
intent carried; unparseable lines left intact, matching `store.ts:1050-1051`). The file is NOT
deleted — deleting would erase the audit trail along with the content (the same
rows-stay/content-goes posture as the DB). Missing file → no-op (matches `store.ts:1043`).

**Mirror-vs-DB crash window [critic m4 — stated, not built around]:** the mirror rewrite is file
I/O and cannot join the sqlite tx; the DB-first ordering is deliberate (the canonical store
scrubbed first is the lesser evil — the per-message path has the same property,
`write-gate.ts:92-100`). A crash between tx-commit and the mirror pass leaves mirror plaintext
until a re-run; `forgetThread`'s idempotence makes "erase again" the recovery. A startup
mirror-reconcile could close the window later — not built at dogfood scale.

### 3.2 — D2: Ruling-2 reconciliation of the per-message primitive (the trap, closed at the root)

`WriteGate.forget` keeps its per-message scrub mechanics (they are `forgetThread`'s building
blocks and keep their unit tests) but **loses the two fact-sweep calls**
(`write-gate.ts:111-112`) and the trap comment they carry:

- Ruling 2 binds ALL source erasure ("a message today, a whole thread when 2e lands") — leaving
  forbidden behavior live in a primitive 2e reactivates is exactly the trap the ×2 flag warned
  about. There is NO production caller today (`hatch.ts:15-17`; recon-confirmed grep), so removal
  changes zero live behavior.
- `dropDistilledFactsByProvenance` / `dropDistilledFactsForThread` (`store.ts:786-797`) become
  caller-less → **DELETED** (dead code encoding forbidden behavior; the m3 no-silent-
  contradictions lesson). Their sync-gate duties are covered by the surviving delete paths'
  count-invariant tests.
- The two tests pinning the sweep (`write-gate.test.ts:64,80` "forget IMMEDIATELY purges…")
  are **REWRITTEN to pin the opposite** — facts SURVIVE a message scrub — which is the RED→GREEN
  evidence of the reconciliation (they fail on today's code, pass after).

### 3.3 — D3: HTTP + Hatch — additive intent dispatch (`target_type:"thread"`)

- `POST /memory/forget` gains the `target_type:"thread"` branch (ADR-0015 intent-dispatch, the
  discriminator that already exists): body `{target_type:"thread", thread_id, reason?}`;
  `thread_id` must be UUID-shaped (the same regex discipline as `fact_id`,
  `http-routes.ts:212`) → else 400 `bad_body`. Dispatches `hatch.forgetThread(thread_id,
  HTTP_CTX, reason)`.
- **Response taxonomy:** 401 (token) · 400 (shape) · 404 `target_not_found` (unknown thread) ·
  **409 `thread_live`** (§0.5 guard — the reserved "refused" slot going live for its first real
  case, `http-routes.ts:29-32`) · 204 (applied; ALSO on an idempotent re-erase — "already erased"
  is success, not an error).
- `Hatch` gains the `forgetThread` façade (thin, the house pattern `hatch.ts`); `MemoryHttpDeps`
  gains the additive `isThreadLive` closure from `index.ts` (§0.5). No other route changes.
- `hatch.view` payload gains an additive `thread: {thread_id, status, last_active_at}` field
  [critic: the detail view cannot render the §0.3 banner without knowing the thread's status —
  today's `HatchView` is content-arrays only]. Additive JSON on a token-gated read — no frozen
  surface, overlay `types.ts` widens alongside.

### 3.3a — D3a: an erased thread id is not adoptable [critic m2]

`beginTurn`'s known-thread branch adopts any existing id regardless of status
(`thread-lifecycle.ts:72-84`) — a client re-sending the erased thread's own id would hydrate an
all-`[forgotten]` tail and then `endTurn`-APPEND fresh plaintext onto the 'forgotten' husk (and
status never flips back). Structural close, mirroring the §0.5 guard: when the requested id
resolves to a `status='forgotten'` thread, `beginTurn` treats it as UNKNOWN and mints a **fresh
random id** (it must NOT pass the erased id as `adoptId` — that `createThread` INSERT would
collide with the surviving husk PK). The conversation continues normally in a genuinely new
thread; the husk stays terminal. Tested: `session_start` with an erased id → a new distinct
thread id, husk untouched.

### 3.4 — D4: overlay Memory window — the affordance + confirm

- **Thread DETAIL view** gains one destructive control ("Forget conversation…"), rendered from
  the loaded view data; **two-step arm→confirm** with the §0.2 copy (message count from the
  loaded `messages.length`). On confirm → `memory-write.ts` gains `forgetThread(threadId)`
  (POST body per §3.3) → existing `handleWriteResult` semantics (`controller.ts:141-150`):
  ok → `refreshCurrentView()` (the banner + husk render appears via re-fetch — no optimistic
  mutation, the house pattern); 401/down → the existing honest states; **409 → a new honest
  message** ("This conversation is open — close it and try again"), additive to the result union.
- **List view**: rows with `status === 'forgotten'` render the badge (status text already
  renders, `render.ts:40-44`); click-through still opens the husk detail (provenance links and
  list rows land on the same honest view).
- No list-row forget control; no changes to fact controls; messages stay read-only.

### 3.5 — D5: the honest "erased" render (the Ruling-2 aftermath the charter asked for)

- **Detail view of a `forgotten` thread:** the banner (*"You erased this conversation's content
  on <date>"*) REPLACES the message list (suppressing N × `[forgotten]` noise rows —
  [critic: rendering 40 identical redaction rows is ceremony, not honesty]); the **facts section
  still renders** (surviving facts with this thread's provenance — the visible proof of Ruling 2)
  with the fact controls intact (the user's remaining levers: fact-edit / fact-forget); the
  distillation-events section renders unchanged; the audit section renders the §0.4 skeleton
  (action + outcome + `[forgotten]` text).
- **Fact provenance elsewhere:** a surviving fact's provenance link (`thread:<id>`) keeps
  rendering as today (`render.ts:109-115`) and lands on the erased husk — the honest answer to
  "where did this come from?" becomes *"an erased conversation"*. NO per-fact "(erased)" badge in
  the fact list [deliberate cut: it needs cross-view thread-status plumbing for marginal signal;
  revisit trigger: dogfood confusion at the provenance link].
- **history.html:** same semantics, minimal render — the thread list gains nothing (it shows no
  status today), the detail view gains the banner + the thread-forget button (§0.1); its message
  rows already display `[forgotten]` honestly if shown. Its error handling gains a 409-specific
  line ("conversation is open — close it first") for guard parity [critic m8 — today `doForget`'s
  generic branch would show a raw "Error: 409", `history-page.ts:508-510`].

### 3.6 — D6: agent-side honesty = ABSENCE (stated deliberately, per the charter's lean)

No new tool, no self-concept clause, no prompt surface. After a thread-forget:
- `memory_search`'s **ARCHIVE leg** cannot find the content — BM25/cosine rows are deleted in the
  scrub tx (§3.1), and the hydrate-time tombstone skip (`memory-action-port.ts:318`,
  `readArchiveMessagesByIds` redaction `store.ts:945-971`) is the belt-and-suspenders. The
  **FACTS leg legitimately still surfaces the surviving fact** [critic m3 — do not read a fact
  hit as a leak]: that IS Ruling 2 working. The archive-empty + fact-present pair is the designed
  asymmetry, asserted as a PAIR in §5/demo. The agent doesn't know a thread was erased, the same
  way it doesn't know a thread never existed.
- The distilled facts REMAIN injected/searchable (Ruling 2) — the agent still "knows" the FACT,
  and its provenance keeps pointing at the erased thread (the Memory window renders that honestly,
  §3.5). This asymmetry (fact known, source gone) is the DESIGNED state, not a leak: it is the
  exact mirror of fact-forget (fact gone, source stays).
- Self-concept: the existing clauses (can forget facts via tools; content is Memory-window
  territory) remain accurate — thread-forget is a Memory-window action the agent never performs,
  so no capability-conditional wording changes (v2-01 lying-defect rule: the prompt claims
  exactly what exists — nothing new exists on the agent side).

### 3.7 — D7: distiller + drain interplay (no-op by construction, proven not assumed)

- **Distill no-op:** should a distill ever run over an erased thread (see the race below),
  `readNewTailSince` returns all-`[forgotten]` rows (`store.ts:1518-1522`) → the D8 filter drops
  them all → **zero ops, no LLM call** (`smart-distiller-provider.ts:524-542`,
  `dumb-tail-provider.ts:44-54`). No new suppression machinery needed — but the path gets an
  explicit test (§5) because it is load-bearing for the race window, not incidental [critic:
  "no-op by construction" claims rot; pin it]. (`forgetThread` itself does NOT bump the marker —
  §3.1 [critic m5].)
- **The dismiss-race window, named [critic m9]:** a thread dismissed (socket closed → distill
  IN-FLIGHT) and erased immediately after passes the §0.5 guard (no longer live), and the
  running distiller may have already read pre-scrub plaintext → it can mint a fact from the
  just-erased conversation. Ruling-2-consistent (facts are source-independent; the fact is
  visible, editable, forgettable in the Memory window) but potentially surprising ("I erased it,
  then a new fact appeared"). At single-user dogfood scale a NOTE suffices — no lock is built;
  the user's remedy is the ordinary fact-forget. Recorded so nobody reads it as a defect later.
- **Drain race:** the scrub tx writes a tombstone per message, so the drain's pending-scan
  exclusion (`store.ts:1594-1603` — content ≠ marker AND no tombstone) and the in-tx re-check
  (`upsertMessageEmbedding`, `store.ts:1624-1639`) hold for every message of the thread — the 2d
  D3b guard needs NO widening, only a thread-scale interleave test (§5).
- **Retrieve/injection:** untouched — facts survive and `isFactVisibleToThread`
  (`store.ts:636-643`) keys off provenance/scope, not thread status. A `thread-local`-scoped fact
  of the erased thread remains visible only to that (now-erased) thread — i.e. effectively
  retired from injection without being deleted; cross-thread facts inject as before. Stated so
  nobody "fixes" it either direction without noticing.

---

## 4. §7.1 runtime-coupling notes (for the decomposer/orchestrator — flagged now)

1. **`forgetThread` tx ↔ the drain** — `deleteMessageDerived` is tx-less by design and MUST stay
   inside the one thread-tx (no tx nesting — bun:sqlite forbids it; the per-message path is the
   precedent, `write-gate.ts:84-90`).
2. **Erase ↔ distiller** — no marker bump (§3.1 [critic m5]), but the dismiss-race window
   (§3.7) means a distill CAN read pre-scrub plaintext in flight; the all-`[forgotten]` no-op
   path defends the post-erase side. Behavioral contract inside unchanged signatures — test,
   don't trust.
3. **`status='forgotten'` ↔ every `listThreads` consumer** — overlay list, history list, and any
   future status consumer see a THIRD value (today 'active'|'dismissed'). Additive; render must
   not choke on it; ADR-0014's dismiss flow never writes it (only this path does).
4. **`HatchView` widening ↔ overlay `types.ts`** — additive `thread` meta field; controller
   renders banner from it. Same-install version skew is not a concern (daemon+overlay ship
   together), but the field is optional-tolerant anyway (history.html ignores it).
5. **Fact-sweep removal ↔ pinned tests** — `write-gate.test.ts:64,80` REWRITTEN (not deleted,
   not skipped) to pin facts-survive; `store.test.ts:80,91,1037,1045` +
   `embedding-storage.test.ts:125,136` lose their `drop*` subjects (methods deleted §3.2) — their
   count-invariant intent migrates to the forgetThread completeness tests.
6. **`isThreadLive` registry ↔ index.ts socket lifecycle [critic MAJOR-1]** — the
   `Map<threadId, refcount>` is NEW module-level mutable state in `index.ts`, maintained at
   session_start-binding and `close` (`index.ts:304-342`); the predicate passed into
   `MemoryHttpDeps` is read-only. Refcount discipline (two sockets, one thread) and
   decrement-on-close are the coupling to get right; a leak = threads permanently unerasable
   (fail-closed — safe but annoying; test the decrement).
7. **`beginTurn` status check (§3.3a) ↔ adoption flow** — the known-thread and adoptId branches
   both gain the 'forgotten' exclusion (`thread-lifecycle.ts:72-92`); ADR-0014 adoption semantics
   otherwise untouched.
8. **`memory_action_events` scrub ↔ the audit render** — the Memory window audit section shows
   `[forgotten]` texts on the husk; the render already displays `fact_text` verbatim
   (`render.ts:181-202`) so no render change is required — but the §0.4 semantics are a contract
   change to the d4 "recoverable text" promise FOR ERASED THREADS ONLY (stated in §0.4; the
   normal-thread audit promise is untouched).

---

## 5. Verification model (PIPELINE §6; Strike-4/5 honored)

- **Real SQLite + real daemon path;** permitted stubs = LLM `clientFactory` + `EmbeddingProvider`
  fixtures (network/model boundaries only). No mocked store internals.
- **THE HEADLINE TEST — Ruling 2 (the trap, RED-first):** seed a thread whose dismiss distilled
  facts (machine AND human-edited) → `forgetThread` → **every `distilled_facts` row byte-identical**
  (id, text, authored_by, provenance), `fact_fts`/`fact_embeddings`/`fact_topics` counts
  unchanged, `forgotten_facts` untouched; the fact still injects into a NEW thread's slice.
  Plus the §3.2 rewritten per-message tests (facts survive a message scrub) — RED on today's code.
- **Erasure-completeness matrix (per §3.1 table):** after `forgetThread` — every message content
  `== REDACTION_MARKER`; one tombstone per previously-live message; ZERO `message_embeddings` /
  `message_fts` rows for the thread; `mutations.replacement_content == REDACTION_MARKER` on
  correction rows targeting the thread [critic MAJOR-2]; the ARCHIVE search leg returns nothing
  from it while the FACTS leg still returns the surviving fact — asserted as a pair [critic m3]
  (fixture vectors — CI-deterministic); mirror file contains no plaintext in `message` OR
  `edit` lines + the `thread_forget` event line; `memory_action_events` rows keep action/outcome
  with `fact_text == REDACTION_MARKER`; `threads.status == 'forgotten'`.
- **Atomicity + idempotence:** a mid-tx failure (inject a throwing statement in test) leaves the
  thread fully UN-erased (all-or-nothing); a second `forgetThread` → no new tombstones, still 204.
- **Live-guard both sides (§0.5):** erase-while-live (fake registry entry) → 409; after
  close→dismiss the same thread erases cleanly AND no post-erase plaintext re-flush lands.
- **Erased id not adoptable (§3.3a):** `session_start` with an erased thread id → a NEW distinct
  thread id; the husk stays byte-untouched.
- **Distill no-op (§3.7):** force a distill over an erased thread → zero ops, zero
  `distillation_events.facts_produced`, no LLM call (spy on clientFactory).
- **Drain interleave at thread scale:** scrub lands between the drain's scan and upsert → zero
  vector rows survive (the 2d D3b deterministic pattern, thread-wide).
- **HTTP taxonomy:** 401 (no/bad token) · 400 (non-UUID `thread_id`, missing field) · 404
  (unknown) · 409 (live thread — fake `isThreadLive`) · 204 (applied + idempotent repeat) ·
  frozen byte-diff empty.
- **Overlay (happy-dom, the Theme-A test pattern):** arm→confirm→POST body; cancel disarms; 409
  renders the honest message; husk badge + banner render from the widened view payload; facts
  section + controls still live on the husk.
- **EXECUTED probe (Strike-5 — output in the PR, actually run):** end-to-end through the real
  `history.html/overlay-client → HTTP → Hatch → WriteGate` path on a fresh store: seed a real
  conversation + distill → erase → prove (stdout): messages scrubbed, facts intact, search-miss,
  mirror clean. Not stale-build-fooled (the finding-4 lesson).
- **Behavioral DoD = Lior's LIVE feature-closing demo (§6.1, non-negotiable — a destructive
  user-facing flow; items (1)–(9) cover the q#019 rider-4 mandated set (a)–(e)):**
  1. Have a real conversation (a fact distills from it; visible in the Memory window) → dismiss.
  2. Memory window → the conversation → **Forget conversation** → arm→confirm (the frozen §0.2
     copy, REAL message count) → the husk + banner render; messages are gone; **the husk leaks
     no pre-erase content anywhere it renders** [q#019 rider 1].
  3. **THE TRAP LIVE:** the distilled fact is STILL in the Memory window, and a NEW thread still
     recalls it (fact source-independence, proven live, not asserted). *(rider-4 b)*
  4. «що я казав про X?» → the ARCHIVE leg of `memory_search` finds NOTHING from the erased
     conversation, while the FACTS leg (and the injected slice) still carries the surviving fact
     — the designed asymmetry, live. NB a fact hit here is NOT a leak — it is Ruling 2 working
     [critic m3: stated so the sign-off cannot mis-read either outcome]. *(rider-4 a — the
     2d-coupling proof)*
  5. The surviving fact's provenance link → lands on the honest erased husk banner. *(rider-4 b)*
  6. Arm → CANCEL → nothing erased (the confirm is real).
  7. Try to erase the CURRENTLY-OPEN conversation → the honest 409 message; then close it →
     dismiss → the SAME thread erases cleanly. *(rider-4 c)*
  8. Re-summon with the erased thread's id (harness-driven) → a FRESH thread is minted; the husk
     stays untouched. *(rider-4 d)*
  9. history.html fallback: erase a second thread there → same end state. *(rider-4 e)*
- **Demo env:** ANTHROPIC key (Keychain), `LLM_PROVIDER=anthropic-api`, `EMBEDDING_PROVIDER`
  default, `MEMORY_DEBUG=action,distill,retrieve,forget,search`.

---

## 6. Decomposition (chunks-todo/thread-forget/) — 3 chunks, strictly sequential

| # | Chunk | Establishes | Depends on |
|---|---|---|---|
| **01** | Ruling-2 reconciliation + the `forgetThread` primitive | §3.2 fact-sweep removal (+ flipped tests, RED-first) + `drop*` deletion; `WriteGate.forgetThread` one-tx scrub (status flip, audit + correction scrub, `redactMirrorThread`, NO marker bump); the §5 headline + completeness + atomicity/idempotence + distill-no-op + drain-interleave tests | none |
| **02** | the daemon surface: HTTP + lifecycle + history.html | `target_type:"thread"` branch + `Hatch.forgetThread` + the `isThreadLive` refcount registry (§0.5) + 409 + `hatch.view` thread-meta widening + the §3.3a erased-id adoption exclusion; history.html button + arm-confirm + banner + 409 parity; HTTP taxonomy + live-guard + adoption tests + the EXECUTED probe | 01 |
| **03** | overlay Memory window + closeout | detail-view control + confirm (frozen §0.2 copy) + 409 message; husk badge + banner + §3.5 render (no-content-leak — rider 1); overlay tests; docs reconcile (backlog §C → shipped, roadmap tick, ADR-0015 status-note cross-ref); **Lior LIVE demo (§5 items 1–9)** | 02 |

Sequential because all three share the store/gate/route behavioral contract (§7.1) — no parallel
lanes. Chunks do NOT start before Lior's §5.2 spec sign-off.

---

## 7. Open at build (architect-time, NOT spec-frozen)

- Exact UI copy (both surfaces) + the control's placement in the detail view; banner styling.
- Whether the husk detail view offers any way to see the tombstone skeleton (likely not — banner
  only) and whether `distillation_events` render on the husk unchanged (default: yes).
- The exact increment sites for the `isThreadLive` refcount registry (the structure itself —
  `Map<threadId, refcount>`, inc on bind, dec on close — is spec-frozen, §0.5 [critic MAJOR-1]).
- `redactMirrorThread` implementation detail (single read-rewrite pass; line-preservation rules
  for unparseable lines — match `store.ts:1050-1051`).
- Whether `Hatch.forgetThread` returns a typed result vs throws (match the house never-throw
  posture, gotcha #9; the route maps either way).
- Test seams for the atomicity fault-injection.

## Related

- [[../adr/0012-conversation-and-memory-model]] — rider Ruling 2 (the binding rule); STABILITY amendment (untouched); 5a/5b (the hatch + observable-events posture this extends to threads).
- [[../adr/0015-intent-based-memory-forget]] — the retained primitive consumed; B1 extended to the thread path; intent-dispatch (`target_type`) reused; decision 5 stays superseded.
- [[../adr/0013-daemon-memory-write-http-surface-caller-auth]] — the write posture (Bearer/401) + the additive-body precedent.
- [[../adr/0016-agent-memory-action-tools]] — untouched; the explicit "no agent-side thread-forget tool" cut (§1 Out) cites its d7 ceiling.
- [[../adr/0014-connection-model-persistent-ws-dismiss-thread-adoption]] — dismiss/adoption semantics behind the §0.5 guard.
- [[2026-06-13-memory-distiller-v2]] §3.6 — the recorded THREAD-forget sketch this executes (its fact-delete half superseded by Ruling 2); D-V6c's comma-join concern dissolves (no by-provenance fact drop exists at all post-§3.2).
- [[archive/2026-07-13-hybrid-retrieval]] §0.3/§3.3/§4.3 — the scrub-cleanup + drain-race machinery reused; the ×2 trap flag honored here.
- [[../memory-backlog]] §C — the charter (single source of truth for the deferred-work record).
- [[../PIPELINE]] §3 (spec) · §5.2 (sign-off gate) · §6 (verified-done) · §7.1/§7.2 · §11 (the conveyor).
