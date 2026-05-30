---
name: likec4-sync
description: Generate or sync LikeC4 architecture diagrams from AgenticEngine core/engine source code. Use on demand when core structure has changed significantly and diagrams need refresh. Reads src/, writes .likec4/*.c4 files. Does NOT modify docs/ or source.
---

# LikeC4 Sync

**STATUS:** PLANNED — Activate after Phase 1, when there is real engine source code under `src/` (or `packages/core/src/` if monorepo). Until then, this skill is a placeholder declaring intent.

## Scope (when implemented)

Scan TypeScript source under `packages/core/src/`, produce/update LikeC4 model files in `.likec4/`:

- `.likec4/engine.c4` — daemon internals (server, session manager, tool registry, scheduler)
- `.likec4/plugin.c4` — plugin layers (manifest, backend tools, ui-tools, agent hints, auth)
- `.likec4/frontends.c4` — Tauri shell, web admin tab, future CLI; their WebSocket protocol to daemon

## What this skill is NOT

- Does NOT generate diagrams from `docs/` (docs prose stays prose; `architecture.md` keeps its ASCII).
- Does NOT modify TypeScript source code.
- Does NOT create new ADRs.
- Does NOT replace prose architecture docs — supplements them.

## When activated (Phase 1+ work)

Future implementation will follow:

1. Read TypeScript source files under `packages/core/src/`.
2. Parse class/module structure.
3. Apply LikeC4 DSL conventions: containers (top-level), components (modules), code (classes/functions).
4. Write/update `.c4` files in `.likec4/`.
5. Live preview available via VS Code extension `likec4.likec4-vscode` (Lior installs separately).

## Bootstrap requirements (do before activation)

- Install LikeC4 toolchain: `bun add -D @likec4/cli` (or current equivalent).
- Add `bun run sync:diagrams` script to `package.json`.
- Decide on `.likec4/` location (committed) vs build output (gitignored).
- Add `.c4` files to Obsidian's ignore list (they're not markdown).
