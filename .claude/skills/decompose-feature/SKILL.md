---
name: decompose-feature
description: Decompose a feature or roadmap phase into atomic PR-sized chunks. Use when starting a phase and not sure where to begin, when a feature feels too large to brief directly to engine-orchestrator, or when Lior says "decompose Phase X", "звідки почати Phase Y", "які atomic chunks для X". Outputs ordered list of chunks as files in orchestration/chunks-todo/<phase>/ AND inline summary in chat.
---

# Decompose Feature into Atomic Chunks

You are helping Lior decompose a strategic-level feature (or roadmap phase) into atomic, PR-sized chunks. Each chunk must be independently briefable to `engine-orchestrator` for execution.

## Model (conveyor launch)

Decomposition is **open-ended structural reasoning** that shapes the entire downstream build — the
highest-leverage single reasoning task in the pipeline, and it runs only **once per feature**. So in
the conveyor, launch the decompose session on a **frontier model: `claude --model fable`**, with
**fallback to `--model opus`** if Fable is unavailable (after the 2026-06-22 promo, or on error).
This skill cannot set its own model — the launcher (the conveyor conductor) pins it via `--model`;
this note records the intent. Everything else stays opus/sonnet per the agent-def pins. *(Promo
experiment: if Fable's cuts aren't visibly sharper than Opus, drop back to opus — decompose is
1×/feature so the cost either way is small. See memory `reference_claude_code_automation_billing`.)*

## When to invoke

- Slash command `/decompose-feature <feature-or-phase-name>`
- Trigger phrases in chat: "decompose Phase X", "звідки почати Phase Y", "які atomic chunks для X", "розбий Phase X на куски"
- Any feature that feels too large for a single orchestrator session (>1 day of work)

## Workflow

### Step 1 — Read context

Read in this order:

1. `orchestration/docs/PIPELINE.md` — the workflow you operate in; you produce the `chunks` stage. (If this skill and PIPELINE.md disagree on lifecycle, PIPELINE.md wins.)
2. `orchestration/docs/roadmap.md` — find the target phase/feature
3. **The spec, if one exists** — `orchestration/docs/specs/<...>.md` for this feature (PIPELINE.md §3 conditional stage). Each chunk's `## Orchestrator brief` should cite the spec section it implements.
4. `orchestration/docs/open-questions.md` — any open Qs that might block this phase
5. `orchestration/docs/known-gotchas.md` — relevant engineering pitfalls
6. `orchestration/docs/architecture.md` — refresh boundaries
7. Any ADR specifically referenced in the roadmap section for this phase

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

**Runtime-coupling check (PIPELINE.md §7.1).** Any "parallel / no coupling / no dependency" claim MUST be checked against **shared runtime/behavioral contracts**, not just disjoint files. Two chunks that both depend on the same daemon/reducer/shared mutable state are **coupled even with zero shared source** — say so in `Depends on:`. A frozen *wire* contract does NOT imply a frozen *behavioral* contract (which variants a handler emits, in which order/phase). (v0 scar: 02a legally changed what the daemon replies to `session_start` within the frozen envelope and silently turned 02b-i's handler into dead code.)

Tighten the decomposition based on grilling feedback.

### Step 5 — Write artifacts

Output BOTH artifact files AND inline summary.

**Artifact files:** for each chunk, write a file at `orchestration/chunks-todo/<phase-or-feature-slug>/NN-kebab-title.md` using the template below. NN is the execution order (01, 02, ...). Slugify phase name to kebab-case (e.g., `phase-1-engine-skeleton`).

**Inline summary in chat:** a markdown table with columns `# | Title | Status | Size | Path`. After the table, list this exact next-step instruction:

> Next: open a new chat and run `/engine-orchestrator do chunk 01 from orchestration/chunks-todo/<phase>/01-<first-title>.md`. The orchestrator reads the chunk file directly — **no brief paste** (PIPELINE.md §7.3, Level-1).

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

**Out:** (each item states WHY — PIPELINE.md §7.2, so the orchestrator can tell a deliberate cut from stale drift)
- ... — OUT because X / deferred to chunk-N because Y / frozen per ADR-Z

## Done criteria

(tag each as **[behavioral]** — visible UI / end-to-end / "works on macOS" → needs a live demo or behavioral test to prove — or **[mechanical]** — typecheck / lint / test / byte-unchanged → proven by command output; PIPELINE.md §6)

- [ ] Verifiable thing 1
- [ ] Verifiable thing 2
- [ ] ...

## Orchestrator brief (read by the orchestrator from this file)

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

`todo` / `in-progress` / `done` / `blocked` / `postponed` (PIPELINE.md §4.1)

- **todo** — created by this skill, not yet picked.
- **in-progress** — an orchestrator chat has started this chunk. Set **by `engine-orchestrator`** on pickup (autonomous, §5.1).
- **done** — **verified-done** (§6: mechanical = command evidence; behavioral = Lior's live demo / passing test) + merged. Then **`engine-orchestrator`** archives it per the uniform convention (§4.4): status-flip + banner + move to `chunks-todo/archive/<phase>/`. NOT merely "review-clean merge."
- **blocked** — external dependency or missing decision prevents work. Keep in place. Add note explaining what is needed to unblock.
- **postponed** — Lior deferred deliberately due to priority shift. Keep in place. Add note explaining when to revisit.

You (decompose) only create chunks at `todo`. All later transitions (`in-progress`, `done` + archive) are the **`engine-orchestrator`'s autonomous duties after verified-done** — NOT manual Lior steps. Lior's role here is the §5.2 judgment gates (behavioral demo sign-off, PR merge) plus `blocked`/`postponed` calls.

## Hard rules

- NEVER write product code.
- NEVER execute chunks yourself — only decompose.
- ALWAYS use `superpowers:brainstorming` AND standalone `grill-with-docs` (no skipping).
- ALWAYS produce BOTH artifact files AND inline summary.
- ALWAYS include a `## Orchestrator brief` section as in-file enrichment (the orchestrator reads it from the file — it is NOT a paste payload; enrich the chunk file rather than expecting copy-paste).
- If decomposition would produce >7 chunks for one phase — push back to Lior: "this phase is too big; consider splitting roadmap Phase X into Phase Xa/Xb."
- NEVER modify files outside `orchestration/chunks-todo/` (except writing the chunks themselves).
