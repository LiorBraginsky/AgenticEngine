# Chunk 02b-i: Tauri overlay shell + global hotkey + WS transport

**Status:** done
**Completed:** 2026-05-31 — implementation review-CLEAN (2 rounds; round-1 caught CRITICAL 02a baseline-drift → cancel-to-complete fix, MAJOR socket leak; round-2 clean, both NITs folded). 45/45 tests, typecheck×2 + lint:strict green, contract+daemon diff empty (spike reverted). **Native macOS re-run by Lior: dev + prod BOTH ✓** — hotkey ⌘⇧Space → transparent overlay → text → `session <uuid> — cancelled` (full loop start→ack→tool_call→auto-cancel→end, no widget), Esc cancels, double-Enter guarded. Prod over `tauri://localhost` (Branch A). FromStr risk did not materialize (compiled clean).
**Created:** 2026-05-30
**Phase:** Walking Skeleton v0 (pre-Phase-1/2 vertical slice)
**Estimated size:** ~1 day
**Depends on:** 01 (frozen protocol contract)
**Parallelism:** runs in parallel with 02a (both depend only on 01). First chunk of the FRONTEND track.

## Scope

**In:**
- **Tauri scaffold (Tauri v2)**: frameless transparent window (ADR-0006 overlay).
- **Global hotkey registration**: tap-to-open centered input panel (Spotlight-style; ADR-0006 tap-hotkey).
- **Input panel UI**: centered, accepts typed text, Enter to submit, closes after submit.
- **WS client** connecting to the daemon (`127.0.0.1:7777`), sending the correct `Origin` so it passes chunk 01's origin-allowlist.
- **Prove transport**: echo round-trip against the frozen contract — hotkey → panel → type → submit → message to daemon → validated → response back. **NO widget rendering yet.**

**Out:**
- No `color-picker` / widget rendering (that is chunk 02b-ii).
- No hold-to-talk voice (Phase 4) — tap-hotkey only.
- No web admin tab (separate later chunk). No coupling to 02a.

## Done criteria

- [ ] Tauri app launches a frameless transparent window; the macOS accessibility/permissions path for the global hotkey works (document the manual permission step).
- [ ] Global tap-hotkey opens the centered input panel; the panel captures text and closes on submit (ADR-0006).
- [ ] WS client connects to the daemon and passes the origin-allowlist; messages validate against the frozen `packages/protocol`.
- [ ] **Echo round-trip proven**: submit text → message reaches daemon → validated response returns to the client. Transport works **without any widget**.
- [ ] The legitimate Tauri origin is **not** blocked by chunk 01's allowlist; a disallowed origin still is.

## Orchestrator brief (ready to copy)

```
implement the Tauri overlay shell + global hotkey + WS transport (echo round-trip, NO widget) for Walking Skeleton v0, per orchestration/docs/roadmap.md ("Walking Skeleton v0") and ADR-0006.

Depends on chunk 01 (frozen protocol + daemon with origin-allowlist). Code ONLY against packages/protocol. Runs in parallel with chunk 02a. This is the FRONTEND track's first chunk -- transport-first de-risk: prove the riskiest parts (Tauri scaffold, global hotkey, transparent window, macOS permissions, WS client) BEFORE any renderer work in 02b-ii.

Files to touch (greenfield Tauri app):
- apps/overlay/src-tauri/: Tauri v2 config, Rust shell (frameless transparent window, global hotkey registration)
- apps/overlay/src/: web renderer -- centered input panel UI, WS client

Behaviour:
- Global tap-hotkey (configurable; ADR-0006) opens a centered Spotlight-style input panel. Type, Enter submits, panel closes.
- WS client connects to 127.0.0.1:7777 with the correct Origin so it passes chunk 01's origin-allowlist.
- Echo round-trip: submitted text -> daemon -> validated against the frozen contract -> response back to client. NO widget rendering in this chunk.

Done when:
- Tauri app shows a frameless transparent window; global hotkey opens the input panel (document the macOS accessibility-permission step).
- Input panel captures text and closes on submit.
- WS client connects, passes the origin-allowlist, and round-trips an echo message validated against packages/protocol.
- The legitimate Tauri origin is NOT rejected by the allowlist; a disallowed origin still is.

Out of scope: color-picker / any widget rendering (chunk 02b-ii), hold-to-talk voice (Phase 4), web admin tab, coupling to chunk 02a.

Confirm the Tauri v2 webview Origin value and the global-hotkey + transparent-window APIs against Tauri docs (use context7).

ADRs in scope: 0003 (WS client / loopback / origin), 0004 (TS/Tauri rationale), 0006 (hotkey + overlay UX).
```

## Notes / Open questions

- **Transport-first de-risk** (Lior, decompose session): this chunk isolates the riskiest moving parts (Tauri scaffold, global hotkey, transparent window, macOS permissions, WS client) and proves the transport via echo round-trip **before** any renderer work. ADR-boundary alignment: 02b-i ↔ ADR-0006 (shell/hotkey/UX), 02b-ii ↔ ADR-0005 (UI contract/primitive).
- **Hold-to-talk voice deferred to Phase 4** — only the tap-hotkey is in scope.
- **macOS accessibility permission** is a known install-friction point (ADR-0006). For the skeleton, document the manual grant step rather than building an onboarding flow.
