# Brief: Distill `.claude_example/` into AgenticEngine's Multi-Agent Dev Team

> **For:** A worker agent dispatched in a fresh chat / branch.
> **From:** The root chat that holds AgenticEngine's strategic context.
> **Purpose:** Curate a focused multi-agent dev team for AgenticEngine from a copy-pasted collection of generic agent definitions.

You have **no prior context** from the conversation that produced this brief. Everything you need is below or readable from the filesystem.

---

## Who is asking and what they want

The user, **Lior**, is building **AgenticEngine** — an AI agent platform (see context section). He is acting as an **orchestrator**: he does not want to write code himself. Instead, he wants to **assemble a team of AI workers** (agents + skills) that he can dispatch from his root chat into focused sub-chats for tactical work.

He copied a folder `.claude_example/` from a previous project that contains agent definitions. **Most of it is irrelevant** to AgenticEngine (different domain). He wants you to:

1. Read every file in `.claude_example/`.
2. Decide what to KEEP, ADAPT, or DISCARD.
3. Propose the **final minimal team** for AgenticEngine's next 2-3 months of work (Phase 1 = Engine Skeleton, Phase 2 = First Frontend).
4. Provide a concrete installation plan.

Stay focused. Don't propose agents for problems Lior doesn't have yet.

---

## Context: What is AgenticEngine

**Tagline:** *"The OS layer for AI agents. Plugins ship widgets and tools, users program rituals, AI-powered services come to you. Mechanism: voice in, widgets out."*

**Status:** Phase 0 (concept fully documented). About to begin Phase 1 (Engine Skeleton).

**Tech stack (decided):**
- Local daemon, TypeScript on Bun, WebSocket on `localhost:7777`
- Multiple frontends connect to same daemon (macOS overlay via Tauri, web admin tab)
- UI generated via "UI tools" — tool calls whose effect is "show this widget"
- Plugins extend both backend tools (via MCP) and UI tools (composed of closed-set primitives)
- Two-sided marketplace: end-users + SaaS providers shipping paid mini-SaaS as plugins

**Read these files BEFORE doing anything else** (in this order):

1. `orchestration/docs/vision.md` — north star
2. `orchestration/docs/concept.md` — 5 pillars of differentiation (especially Pillar 5 about marketplace)
3. `orchestration/docs/architecture.md` — daemon + WebSocket + frontends shape
4. `orchestration/docs/plugin-anatomy.md` — what a plugin is (5 layers)
5. `orchestration/docs/roadmap.md` — Phase 1 is next; Phase 7 is far away
6. `orchestration/docs/adr/0001` through `0008` — full decision history (skim is fine)
7. `orchestration/docs/glossary.md` — terminology

**Skip:** `*_UKR_TEMP.md` files. Those are Ukrainian translations for Lior's bedtime reading — they have no extra content.

---

## Context: About Lior

- Self-described: "prosumer-developer hybrid", "tired of managing endless ChatGPT/Claude tabs."
- Lives at the code-tools layer. Uses Raycast extensions, Obsidian plugins, Claude Code skills.
- Does **not** want to write code himself in this project.
- Strategic context (vision, concept, roadmap) lives in the **root chat** and in `orchestration/docs/`.
- Tactical work (write file X, implement feature Y, review code Z) is delegated to **worker agents** in sub-chats.
- Likes structure, ADRs, explicit decisions.

**He explicitly asked for at least these roles:**

- **Architect** (planning, design decisions)
- **Worker** (implementation)
- **Skill Manager** (Lior's own term — unclear what he means; you should propose a definition based on context — likely: an agent that manages/curates which skills are installed, where they live, when to use which)

He's open to **2-4 additional roles** if you see clear need.

---

## What Lior already has installed

Run `ls ~/.claude/skills/` to verify, but most likely Lior has the **superpowers skill pack** installed, which provides:

- `subagent-driven-development` — for executing plans with sub-agents
- `dispatching-parallel-agents` — when to spawn agents in parallel
- `writing-plans` — for plan documents
- `executing-plans` — for plan execution with review checkpoints
- `writing-skills` — for creating new skills
- `test-driven-development` — TDD discipline
- `systematic-debugging` — bug investigation
- `requesting-code-review` — completion check
- `verification-before-completion` — evidence before claims
- `brainstorming` — feature exploration
- `using-superpowers` — meta-skill on using all of the above

**Critical:** Do not recommend agents/skills that duplicate these. If you find overlap, explicitly note "this duplicates superpowers:X, prefer the superpowers version."

---

## What's in `.claude_example/`

**Agents** (`.claude_example/agents/`):
- `architect.md`
- `business-writer.md`
- `code-reviewer.md`
- `derivative-docs-reviewer.md`
- `diagram-writer.md`
- `docs-architect.md`
- `reality-auditor.md`
- `researcher.md`
- `technical-writer.md`
- `worker.md`

**Skills:**
- `.claude_example/feature-team-orchestration/SKILL.md` — looks directly relevant to Lior's orchestration goal; **prioritize reading this fully**.
- `.claude_example/shadcn/SKILL.md` — frontend component library; **potentially relevant for Phase 2 UI work** (but not Phase 1).

These were copied from another project's setup. Treat them as **raw material**, not as a designed team.

---

## Your deliverables

Return a single markdown document (~2000-3000 words max) with this structure:

### 1. TL;DR (3 sentences)
- What to install, what to skip, what new agents to create.

### 2. Per-file verdict table

A markdown table covering all 12 files:

| File | Relevance (1-5) | Verdict (KEEP / ADAPT / DISCARD) | Reason (1 sentence) |
|------|-----------------|----------------------------------|---------------------|

### 3. Detailed analysis (KEEP and ADAPT files only)

For each KEEP / ADAPT file:
- One paragraph: what it does, why it fits AgenticEngine.
- If ADAPT: explicit list of changes needed.

### 4. Proposed AgenticEngine multi-agent team

A description of the **final team**:

- For each role: name, purpose, when Lior should spawn this agent, what it needs as input, what it returns.
- Sketch how roles interact (e.g., "Architect produces plan → Worker executes → Code-reviewer audits").
- Cover Lior's three requested roles (Architect, Worker, Skill Manager) + your 2-4 additions.

### 5. Gaps and new agent definitions

For any role Lior needs but no source file fits, **write the full new agent definition** in markdown format (frontmatter + body), ready for `.claude/agents/`.

### 6. Installation plan

Concrete commands Lior can execute:

```bash
mkdir -p .claude/agents .claude/skills
cp .claude_example/agents/X.md .claude/agents/X.md
# (with reasoning per file)
```

Plus inline content of any ADAPTED files (with adaptations applied).

### 7. Open questions for Lior

Things you couldn't decide alone and want Lior to confirm before installing.

---

## Constraints

- **Read each file fully before judging.** Don't summarize from filename.
- **Be ruthless about discarding.** Lior said most stuff is irrelevant. Argue affirmatively for what you keep.
- **Don't reinvent superpowers.** Note overlaps and defer to superpowers when possible.
- **Stay scoped to Phase 1 + Phase 2 needs.** Don't propose Phase 6 (rituals) agents now.
- **Under ~3000 words.** Lior reads carefully; he hates bloat.
- **No "just in case" recommendations.** Every keep needs justification.

---

## Quality bar (what good looks like)

A good answer will let Lior:

1. In <10 minutes, understand which 5-7 agents he's installing and why.
2. Run the bash commands from your installation plan without modification.
3. Begin Phase 1 work the same day, dispatching the right agent for each task.
4. Trust that nothing important was left out, and nothing irrelevant was kept.

A bad answer will:

- Recommend 10+ agents "just in case."
- Duplicate superpowers without acknowledging it.
- Skip the diff against `~/.claude/skills/`.
- Discuss future phases instead of Phase 1.

---

## Useful starting commands

```bash
# Read everything first
cat orchestration/docs/vision.md orchestration/docs/concept.md orchestration/docs/architecture.md orchestration/docs/plugin-anatomy.md orchestration/docs/roadmap.md
ls orchestration/docs/adr/
ls ~/.claude/skills/    # verify superpowers installed
find .claude_example -type f
```

Begin.
