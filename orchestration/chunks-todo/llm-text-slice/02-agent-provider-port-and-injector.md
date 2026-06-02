# Chunk 2: AgentProvider port + llm-injector + mock-behind-port + memory-ready session state

**Status:** todo
**Created:** 2026-06-02
**Phase:** llm-text-slice (first post-v0 vertical slice)
**Estimated size:** ~1 day
**Depends on:** none (parallelizable with Chunk 1 — pure daemon refactor; the mock keeps emitting the existing color-picker flow, no new primitive needed. Recommended order 1→2→3.)

## Scope

**In:**
- Define the **`AgentProvider` port** in `packages/daemon` — an async producer: given user input + session state, produce outbound envelopes. **Auth is a property of the adapter** (the port knows nothing about credentials).
- **`ProviderKind` discriminated union** (`raw-api` | `agent-harness`). Only the `raw-api` shape is exercised now; the union *anticipates* `agent-harness` (Claude Agent SDK / opencode / codex own their tool loop) but does NOT implement it.
- **`llm-injector`** — registry/selector: register providers, select the active one by config (e.g. `LLM_PROVIDER` env). Dispatch over `ProviderKind`.
- Refactor the existing **mock-agent to sit behind the port** as the `mock` provider. Behaviour stays the **same** (color-picker flow) — a behaviour-preserving refactor that introduces the seam.
- **Memory-ready session state:** session state holds a `messages[]` array (single-turn will put 1 in it later). No multi-turn lifecycle yet.

**Out:**
- Any real LLM call (Chunk 3) — mock only.
- The `show_text` primitive (Chunk 1) and overlay rendering (Chunk 3).
- The `agent-harness` adapter (subscription provider = #2, later).
- Multi-turn lifecycle / context-window mgmt / durable persistence (gotchas #29/#30 — deferred).

## Done criteria

- [ ] `AgentProvider` port defined; auth internal to the adapter.
- [ ] `llm-injector` selects the active provider by config; dispatches over `ProviderKind`.
- [ ] The existing mock works **behind the port** — the v0 color-picker flow is **behaviorally unchanged** (same envelopes, same tests).
- [ ] Session state holds `messages[]` (memory-ready), single-turn-shaped.
- [ ] Existing daemon tests green (behaviour unchanged); new tests cover the injector (selects by config) + the port contract.
- [ ] `git diff packages/protocol` is **empty** (daemon-only; contract untouched).

## Orchestrator brief (ready to copy)

```
implement the pluggable LLM provider abstraction in packages/daemon, per orchestration/docs/specs/2026-06-02-llm-text-slice.md (§3 ②, §4, §11 ADR-B). Behaviour-preserving refactor: introduce the seam, keep the mock's color-picker flow unchanged.

Files to touch:
- packages/daemon (AgentProvider port; ProviderKind union; llm-injector registry/selector; wrap mock-agent as the `mock` provider; memory-ready session state messages[]; route session_start through injector→provider; tests)

Constraints:
- Auth is a property of the adapter (port knows no credentials).
- raw-api shape only now; union anticipates agent-harness (do NOT build it).
- Mock behaviour UNCHANGED (color-picker). Refactor + seam, not a behaviour change.
- git diff packages/protocol MUST stay empty (contract untouched).

Done when:
- port + injector + mock-behind-port + memory-ready state land; existing daemon tests green (color-picker unchanged); injector + port tests added; protocol diff empty.

ADRs in scope: ADR-B (pluggable LLM provider abstraction). Flag `## ADR worthy: yes` → adr-curator. ADR-B RESOLVES open-question Q1 (LLM provider strategy) — escalate Q1 open-question → ADR (move/strike in open-questions.md).
Out of scope: real LLM, show_text, overlay, agent-harness adapter, multi-turn.
```

## Notes / Open questions

- **Resolves open-question Q1** (LLM provider strategy, "decide before Phase 3"): ADR-B IS that decision. Architect/curator must escalate Q1 → ADR (project governance: open-question → decided ADR).
- **Memory seam is NOT the hard part:** holding `messages[]` is trivial; the hard parts (context compaction #29, session memory footprint #30, durable persistence) stay deferred — do NOT solve them here.
- Reference patterns (verify, don't copy): Vercel AI SDK registry; t3code `ProviderKind` union; opencode (spec §4, §10).
