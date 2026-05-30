# EXECUTE: Move docs/, chunks-todo/, agent-prompts/ into `orchestration/`

## ⚡ DO THIS NOW

You are a fresh agent dispatched with this brief. You have no prior conversation context.

**You are a tactical worker.** Per `memory/workflow_orchestrator_not_coder.md`: if dispatched by a brief from `agent-prompts/`, execute directly. Do not ask "am I supposed to do this?" — the answer is yes.

**Critical constraint:** the project is NOT git-initialized yet. Use plain `mv`, not `git mv`. Do NOT run `git init`. Do NOT commit anything.

Working directory: `/Users/lior/WebstormProjects/playground/AgenticEngine`

---

## STEP 1 — Sanity checks

Confirm preconditions before doing anything destructive:

```bash
cd /Users/lior/WebstormProjects/playground/AgenticEngine

# 1. Confirm git is NOT initialized
[ -d .git ] && echo "ERROR: .git exists — abort, Lior expects pre-git state" && exit 1
echo "OK: pre-git state confirmed"

# 2. Confirm target dir does NOT yet exist
[ -d orchestration ] && echo "ERROR: orchestration/ already exists — abort" && exit 1
echo "OK: orchestration/ does not exist yet"

# 3. Confirm source dirs exist
for d in docs chunks-todo agent-prompts; do
  [ ! -d "$d" ] && echo "ERROR: $d/ missing — abort" && exit 1
done
echo "OK: all source dirs present"
```

If any check fails — STOP and report.

---

## STEP 2 — Physical move

```bash
mkdir -p orchestration
mv docs orchestration/docs
mv chunks-todo orchestration/chunks-todo
mv agent-prompts orchestration/agent-prompts
```

After this command — this very brief file's old path `agent-prompts/reorganize-into-orchestration.md` is now at `orchestration/agent-prompts/reorganize-into-orchestration.md`. **You can continue reading it from there if needed**, but you already have all instructions loaded.

Verify physical layout:

```bash
ls -la orchestration/
ls -la orchestration/docs/
ls -la orchestration/chunks-todo/
ls -la orchestration/agent-prompts/
```

Expected: each subfolder shows its content. `docs/` has vision.md/concept.md/architecture.md/etc, `chunks-todo/` has README.md and archive/, `agent-prompts/` has install-* and distill-* files.

---

## STEP 3 — Update memory entries

Files to update (all under `/Users/lior/.claude/projects/-Users-lior-WebstormProjects-playground-AgenticEngine/memory/`):

For each file, **read first, then edit** with these replacements:

| Replace | With |
|---------|------|
| `docs/` | `orchestration/docs/` |
| `chunks-todo/` | `orchestration/chunks-todo/` |
| `agent-prompts/` | `orchestration/agent-prompts/` |

**CRITICAL — only replace where it is a file/directory path.** Do not replace if the word appears as plain English (rare here, but be careful). Examples:

| Original | Replace? | Reason |
|----------|----------|--------|
| `Read docs/vision.md` | YES | path |
| ``docs/**`` | YES | path glob |
| `briefs in `agent-prompts/`` | YES | path |
| `the docs folder` | NO | English usage, no slash |
| `https://example.com/docs/` | NO | URL (none expected here) |

The trailing slash (`docs/`, not `docs`) is the safe rule — only paths with trailing slash or file extension after.

### Files to edit:

1. **`MEMORY.md`** — index file. Check if any captions mention paths.
2. **`workflow_orchestrator_not_coder.md`** — has many path mentions (`docs/`, `chunks-todo/<phase>/`, `agent-prompts/<task>.md`, etc.). Update all.
3. **`reference_folder_conventions.md`** — entirely about folder paths. Heavy editing — every section refers to one of the three folders.
4. **`reference_agent_prompts_dir.md`** — about agent-prompts/. Update path everywhere.
5. **`project_agentic_engine_status.md`** — may mention `docs/` for ADRs and structure. Update.
6. **`user_profile.md`** — likely no paths. Skim, edit only if needed.
7. **`reference_skills_locations.md`** — unlikely to have project paths. Skim only.

For each file, use Edit tool with exact string replacement. Do not do mass sed — too risky.

---

## STEP 4 — Update Claude config files

### `.claude/skills/` — 3 SKILL.md files

1. **`.claude/skills/engine-orchestrator/SKILL.md`** — references `docs/**`, `agent-prompts/**`, `chunks-todo/<phase>/NN-*.md`, plan path `docs/plans/<feature-name>/plan.md`. Update all path references.

2. **`.claude/skills/decompose-feature/SKILL.md`** — output path `chunks-todo/<phase>/NN-*.md` → `orchestration/chunks-todo/<phase>/NN-*.md`. Also context-read paths (`docs/roadmap.md`, etc.). Update all.

3. **`.claude/skills/likec4-sync/SKILL.md`** — only mentions `src/`, `packages/core/`, `.likec4/`. **No changes needed.** Verify by grep.

### `.claude/agents/` — 5 agent .md files

For each: open, scan for `docs/`, `chunks-todo/`, `agent-prompts/` references, update.

4. **`.claude/agents/engine-architect.md`** — heavy references to `docs/` (reads `docs/vision.md`, `docs/concept.md`, etc.). Update all.

5. **`.claude/agents/engine-worker.md`** — refers to `docs/architecture.md`, `docs/plugin-anatomy.md`, `docs/adr/`. Update all.

6. **`.claude/agents/engine-reviewer.md`** — refers to `docs/architecture.md`, `docs/plugin-anatomy.md`, ADR numbers. Update paths.

7. **`.claude/agents/adr-curator.md`** — refers to `docs/adr/`, `docs/adr/0000-template.md`, `docs/architecture.md`, `docs/concept.md`. Update all.

8. **`.claude/agents/skill-manager.md`** — refers to `.claude/agents/`, `.claude/skills/`, `agent-prompts/`, `docs/roadmap.md`. Update `agent-prompts/` and `docs/...` only; `.claude/agents/` and `.claude/skills/` stay as-is (those didn't move).

---

## STEP 5 — Update README.md

`README.md` at project root has Quick links section pointing to `docs/vision.md`, `docs/concept.md`, etc. Update all `docs/` and any other paths to use `orchestration/docs/`.

---

## STEP 6 — Update internal docs references

Inside `orchestration/docs/**/*.md` and `orchestration/agent-prompts/**/*.md` — many cross-references between docs.

**Important nuance about Obsidian wikilinks:**

- `[[concept]]` style (filename only) — DO NOT change. Obsidian resolves by filename across vault.
- `[[adr/0001-interaction-pattern]]` style (path suffix) — DO NOT change. Obsidian's path-suffix resolution still finds `orchestration/docs/adr/0001-...md` because path **ends with** `adr/0001-...md`.
- Markdown links like `[concept](docs/concept.md)` or `(docs/adr/0001-...)` — YES change to `orchestration/docs/...`
- Plain-text path mentions like `Read docs/vision.md first` — YES change.

**Strategy:** grep first to surface all candidate locations, then edit each one carefully.

```bash
grep -rn -E "(^|[[:space:][:punct:]])(docs|chunks-todo|agent-prompts)/[a-zA-Z0-9._/-]+" \
  orchestration/docs/ \
  orchestration/agent-prompts/ \
  orchestration/chunks-todo/ \
  | grep -v "^[^:]*:[0-9]*:\[\[" \
  | head -200
```

(The second grep filters out Obsidian `[[...]]` lines — those we leave alone.)

For each remaining hit, apply the path prefix. Do this with Edit tool one file at a time, not bulk sed.

### Specific docs files known to have path refs (non-exhaustive — grep is authoritative):

- `orchestration/docs/architecture.md` — references all 8 ADRs via wikilinks (don't change) AND mentions concrete paths like `packages/core/src/` (don't change — those are future code paths).
- `orchestration/docs/concept.md` — wikilinks to ADRs and other docs (don't change).
- `orchestration/docs/roadmap.md` — phase references, may have `docs/` mentions.
- `orchestration/docs/plugin-anatomy.md` — wikilinks (don't change), may have `docs/` text refs.
- `orchestration/docs/open-questions.md` — wikilinks (don't change).
- `orchestration/docs/known-gotchas.md` — wikilinks (don't change).
- `orchestration/docs/glossary.md` — minimal cross-refs.
- `orchestration/docs/vision.md` — wikilinks at bottom (don't change).
- `orchestration/docs/adr/0001-0008` — wikilinks within (don't change). May have `[[../concept]]` style — those still resolve.

### Historical briefs in `orchestration/agent-prompts/`:

- `install-agentic-team.md` — mentions `docs/`, `chunks-todo/`, `agent-prompts/`. Update for consistency (these are historical but may be referenced).
- `install-decomposer-skill.md` — same.
- `distill-claude-example.md` — references docs/ paths.
- `distill-claude-result.md` — references many paths.

### `orchestration/chunks-todo/README.md`:

- Has path examples like `chunks-todo/<phase-or-feature-slug>/`. Update to `orchestration/chunks-todo/<phase-or-feature-slug>/`.

---

## STEP 7 — Final verification

```bash
# 1. Structure check
ls -la /Users/lior/WebstormProjects/playground/AgenticEngine/
# Expected: README.md, orchestration/, .claude/, .obsidian/, .idea/

ls -la /Users/lior/WebstormProjects/playground/AgenticEngine/orchestration/
# Expected: docs/, chunks-todo/, agent-prompts/

# 2. No leftover top-level docs/, chunks-todo/, agent-prompts/
[ -d /Users/lior/WebstormProjects/playground/AgenticEngine/docs ] && echo "ERROR: docs/ still at root" && exit 1
[ -d /Users/lior/WebstormProjects/playground/AgenticEngine/chunks-todo ] && echo "ERROR: chunks-todo/ still at root" && exit 1
[ -d /Users/lior/WebstormProjects/playground/AgenticEngine/agent-prompts ] && echo "ERROR: agent-prompts/ still at root" && exit 1
echo "OK: top-level cleanup confirmed"

# 3. Path-reference leak check — grep for remaining unprefixed paths in Claude config + memory
# (Should return zero matches, modulo Obsidian wikilinks)
echo "=== Remaining unprefixed path references (should be empty or Obsidian-only) ==="
grep -rn -E "(^|[[:space:][:punct:]])(docs|chunks-todo|agent-prompts)/" \
  /Users/lior/WebstormProjects/playground/AgenticEngine/.claude/ \
  /Users/lior/WebstormProjects/playground/AgenticEngine/README.md \
  /Users/lior/.claude/projects/-Users-lior-WebstormProjects-playground-AgenticEngine/memory/ \
  2>/dev/null \
  | grep -v "orchestration/" \
  | head -20
# If output is empty or only shows Obsidian `[[...]]` wikilinks — OK.

# 4. Count files updated (rough)
echo "=== File counts after move ==="
find /Users/lior/WebstormProjects/playground/AgenticEngine/orchestration -type f -name "*.md" | wc -l
```

---

## STEP 8 — Final report

Return ONE sentence: `"Reorganized into orchestration/. Updated NN files. Ready for Lior to invoke /decompose-feature."` where NN is the actual count of files you edited.

That is your full response. Nothing else.

---

## ❌ DO NOT do these things

- **DO NOT** run `git init`, `git add`, `git commit`, `git mv`, or any git command. The project is intentionally pre-git for now.
- **DO NOT** modify or rename anything inside `.claude/agents/`, `.claude/skills/` other than updating path references inside their existing .md files. The folder names themselves do NOT change.
- **DO NOT** modify Obsidian wikilinks `[[name]]` or `[[adr/000N-...]]` — they resolve by filename or path-suffix and survive the move.
- **DO NOT** modify `.obsidian/`, `.idea/` config files.
- **DO NOT** create new files beyond updating the existing ones.
- **DO NOT** delete any file. Only move (in STEP 2) and edit content (other steps).
- **DO NOT** add cosmetic changes — no formatting fixes, no rewording, no "while I'm here" cleanups. Path updates only.
- **DO NOT** mass-sed across files — use Edit tool one file at a time with explicit before/after strings.
- **DO NOT** ask clarifying questions. If something is ambiguous, follow the literal spec.

Begin now.
