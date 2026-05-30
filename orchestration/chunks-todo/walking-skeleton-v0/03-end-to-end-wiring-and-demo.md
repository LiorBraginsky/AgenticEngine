# Chunk 03: End-to-end wiring + Definition-of-done demo

**Status:** todo
**Created:** 2026-05-30
**Phase:** Walking Skeleton v0 (pre-Phase-1/2 vertical slice)
**Estimated size:** ~1 day
**Depends on:** 02a (mock agent loop) AND 02b-ii (color-picker renderer)

## Scope

**In:**
- Wire the **real path end-to-end**: global hotkey → input panel → submit → daemon mock agent loop → `tool_call(show_color_picker)` → Tauri renders the picker → user picks → `tool_result` → mock agent emits final text → **visible result in the overlay**.
- Demonstrate **both** terminations:
  - **resolve** — user picks → fun-fact result;
  - **cancel** — user closes picker without picking → session ends gracefully (ephemeral-widget UX).
- Satisfy the roadmap Walking Skeleton **Definition of done** (roadmap line 60).
- On completion: known-gotcha #2 (cancellation) → resolved in v0; the worker updates `orchestration/docs/known-gotchas.md` accordingly (doc edit during execution).

**Out:**
- No new protocol changes. If anything is missing → **stop-the-line** on chunk 01's contract (pause, update atomically, resume); do **not** patch ad hoc here.
- No real LLM (Phase 3), voice (Phase 4), or web admin tab (later chunk).

## Done criteria

- [ ] Full happy path works on **real macOS**: hotkey → type "pick a color" → picker widget appears in the overlay → click a color → result text ("you picked X, fun fact: …") appears. (= roadmap line 60.)
- [ ] Cancel path works: open picker → close without picking → session ends gracefully (no orphaned/leaked session, no crash).
- [ ] All traffic flows over the **real WS protocol** against the frozen contract — no shortcuts bypassing the protocol.
- [ ] No ad-hoc contract change was made; if a gap surfaced, it was handled as a stop-the-line update to chunk 01's module.
- [ ] Worker updates `known-gotchas.md`: #2 (cancellation) → resolved in skeleton v0.

## Orchestrator brief (ready to copy)

```
implement the end-to-end wiring + Definition-of-done demo for Walking Skeleton v0, per orchestration/docs/roadmap.md ("Walking Skeleton v0", Definition of done).

Depends on chunk 02a (mock agent loop) AND chunk 02b-ii (color-picker renderer). This is the JOIN chunk. Both sides already code against the same frozen packages/protocol, so this should be wiring + verification, not new design. If anything in the contract turns out missing, treat it as a STOP-THE-LINE update to chunk 01's protocol module (pause, update contract atomically, resume) -- do NOT patch the protocol ad hoc here.

Files to touch:
- wiring/config across apps/overlay and packages/daemon so the live path connects end-to-end; a manual verification checklist/script

Behaviour (real WS protocol, no shortcuts):
- Global hotkey -> input panel -> submit -> daemon mock agent -> tool_call show_color_picker -> overlay renders picker -> user picks -> tool_result -> mock agent emits final text -> result visible in overlay.
- Cancel path: open picker -> close without picking -> tool_cancel -> session ends gracefully.

Done when:
- On real macOS: press hotkey, type "pick a color", a real color-picker widget appears in a native overlay, click a color, the overlay shows "you picked X, fun fact: ..." -- all driven by the mock agent loop over the real WS protocol. (= roadmap Definition of done, line 60.)
- Cancel path verified: closing the picker without picking ends the session gracefully (no orphaned/leaked session, no crash).
- All traffic flows over the real protocol against the frozen contract; nothing bypasses it.
- No ad-hoc contract change was made (any contract gap -> stop-the-line on chunk 01).
- known-gotchas.md updated: #2 (cancellation) -> resolved in skeleton v0.

Out of scope: real LLM (Phase 3), voice (Phase 4), web admin tab (later chunk), any new primitive.

ADRs in scope: 0001 (session lifecycle / orphaned-session handling), 0002 (UI tool resolve/cancel end-to-end), 0003 (WS transport), 0005 (primitive render), 0006 (overlay UX: input center, widget top-right).
```

## Notes / Open questions

- **This chunk proves the product's unique claim** (text-in → widget-out, end-to-end on real macOS) — the exact thing a CLI-only test could not validate, which is why the walking-skeleton approach was chosen over building the backend in isolation (roadmap).
- **gotcha #2 resolution is documented here**, once the full cancel path is demonstrated end-to-end.
- **A missing protocol field discovered at the join is the designed stop-the-line signal** — it means the frozen contract genuinely needed it, handled atomically on chunk 01 rather than papered over in the wiring.
