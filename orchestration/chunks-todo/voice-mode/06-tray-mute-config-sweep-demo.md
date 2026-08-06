# Chunk 6: Tray mute-mic + D14 config sweep + §6.1 demo assembly

**Status:** todo
**Created:** 2026-08-06
**Phase:** route part 3 (voice-mode)
**Estimated size:** ~0.5–1 day
**Depends on:** 03 (the `voice.enabled` gate it flips), 05 (the demo needs the full path)

> ⚠️ **Build gate:** spec `2026-07-28-voice-mode.md` is `draft — do-not-build` until Lior flips it to
> `accepted` (§5.2).

## Scope

**In:**
- **Tray "Mute mic" toggle** (brief-of-record R3 — rides with VOICE, not settings, because it is
  LOAD-BEARING: the owed ADR-0007 wording note justifies the `toggle`-gesture privacy narrowing with
  a named mitigation set — visible indicator + silence auto-stop + hard cap + **tray mute**; shipping
  `toggle` without tray-mute leaves that amendment's own justification incomplete). Mechanically: a
  checkable tray menu item (`apps/overlay/src-tauri/src/lib.rs` tray builder, additive next to "Open
  Memory…") toggling the **Rust-owned** `voice.enabled` runtime state that chunk 03 built INTO the
  hotkey handler (spec-critic B3 resolution: ONE owner, Rust-side, short-circuits before show/emit —
  this chunk adds the toggle; it does NOT build a second gate or move enforcement into TS).
  **Runtime = in-memory for this cut**: no settings store exists (config-surface-inventory §4 Q1);
  persistence of the toggle across restarts belongs to the settings cut — say so in a code comment.
- **D14 config sweep:** verify EVERY D14 key exists as env/constant plumbing per today's pattern
  (R1), including the slots that nothing reads yet: `stt.models.*` (model-manager slot, D12),
  `voice.output` (`widget-text` only value; the disabled "speak — coming soon" UI slot belongs to the
  settings cut), `voice.minimizeMs` (dormant until continuation). Reconcile against
  `config-surface-inventory.md` §2 (the 16 keys).
- **§6.1 demo script assembly:** collate the behavioral DoD items of chunks 02–05 + the spec's
  Behavioral DoD sketch into ONE ordered live-demo script for Lior (real mic, real STT, fresh-install
  key-entry via the chunk-02 keychain path). Include the spec-critic's behavioral-DoD list
  (PIPELINE §3.1 — it is an INPUT to the script, never evidence).
- Mute demo item: mute ON → hotkey inert (with a visible hint why, e.g. tray icon state) → mute OFF →
  voice works.

**Out:** (WHY per §7.2)
- Settings UI / settings store / persistence of the toggle — OUT per brief-of-record R1 (sibling
  decompose; no settings spec exists; building storage now would decompose on top of
  config-surface-inventory §4's unresolved ownership questions).
- Onboarding wizard — OUT per R2 (the cloud-vs-local fork does not exist in this cut; wizard = dead
  UI; arrives with the local lane / model manager).
- Pause-cron and other promised tray toggles — OUT because they are unrelated to voice (ADR-0006 p.4
  debt, tracked in config-surface-inventory Tier D).
- Marking any behavioral criterion done from this chunk's own runs — the §6.1 gate is LIOR's live
  demo; this chunk PREPARES it (PIPELINE §6.1; the recurring scar).

## Done criteria

- [ ] **[mechanical]** `lint:strict` + typecheck + `bun test` green; `@agentic/protocol`
  byte-unchanged. *(The toggle→gate flip itself crosses the tray→hotkey-handler boundary in Rust —
  spec-critic re-tag: it is proven by the behavioral line below, not by a TS unit test.)*
- [ ] **[mechanical]** D14 sweep table in the PR body: key → where it lives (file:line) → read-by
  (or "dormant slot — reader named").
- [ ] **[behavioral]** Tray shows the mute state; mute ON → voice hotkey does nothing; text hotkey
  unaffected; mute OFF → voice records.
- [ ] **[behavioral]** The FULL voice-mode demo script executes GREEN in Lior's live §6.1 demo
  (speak→waves→answer · in-widget follow-up same thread · typed mix · Esc cancel · 0.2 s tap = no
  turn no fact · toggle silence-stop · 60 s cap stops-and-SENDS · no focus steal · first-run TCC
  prompt on the PRODUCT build · busy → editable pending text · transcript in Memory thread-detail ·
  no audio on disk · tray mute ON = hotkey inert / OFF = records). This line is done ONLY at that
  demo.

## Orchestrator brief (read by the orchestrator from this file)

```
Ship the tray mute-mic toggle + close the D14 config sweep + assemble the §6.1 demo script per
orchestration/docs/specs/2026-07-28-voice-mode.md D14 + brief-of-record R3.

Files to touch:
- apps/overlay/src-tauri/src/lib.rs: tray menu item (checkable "Mute mic"), runtime state consulted
  by the chunk-03 gesture gate (same file as chunk 03 — sequential by Depends-on, no parallel run)
- apps/overlay/src/voice/ + packages/daemon/src/stt/: config-constant sweep (add any D14 key still
  missing, following the existing env/constants pattern)
- orchestration: the demo script lands in the feature's plan/PR body, NOT in docs/ (process vs
  product, PIPELINE §7.4)

Done when:
- Mechanical criteria pass; the demo script exists and covers every [behavioral] line of chunks
  02–05 + the spec sketch; Lior's live demo is SCHEDULED, not self-attested

ADRs in scope: 0006 p.4 (tray toggles — mute-mic was already promised), 0007 (the mitigation set the
mute completes — the wording amendment itself stays Lior's, §5.2 hard-to-reverse tier). Frozen:
@agentic/protocol.
```

## Notes / Open questions

- The three owed amendments (ADR-0006 p.1 ×2, ADR-0007 narrowing) should all be PROPOSED (as
  `proposed` notes/PR text) by the time this chunk closes, so Lior can gate them alongside the demo —
  the ADR-0007 one is privacy-adjacent = hard-to-reverse tier, NO async-acceptance shortcut
  (PIPELINE §5.2 Finding #5 / §11.3).
- If the mute state should also visibly change the tray glyph (like the connected/error status does),
  keep it within the existing `set_tray_status` pattern — implementer's call.
