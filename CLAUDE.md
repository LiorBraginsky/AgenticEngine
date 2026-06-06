# AgenticEngine — Project Instructions

These project rules **override** my global `~/.claude/CLAUDE.md` defaults where
they conflict (per the "more specific wins" rule stated there). Both files load
together; this one is more specific, so it wins for this repo.

## Git workflow (scoped override of global "Git is sacred")

During feature / chunk implementation in **this repo**, agents are AUTHORIZED to
manage git autonomously, within these rails:

- **Branch first.** Never commit on `main`. Create/checkout a feature branch
  before any commit: `chunk/<chunk-id>-<short-slug>` (e.g. `chunk/03-e2e-wiring`).
- **Commit per task.** After each completed task, make a focused commit with a
  clear message and the trailer:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- **Push the feature branch** to `origin`.
- **Open a PR** with `gh pr create` targeting `main`. The PR body summarizes
  what the chunk did and how it was verified (tests / manual checklist), and
  ends with the standard Claude Code attribution line.
- **Auto-merge on all-green** (changed 2026-06-06; see PIPELINE §5.2). Merge is the
  *effect* of the automated gates passing, not a human gate — Lior is no longer pinged per PR.

### Auto-merge — allowed ONLY on an all-green gate set (2026-06-06)

Agents MAY auto-merge a PR to `main`, but ONLY when ALL automated gates are green:
- **CI green:** tests + `lint:strict` + typecheck all passing.
- **Reviewer-clean:** `engine-reviewer` / `/code-review` reports 0 blockers.
- **Frozen surfaces byte-unchanged** (e.g. `@agentic/protocol`, the mock reducer) — any change
  → freeze gate (human, PIPELINE §5.2), NOT an auto-merge.
- **Behavioral DoD?** → Lior's live demo already signed off (PIPELINE §6.1).

Any gate red → **do NOT merge; escalate.** Branch protection enforces the preconditions, and the
conveyor **auto-reverts on a post-merge red `main`**. The replacement net is these checks, not trust.

### Still sacred — agents NEVER:
- push to `main` directly,
- `--force` / force-push, rewrite published history, or `amend` pushed commits,
- use `--no-verify`,
- merge with ANY gate above red (a red gate is a hard stop, not a judgment call).

> Rationale: per-chunk commit+PR is the *authoritative* behavior for every chat in the repo
> (not reliant on Claude memory, which subagents don't see). As of 2026-06-06 the merge step is
> **automated behind the green-gate set above** instead of Lior's per-PR eyes — Lior's review
> attention moves to the irreplaceable gates (behavioral demo, north-star/design, freeze; PIPELINE
> §5.2). Piloted on MF-04/MF-05 with a revert switch
> (`orchestration/docs/experiments/2026-06-06-conveyor-pilot.md`).
