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
- **Lior reviews and merges.** This is the human gate.

### Still sacred — agents NEVER:
- merge a PR (Lior merges),
- push to `main` directly,
- `--force` / force-push, rewrite published history, or `amend` pushed commits,
- use `--no-verify`.

> Rationale: this makes per-chunk commit+PR the *authoritative* behavior for
> every chat in the repo (not reliant on Claude memory, which subagents don't
> see). The "review & merge" step stays human so nothing lands on `main`
> without Lior's eyes.
