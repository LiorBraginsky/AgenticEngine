# Chunk 4: Voice indicator (3 states, D4 placement) + the interim in-widget reply-input slot

**Status:** todo
**Created:** 2026-08-06
**Phase:** route part 3 (voice-mode)
**Estimated size:** ~1 day
**Depends on:** 03 (recorder state events drive the indicator); 02 (transcribing state brackets the
HTTP round-trip — DTO import)

> ⚠️ **Build gate:** spec `2026-07-28-voice-mode.md` is `draft — do-not-build` until Lior flips it to
> `accepted` (§5.2).

## Scope

**In:**
- **Three distinct status states** (spec D5): `listening` (moving waves) → `transcribing` (waves
  stop; pulse/shimmer for the 0.5–3 s STT round-trip) → `agent thinking` (the EXISTING thinking
  loader). All three are **status** chrome under ADR-0006's rule-of-three (timer/self-dismiss
  allowed). Conflating them is explicitly rejected (a network wait must not look like a dead mic).
- **D4 placement rule:**
  - **No widget open** → indicator in the **centre** (the ADR-0006 input zone). Lean of record: a
    render mode of the existing `main` window, **shown without focus** — NOT a third window (the
    2026-05-31 amendment already rejected a third window for status; if implementation forces one,
    STOP and flag — that touches ADR-0006 amendment territory).
  - **A widget is open** → the indicator is **born inside that widget, in the reply-input slot**
    (voice replaces the same slot text focuses — one slot, two modalities).
- **The interim reply-input slot** in the expanded text widget — the minimal inline input that D4/D11
  presuppose. It: hosts the voice indicator in the in-widget case; holds the D11 busy-case transcript
  as **editable pending text**; sends explicitly (Enter) as a turn on the live thread via the
  existing submit machinery. **This is NOT new scope:** the inline-reply-on-the-expanded-widget shape
  is already DECIDED in `specs/2026-07-28-continuation-affordance.md` Decided-1 (the "Live Card"
  half); voice builds the minimal slot it needs, continuation later adds auto-minimize / hover-pause /
  expand-focus around it. (ADR-0012's "exact reply affordance" open was closed by that spec — this
  chunk implements, not decides.)
- **D6 honored:** NO transcript label on the widget ("what I heard" is read in the Memory window's
  thread-detail until chat-view ships — recorded interim, not a gap).
- Cross-window plumbing via the existing `EV_*` relay pattern (`apps/overlay/src/main.ts`), new
  events additive.
- Config plumbing: `voice.minimizeMs` key exists as a **dormant** constant (D14 lists it; the
  auto-minimize machinery it configures is continuation's build — key lands, nothing reads it yet;
  say so in a code comment).

**Out:** (WHY per §7.2)
- Auto-minimize / hover-pause / minimized-pill states — OUT because they are the continuation
  feature's build (arc order: voice first, continuation next); voice answers inherit them when
  continuation ships (D3).
- Turn landing / busy verdict — chunk 05 owns the `canAcceptTurn` seam; this chunk provides the SLOT
  (a place for pending text), not the routing that fills it.
- A separate "voice widget" — rejected by D3 (voice in, the SAME widget out; one behavioral contract,
  ADR-0012 decision 2).
- Transcript-on-widget review step — rejected by D2/D6 (fire-on-release is firm; the busy case is the
  one exception and lands in the slot, not as a label).

## Done criteria

- [ ] **[mechanical]** Renderer unit tests: state transitions listening→transcribing→thinking; slot
  renders editable text; Enter in slot triggers the submit callback with the (possibly edited) text.
- [ ] **[mechanical]** `lint:strict` + typecheck + `bun test` green; `@agentic/protocol`
  byte-unchanged.
- [ ] **[behavioral]** New conversation: hotkey → waves visible in the CENTRE, without focus steal;
  waves→pulse on release. *(The pulse→thinking transition needs chunk 05's upload wired — this line
  is demo-at-05/06, like the slot line below; spec-critic DoD note 16.)*
- [ ] **[behavioral]** Widget open: hotkey → the indicator appears IN the widget's reply-input slot
  (not centre).
- [ ] **[behavioral]** The slot accepts typed edits and sends on Enter, landing on the SAME thread
  (full path proven at chunk 05/06 demo).

## Orchestrator brief (read by the orchestrator from this file)

```
Implement the voice indicator (D5 three states) + D4 placement + the interim reply-input slot per
orchestration/docs/specs/2026-07-28-voice-mode.md D4/D5/D6 and
specs/2026-07-28-continuation-affordance.md Decided-1 (the slot's decided shape).

Files to touch:
- apps/overlay/src/widgets/ (text-reply renderer): add the reply-input slot to the expanded text
  card; indicator render modes (waves | pulse) for the in-widget case
- apps/overlay/src/main.ts + widget.ts: centre-indicator render mode of the main window (unfocused
  show path from chunk 03); new EV_* relay events (additive, follow the existing naming)
- apps/overlay/src/voice/: subscribe to chunk-03 recorder state events; import the chunk-02 DTO for
  the transcribing bracket

Done when:
- Mechanical criteria pass; behavioral criteria demoable on macOS
- The slot is a plain inline input — NO minimize/hover machinery (continuation's build)
- No transcript label anywhere on the widget (D6)

ADRs in scope: 0006 (rule-of-three: all three states are status; centre zone = main window mode —
flag if a third window becomes necessary), 0012 decision 2/3 (same widget out; no transcript
surface). Frozen: @agentic/protocol.
```

## Notes / Open questions

- **§7.1 coupling declared:** this chunk and continuation's future build SHARE the reply-input slot
  surface. The continuation decompose must treat the slot as existing (extend, not re-create). Also
  shares the widget window's render-mode enum with existing modes (`loader|text|picker|status|
  confirmation`) — additive members only.
- ADR-0006 p.1 "No visual panel needed" amendment note is owed for exactly this indicator (spec
  §Amendments owed 1b) — flag in PR body; Lior accepts (§5.2).
- Empty-slot idle state (widget open, no voice, no pending text): keep the slot visually minimal so
  the widget does not read as a chat box (ADR-0012 decision 3 spirit); exact styling is the
  implementer's call.
