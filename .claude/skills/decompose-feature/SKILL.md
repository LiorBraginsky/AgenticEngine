---
name: decompose-feature
description: Decompose a feature or roadmap phase into atomic PR-sized chunks. Use when starting a phase and not sure where to begin, when a feature feels too large to brief directly to engine-orchestrator, or when Lior says "decompose Phase X", "звідки почати Phase Y", "які atomic chunks для X". Outputs ordered list of chunks as files in orchestration/chunks-todo/<phase>/ AND inline summary in chat.
---

# Decompose Feature into Atomic Chunks

You are helping Lior decompose a strategic-level feature (or roadmap phase) into atomic, PR-sized chunks. Each chunk must be independently briefable to `engine-orchestrator` for execution.

## When to invoke

- Slash command `/decompose-feature <feature-or-phase-name>`
- Trigger phrases in chat: "decompose Phase X", "звідки почати Phase Y", "які atomic chunks для X", "розбий Phase X на куски"
- Any feature that feels too large for a single orchestrator session (>1 day of work)

## Workflow

### Step 1 — Read context

Read in this order:

1. `orchestration/docs/roadmap.md` — find the target phase/feature
2. `orchestration/docs/open-questions.md` — any open Qs that might block this phase
3. `orchestration/docs/known-gotchas.md` — relevant engineering pitfalls
4. `orchestration/docs/architecture.md` — refresh boundaries
5. Any ADR specifically referenced in the roadmap section for this phase

### Step 2 — Brainstorming Q&A

Invoke `superpowers:brainstorming` skill. Drive an interactive Q&A loop with Lior:

- What does "done" look like for this phase as a whole?
- Sequential or parallel chunks possible?
- What's the highest-leverage "first chunk"?
- Are there hard dependencies between sub-tasks?
- Are there open questions from `orchestration/docs/open-questions.md` that block any sub-task?

**Do not decide for Lior.** Brainstorming is a tool to surface his thinking, not to bypass it.

### Step 3 — Initial decomposition draft

Based on roadmap + brainstorming output, draft an ordered list of chunks. Each chunk should be:

- ~1 day of work
- Independently verifiable (has its own done criteria)
- Either a strict prerequisite for the next, or explicitly parallelizable

### Step 4 — Stress-test against docs

Invoke `grill-with-docs` skill (standalone, NOT `superpowers:grill-with-docs` — there is no such prefix). Let it stress-test your draft decomposition against:

- `orchestration/docs/roadmap.md` — does ordering match phase logic?
- `orchestration/docs/architecture.md` — does each chunk respect system boundaries?
- ADRs 0001-0008 — does any chunk reopen a decided question without proper ADR escalation?
- `orchestration/docs/known-gotchas.md` — does any chunk hit a known pitfall that needs preemptive thought?

Tighten the decomposition based on grilling feedback.

### Step 5 — Write artifacts

Output BOTH artifact files AND inline summary.

**Artifact files:** for each chunk, write a file at `orchestration/chunks-todo/<phase-or-feature-slug>/NN-kebab-title.md` using the template below. NN is the execution order (01, 02, ...). Slugify phase name to kebab-case (e.g., `phase-1-engine-skeleton`).

**Inline summary in chat:** a markdown table with columns `# | Title | Status | Size | Path`. After the table, list this exact next-step instruction:

> Next: open a new chat, run `/engine-orchestrator`, then paste the `## Orchestrator brief` section from `orchestration/chunks-todo/<phase>/01-<first-title>.md`.

### Step 6 — Stop

Do NOT execute the chunks. You only decompose. Execution is `engine-orchestrator`'s job in a separate chat. After Step 5, return your inline summary and stop.

## Chunk file template

````markdown
# Chunk N: <Title>

**Status:** todo
**Created:** YYYY-MM-DD
**Phase:** N (<phase name>)
**Estimated size:** ~X day(s)
**Depends on:** <chunk numbers or "none">

## Scope

**In:**
- ...

**Out:**
- ...

## Done criteria

- [ ] Verifiable thing 1
- [ ] Verifiable thing 2
- [ ] ...

## Orchestrator brief (ready to copy)

```
implement <chunk goal> per orchestration/docs/roadmap.md Phase N.

Files to touch:
- ...

Done when:
- ...

ADRs in scope: ...
```

## Notes / Open questions

(empty unless something surfaced during decomposition that needs Lior's attention)
````

## Status field values

`todo` / `in-progress` / `done` / `blocked` / `postponed`

- **todo** — created, not yet picked.
- **in-progress** — Lior copied brief into orchestrator chat and started.
- **done** — passed review-clean merge. Move file to `orchestration/chunks-todo/archive/<phase>/`.
- **blocked** — external dependency or missing decision prevents work. Keep in place. Add note explaining what is needed to unblock.
- **postponed** — Lior deferred deliberately due to priority shift. Keep in place. Add note explaining when to revisit.

When orchestrator picks a chunk → Lior manually updates `Status:` to `in-progress`. After clean merge → manually move file to archive.

## Hard rules

- NEVER write product code.
- NEVER execute chunks yourself — only decompose.
- ALWAYS use `superpowers:brainstorming` AND standalone `grill-with-docs` (no skipping).
- ALWAYS produce BOTH artifact files AND inline summary.
- ALWAYS include `## Orchestrator brief` section, ready to copy without modification.
- If decomposition would produce >7 chunks for one phase — push back to Lior: "this phase is too big; consider splitting roadmap Phase X into Phase Xa/Xb."
- NEVER modify files outside `orchestration/chunks-todo/` (except writing the chunks themselves).
