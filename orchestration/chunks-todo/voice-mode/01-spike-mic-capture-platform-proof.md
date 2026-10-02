# Chunk 1: SPIKE — mic capture platform proof (unfocused Tauri window + TCC + Released-state hotkey)

**Status:** todo
**Created:** 2026-08-06
**Phase:** route part 3 (voice-mode)
**Estimated size:** ~0.5 day
**Depends on:** none

> ⚠️ **Build gate:** the spec of record (`orchestration/docs/specs/2026-07-28-voice-mode.md`) is
> `status: draft — PLANNING, do-not-build`. No chunk in this folder goes to the conveyor until Lior
> flips the spec to `accepted` (PIPELINE §5.2 spec sign-off).

## Scope

**In:**
- A throwaway spike (no product code lands; evidence + verdict land) that settles four load-bearing
  platform assumptions the whole cut rests on:
  1. **`getUserMedia` audio capture works in a Tauri WKWebView window that is shown WITHOUT
     `set_focus()`** (spec D8 focus rail). Today's only show-path calls `set_focus()`
     (`apps/overlay/src-tauri/src/lib.rs:91`); nobody has ever captured mic audio from this app at all
     (voice is 0% built — spec §Code state).
  2. **The macOS TCC mic-permission prompt appears and is answerable** when capture is first triggered
     from a never-activated overlay window — and capture works after grant. (O7 specifies the *flow*
     later; this asks "can it work at all", which is a different question.)
  3. **`tauri-plugin-global-shortcut` delivers `ShortcutState::Released`** reliably for the `hold`
     gesture (the current handler reacts only to `Pressed`, `lib.rs:88`), and a second registered
     accelerator does not interfere with the existing text hotkey.
  4. **The captured audio container/codec (MediaRecorder default, likely webm/opus) is accepted by the
     Whisper API** — or a re-encode step is needed (which would change chunk 02/03 shape).
  5. **Key-event delivery to the unfocused overlay** (spec-critic B1): D1's "`Esc` cancels" requires a
     `keydown` to reach a window that D8 forbids focusing. Add a `document.addEventListener("keydown")`
     probe to the A1 window while ANOTHER app is frontmost. If keydowns do NOT arrive, `Esc`-cancel has
     no channel as designed → **STOP: escalate per §5.2** (D1 is a firm Decided; candidate fixes —
     global-shortcut Esc registration or focusing the overlay — each amend a firm rail and are Lior's
     call, not chunk-level).
- Also answer: **which window hosts capture** (`main` vs `widget`) — the media stream and the indicator
  render can live in different windows; the spike names the workable host.
- Record the verdict (PASS/FAIL per assumption + evidence: commands run, observed behavior, macOS
  version) in this file under Notes and in the conveyor ledger.

**Out:** (each states WHY — PIPELINE §7.2)
- Any product wiring, any UI, any daemon change — OUT because a spike is evidence-gathering; product
  code starts at chunk 02/03 only after the platform verdict exists (the `transformers.js`-on-Bun scar:
  gotcha #46 / 2d q#018 — a load-bearing platform claim gets a spike BEFORE chunks build on it).
- The full TCC/permission-denied UX (spec O7) — OUT because it is a carried Open; this spike only
  proves feasibility.
- Local STT (O3) — OUT per spec ruling; needs its own spike when its lane opens.

## Done criteria

- [ ] **[behavioral]** A demo recording (or reproducible run) shows audio captured from a Tauri window
  that was shown without `set_focus()`, on macOS, including the first-run TCC prompt outcome.
- [ ] **[behavioral]** `ShortcutState::Released` events observed for a second accelerator while the
  existing text hotkey still works.
- [ ] **[mechanical]** A captured audio sample was accepted by the Whisper API (HTTP 200 + plausible
  transcript) OR the required re-encode step is named with evidence.
- [ ] **[behavioral]** `keydown` events observed (or not) in the unfocused overlay window while another
  app is frontmost (A5) — with the TCC/plist observation recorded for BOTH dev and a packaged build
  (spec-critic m2: `tauri.conf.json` has no `infoPlist` usage string today; note whether the prompt
  appears without one, dev vs bundled).
- [ ] **[mechanical]** Verdict + evidence recorded in this file's Notes and the ledger; spike code NOT
  merged to `main` (throwaway branch or deleted).
- [ ] **[mechanical]** If assumption 1 OR 5 FAILS → STOP: escalate per §5.2 (D8's focus rail and D1's
  Esc-cancel are firm decisions; a failure re-shapes the design and is not absorbable at chunk level).

## Orchestrator brief (read by the orchestrator from this file)

```
Run a throwaway spike proving the voice-mode platform assumptions per
orchestration/docs/specs/2026-07-28-voice-mode.md D8 + §Code state.

Do:
- Branch a scratch Tauri window path (or temporarily instrument apps/overlay) that: registers a second
  global shortcut, logs Pressed/Released, shows a window WITHOUT set_focus(), runs
  navigator.mediaDevices.getUserMedia({audio:true}) + MediaRecorder for ~3s, and dumps the blob's
  mime/type + size to console.
- Trigger from another app focused (the real use-case: user is elsewhere, presses the hotkey).
- First run must exercise the TCC prompt (reset with `tccutil reset Microphone` if needed).
- POST the captured blob to the Whisper API once (any throwaway key handling — spike only, key NEVER
  committed) to verify container acceptance.
- Record PASS/FAIL + evidence per assumption in this chunk file + ledger. Delete/abandon the spike code.

Done when: all four assumptions have a recorded verdict with evidence; failure of assumption 1
escalated, not worked around.

ADRs in scope: 0006 (hotkey/window model — read-only), 0007 (cloud STT). Frozen: @agentic/protocol
untouched (nothing here goes near it).
```

## Notes / Open questions

- Verdict slots (fill at spike time): A1 unfocused-capture: — · A2 TCC: — · A3 Released-state: — ·
  A4 codec-accepted: — · A5 keydown-to-unfocused: — · capture-host window: — · plist/dev-vs-bundled: —.
- If MediaRecorder's default container is rejected by Whisper, the known-cheap fallback is
  re-encoding to WAV in the webview (AudioBuffer → PCM) — evidence, not adoption, is this chunk's job.
