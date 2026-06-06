# PIPELINE — how work flows through AgenticEngine

> **Single source of truth for the team's workflow.** Every agent and skill in this
> repo (`engine-orchestrator`, `engine-architect`, `engine-worker`, `engine-reviewer`,
> `adr-curator`, `decompose-feature`, `team-auditor`) reads this file to know its place
> in the pipeline, which artifacts it produces and consumes, and which lifecycle duties
> it owns. If an agent definition contradicts this file on workflow or lifecycle, **this
> file wins** — and the contradiction should be flagged so the agent def gets fixed.
>
> This document is **process governance**, not product design. For product decisions see
> `orchestration/docs/adr/`; for what to build next see `orchestration/docs/roadmap.md`.

---

## 1. The pipeline at a glance

```
roadmap ──▶ (brainstorm) ──▶ spec* ──▶ (decompose) ──▶ chunks ──▶ (orchestrate) ──▶ plan ──▶ code + ADRs ──▶ review ──▶ demo
  │                            │                          │                          │            │             │         │
strategic                  design doc               todo inbox                 per-feature    source +     findings   behavioral
source of                  (conditional)            of atomic                  plan file      ADRs                    sign-off
truth                                                PR-sized units                                                   (Lior)

* spec is CONDITIONAL — see §3.
( ) = an ACT performed by a skill/agent, not a persisted artifact.
```

**Stages in words:**

1. **roadmap** — the strategic backlog. What we build and in what order.
2. **brainstorm** *(act, optional)* — interactive exploration of intent/requirements before anything is written down. Ephemeral; lives in chat.
3. **spec** *(conditional artifact)* — a design document for a feature whose design/research is **thick** (see §3). Skipped when the feature is thin.
4. **decompose** *(act)* — `/decompose-feature` cuts a feature/phase into atomic, PR-sized **chunks**.
5. **chunks** — the todo inbox. One file per atomic unit; each independently briefable to the orchestrator.
6. **orchestrate** *(act)* — `/engine-orchestrator` takes one chunk from idea to reviewed, merged implementation.
7. **plan** — the orchestrator's per-feature working document (architect-authored content, orchestrator-persisted).
8. **code + ADRs** — the actual implementation (`packages/`, `apps/`) plus any Architecture Decision Records the change warranted.
9. **review** *(act)* — `engine-reviewer` diffs the branch against baseline.
10. **demo** — Lior's live behavioral sign-off where the Definition-of-Done has behavioral criteria (§6.1).

---

## 2. Who produces / who consumes / where it lives

| Stage | Artifact | Produced by | Consumed by | Lives in | Status / state field |
|-------|----------|-------------|-------------|----------|----------------------|
| roadmap | `roadmap.md` | Lior + Jimmy | `decompose-feature`, `engine-architect` | `orchestration/docs/roadmap.md` | phase markers (no lifecycle) |
| brainstorm | — (ephemeral) | Jimmy / architect | feeds the spec or the decompose act | chat only | — |
| **spec** | `YYYY-MM-DD-<slug>.md` | Jimmy (+ architect / deep-research) | `decompose-feature` | `orchestration/docs/specs/` | frontmatter `status:` + `feeds:` |
| decompose | — (act) | `/decompose-feature` (Jimmy-driven, in-chat) | produces chunks | — | — |
| **chunks** | `NN-<slug>.md` | `decompose-feature` | `engine-orchestrator` | `orchestration/chunks-todo/<feature>/` | frontmatter `Status:` (§4) |
| orchestrate | — (act) | `/engine-orchestrator` (fresh chat per chunk) | produces plan + code | — | — |
| **plan** | `plan.md` | `engine-orchestrator` writes; `engine-architect` authors content | `engine-architect`, `engine-worker`, `engine-reviewer` read | `orchestration/docs/plans/<feature>/` | `## Status` heading inside the file |
| code | source | `engine-worker` | end users / tests | `packages/`, `apps/` | git history (permanent) |
| **ADRs** | `NNNN-<slug>.md` | `adr-curator` (when `engine-architect` flags `## ADR worthy: yes`) | everyone | `orchestration/docs/adr/` | `status: proposed \| accepted` |
| review | — (act) | `engine-reviewer` | `engine-orchestrator`, `engine-worker` | findings returned inline | — |
| demo | — (act) | Lior (live macOS demo) | gates the chunk's `done` | — | — |

**The hand-offs (the joints where work passes between stages):**

- **roadmap → decompose:** Jimmy points `/decompose-feature` at a roadmap phase/feature. If a spec exists, decompose reads it too.
- **(thick design) → spec:** when research/design is heavy, Jimmy authors a spec first; its `feeds:` frontmatter names the decompose target.
- **spec → chunks:** `decompose-feature` reads the spec + roadmap + open-questions + known-gotchas, and writes chunk files. Each chunk's `## Orchestrator brief` cites the spec section it implements.
- **chunks → orchestrate:** Jimmy invokes `/engine-orchestrator do chunk NN from <path>` in a **fresh chat** (the multi-agent build is too context-heavy for the long-lived adviser chat). The orchestrator reads the chunk file directly — **no brief paste** (Level-1, see §7.3).
- **orchestrate → plan → code:** orchestrator spawns `engine-architect` (plan), then `engine-worker` per step, then `engine-reviewer`. ADR-worthy decisions route to `adr-curator`.
- **code → review → demo:** reviewer-clean + (where applicable) Lior's behavioral demo green ⇒ the chunk is **verified-done** and may be archived (§4).

---

## 3. When is a `spec` required? (the conditional stage)

A spec is **CONDITIONAL** — produce one only when a feature's design or research is *thick*:

**Write a spec when:**
- The design has load-bearing seams not already fixed in roadmap/ADRs (e.g. the LLM provider abstraction).
- There is research to harvest and freeze (e.g. ToS/policy findings, comparative provider analysis).
- Multiple chunks will share a contract or set of decisions that should be stated once, not re-derived per chunk.

**Skip the spec when:**
- The feature is thin and the roadmap entry + existing ADRs already say enough to decompose directly.
- It is a single-chunk change, a follow-up, or a deferred gotcha.

When in doubt, Jimmy decides at decompose time. A skipped spec is not debt — decompose can read the roadmap directly.

---

## 4. Artifact lifecycle (status fields + archiving)

Every **tactical** artifact (spec, chunk, plan) has a lifecycle. **Strategic** artifacts
(roadmap, architecture, concept, glossary) and **immutable** artifacts (ADRs) do not.

### 4.1 Chunk lifecycle

`Status:` field in the chunk file's header:

| Status | Meaning | Who sets it |
|--------|---------|-------------|
| `todo` | created by `decompose-feature`, not yet picked | `decompose-feature` |
| `in-progress` | an orchestrator chat has started this chunk | **`engine-orchestrator`** (autonomously, on pickup) |
| `done` | verified-done (§6) + merged → **move file to `chunks-todo/archive/<feature>/`** | **`engine-orchestrator`** (autonomously, after verified-done) |
| `blocked` | external dependency / missing decision; keep in place + add note | orchestrator flags; Lior decides unblock |
| `postponed` | deliberately deferred; keep in place + add note on when to revisit | Lior |

`chunks-todo/`'s **end goal is to be empty** — every chunk either archived (done) or annotated (blocked/postponed).

### 4.2 Plan lifecycle

- Lives at `orchestration/docs/plans/<feature>/plan.md` during the cycle.
- `## Status` heading inside the file tracks phase progress (the orchestrator updates it).
- **On ship:** archived per the uniform convention (§4.4) — moved to `plans/archive/<feature>/`,
  the `## Status` flipped to `shipped`, and the archive banner prepended. Archived by the
  **`engine-orchestrator`** at closeout. The banner neutralizes stale mid-execution text like
  "IN PROGRESS" so an archived plan can't be misread as current.

### 4.3 Spec lifecycle

- Lives at `orchestration/docs/specs/YYYY-MM-DD-<slug>.md`.
- `status:` frontmatter: `draft` → `accepted` (Lior signs off) → `implemented` (all chunks merged).
- **On `implemented` (or `superseded`):** archived per the uniform convention (§4.4) — moved to
  `specs/archive/`, `status:` set to the terminal value, banner prepended.

### 4.4 The uniform archive convention (the WHY and the HOW)

> **Archives exist to prevent stale-truth.** A finished plan that still says "IN PROGRESS",
> a decomposed-and-shipped chunk still sitting in the todo inbox, a spec describing a design
> that has since drifted — each is a lie an agent can read as current. Quarantining the
> artifact as read-only history is the cure. **Files under any `archive/` are read-only
> history — never edit them.** This discipline is non-negotiable — it is the failure mode
> that has bitten this project repeatedly (see §6).

**ONE convention for all tactical artifacts (chunks, plans, specs, agent-prompts)** — decided
2026-06-02 (§9). When an artifact reaches its terminal state, the **owning agent** performs all
three steps, in this order:

1. **Flip the status field** to the terminal value (`chunk → done`, `plan → shipped`,
   `spec → implemented`/`superseded`, `agent-prompt → spent`).
2. **Prepend the archive banner** as the file's first line:
   `> 🗄️ ARCHIVED YYYY-MM-DD — <terminal-status>. Historical record; do not edit.`
3. **Move the file** to the sibling `archive/<feature>/` directory (`agent-prompts/archive/`
   has no `<feature>/` subdir).

Same ritual everywhere — no per-layer special cases. This replaces the three divergent
conventions that previously existed (chunk: status+move; plan: banner+move; agent-prompt:
bare move; spec: none).

---

## 5. The authority model — who moves the work (THE KEY SHIFT)

The pipeline separates **routine mechanics** from **judgment gates**. This mirrors the
flag-vs-execute rule (§7.2): routine, objective, reversible mechanics are automated;
context-rich, consequential, hard-to-reverse decisions stay with Lior.

### 5.1 Routine mechanics — AGENTS do these autonomously (no asking)

The orchestrator/worker set status and archive **without asking Lior** — **but only after
work is verified-done** (§6):

- Set a chunk `Status: in-progress` when an orchestrator chat picks it up.
- Set a chunk `Status: done` **and move it to `archive/<feature>/`** once verified-done.
- Create, update, and (on ship) archive the plan file with its `SHIPPED` banner.
- Commit per task, push the feature branch, open the PR (the autonomous-git workflow — see project `CLAUDE.md`).
- **Auto-merge the PR** once ALL automated gates are green (§5.2) — merge is an *effect* of the
  gates passing, not a decision. Preconditions + auto-revert-on-red live in project `CLAUDE.md`.

These were previously done manually by Lior. **They are now the agents' job.** The single
guard is §6 (plus, for merge, the §5.2 preconditions): *never* flip to `done` / archive / merge
on a claimed-but-unverified result.

### 5.2 Judgment gates — these stay with LIOR (escalate only)

**Governing principle (Lior, 2026-06-06):** escalate to Lior ONLY when the decision is one of —
**(1)** a behavioral/demo judgment (does it actually work — the recurring scar, §6.1),
**(2)** a change to north-star / roadmap / architecture (spec, ADR, frozen contract — the
"super-important irreversibles"), or **(3)** a genuine blocker the agents cannot resolve from the
docs or each other. **Everything else — including PR merge and routine plan approval — is
automated.** A gate exists only where the decision is hard-to-reverse AND needs Lior's unique
context (taste / north-star / behavioral judgment) that no automated check or agent can substitute.

| Gate | What it decides | When |
|------|-----------------|------|
| **Behavioral demo sign-off** | does it actually work on the machine? | before any behavioral DoD criterion → `done` (§6.1) — non-negotiable |
| **Spec sign-off** | is the design/research right? | `status: draft → accepted` (thick-design features only) |
| **ADR acceptance** | is a decision binding? | `status: proposed → accepted` |
| **Freeze / stop-the-line** | may a frozen contract change? | any change to a frozen ADR / wire contract |
| **north-star / roadmap change** | does the work imply the strategic premise must change? | an agent discovers a chunk conflicts with north-star/roadmap → STOP, escalate |

**Downgraded from blanket gates to automated (2026-06-06 — see the conveyor pilot,
`experiments/2026-06-06-conveyor-pilot.md`):**

- **Plan approval** is no longer a blanket gate. The plan PROCEEDS autonomously; Jimmy/architect
  escalate it to Lior ONLY via the **§7.2 citation test** — the plan cites a specific frozen conflict
  (spec / ADR / frozen contract / north-star), introduces NEW scope, or is a genuine blocker. A
  well-scoped plan that fits its decompose-blessed chunk gets no ping.
- **PR merge** is no longer a gate — it is the **effect** of all applicable gates passing, not a
  decision (10 PRs/day → 0 pings). Auto-merge fires when ALL automated preconditions are green:
  CI (tests + `lint:strict` + typecheck), reviewer-clean (0 blockers), frozen surfaces byte-unchanged,
  and — for a behavioral DoD — Lior's live demo already signed off. Any precondition red → no merge,
  escalate. Branch protection enforces the preconditions; **auto-revert on post-merge red `main`**.
  (Project `CLAUDE.md` carries the operational rule; force-push / amend / direct-push-to-`main` /
  `--no-verify` remain NEVER.)

> Rationale: the agents that implement chunks lack the context Lior (and the decomposer)
> hold, and the agent that builds a thing has a conflict of interest in declaring it
> correct. So **discovery flows up, decisions flow down** — agents surface and propose;
> Lior (or the decompose/architect layer) decides. See §7. The 2026-06-06 narrowing keeps this
> for the *irreplaceable* decisions while removing Lior from reversible/checkable ones (merge,
> routine plans). The replacement net for auto-merge is the green-precondition set above, NOT trust.

---

## 6. Verified-done — the bar before `done`/archive

An agent may set `done` / archive **only** when the Definition-of-Done is **proven**, not
claimed. Two classes of DoD criteria, two evidence bars:

### 6.1 Behavioral criteria → require RUNTIME PROOF (gated by Lior's live demo)

A **behavioral** DoD criterion — visible UI behavior, an end-to-end path actually working,
"verified on macOS" — may be marked done **only with runtime evidence**: a live demo (Lior)
or an automated behavioral test that PASSES.

- **Reading the code is NOT evidence.** Trusting a prior chunk's "verified / SHIPPED ✅"
  record is NOT evidence. Both have produced **false `done` claims** — this exact failure
  recurred **3×** during Walking Skeleton v0 (e.g. chunk-03: a static "wiring verified on
  macOS" claim was falsified by Lior's live demo, surfacing three overlay-only behavioral
  gaps the wire contract had hidden).
- **engine-architect:** never assert runtime/behavioral facts from code-reading. A reality
  check may state "this code path exists" but must mark behavioral DoD as *"requires
  runtime demo to confirm,"* not *"verified."*
- **engine-orchestrator:** do NOT mark a behavioral DoD criterion done, and do NOT let a
  worker commit docs that say "verified on macOS," until a live demo or automated
  behavioral test passes. Sequence the demo **before** the closeout docs.
- Treat past "manually verified / SHIPPED ✅" records as **suspect** for behavioral claims;
  re-demo is the only proof.

### 6.2 Mechanical criteria → require COMMAND EVIDENCE

Typecheck, lint (`lint:strict` where present), `bun test`, byte-unchanged frozen surfaces —
these are proven by **running the command and reading its output**, not by assertion.
Evidence before assertions, always.

---

## 7. Governance rules every agent must honor

These were previously held only in Jimmy's private memory (which subagents cannot see).
They are graduated here so the team actually reads them.

### 7.1 Decompose must check RUNTIME coupling, not just file overlap

When `/decompose-feature` (or any orchestration) marks two chunks "parallel, no coupling,"
that claim must be checked against **shared runtime/behavioral contracts**, not only whether
they touch disjoint files.

- Two chunks that both depend on the same daemon/reducer/shared mutable state are **coupled
  even with zero shared source**. Flag it at decompose time.
- A frozen **wire** contract (envelope/schema) does NOT imply a frozen **behavioral**
  contract (which variants a handler emits, in which order/phase). Distinguish the two.
- When chunks run in parallel against shared mutable runtime, **re-validate the reality
  check at integration time** — the baseline can move under you mid-flight.

*(v0 scar: chunk 02a legally changed what the daemon replies to `session_start` — within
the frozen 6-variant envelope — which silently turned 02b-i's handler into dead code. The
wire held; the behavior drifted. Caught only at the review gate, after build.)*

### 7.2 Orchestrator/worker authority: FLAG always, EXECUTE narrowly

The implementation chat holds **less** context than the decomposer (it sees the chunk file,
not the decomposer's coupling recon or deliberate scope-cut rationale). Therefore:

- **FLAG / propose** any plan/DoD/contract problem → **always allowed** (high-value signal
  from the integration join).
- **EXECUTE a plan/DoD edit** → only when (a) Lior approved AND (b) it is an *annotation*
  (out-of-scope backlog note) or a *reconciliation to an already-made decision* (chunk text
  lagging a frozen ADR/FU).
- **Author NEW scope / DoD / contract** → never autonomously → back to `/decompose-feature`
  or an ADR.

**The citation test (when to pull the cord):** flag IFF you can cite a *specific frozen
artifact* this contradicts (a DoD line, an ADR, a frozen contract/wire schema) — OR a wrong
guess would be expensive to unwind. Can't cite a frozen line AND cheap to reverse → proceed
+ note the assumption. Can cite → you MUST flag and may NOT code around it. This keeps the
team out of both **paralysis** (flagging on vibes) and **freelancing** (silently coding past
a frozen contradiction).

> Why: (1) *context asymmetry* — what looks like "drift to fix" may be a deliberate
> decomposer scope-cut whose rationale didn't survive into the chunk file; (2) *conflict of
> interest* — the agent implementing a chunk must not edit its own acceptance criteria, or
> the independent spec yardstick is destroyed.

**Structural mitigation:** the decomposer should record the *rationale* for each scope
boundary IN the chunk file ("OUT because X / deferred to chunk-N because Y / frozen per
ADR-Z") so the orchestrator can distinguish deliberate-cut from stale-drift.

### 7.3 No brief paste — agents read files (Level-1)

The orchestrator reads chunk files directly; Jimmy invokes with a one-liner
(`/engine-orchestrator do chunk NN from <path>`). Chunk files already contain a
`## Orchestrator brief` section. **Do not paste walls of brief text** — enrich the chunk
file instead. The planning step (`decompose`) is light and decision-rich, so Jimmy drives it
**in-chat**; the build is context-heavy, so it runs in a **fresh orchestrator chat per chunk**.

---

## 8. Folder conventions (graduated from project memory)

### Strategic / permanent
- **`orchestration/docs/`** — vision, concept, architecture, glossary, roadmap, open-questions, known-gotchas, plugin-anatomy, **this PIPELINE.md**. Permanent; grows with the project.
- **`orchestration/docs/adr/`** — immutable Architecture Decision Records, numbered `0000`–`NNNN`. **Never renumber. Never archive.**

### Tactical / lifecycle-managed (all archive via the uniform convention, §4.4)
- **`orchestration/docs/specs/`** — per-feature design docs (conditional, §3). `status:` frontmatter → `specs/archive/`.
- **`orchestration/chunks-todo/`** — Kanban inbox of atomic chunks. `Status:` field → `chunks-todo/archive/<feature>/` on done. **Goal: be empty.**
- **`orchestration/docs/plans/`** — orchestrator's per-feature plan files → `plans/archive/<feature>/` on ship.
- **`orchestration/agent-prompts/`** — one-time handoff briefs for worker dispatches. **Transient** → `agent-prompts/archive/` when spent.

### Configuration / setup
- **`.claude/agents/`** — local agent definitions. Permanent.
- **`.claude/skills/`** — local skill definitions. Permanent.

### Principle
**Each folder has a clear lifecycle.** Strategic = permanent. Tactical = lifecycle-managed
(consumed by execution, not accumulated). Configuration = permanent unless setup changes.
Folders without a clear lifecycle become bloated; `chunks-todo/` and `agent-prompts/` are
designed to empty themselves.

---

## 9. Decision record — lifecycle layer layout (2026-06-02)

The lifecycle previously had four tactical layers with **three divergent archive
conventions** (chunks: status+move; plans: `SHIPPED` banner+move; agent-prompts: bare move;
specs: none). Lior reviewed three options and chose **Option A — unify the convention**:

- **CHOSEN — Option A:** keep all four tactical layers; collapse the three divergent archive
  rituals into the **one uniform convention** (§4.4: status-flip + banner + move-to-sibling-
  `archive/`). Specs gain an archive convention for the first time. Fixes the *inconsistency*
  (the real source of the "heavy" feeling) without dropping any layer; `plan.md` is retained
  as the orchestrator's resumption anchor and keeps the §7.2 separation (the chunk file is the
  implementer-frozen yardstick; the plan is the implementer's working doc — kept in distinct
  files on purpose).
- **Rejected — Option B (collapse the plan layer into chunk-file + in-chat):** would drop one
  layer but loses `plan.md` as the resumption anchor and risks blurring the §7.2 boundary by
  co-locating the editable plan with the frozen DoD. Deferred, not dead — revisit if the plan
  layer proves to be pure overhead in practice.
- **Rejected — Option C (status-only, no physical move):** fewest folders but **weakens §4.4**
  — a `done` artifact left in the live inbox is exactly the stale-truth failure that bit v0
  repeatedly. The physical quarantine is load-bearing; not traded away.

---

## 10. Quick reference — your place in the pipeline

| Agent / skill | Reads | Produces | Lifecycle duty it owns |
|---------------|-------|----------|------------------------|
| `decompose-feature` | roadmap, spec, open-questions, known-gotchas, ADRs | chunk files (`Status: todo`) + inline summary | records scope-cut rationale per chunk (§7.2) |
| `engine-orchestrator` | the chunk file, docs, plan file | plan file, commits, PR | sets chunk `in-progress`→`done`, archives chunk + plan after verified-done (§5.1) |
| `engine-architect` | docs, ADRs, plan file | plan content, `## ADR worthy` flags | marks behavioral DoD "requires demo," never "verified" (§6.1) |
| `engine-worker` | plan file, architecture, ADRs | code, tests | command-evidence before "done" (§6.2); never edits its own DoD (§7.2) |
| `engine-reviewer` | branch diff, full files, ADRs | priority-sorted findings | flags contract/behavioral drift (§7.1) |
| `adr-curator` | ADR template, existing ADRs | new ADR (`status: proposed`) | never changes ADR status without Lior (§5.2) |
| `team-auditor` | `.claude/agents`, `.claude/skills`, this file | health report (read-only) | checks team alignment to this pipeline |

---

## 11. Autonomous execution triggers — the "conveyor" (axis A)

> §5 governs **in-flight authority** (axis B — what an already-running agent decides). This
> section governs **trigger autonomy** (axis A — who *starts* an agent). The conveyor automates
> axis A: events start the right chat with no human in the launch path. It is in a **piloted
> experiment** — see `experiments/2026-06-06-conveyor-pilot.md` for the metrics and the revert
> switch. **Billing rail:** everything runs as **interactive** `claude` sessions (no `-p`) →
> subscription; the metered Agent-SDK pool (from 2026-06-15) is triggered by the `-p`/SDK entry
> point, NOT by subagent fan-out (memory `reference_claude_code_automation_billing`).

### 11.1 The model — federated sessions, hub-and-spoke

- **Federated (Topology Z), not one cockpit.** Each role is its own top-level chat (so each can
  spawn its own subagents — the "subagent depth = 1" limit dissolves). This is Lior's existing
  Jimmy-chat + orchestrator-chat pattern, automated.
- **Only Jimmy listens.** Jimmy is the long-lived **conductor** (a `/loop` session). Worker chats
  are **fire-and-complete**: launched with a rich brief, they run one chunk agentically to done or
  to a gate, post their result, end the turn, and get killed (`tmux kill-session`). Workers never
  subscribe to anything → no "unsubscribe" problem.
- **Substrate = tmux.** Jimmy launches `tmux new-session -d "claude '<brief>'"`, monitors via the
  ledger / `capture-pane`, retires via `tmux kill-session`.
- **Cardinality:** Jimmy 1× per feature (refreshes when the feature folder archives); decompose-chat
  1× per feature; orchestrator-chat 1× per chunk.
- **Disk canonical, chat disposable.** The handoff brief is a pure function of disk (git + chunk
  files + ledger), so any chat can be (re)launched losslessly. Prefer a fresh chat over compaction;
  a worker that hits a gate dies and is replaced by a fresh continuation from disk — never resurrected.

### 11.2 Trigger registry (event → chat → output → unattended behavior)

| Event | Starts | Produces | If it hits a gate (unattended) |
|-------|--------|----------|--------------------------------|
| feature has `todo` chunks | orchestrator-chat (1×/chunk) | plan → code → PR | post `BLOCKED <gate>` → Jimmy → Lior; Jimmy relaunches a fresh continuation on the decision |
| PR opened | reviewer (walk rung) | review comment | n/a (read-only) |
| all gates green on a PR | — | **auto-merge** (effect, not decision; §5.2) | red gate → no merge, escalate |
| PR merged + chunk verified-done | orchestrator | archive ritual (§4.4) | — |
| feature folder drained | Jimmy | refresh self / pick next feature | — |
| residual agent↔agent question (run rung) | localhost bus | routed message | judgment → Lior, transport → peer |

### 11.3 Conductor charter — what Jimmy NEVER decides alone

Jimmy is the **safety-critical gatekeeper** of what reaches Lior. Jimmy MUST escalate (never
auto-decide) the §5.2 human gates:

- **behavioral demo sign-off** (the recurring scar, §6.1),
- **spec sign-off / ADR acceptance / freeze–stop-the-line** (north-star & frozen contracts),
- a **north-star / roadmap conflict** discovered mid-work,
- any **genuine blocker** not answerable from the docs.

Jimmy MAY auto-act on: launching/retiring worker chats, routine plan-approval (escalate only via the
**§7.2 citation test**), and **auto-merge — but ONLY on the all-green precondition set** (CI +
reviewer-clean + frozen-surfaces-byte-unchanged + demo-if-behavioral; a red gate is a hard stop). The
replacement net for Lior's removed per-PR eyes is the green-gate set, not trust (project `CLAUDE.md`).

### 11.4 The ladder — build one rung at a time

1. **crawl (current; piloting MF-04/MF-05):** `orchestration/bin/conveyor-next.sh` generates a
   handoff brief from disk and tmux-launches a fresh orchestrator chat; every brief carries the
   **self-serve rule** (read PIPELINE/ADR/spec yourself before escalating — kills the copy-paste that
   was really doc-lookups). Auto-merge enforced by Jimmy via command-checks (`gh pr checks`, frozen
   `git diff`) + a ledger digest; the GitHub-side net is walk.
2. **walk:** PR auto-review trigger + the auto-merge **safety net** (branch protection requiring the
   green gates + auto-revert on post-merge red `main`).
3. **run:** localhost event-bus for the *residual* true agent↔agent transport, with explicit
   judgment→Lior routing. Building the bus un-defers the concurrent-session model and is **ADR-worthy**
   at that point; keep the dev-bus separate from the product daemon.

**Anti-over-engineering:** do not build a higher rung until the pilot shows the lower one is
insufficient. The pilot's first job is to measure how much copy-paste survives crawl — that number,
not a hunch, decides whether the bus gets built.

---

## Related

- `orchestration/chunks-todo/README.md` — chunk-folder lifecycle detail
- `.claude/skills/decompose-feature/SKILL.md`, `.claude/skills/engine-orchestrator/SKILL.md`
- `.claude/agents/*.md` — the five worker/reviewer/architect/curator/auditor definitions
- `orchestration/docs/roadmap.md` — what to build next
- `orchestration/docs/dev-runbook.md` — run/verify/debug cheatsheet
- project `CLAUDE.md` — the autonomous-git workflow (branch → commit → push → PR; Lior merges)
