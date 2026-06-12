---
title: Dev-roadmap (process world)
status: living-document
last-major-update: 2026-06-12
tags: [process, orchestration, conveyor, boilerplate, meta]
---

# Dev-roadmap — the PROCESS world

> The roadmap for **how we build**, kept separate from the product roadmap (`roadmap.md`, which is
> *what we build*). Per PIPELINE §7.4: product = ADRs/specs/roadmap; **process = PIPELINE.md +
> experiments/ + this file, never an ADR.** This doc is the plan for the process *as its own
> deliverable*.

## North-star (Lior, 2026-06-12)

**Extract the development process into reusable, project-agnostic substances / boilerplates that can
be dropped onto other projects.** Today the machinery (conveyor, Jimmy-conductor, dev-bus, gates,
chunk lifecycle) is grown inside AgenticEngine and is coupled to it (repo paths, `gh` repo slug,
`packages/`/`apps/` assumptions, the frozen-surface list, the security/demo gates). The goal is to
factor it so the *mechanism* is separable from the *project it's applied to* — install it on a new
repo and get the same crawl→walk→run pipeline with project-specific config, not a fork.

This is **why PIPELINE §7.4 matters**: every product-specific entanglement that leaks into the
process makes the eventual lift-out more expensive. Keep the seam clean as we go.

## What exists today (the substances, and their current coupling)

| Substance | What it is | Coupled to AgenticEngine via |
|---|---|---|
| **Pipeline / gates** | `PIPELINE.md` — stages, §5.2 gates, verified-done, governance | the frozen-surface list, the §6.1 demo, security gates |
| **Conveyor (crawl)** | `bin/conveyor-{next,status,room}.sh`, `chunks-todo/`, `conveyor-ledger.md` | repo paths, `gh` slug `LiorBraginsky/AgenticEngine`, branch conventions |
| **Jimmy-conductor** | the orchestrating-chat charter (launch/retire workers, escalate §5.2) | the agent-def set, the model map |
| **Dev-bus (run, piloting)** | `bin/conveyor-{ask,bus}.sh`, `.conveyor/bus/` — worker↔conductor Q&A | tmux control-room pane names; Finding #9 |
| **Agent team** | `.claude/agents/*`, `.claude/skills/*` (decompose, orchestrator, reviewer…) | model pins, project-specific reviewer rules |
| **Half-manual baseline** | the pre-conveyor flow (Lior runs each chat) | — (the thing we climbed away from) |

## Themes for extraction (NOT committed — directions)

1. **Config-ize the project coupling** — repo slug, paths, frozen-surface list, gate set, model map
   into one project-config the scripts + charter read (so the scripts are project-agnostic).
2. **Package the conveyor scripts** — a portable `bin/` (or an installable CLI) + a template
   `chunks-todo/`, `ledger`, `.conveyor/` layout.
3. **Generalize the agent/skill set** — which agents are project-agnostic (reviewer, decompose) vs
   project-specific (the engine-* defs); extract the reusable core.
4. **Portable PIPELINE template** — the gate model with project-specific gates (here: frozen
   surfaces + §6.1 demo + security) as pluggable slots.
5. **Decide the verdict on the conveyor + dev-bus FIRST** — extraction should package what's *proven*,
   not what's *piloting*. Setup-verdict is deferred until usage stats over 3–4 features
   (`experiments/2026-06-12-conveyor-dev-bus.md`). Don't extract a moving target.

## Status

Seed only (Lior flagged this as a future direction, "не обов'язково" to formalize now). The
immediate work stays on the PRODUCT roadmap (security-hardening building next). This doc exists so
the process-as-deliverable has a home and the §7.4 boundary has somewhere to point.

## Related

- `PIPELINE.md` — the current process SSOT (§7.4 = the product/process boundary).
- `experiments/2026-06-06-conveyor-pilot.md` — conveyor pilot (ratified) · `…2026-06-12-conveyor-dev-bus.md` — dev-bus (piloting).
- `roadmap.md` — the PRODUCT roadmap (the other world).
- memory `project_pipeline_automation` — the conveyor design record.
