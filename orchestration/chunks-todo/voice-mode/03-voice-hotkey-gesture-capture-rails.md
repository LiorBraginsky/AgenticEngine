# Chunk 3: Voice hotkey 2 + gesture engine (hold/toggle) + capture + D8 guard-rails

**Status:** todo
**Created:** 2026-08-06
**Phase:** route part 3 (voice-mode)
**Estimated size:** ~1.5 days
**Depends on:** 01 (spike verdict gates the capture host + Released-state approach)

> ⚠️ **Build gate:** spec `2026-07-28-voice-mode.md` is `draft — do-not-build` until Lior flips it to
> `accepted` (§5.2).

## Scope

**In:**
- **Second global hotkey** (`voice.hotkey` config key; spec D1). Registered alongside the existing
  text hotkey in `apps/overlay/src-tauri/src/lib.rs` — the existing text-hotkey behavior (incl. its
  `set_focus()`) must not regress.
  - **Default accelerator = a chunk-level PROPOSAL** riding the already-owed ADR-0006 p.1 amendment
    (§5.2, Lior accepts — never self-accept). Ship the default as config-overridable, flag the pin in
    the PR body. (Precedent: the 2026-05-30 amendment pinned the text-hotkey default the same way.)
- **Gesture engine** (D1, config `voice.gesture`): `hold` (Pressed = start, Released = send) |
  `toggle` (tap = start, tap again = send). **`Esc` cancels in both modes** — records nothing, sends
  nothing. *Esc's delivery channel is GATED by spike A5 (spec-critic B1): a `keydown` cannot reach a
  window D8 forbids focusing unless the probe proves otherwise. Build to the spike's verdict; if the
  spike escalated, do not start this chunk until Lior rules the cancel channel.*
- **Audio capture** in the window the spike named, via `getUserMedia`/`MediaRecorder` (+ the re-encode
  step IF spike A4 mandated one). The overlay window is shown **WITHOUT `set_focus()`** (D8 focus
  rail — pressing the voice hotkey must never eject the user from their app).
- **D8 guard-rails** (numbers = defaults, all config keys):
  - `< voice.minDurationMs` (400) or below level threshold → **discard**, micro-status "nothing
    heard"; nothing reaches the agent or memory (input hygiene at the entrance to long-term memory —
    a junk turn would be distilled into a fact).
  - `voice.maxDurationMs` (60000) hard cap → auto-stop and **send** what was captured, status "limit
    reached" (never silently lose a minute of speech).
  - `voice.silenceStopMs` (2500) silence auto-stop → stop + send, **`toggle` mode only**. VAD =
    level-threshold silence detection via WebAudio `AnalyserNode` — interpretation of record: D8's
    "(VAD)" is satisfied by level-based detection; **no ML/native VAD dependency** (gotcha #46 class
    stays out of this cut).
- **`voice.enabled` — the gate has ONE owner: the RUST hotkey handler** (spec-critic B3 resolution).
  The mute check short-circuits IN `lib.rs` BEFORE the window is shown or any event reaches the
  webview — so a muted press neither pops the overlay nor risks opening the mic. The state is a
  Rust-side runtime flag (e.g. `AtomicBool` in managed state), initialized from the config key; the
  tray toggle that flips it arrives in chunk 06 and toggles THIS state — it does not build a second
  gate. The TS gesture engine may mirror the flag for UI purposes but is NOT the enforcement point.
- Gesture/rails core implemented as a **pure TS state machine module** (unit-testable), with the
  Tauri/WebAudio edges thin around it.
- Config plumbing (R1): `voice.hotkey`, `voice.gesture`, `voice.enabled`, `voice.minDurationMs`,
  `voice.maxDurationMs`, `voice.silenceStopMs`, `voice.inputDevice` (system default | specific mic).

**Out:** (WHY per §7.2)
- The indicator UI (waves/pulse) and its placement — chunk 04, because it is a widget-render surface
  concern; this chunk emits recorder **state events** the indicator subscribes to.
- Sending the transcript / landing the turn / busy behavior — chunk 05, because turn-routing owns the
  `canAcceptTurn` seam. **⚠️ §7.1 boundary: the recorder must NOT consult `inFlight`** — recording
  proceeds even while the agent is busy (D11: recording is never refused); the ONLY consumer of busy
  state is the landing router (chunk 05). Coupling recorder→inFlight here would recreate the Theme-A
  "two detectors of one state" defect class.
- The upload to `/voice/transcribe` — chunk 05 wires capture→upload→landing end-to-end (this chunk
  ends at "a captured, rail-guarded audio blob + state events exist").
- Follow-up mic window — OUT per spec O1 (opt-in later; needs an ADR-0007 amendment if ever enabled).
- Wake word / TTS — OUT per ADR-0007 (stands unamended).
- Hotkey rebinding UI — OUT per R1 (settings cut); the key is env/constant-overridable only.

## Done criteria

- [ ] **[mechanical]** Pure state-machine unit tests: hold happy-path, toggle happy-path, Esc-cancel
  (both modes), min-duration discard, hard-cap stop+send, silence-stop only-in-toggle,
  `voice.enabled=false` → hotkey inert.
- [ ] **[mechanical]** `lint:strict` + typecheck + full `bun test` green; `@agentic/protocol`
  byte-unchanged.
- [ ] **[behavioral]** On macOS: voice hotkey pressed while ANOTHER app is focused → overlay appears
  WITHOUT stealing focus (user keeps typing in their app); text hotkey still focuses as before.
- [ ] **[behavioral]** Hold: speak while holding, release → recorder yields a bounded audio blob.
  Toggle: tap-speak-tap; silence auto-stop fires after ~2.5 s quiet.
- [ ] **[behavioral]** A real recording crossing the 60 s hard cap auto-stops and SENDS what was
  captured, with the "limit reached" status (spec-critic re-tag: "never silently lose a minute of
  speech" is a real-recording claim — the state-machine unit test alone does not prove it).
- [ ] **[behavioral]** A 0.2 s accidental tap produces NO blob, a "nothing heard" micro-status, and
  (verifiable at chunk 05/06 demo) no turn and no fact.
- [ ] **[behavioral]** `Esc` mid-record cancels with nothing sent.

## Orchestrator brief (read by the orchestrator from this file)

```
Implement voice hotkey 2 + gesture engine + capture rails per
orchestration/docs/specs/2026-07-28-voice-mode.md D1/D8 and the chunk-01 spike verdict (read its
Notes first — capture host + Released-state + codec are decided there).

Files to touch:
- apps/overlay/src-tauri/src/lib.rs: register second shortcut (voice.hotkey), handle
  Pressed+Released, voice show-path WITHOUT set_focus(), Rust-owned voice.enabled gate
  (short-circuit BEFORE show/emit); keep text-hotkey path byte-equivalent
- apps/overlay/src-tauri/tauri.conf.json: macOS `infoPlist` mic usage string
  (NSMicrophoneUsageDescription) + audio-input entitlement if the bundled build needs it —
  per the chunk-01 spike's plist/dev-vs-bundled observation (spec-critic m2: nobody owned this)
- apps/overlay/src/voice/ (new): recorder state machine (pure TS) + capture adapter
  (getUserMedia/MediaRecorder/AnalyserNode) + config constants (voice.* keys, env-pattern)
- tests: state-machine unit tests (pure module — no Tauri/browser mocking needed for the core)

Done when:
- All mechanical criteria pass; behavioral criteria demoable (they gate at the §6.1 demo, chunk 06)
- Recorder emits state events (idle → listening → captured(blob) | discarded | cancelled) that
  chunk 04 subscribes to; it does NOT import inFlight or connection state

ADRs in scope: 0006 (second hotkey; default-pin flagged for the owed p.1 amendment — do NOT
self-accept), 0007 (push-to-talk shape). Frozen: @agentic/protocol.
```

## Notes / Open questions

- **§5.2 flag (carried, not decided here):** ADR-0007's stated positive "mic never on unless user
  explicitly **holds** the key" is **narrowed** by `toggle` — the wording note is owed at build time
  with the mitigations named (visible indicator + silence auto-stop + hard cap + tray mute). This is
  the **privacy-adjacent, hard-to-reverse tier** of §5.2 Finding #5 — no async-acceptance shortcut.
  Chunk 06 (tray mute) completes the named mitigation set; the amendment itself is Lior's.
- ADR-0006 p.1's "No visual panel needed" is also amended-in-practice by the indicator (chunk 04) —
  both p.1 notes are already spec-recorded as owed (§Amendments owed); flag in PR bodies, never
  self-accept.
- `voice.inputDevice` beyond "system default" may be UI-less in this cut (env value naming a device) —
  acceptable; the settings cut owns the picker.
