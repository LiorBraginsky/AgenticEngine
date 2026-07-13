> 🗄️ ARCHIVED 2026-07-13 — implemented. Historical record; do not edit.

---
title: In-answer provenance affordance — design resolution (the Theme A carve-out)
status: implemented — chunk 01 (the single implementation chunk) shipped via PR #93 2026-07-13; generic provenance line retargeted from the stale history.html port-URL to the in-overlay Memory window (tray → "Open Memory…"); mechanical DoD (bun test 706/0, typecheck/lint:strict 0, frozen byte-unchanged). (was: accepted — Lior 2026-07-13 §5.2 sign-off, all three §0 points AS RECOMMENDED — archaeology confirmed ⇒ NO ADR-0012 rider · O1 + deliberate deferral w/ named triggers · line drops the history.html URL)
date: 2026-07-13
tags: [memory, transparency, provenance, overlay, design-task, north-star]
related:
  - ../adr/0012-conversation-and-memory-model.md (decision 5 — the transparency mandate this task reconciles)
  - ../adr/0016-agent-memory-action-tools.md (the audit surface + injectedFactIds datapoint 5a's authors didn't have)
  - ../adr/0005-ui-contract-closed-set.md (the closed-set constraint on any overlay affordance)
  - ../memory-backlog.md (§A — the carve-out bullet this spec resolves; edited in this PR)
  - 2026-06-04-memory-foundation.md (§3.5/§7 — where the "MANDATORY" wording actually lives)
  - archive/2026-07-02-memory-transparency-ui.md (the Theme A carve-out of record)
  - archive/2026-07-10-memory-action-tools.md (§3.3 ordinal-map design; injectedFactIds = its 2c chunk-02 implementation)
  - ../../.conveyor/bus/{q,a}/016-core-shape.md (the conductor ruling of record)
---

# In-answer provenance affordance — option space + resolution

> **The task (Lior pick 2026-07-13, «пускай»):** should live agent answers carry a
> "where did this come from?" affordance (per-fact → thread provenance surfaced in-answer),
> and if yes — in what minimal form? This was **carved out of Theme A** (Lior 2026-07-02) as a
> deliberate revisit: ADR-0012 5a is cross-referenced everywhere as naming the affordance
> MANDATORY, while Lior's recorded concern is **memory-UX overcomplication** — dragging
> fact→thread linkage through live answers may be more machinery than the value justifies.
> This spec owns reconciling that tension — or proposing the ADR amendment.
>
> **Resolution in one line:** the tension dissolves under mandate archaeology (§2) — the
> mandate never demanded per-fact linkage, and ADR-0012's own text never says "in-answer" at
> all. Keep the already-blessed generic-line affordance, **retarget it to the Memory window**
> (one trivial chunk), deliberately do NOT build per-fact machinery (named revisit triggers),
> and amend nothing. Conductor-ruled q#016 (O1+R1+B1); **Lior gates below (§0)**.

## 0. Decision points for sign-off (read these first)

1. **The mandate-archaeology receipt (§2) — verify from the quotes, not our claim chain.**
   The carve-out's premise («ADR-0012 5a names it MANDATORY», memory-backlog §A) is what this
   spec reverses. The two texts, side by side:

   > **ADR-0012 5a (the whole clause):** "**(a) A view / edit / forget escape hatch.** The
   > user can always see, correct, and delete what the agent remembers."

   > **memory-foundation spec §3.5, "5a-open" (where MANDATORY actually lives):** "5a MUST
   > also answer the **in-overlay provenance affordance** (agent used a remembered fact → a
   > lightweight 'from where?' → leads into History)."

   ADR-0012's own text (grep-verified: zero "in-answer" hits across all ADRs, amendment and
   rider included) mandates the hatch; the in-answer wording is a foundation-spec
   discoverability ruling already **satisfied by the shipped generic line** (MF-05,
   route-closing demo step 6 signed — ledger DEMO-SIGNED 2026-06-11). Full context + the
   adjacent wording honestly disposed of in §2. **If you read the quotes the same way → no
   ADR-0012 rider is needed** (this spec + the backlog §A / roadmap fixes are the durable record).
   **If you read them differently → the recorded fallback is a doc-style ADR-0012 rider**
   ("in-answer provenance = generic line → Memory window; per-fact deliberately not built")
   — say so at sign-off and the rider gets authored as a follow-up; nothing else here changes.
2. **The resolution itself (§6):** retarget the generic line (O1); per-fact in-answer linkage
   is a **deliberate deferral, not a drop**, with named revisit triggers:
   **a real wrong-answer-from-stale-fact incident in dogfood · multi-user · 2d search landing.**
3. **The retargeted line drops the `history.html` URL** (q#016 minimal-bias ruling): the
   overlay is by definition running when the line renders, so the tray path is always
   available; `history.html` stays reachable as the documented no-install fallback elsewhere.
   Veto here = keep a URL mention; the chunk absorbs either wording.

## 1. What exists today (code-verified seams)

The findings below were verified in-code for this spec (2026-07-13, main `db1205f`):

- **The generic line is composed DAEMON-side** — `packages/daemon/src/memory/provenance-stamp.ts`
  appends `«— this reply used remembered context · view in History: http://127.0.0.1:<port>/history.html»`
  to the `show_text` payload's `content` string (deliberate "additive string growth" so the
  **frozen wire is untouched**); `index.ts` fires it iff ≥1 remembered fact was injected this
  turn (`injectedMemory` flag). It is a **daemon text change away** from saying anything else.
- **The overlay renders it INERT.** `apps/overlay/src/widgets/text-reply.ts` sets answer text
  via `textContent` (XSS-safe by design) — no links, no tap targets. The URL is not clickable;
  today's affordance is a **non-interactive pointer at a page Theme A demoted to fallback**.
- **`injectedFactIds` never crosses the wire.** Since 2c chunk-02 (the field implementing the
  ordinal-map design of action-tools spec §3.3; `RetrievedSlice.injectedFactIds`,
  `memory-provider.ts`) the daemon knows exactly which facts it injected this turn — the
  ordinal map for `memory_forget`/`memory_remember` — but it is **daemon-internal only**.
  `@agentic/protocol` has **no field for fact ids / provenance / memory metadata** (6-variant
  union, frozen, stop-the-line). The overlay never learns which facts fed an answer.
- **The Memory window (Theme A) is one tray-click away** and already renders per-fact
  **thread-level** provenance (`thread:<id>` → clickable jump to the source thread) plus the
  2c audit trail. Note the **semantic gap**: the window answers *"which thread did this FACT
  come from?"*; the in-answer ask is *"which FACTS fed this ANSWER?"* — closing that gap is
  exactly the wire + deep-link work costed in §5/O3. Window navigation granularity is
  thread-level; **no fact-level deep-link or programmatic open-at-fact exists**.
- **Audit events carry no turn reference** (`memory_action_events`: `thread_id` + `created_at`
  only) — they cannot anchor an answer→facts mapping either.

**The stakes rule this implies (task charter, stated explicitly):** anything **answer-scoped
and structured** (per-fact chips, tap-through) requires an `@agentic/protocol` change — a
**freeze gate**, not a normal chunk. Anything **text-shaped** is a daemon-side string change
with zero contract risk. The option space below is priced by that line.

## 2. Mandate archaeology — what is actually mandated, and where (THE RECEIPT)

**ADR-0012 decision 5 (accepted 2026-06-04), verbatim — (a) and (c), the two clauses
"provenance affordance" gets attributed to:**

> **(a) A view / edit / forget escape hatch.** The user can always see, correct, and delete
> what the agent remembers.

> **(c) Provenance + scope + expiry/confidence tags on every distilled fact.** Every
> remembered item knows where it came from, how broadly it applies, and when/how confidently
> it should still be trusted.

Neither clause — nor any other text in ADR-0012 — contains "in-answer", "in-overlay
affordance", or any per-answer surfacing requirement. 5a is the **hatch** (shipped: Memory
window, Theme A). 5c is **tags on facts** (shipped: provenance/scope/expiry columns +
per-fact display in the window).

**The "MANDATORY" wording actually lives in the memory-foundation spec (2026-06-04), §3.5 —
a Lior discoverability ruling recorded as "5a-open," verbatim:**

> **Discoverability is NOT optional (5a-open, Lior — see §7):** a web-admin "History" tab as
> the *sole* surface satisfies the letter of 5a but not its spirit — memory invisible in
> daily use is the #1 churn driver (prior-art). 5a MUST also answer the **in-overlay
> provenance affordance** (agent used a remembered fact → a lightweight "from where?" →
> leads into History). Recorded so 5a cannot silently ship web-admin-only.

**And its §7 restatement, verbatim:**

> **In-overlay memory discoverability (5a MUST answer, not optional)** — […] 5a must ship an
> **in-overlay provenance affordance**: when the agent uses a remembered fact, a lightweight
> "from where?" leads into History. Not a blocker for this spec; recorded so 5a does not
> silently ship web-admin-only. (§3.5)

**What the mandate therefore asks for:** a **lightweight, generic** "from where?" signal on
memory-using answers that **leads into** the memory surface — an anti-invisibility /
discoverability hook. It does **not** ask for per-fact linkage, fact ids on answers, or any
structured in-answer provenance. And it was **already delivered and demo-blessed**: the
generic line is what MF-05 shipped, and the route-closing demo (step 6, signed 2026-06-11)
proved exactly this affordance.

**Two adjacent wordings, disposed of honestly (so the receipt has no loose ends):**

- Foundation-spec **§4.1 step 6** phrases the demo as "the affordance appears → **click** →
  lands in History", and the MF-05 plan blessed the URL as openable "via the overlay's
  existing browser-open path". The shipped line was **never clickable** (the text card is
  `textContent`-only) — and the demo **signed the URL-form as-is** (ledger 2026-06-11, item 6:
  "provenance line on memory replies → History"). The "click" wording was aspiration, not the
  blessed contract; O1 replaces the never-clickable URL with an always-available tray path.
- The mandate's literal target is "**History**" — the only memory surface that existed in
  2026-06. Theme A (2026-07-10) relocated the primary surface to the **Memory window** and
  demoted `history.html` to fallback; this spec's "leads into the memory surface" reading is
  that relocation, named, not a silent substitution.

Two adjacent recorded rulings bound the space further:

- **Foundation spec §7 (grill F5):** any overlay-rendered affordance must use an **existing
  ADR-0005 closed-set primitive**; "a new overlay primitive needs Q2 / an ADR escalation" —
  a rich per-fact chip UI is escalation territory even before the wire question.
- **Message-level provenance is CLOSED** (Lior 2026-07-02; backlog Ruled-out): thread-level
  only. Any design here inherits that ceiling.

**Conclusion (the reversal):** the carve-out's premise — a MANDATORY per-fact in-answer
affordance colliding with Lior's simplicity concern — **dissolves**. The mandate is generic,
thread-level-compatible, and satisfied; the only honest defect is that the shipped line now
**points at the wrong surface** (`history.html`, demoted to fallback by Theme A) and was
composed before the Memory window existed. ADR-0012 needs **no amendment** for the resolution
below — subject to the §0.1 receipt check.

## 3. Fresh datapoints weighed (post-carve-out evidence)

- **Lior's own polish note on this exact string** (MF route-closing demo record, ledger
  2026-06-11): provenance line text/styling «привабливіше» — an independently recorded wish
  to touch the line, predating this task. The O1 chunk is also that polish landing.
- **O3 (2c live demo — run 2026-07-11, verdict reported 2026-07-13):** on a missed REPLACE
  (зелений→синій), the agent
  **self-surfaced the fact contradiction in a new thread and offered cleanup** — the
  documented degradation-not-corruption path. This is an **organic, conversational lane of
  in-answer memory transparency** that already exists at zero build cost: the agent sees its
  injected `[remembered] N. <fact>` slice and can talk about it (and, since 2c, act on it).
  Part of why per-fact *machinery* is not needed now — the conversation itself covers much of
  "where did this come from?" on demand.
- **O2 (same demo):** on a large incoherent injection blob the reply degraded to a greeting
  non-sequitur (defense held; answer quality poor). Weighed and found **orthogonal**: that is
  an answer-quality / prompt-quality tail (backlog open-case #3), not a transparency gap —
  provenance chrome on the answer would not have helped. Stays in the backlog untouched.
- **ADR-0016 audit trail (2c):** every memory *action* already renders user-visibly in the
  Memory window. The transparency story is consistent without new answer chrome: **answer =
  lightweight generic pointer · Memory window = the detail surface (facts, provenance, audit)**.

## 4. Option space (honestly costed)

| # | Option | Cost | Mandate (§2) | Verdict |
|---|--------|------|--------------|---------|
| **O1** | **Retarget the generic line** — daemon string-only: point at the Memory window («menu-bar → Open Memory…»), drop the stale port-URL | One string + signature simplification + test updates; **zero contract risk** | Satisfied by the same demo-blessed mechanism, now pointing at the right surface | ✅ **RECOMMENDED — ruled q#016** |
| O2 | **Functional chip, no wire change** — overlay sniffs a shared marker string in `content`, strips it, renders a real "from memory → open" chip that opens the Memory window | Shared marker constant + strip logic + false-positive edge + chip UI in a deliberately `textContent`-only card + a new open-path from widget context; skirts the F5 closed-set rule | Satisfied (letter + spirit) | ❌ machinery > one saved click at dogfood scale; fragile daemon↔overlay string coupling |
| O3 | **Full per-fact tap-through** — answers carry which facts they used; tap → Memory window at that fact → its source thread | **`@agentic/protocol` change (freeze gate)** + rich tap targets in the text card (F5 escalation) + fact-level deep-link into the Memory window (new navigation granularity) — three new surfaces | Letter-plus (more than was ever mandated) | ❌ against the ephemeral-widget paradigm + Lior's recorded concern; value unproven in dogfood |
| O4 | **Drop the line entirely** + amend the mandate | Cheapest build; **hard §5.2 amendment** of a recorded Lior ruling | Killed | ❌ removes the only in-answer memory signal; the churn rationale (silent misremembering) argues against; negative user value for a hard gate |

## 5. Resolution (conductor-ruled q#016; Lior gates via §0)

1. **O1 — retarget the generic line.** One chunk (§6). The affordance concept, gating
   (`injectedMemory` flag), and text-shaped transport are all unchanged — only the target
   moves from the demoted browser page to the shipped Memory window. Frozen surfaces
   untouched by construction.
2. **Per-fact in-answer linkage = deliberate deferral, NOT a drop.** Revisit triggers,
   verbatim from the ruling: **(i)** a real wrong-answer-from-stale-fact incident in dogfood
   (the flow per-fact tap-through would actually shorten), **(ii)** multi-user (teaching-the-
   tray-path stops scaling), **(iii)** 2d search landing (2d's read tools / hybrid retrieval
   will re-open answer↔fact plumbing anyway — if a per-fact affordance is ever built, it
   should ride that pass, and the escalation ladder is **O2 → O3**, each step re-gated).
3. **R1 — no ADR-0012 rider** (subject to §0.1): this spec + the memory-backlog §A and
   roadmap fixes are the durable record. The «⚠️ ADR-0012 5a names it MANDATORY»
   mis-attribution is corrected in this PR **in both live docs that carried it**
   (memory-backlog §A bullet + roadmap memory-work bullet; the archived Theme A spec keeps
   its historical wording per §4.4 read-only convention) — each with a pointer here.
4. **What this spec does NOT touch:** the Memory window (no fact deep-link built), the wire
   (nothing), the injected-slice format, the audit schema, `history.html` (stays the
   documented no-install fallback), and the O2/A′ answer-quality tail (stays backlog #3).

## 6. The build (one chunk, gated on this spec's acceptance)

`orchestration/chunks-todo/provenance-affordance/01-retarget-provenance-line.md` — reword
`provenanceLine()` to teach the tray path (`menu-bar → Open Memory…` — match the live tray
label, `lib.rs:105`), drop the now-unused `port` parameter (signature ripple:
`stampProvenance` + the `index.ts` call site), and update **every consumer that pins the
string** (critic-verified list): `provenance-stamp.test.ts`,
`provenance-stamp.daemon.test.ts` (6 positive `toContain("/history.html")` assertions **plus
2 negative ones** — the negatives MUST be re-keyed to the new marker or they pass vacuously),
and the real-mode provenance probe in `packages/daemon/scripts/memory-demo-harness.ts`
(`reply.includes("/history.html")` — left stale it would false-report "no provenance stamps"
every real run). **Mechanical DoD (§6.2):** tests + `lint:strict` + typecheck + frozen
byte-diff empty; **no behavioral demo gate** — a string change with the affordance mechanism
already demo-blessed at MF-05. Scope-cut rationale per §7.2 lives in the chunk file.

## 7. Explicitly NOT decided here (so a future reader does not over-read)

- **How a future per-fact affordance would work** (wire field shape, deep-link contract,
  card UX) — deliberately undesigned; the O2→O3 ladder is a recorded direction, not a spec.
- **Whether 2d's read tools change the calculus** — 2d owns re-weighing this at its own
  design pass (the backlog §A pointer carries it).
- **Reply-language of the line** (stays English, matching all shipped daemon strings) — a
  localization pass, if ever, is product-wide and not provenance-specific.

## Related

- ADR-0012 decision 5 (+ 2026-07-10 rider) · ADR-0016 · ADR-0005 (F5 closed-set constraint)
- `specs/2026-06-04-memory-foundation.md` §3.5/§7 (5a-open — the mandate of record) · §4.1 step 6 (the demo that blessed the generic line)
- `specs/archive/2026-07-02-memory-transparency-ui.md` (the carve-out) · `specs/archive/2026-07-10-memory-action-tools.md` §3.3 (the ordinal-map design `injectedFactIds` implements, 2c chunk-02)
- `memory-backlog.md` §A (the bullet this spec resolves — edited in this PR)
- `packages/daemon/src/memory/provenance-stamp.ts` · `apps/overlay/src/widgets/text-reply.ts` · `packages/protocol/src/envelope.ts` (the seams of record)
- Bus `q/a #016-core-shape` (the conductor ruling) · conveyor-ledger 2026-07-13 (O2/O3 datapoints, PICK record)
