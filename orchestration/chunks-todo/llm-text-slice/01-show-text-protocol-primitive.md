# Chunk 1: `show_text` display-only protocol primitive

**Status:** in-progress
**Created:** 2026-06-02
**Phase:** llm-text-slice (first post-v0 vertical slice)
**Estimated size:** ~0.5 day
**Depends on:** none (parallelizable with Chunk 2 — disjoint files: protocol vs daemon; recommended order 1→2→3)

## Scope

**In:**
- Add a `text` UI primitive to `packages/protocol`: a `tool_call` with payload `{ tool: "show_text", args: { content: string } }`.
- **Display-only:** `show_text` expects **no `tool_result`** (unlike `show_color_picker`). Encode the display-only-vs-interactive distinction in the contract (discriminator or documented convention the daemon reads).
- Zod schema `ShowTextArgs = { content: string }` (mirror `ShowColorPickerArgs`), self-validated.
- Tests for the new variant + schema.

**Out:**
- Daemon integration / session handling (Chunk 2/3), overlay rendering (Chunk 3), any LLM (Chunk 3).
- The other Phase-2 primitives (button/input/image) and the **full primitive list + versioning policy** — that is open-question **Q2** and is OUT; this chunk adds ONLY `text`.

## Done criteria

- [ ] `show_text` is part of the envelope union — **6 → 7 variants, additive** (existing 6 byte-unchanged).
  > 📝 RECONCILIATION 2026-06-02 (orchestrator, Lior-approved at grilling gate): architect reality-check found `show_color_picker` lives in the **tool** sub-union `ToolCallPayload` (currently 1 variant), **not** the 6-variant `Envelope` union. The literal "envelope 6→7" is unmeetable without corrupting the wire contract. **Corrected acceptance:** the `ToolCallPayload` tool union grows **1 → 2** additively (existing `show_color_picker` byte-unchanged); the `Envelope` union stays **6** and `envelope.ts` is byte-unchanged (the existing "exactly 6" witness test stays green). Original intent (additive; existing variants byte-unchanged) is fully preserved — only the union label/count was wrong.
- [ ] `ShowTextArgs` validates `{ content: string }` and rejects malformed input.
- [ ] The display-only marker/convention is in the contract so a consumer can tell `show_text` (no result) from `show_color_picker` (awaits result).
- [ ] Existing protocol tests green; new tests cover `show_text`.
- [ ] `git diff` touches **only `packages/protocol`**.
  > 📝 RECONCILIATION 2026-06-02 (orchestrator, Lior-approved after reviewer-gate CRITICAL): additive union-widening of `ToolCallPayload` (1→2) has an unavoidable **type-level blast radius** into existing v0 consumers — `apps/overlay/src/ws/tool-call-handler.ts` and `packages/daemon/src/mock-agent.test.ts` read `.args.picker` without discriminating on `payload.tool`, so the root `typecheck` + `lint:strict` gates go red. This is the §7.1 scar (wire-additive ≠ type-additive); the decompose "disjoint files" reality-check missed the shared `ToolCallPayload` **type** contract. **Corrected scope:** the consumer-narrowing fix (add a `payload.tool === "show_color_picker"` discriminant in those 2 files) is IN-scope for this chunk so the workspace stays green. Diff is therefore `packages/protocol` **+ those two consumer files only** — no other expansion. v0 behavior unchanged (no `show_text` handling added to consumers — that's Chunk 2/3).

## Orchestrator brief (ready to copy)

```
implement the `show_text` display-only UI primitive in packages/protocol, per orchestration/docs/specs/2026-06-02-llm-text-slice.md (§3 ①, §11 ADR-A).

This is the first of roadmap Phase-2's 5 primitives (text/button/input/color-picker/image, open-question Q2) — add ONLY `text`; do NOT settle the full primitive list or versioning (Q2 stays open).

Files to touch:
- packages/protocol (envelope union + ShowTextArgs zod schema + tests)

Behaviour:
- tool_call{ payload: { tool: "show_text", args: { content: string } } }, display-only (NO tool_result expected). Introduce the display-only-vs-interactive distinction in the contract.

Done when:
- envelope union 6 → 7 (additive, existing variants byte-unchanged); ShowTextArgs validates/rejects; display-only marker present; existing tests green + new show_text tests; diff only in packages/protocol.

ADRs in scope: ADR-A (text display-only primitive — extends ADR-0005 closed-set + ADR-0002 UI-as-tool-calls). Flag `## ADR worthy: yes` → adr-curator.
Out of scope: daemon, overlay, LLM, other primitives, Q2 list/versioning.
```

## Notes / Open questions

- **Scope-guard (Q2):** adding `text` must NOT be read as deciding the full primitive set or versioning — open-question Q2 stays open.
- Display-only is a NEW contract concept; future `image` reuses it — keep the distinction clean/general.
