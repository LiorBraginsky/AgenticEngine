# EXECUTE: Install `decompose-feature` skill + `chunks-todo/` folder + memory updates

## ⚡ DO THIS NOW

You are a fresh agent dispatched with this brief. You have no prior conversation context.

**Your job:** create files exactly as specified below. Do NOT ask clarifying questions. Do NOT propose alternatives. Do NOT discuss the plan. Just execute step by step.

If something genuinely fails (e.g., write permission error), report the specific failure and stop. Otherwise proceed silently until done.

Working directory: `/Users/lior/WebstormProjects/playground/AgenticEngine`

---

## STEP 1 — Create directories

```bash
mkdir -p .claude/skills/decompose-feature
mkdir -p orchestration/chunks-todo/archive
```

---

## STEP 2 — Create `.claude/skills/decompose-feature/SKILL.md`

Write this exact content:

````markdown
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
````

---

## STEP 3 — Create `orchestration/chunks-todo/README.md`

Write this exact content:

````markdown
# chunks-todo/

**Purpose:** Kanban-style inbox of atomic, PR-sized work items ready to be picked up by `engine-orchestrator` one at a time.

This folder is the **bridge between strategic planning** (`orchestration/docs/roadmap.md`, `orchestration/docs/open-questions.md`) and **tactical execution** (`engine-orchestrator` → `engine-architect` → `engine-worker` → `engine-reviewer`).

## Lifecycle

Each chunk file has a `Status:` field with one of:

| Status | Meaning |
|--------|---------|
| `todo` | Created by `/decompose-feature` skill, not yet picked. |
| `in-progress` | Lior copy-pasted orchestrator brief into a chat and started execution. |
| `done` | Passed review-clean merge. **Move file to `archive/<phase>/`.** |
| `blocked` | External dependency or missing decision prevents work. Keep in place, add note. |
| `postponed` | Deliberately deferred (priority shift). Keep in place, add note explaining when to revisit. |

`chunks-todo/`'s **end goal is to be empty** — all chunks either executed (in archive) or postponed/blocked with notes.

## Structure

```
chunks-todo/
├─ README.md                              ← this file
├─ <phase-or-feature-slug>/                ← e.g. phase-1-engine-skeleton/
│  ├─ 01-<kebab-title>.md
│  ├─ 02-<kebab-title>.md
│  └─ ...
└─ archive/
   └─ <phase-or-feature-slug>/             ← moved here when done
      └─ 01-<kebab-title>.md
```

## Conventions

- **One chunk per file.** File name: `NN-kebab-title.md` where `NN` is execution order (`01`, `02`, `03`).
- **Subfolder per phase/feature.** Slugified to kebab-case.
- **Each file follows the template** enforced by `.claude/skills/decompose-feature/SKILL.md`.
- **Files in `archive/`** are read-only historical record — do not edit.

## Workflow

1. **Decomposition:** `/decompose-feature <phase>` skill creates files here, status = `todo`.
2. **Execution:** Lior picks oldest `todo` chunk, copies `## Orchestrator brief` section, pastes into new chat with `/engine-orchestrator`.
3. **Status update:** Lior manually edits `Status:` field as work progresses (`todo` → `in-progress`).
4. **Completion:** After reviewer-clean merge, Lior manually moves file to `archive/<phase>/` and sets `Status: done`.

## Why filesystem and not GitHub Issues / Linear / Jira

- **Co-located with `orchestration/docs/`** — AI agents read both atomically without auth or API.
- **Markdown** — editable in any editor, no platform lock-in.
- **Versioned with git** — history without third-party.
- **AI-native workflow** — orchestrator/architect/worker read these as input directly.

## Related

- `.claude/skills/decompose-feature/SKILL.md` — the skill that creates chunks here.
- `.claude/skills/engine-orchestrator/SKILL.md` — picks chunks from here for execution.
- `orchestration/docs/roadmap.md` — source of truth for what to decompose.
````

---

## STEP 4 — Create memory file `reference_folder_conventions.md`

Write to `/Users/lior/.claude/projects/-Users-lior-WebstormProjects-playground-AgenticEngine/memory/reference_folder_conventions.md`:

````markdown
---
name: reference-folder-conventions
description: Folder structure, purpose, and lifecycle for AgenticEngine project
metadata:
  type: reference
---

# Folder conventions in AgenticEngine

## Strategic / permanent

- **`orchestration/docs/`** — vision, concept, architecture, ADRs, glossary, roadmap, open-questions, known-gotchas, plugin-anatomy. Permanent, grows with project.
- **`orchestration/docs/adr/`** — immutable Architecture Decision Records. Numbered 0000-NNNN. NEVER renumber existing ADRs.
- **`orchestration/docs/plans/`** — `engine-orchestrator`'s per-feature plan files. Created during cycle, persisted after merge for history. Per-feature lifecycle.

## Tactical / lifecycle-managed

- **`orchestration/agent-prompts/`** — one-time handoff briefs for worker dispatches (e.g., `install-agentic-team.md`, `distill-claude-example.md`, `install-decomposer-skill.md`). **Transient** — clean periodically; consider these consumed-after-use. Lior treats this as "rudimentary, needs occasional cleanup."
- **`orchestration/chunks-todo/`** — Kanban inbox of atomic chunks ready for `engine-orchestrator`. **Active** — files live here until executed, then moved to `orchestration/chunks-todo/archive/<phase>/`. Goal is to **be empty**. See `orchestration/chunks-todo/README.md` for full lifecycle.

## Configuration / setup

- **`.claude/agents/`** — local agent definitions (engine-architect, engine-worker, engine-reviewer, adr-curator, skill-manager). Permanent.
- **`.claude/skills/`** — local skill definitions (engine-orchestrator, decompose-feature, likec4-sync planned). Permanent.
- **`.claude_example/`** — original reference material from another project. Kept until Lior decides to remove.
- **`.obsidian/`** — Obsidian vault config.

## External (machine-local, auto-loaded)

- **`~/.claude/projects/-Users-lior-WebstormProjects-playground-AgenticEngine/memory/`** — assistant memory entries. Auto-loaded into every Claude Code chat in this project. Includes `workflow_orchestrator_not_coder`, `user_profile`, `project_agentic_engine_status`, `reference_agent_prompts_dir`, `reference_skills_locations`, this file.

## Convention principle

**Each folder has a clear lifecycle.** Strategic = permanent. Tactical = lifecycle-managed. Configuration = permanent unless setup changes.

Folders without clear lifecycle become bloated. The goal of `orchestration/chunks-todo/` and `orchestration/agent-prompts/` is to eventually empty themselves — content is consumed by execution, not accumulated for posterity.

Related: [[reference_agent_prompts_dir]], [[workflow_orchestrator_not_coder]], [[project_agentic_engine_status]].
````

---

## STEP 5 — Update `workflow_orchestrator_not_coder.md` to add Jimmy

Read `/Users/lior/.claude/projects/-Users-lior-WebstormProjects-playground-AgenticEngine/memory/workflow_orchestrator_not_coder.md` and APPEND (at the end of file, after existing content, before any `Related:` line — if no Related line exists, append at end):

````markdown

## Root chat identity: "Jimmy"

Lior calls the root chat **"Jimmy"** — a strategic adviser/брателик (brother) who NEVER executes.

**Jimmy's job:**
- Hold strategic context (vision, concept, roadmap).
- Discuss decomposition, trade-offs, sequencing interactively.
- Write handoff briefs for worker agents in other chats (saved to `orchestration/agent-prompts/`).
- Update memory and folder conventions.
- Be honest adviser — challenge bad ideas, surface alternatives.

**Jimmy's job is NOT to:**
- Create product code.
- Run `bun`, `npm`, build commands, or any tooling.
- Execute `/decompose-feature`, `/engine-orchestrator`, or install agents.
- Anything that could be handed off to a worker in another chat.

**If Lior asks Jimmy to "do X":** Jimmy responds by writing a handoff brief for a worker to do X, unless X is a strategic discussion or quick context lookup (reading a file to inform conversation).

This role discipline protects the root chat's strategic context budget from being consumed by implementation details. It also matches the AgenticEngine product concept: orchestrator + workers, anchor agent + tactical sub-agents.
````

Make sure you APPEND, do not overwrite. The existing content of the file must remain.

---

## STEP 6 — Update `MEMORY.md` index

Read `/Users/lior/.claude/projects/-Users-lior-WebstormProjects-playground-AgenticEngine/memory/MEMORY.md`. It currently has 5 lines. Do TWO things:

1. **Modify line 1** (Workflow line) from current text to:

```
- [Workflow: orchestrator, not coder](workflow_orchestrator_not_coder.md) — Lior delegates code; root chat = "Jimmy", adviser only; workers handle tactical work
```

2. **Append at the end** as line 6:

```
- [Reference: folder conventions](reference_folder_conventions.md) — lifecycle and purpose of each folder in the project
```

Final file should have 6 lines, no trailing newline issues.

---

## STEP 7 — Verify and report

Run these checks:

```bash
ls -la .claude/skills/decompose-feature/
ls -la orchestration/chunks-todo/
cat orchestration/chunks-todo/README.md | head -10
ls -la /Users/lior/.claude/projects/-Users-lior-WebstormProjects-playground-AgenticEngine/memory/
cat /Users/lior/.claude/projects/-Users-lior-WebstormProjects-playground-AgenticEngine/memory/MEMORY.md
```

Expected:
- `.claude/skills/decompose-feature/SKILL.md` exists.
- `orchestration/chunks-todo/` has `README.md` and `archive/` subdir.
- Memory dir contains `MEMORY.md` + 6 entry files (was 5, now 6 with `reference_folder_conventions.md`).
- `MEMORY.md` has 6 lines, line 1 mentions "Jimmy", line 6 is the new `reference_folder_conventions` entry.
- `workflow_orchestrator_not_coder.md` ends with the Jimmy section.

Then return **one sentence** in your final response: `"Installed decompose-feature skill + chunks-todo/ folder + 1 new memory entry + 2 updated memory entries; ready for Lior to invoke /decompose-feature."`

That is your full response. Nothing else.

---

## ❌ DO NOT do these things

- DO NOT modify any file under `orchestration/docs/`, `.claude/agents/`, `.claude/skills/engine-orchestrator/`, `.claude/skills/likec4-sync/`, or any other existing path. Only the files specified above.
- DO NOT delete anything.
- DO NOT create chunks inside `chunks-todo/` — that's the skill's job, not yours. You only create the folder + README.
- DO NOT add Lior to "What we'll regret" sections of ADRs.
- DO NOT propose additional skills or agents beyond the one specified.
- DO NOT ask clarifying questions. If something is ambiguous, follow the spec literally.

Begin now.
