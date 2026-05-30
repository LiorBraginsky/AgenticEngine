# Chunk 02a: Mock agent loop (CLI-verified)

**Status:** done
**Completed:** 2026-05-30 — implementation review-CLEAN (0 critical/major). 39/39 tests green, typecheck + lint:strict clean (independently re-verified by Jimmy). Decision: Option A (final text computed + asserted + logged, NOT a wire message — contract has no text envelope; FU-1 tracked to revise v0 DoD in chunk 03). Contract untouched. Pure reducer `advanceMockAgent` + daemon session-state Map.
**Created:** 2026-05-30
**Phase:** Walking Skeleton v0 (pre-Phase-1/2 vertical slice)
**Estimated size:** ~1 day
**Depends on:** 01 (frozen protocol contract)
**Parallelism:** runs in parallel with 02b-i (both depend only on 01)

## Scope

**In:**
- A hard-coded **mock reasoning loop** in the daemon (no real LLM):
  - On `session_start` → emit `tool_call` for `show_color_picker` with `{question, palette}` (validated against the frozen registry).
  - On `tool_result {picked}` → emit a final text result `"you picked <X>, fun fact: ..."`, then `session_end`.
  - On `tool_cancel` → end the loop **gracefully** (close session, no crash).
- The mock **ignores the user's typed text** — it always takes the hard-coded "find a color" path. Intentional skeleton scope; document it.
- Verified via a **CLI test harness** (Phase 1 Definition-of-done style) — **NO UI**. The harness drives `session_start`, responds with a mock `tool_result` (and separately a `tool_cancel`), and asserts the loop's emitted messages.

**Out:**
- No UI / Tauri (chunks 02b-*). No real LLM (Phase 3). No streaming. No MCP / backend tools.
- Does **not** code against the frontend — only against the frozen `packages/protocol`.

## Done criteria

- [ ] On `session_start`, daemon emits a valid `tool_call` for `show_color_picker` (args validate against the contract).
- [ ] On receiving `tool_result {picked}`, emits final text incorporating the pick, then `session_end`.
- [ ] On receiving `tool_cancel`, the loop ends gracefully (session closes, no error thrown).
- [ ] All emitted/received messages validate against the frozen contract; a malformed `tool_result` is rejected with a typed error (gotcha #9), not a crash.
- [ ] CLI harness runs end-to-end **without any UI** and asserts **both** the resolve path and the cancel path. (Satisfies Phase 1 Definition of done.)

## Orchestrator brief (ready to copy)

```
implement the mock agent loop (CLI-verified, no UI) for Walking Skeleton v0, per orchestration/docs/roadmap.md ("Walking Skeleton v0" + Phase 1 "Mock LLM loop" / "CLI test harness").

Depends on chunk 01 (frozen protocol contract). Code ONLY against packages/protocol -- do NOT couple to the frontend (chunk 02b). This runs in parallel with chunk 02b-i.

Files to touch:
- packages/daemon/src/: the mock reasoning loop (e.g. mock-agent.ts) wired into the session lifecycle
- a CLI test harness script (no UI) for protocol verification

Behaviour (hard-coded, no real LLM):
- On session_start -> emit tool_call show_color_picker with {question, palette} (validated against the frozen registry).
- On tool_result {picked} -> emit final text "you picked <X>, fun fact: ..." then session_end.
- On tool_cancel -> end the loop gracefully (close session, no crash).
- The mock IGNORES the user's typed text -- it always takes the hard-coded "find a color" path. This is intentional skeleton scope; document it.

Done when:
- CLI harness drives session_start and observes a valid show_color_picker tool_call.
- Harness sends a mock tool_result {picked} -> observes correct final text + session_end.
- Harness sends tool_cancel -> loop ends gracefully.
- All messages validate against the frozen contract; a malformed tool_result is rejected with a typed error (gotcha #9), not a crash.
- Entire flow verified with NO UI (satisfies Phase 1 Definition of done).

Out of scope: real LLM, streaming, MCP, any UI, any coupling to chunk 02b.

ADRs in scope: 0001 (sessions / multi-step loop), 0002 (UI as tool calls -- async resolve/cancel semantics), 0004 (Bun/TS).
```

## Notes / Open questions

- **`tool_cancel` is exercised here** (the "close without picking" termination) and again in chunk 03's demo. gotcha #2 (cancellation) is proven resolved once chunk 03 demonstrates the full path; the known-gotchas doc update lands at chunk 03.
- **Mock ignores input by design** — the typed text is captured by the frontend (02b-i) to prove transport, but the agent path is hard-coded. Real input-driven reasoning is Phase 3.
- Terminology: roadmap Phase 1 calls this "Mock LLM loop"; glossary term is "Reasoning Loop". Use "mock agent / mock reasoning loop" consistently.
