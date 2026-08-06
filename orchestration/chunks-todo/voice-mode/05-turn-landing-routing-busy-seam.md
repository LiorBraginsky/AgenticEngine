# Chunk 5: Turn landing — fire-on-release, D7 routing, the per-cause busy seam (D11)

**Status:** todo
**Created:** 2026-08-06
**Phase:** route part 3 (voice-mode)
**Estimated size:** ~1 day
**Depends on:** 02, 03, 04

> ⚠️ **Build gate:** spec `2026-07-28-voice-mode.md` is `draft — do-not-build` until Lior flips it to
> `accepted` (§5.2).

## Scope

**In:**
- **The end-to-end wire-up:** recorder `captured(blob)` → upload to `POST /voice/transcribe`
  (chunk-02 DTO, bearer token the overlay already holds — `read_auth_token`) → transcript → turn.
- **D2 fire-on-release:** the transcript becomes a turn IMMEDIATELY (no review step; STT-error
  feedback is deliberately indirect). **Interpretation of record (D9's "the daemon turns the text
  into a normal turn"):** the daemon endpoint returns the transcript; the **overlay** lands the turn
  via the EXISTING `session_start` path — this keeps `@agentic/protocol` byte-unchanged and reuses
  thread adoption (ADR-0014 / CM-01). If the orchestrator believes daemon-side landing is required,
  STOP and flag (it would need a daemon→overlay push and touches the frozen-wire question).
- **D7 routing = the existing thread semantics** (`currentThreadId`, CM-01/CM-03: dismiss resets it,
  hide does not). **Resolution of record for spec-critic B2** (D7's "a live widget exists" has two
  readings, and the code makes them diverge — error/timeout/`session_end` cards and the picker
  teardown hide the widget WITHOUT resetting the thread): voice adopts **Reading B —
  "conversation not dismissed" (`currentThreadId !== undefined`)** — NOT "widget visible on screen".
  **Reason:** the text path ALREADY behaves this way (a typed follow-up after an error card
  continues the thread), and ADR-0012 decision 2 (one behavioral contract, two affordances) forbids
  voice forking the routing semantics from text. The visible-widget wording in D7 is flagged as a
  spec-wording gloss for Lior (PR body §5.2 list) — if Lior rules Reading A instead, BOTH modalities
  change together, in a follow-up. The stale-thread-across-hours consequence the critic names is a
  PRE-EXISTING text-side property, not introduced by voice; it belongs to the continuation cut's
  minimize/dismiss policy. One active thread only — multi-widget targeting is route part 5, not here.
- **D11 busy seam — ONE place, PER-CAUSE verdict** (`canAcceptTurn`-shaped;
  `widget-lifecycle-model.md` §3-C): busy-because-**thinking** → the transcript lands in the
  reply-input slot (chunk 04) as **editable pending text**, sent explicitly by the user; NEVER
  silently refused, NEVER auto-sent when the agent frees up. **Correction (spec-critic m1): the
  `awaiting-a-human` cause IS reachable in MVP** — the DEFAULT provider lane is `mock`
  (`LLM_PROVIDER` unset → `injector.ts`), whose reducer emits `show_color_picker`, an awaiting
  widget. The seam therefore needs a REAL per-cause data source, named here: **thinking** =
  `inFlight` with no parked tool-call context; **awaiting-a-human** = a pending picker context
  (`activeCtx`/picker state in `main.ts`). Per §3-C rule C, awaiting-a-human = NOT busy → the voice
  turn proceeds normally (the parked call stays parked). Both causes get unit tests; the demo runs
  on `LLM_PROVIDER=anthropic-api` (only `show_text`), but the mock lane must not contradict §3-C.
  The seam must NOT be a single boolean. Gotcha #45: do not harden the single-session guard — the
  seam is the soft point route part 5 later turns into real queueing.
- **D10 voice↔text mixing on one thread:** falls out of reusing the same submit path — verify with a
  test/demo item (this closes a roadmap bounded-open).
- **Memory hygiene closes here:** a discarded capture (chunk-03 rails) produces NO turn → NO archive
  message → NO fact (D8's rationale); the busy-case ARCHIVE message is the text actually SENT (the
  user-edited pending text is the user's message; an unsent transcript is never stored — term
  sharpening of D9's "the transcript IS the archive message", which describes the normal path).
- Config plumbing: `voice.whenBusy` = `queue-to-reply-input` (default). **Reconciliation note
  (D11↔D14):** the `reject` value, if implemented, must be a VISIBLE "busy" status — D11's "never
  silently refuse" is absolute; `reject` is a non-default opt-out and may ship as
  recognized-but-unimplemented in this cut (documented), since D11's queue behavior is the decided
  rail.

**Out:** (WHY per §7.2)
- Real queueing / routing to a chosen widget / concurrent threads — route part 5 (gotcha #45),
  frozen out by the spec's own scope.
- A "here's what I heard, confirm?" step — rejected by D2 (the busy case is the ONE exception).
- Auto-send of pending text when the agent frees — rejected by D11 ("twenty seconds later the
  context may have moved").
- O5 research (how chat-UIs handle input during generation) — NOT commissioned per brief-of-record
  R4: D11 is decided; research that cannot change a ruled design is decoration. If D11 proves wrong
  at Lior's §6.1 demo, THAT is when research is justified (available-not-commissioned).

## Done criteria

- [ ] **[mechanical]** Seam unit tests: per-cause verdict (thinking → queue-to-slot;
  awaiting-a-human → allow, parked call untouched — reachable on the mock lane, see Scope);
  not-busy → land immediately; correct thread id passed (existing vs fresh mint, Reading B
  semantics).
- [ ] **[mechanical]** Upload path: token attached; endpoint error → status card (existing error
  chrome), never a crash; discard path produces no HTTP call.
- [ ] **[mechanical]** `lint:strict` + typecheck + `bun test` green; `@agentic/protocol`
  byte-unchanged (byte-check in CI evidence).
- [ ] **[behavioral]** Speak → answer widget appears (same widget as text; D3/ADR-0012 decision 2).
- [ ] **[behavioral]** Speak again with the widget alive → indicator in the widget slot, turn lands
  on the SAME thread; then a TYPED follow-up lands on that same thread (D10).
- [ ] **[behavioral]** Speak while the agent is busy → transcript appears as EDITABLE pending text;
  user edits, sends by hand; nothing auto-sends.
- [ ] **[behavioral]** The spoken utterance is readable afterwards in the Memory window
  thread-detail (D6 interim), and NO audio file exists anywhere on disk.

## Orchestrator brief (read by the orchestrator from this file)

```
Wire the voice turn end-to-end per orchestration/docs/specs/2026-07-28-voice-mode.md D2/D7/D10/D11
+ widget-lifecycle-model.md §3-C (per-cause seam).

Files to touch:
- apps/overlay/src/voice/: upload step (fetch to /voice/transcribe with bearer token — follow the
  memory.ts fetch pattern), landing router with the canAcceptTurn-shaped per-cause seam
- apps/overlay/src/main.ts: route the transcript into the EXISTING submit path (session_start +
  currentThreadId reuse — do not fork a parallel submit; D10 mixing must fall out for free)
- apps/overlay/src/widgets/…: pending-text fill of the chunk-04 slot

Done when:
- Mechanical criteria pass; behavioral criteria are the core of the §6.1 demo script (chunk 06)
- ONE seam, per-cause return; no scattered inFlight checks added anywhere in the voice path
- The existing text-submit path behavior is unchanged for text users

ADRs in scope: 0012 (decision 2 — one contract, two affordances), 0014 (thread adoption reuse),
0013 (bearer on the upload). Frozen: @agentic/protocol — the turn rides the EXISTING session_start;
any new WS variant = freeze gate, stop and escalate.
```

## Notes / Open questions

- **§7.1 coupling declared:** this chunk consumes chunk-02's DTO, chunk-03's recorder events,
  chunk-04's slot, and the LIVE `currentThreadId` / `inFlight` runtime state of `main.ts`. It is the
  integration point — re-validate the chunk-02/03/04 reality checks at build time (baselines move).
- The busy-case pending text survives… what? (widget dismissed while pending text sits in the slot →
  text is lost with the widget — acceptable for MVP, matches ephemeral-widget principle; noted so the
  demo doesn't read it as a bug.)
