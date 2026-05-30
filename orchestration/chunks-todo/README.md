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
