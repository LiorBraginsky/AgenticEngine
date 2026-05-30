# Chunk 02b-ii: color-picker primitive renderer + selection/cancel round-trip

**Status:** todo
**Created:** 2026-05-30
**Phase:** Walking Skeleton v0 (pre-Phase-1/2 vertical slice)
**Estimated size:** ~1 day
**Depends on:** 02b-i (Tauri shell + WS transport)
**Parallelism:** sequential after 02b-i (same frontend chat). Parallelism with 02a is preserved.

## Scope

**In:**
- Implement the **`color-picker` primitive renderer** (ADR-0005 closed-set; the **only** primitive in the skeleton, per Q2) in the Tauri webview, rendered in the **top-right ephemeral widget zone** (ADR-0006).
- On receiving a `tool_call(show_color_picker, {question, palette})` from the frozen contract → render the picker widget.
- On user click → emit `tool_result {picked}` (validated against the contract).
- On close-without-pick → emit `tool_cancel {session_id}` (ephemeral-widget dismiss UX, ADR-0006).
- Verified against **MOCK `tool_call` data** shaped by the frozen contract — does **not** require chunk 02a or a live agent.
- Unknown-tool graceful fallback (per contract): a `tool_call` naming an unknown tool renders nothing/placeholder, does **not** throw.

**Out:**
- No other primitives (Q2 → only `color-picker`). No real agent (that is the join, chunk 03). No voice.

## Done criteria

- [ ] The `color-picker` renderer renders from a `tool_call(show_color_picker)` shaped by the frozen contract (mock-driven; no daemon agent needed).
- [ ] Widget appears in the **top-right ephemeral zone** (ADR-0006).
- [ ] User click → emits a valid `tool_result {picked}` (validates against the contract).
- [ ] Close-without-pick → emits a valid `tool_cancel {session_id}` (gotcha #2 path).
- [ ] Unknown tool in a `tool_call` → graceful fallback, no throw (forward-compat from the contract).

## Orchestrator brief (ready to copy)

```
implement the color-picker primitive renderer (+ selection and cancel round-trip) for Walking Skeleton v0, per orchestration/docs/roadmap.md ("Walking Skeleton v0") and ADR-0005 / ADR-0006.

Depends on chunk 02b-i (Tauri shell + WS transport). Sequential after it, same frontend chat. Code ONLY against packages/protocol; verify with MOCK tool_call data -- do NOT require chunk 02a or a live agent. Parallelism with 02a is preserved.

Files to touch:
- apps/overlay/src/: color-picker primitive renderer component + widget container (top-right ephemeral zone), wired to the existing WS client from 02b-i

Behaviour:
- On tool_call show_color_picker {question, palette} (from the frozen contract) -> render the picker widget in the top-right ephemeral zone (ADR-0006).
- On user click -> emit tool_result {picked} (validated against the contract).
- On close-without-pick -> emit tool_cancel {session_id}. This ephemeral-dismiss path is a defining skeleton UX (ADR-0006) and is exercised in the chunk 03 demo.
- On a tool_call naming an unknown tool -> graceful fallback (render nothing/placeholder), do NOT throw (forward-compat from the frozen contract).

Done when:
- Picker renders from a contract-shaped mock tool_call WITHOUT needing the daemon's agent.
- Click emits a valid tool_result {picked}; close emits a valid tool_cancel {session_id}.
- Unknown-tool tool_call is handled gracefully (no throw).
- Widget appears in the top-right ephemeral zone (ADR-0006).

Out of scope: any other primitive (Q2 -> only color-picker), the real agent loop (chunk 03 joins it), voice.

ADRs in scope: 0002 (UI tool resolve/cancel), 0005 (closed-set primitive / color-picker schema), 0006 (top-right ephemeral widget zone).
```

## Notes / Open questions

- **Only the `color-picker` primitive** is implemented (Q2 deferral — the full primitive list is post-skeleton).
- **Cancel path here + 02a's cancel handling together prove gotcha #2.** The known-gotchas doc update lands at chunk 03, when the full end-to-end cancel path is demonstrated.
- Mock-driven verification keeps this chunk truly independent of 02a — both sides only touch the frozen `packages/protocol`.
