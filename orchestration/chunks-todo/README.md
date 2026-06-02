# chunks-todo/

**Purpose:** Kanban-style inbox of atomic, PR-sized work items ready to be picked up by `engine-orchestrator` one at a time.

This folder is the **bridge between strategic planning** (`orchestration/docs/roadmap.md`, `orchestration/docs/open-questions.md`) and **tactical execution** (`engine-orchestrator` → `engine-architect` → `engine-worker` → `engine-reviewer`).

## Lifecycle

Each chunk file has a `Status:` field with one of:

> **Lifecycle is governed by `orchestration/docs/PIPELINE.md` (§4.1, §5.1, §6).** This file is the chunk-folder detail; PIPELINE.md is the SSOT. The key shift: status transitions + archiving are the **`engine-orchestrator`'s autonomous duties** (gated on verified-done), **not** manual Lior steps.

| Status | Meaning |
|--------|---------|
| `todo` | Created by `/decompose-feature` skill, not yet picked. |
| `in-progress` | An orchestrator chat has started this chunk. Set **by `engine-orchestrator`** on pickup (autonomous). |
| `done` | **Verified-done** (PIPELINE.md §6: mechanical = command evidence; behavioral = Lior's live demo / passing test) + merged. **`engine-orchestrator`** then archives it (§4.4: status-flip + banner + move to `archive/<phase>/`). |
| `blocked` | External dependency or missing decision prevents work. Keep in place, add note. |
| `postponed` | Deliberately deferred (priority shift). Keep in place, add note explaining when to revisit. |

`chunks-todo/`'s **end goal is to be empty** — all chunks either executed (in archive) or postponed/blocked with notes.

## Structure

```
chunks-todo/
├─ README.md                              ← this file
├─ <phase-or-feature-slug>/                ← e.g. walking-skeleton-v0/
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
2. **Execution:** open a new chat and invoke `/engine-orchestrator do chunk NN from <path>`. The orchestrator reads the chunk file directly — **no brief paste** (PIPELINE.md §7.3, Level-1). It sets `Status: in-progress` on pickup.
3. **Verified-done:** the orchestrator gates `## Done criteria` per PIPELINE.md §6 — behavioral criteria need Lior's live demo (sequenced before closeout docs); mechanical criteria need command output. Review-clean alone is not done.
4. **Completion:** after verified-done + merge, the orchestrator autonomously sets `Status: done`, prepends the archive banner, and moves the file to `archive/<phase>/`. Lior's remaining role: the §5.2 judgment gates (demo sign-off, PR merge) and `blocked`/`postponed` calls.

## Why filesystem and not GitHub Issues / Linear / Jira

- **Co-located with `orchestration/docs/`** — AI agents read both atomically without auth or API.
- **Markdown** — editable in any editor, no platform lock-in.
- **Versioned with git** — history without third-party.
- **AI-native workflow** — orchestrator/architect/worker read these as input directly.

## Related

- `.claude/skills/decompose-feature/SKILL.md` — the skill that creates chunks here.
- `.claude/skills/engine-orchestrator/SKILL.md` — picks chunks from here for execution.
- `orchestration/docs/roadmap.md` — source of truth for what to decompose.
