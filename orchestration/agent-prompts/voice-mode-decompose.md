# Brief — decompose `voice-mode` (conveyor run, conductor-driven)

> **You are a conveyor worker. Lior is AWAY and will not answer questions.** The conductor (Jimmy) has
> already ruled the four scope questions below. **Do not ask further questions.** If you hit a genuine
> §5.2 gate, record it in your PR body + the ledger and stop there — do not block waiting for input.
>
> Launched 2026-08-06. Supersedes the interrupted interactive session `c0b80fb3` (its four questions are
> answered here). **Commit this file as part of your decompose PR** — it is the brief of record for this run.

## Task

Run `/decompose-feature voice-mode` — roadmap route part 3, the conversational-surface arc.

## Read these yourself (PIPELINE §7.3, Level-1 — nothing will be pasted to you)

- `orchestration/docs/specs/2026-07-28-voice-mode.md` — the spec of record (Decided D1–D14, Open O1–O7, Amendments owed, Behavioral DoD sketch)
- `orchestration/docs/roadmap.md` § "Conversation & Interaction Model" → the ⚡ CONVERSATIONAL-SURFACE ARC callout (sequencing of record). The 🎯 NORTH-STAR HORIZON callout below it is **context only — it authorizes nothing and is out of scope**
- `orchestration/docs/PIPELINE.md` — especially **§3.1 (NEW — the `spec-critic` pre-mortem gate)**, §6.1 runtime proof, §7.1 runtime coupling, §7.2 flag-vs-execute, §11.3 conductor charter
- `orchestration/docs/adr/` — 0007 (voice MVP), 0006 (dual hotkey / 2-zone), 0012, 0013 (token-gated HTTP), 0010
- `orchestration/docs/known-gotchas.md` — #45 single-session guard; #46 for the O3 local-STT note
- `orchestration/docs/widget-lifecycle-model.md` §3-C — the per-cause busy verdict D11 depends on
- `orchestration/docs/config-surface-inventory.md` — every config knob that already exists

## The four scope rulings (conductor, §5.1 — these are DECIDED, build on them)

**R1 — Scope: SIBLING decompose. This cut is voice-only.**
D14's config keys ride here as **plumbing** (env/constants per today's pattern), not as settings UI. Minimal-settings
UI gets its own brainstorm → spec → decompose.
*Reason beyond the obvious:* **no settings spec exists.** `config-surface-inventory.md` is `status: NOTES`, and
PIPELINE §3 requires a spec when multiple chunks share a contract or a set of decisions. Cutting settings chunks off a
NOTES doc would breach §3 and decompose on top of inventory §4's unresolved questions (where settings live, who owns
them, how a change propagates). The arc's build window ("voice + minimal settings first") is **preserved** — two
cuts, one build window.

**R2 — O6: NO onboarding wizard in this cut — with one rider that is NOT optional.**
No cloud-vs-local wizard: the local-STT lane (O3) is out of the MVP build, so that choice has no second branch, and a
wizard whose only purpose is a fork that does not exist is dead UI. It arrives with the local lane / model manager.
**Rider:** the behavioral DoD ("speak → waves → answer", with real STT) **cannot pass on a fresh install without a way
to get the STT key in.** So: **first check whether a key-entry path already exists** — the security-hardening pass
shipped an API-key→Keychain path; find it and reuse it (`stt.apiKeyRef` is a Keychain reference per D14, never a
value). If, and only if, no reusable path exists, the **minimum** key-entry mechanism is in scope inside a voice
chunk — as a DoD prerequisite, not as a wizard, and say so explicitly in that chunk's `## Scope` with the reason.

**R3 — Tray mute-mic: rides with VOICE, not settings.**
*Reason:* it is load-bearing, not cosmetic. The ADR-0007 wording note narrows the ADR's own privacy positive ("mic
never on unless the user **holds** the key") and justifies that narrowing with a named mitigation set — visible
indicator + silence auto-stop + hard cap + **tray mute**. Ship `toggle` mode without tray-mute and the amendment's own
justification is incomplete. Small: tray item → `voice.enabled` runtime toggle.

**R4 — O5 research: DO NOT commission.**
D11 is already **decided** (record → transcribe → land in the reply input as editable pending text, sent explicitly).
A research pass that cannot change an already-ruled design is decoration, and `engine-researcher`'s own keep-metric is
*"did research change the design vs what would have been guessed?"* — here it structurally cannot. If D11 proves wrong
it surfaces at Lior's §6.1 demo, and *that* is when research is justified. Note it as available-not-commissioned.

## Do NOT decide these — record and stop (§5.2, Lior only)

1. **The spec is `status: draft — PLANNING, do-not-build`.** Decomposing is correct; chunks must **not** go to the
   conveyor for building until Lior flips it to `accepted` (§5.2 spec sign-off). State this in your summary and set
   every chunk `Status: todo` as usual.
2. **The three amendments owed** (spec § Amendments owed): ADR-0006 p.1 ×2, and the ADR-0007 wording narrowing.
   Flag, never self-accept. Note that the ADR-0007 one is **privacy/security-adjacent** (it narrows a stated privacy
   guarantee), so it is the **hard-to-reverse tier** of PIPELINE §5.2 Finding #5 — **no async-acceptance shortcut.**
3. **`@agentic/protocol` stays byte-unchanged** (D9: audio rides token-gated HTTP, not the WS wire). Any chunk that
   would touch the wire contract = **freeze gate** → stop and escalate.
4. Anything that would change the roadmap sequencing or the north-star.

## Step 5.5 — the new pre-mortem gate. Do not skip it.

Dispatch the **`spec-critic`** subagent once over the spec + your finished cut before the hand-off line
(PIPELINE §3.1). This is its **first real run** as a tracked experiment
(`orchestration/docs/experiments/2026-08-06-spec-critic.md` — read the charter, ignore the pre-registered predictions
section; it is scoring material, not input for you).

- Its **≤3 blockers get triaged, not auto-applied**. Routine fixes (wording, `Depends on:`, promoting an assumption to
  a pre-chunk spike) you land yourself. §5.2-class findings go in the PR body for Lior.
- `RE-OPENING:`-prefixed findings default to **"the deferral stands"** unless they cite genuinely new information.
- Reconcile its **behavioral-DoD list** against your own `[behavioral]` tags.
- **A green verdict is NOT evidence of anything** and is never citable in a DoD.
- **Reproduce its full output verbatim in your PR body** (all fields, including `cite` and `disconfirming evidence`) —
  the conductor scores the pilot against a pre-registered rubric and needs the exact text, not a summary. Also record
  roughly how long your triage took.

## Git

Per project `CLAUDE.md`: branch (`chunk/voice-mode-decompose`) → commit → push → open a PR against `main`.
**Docs-only decompose → do NOT auto-merge.** Leave the PR open; the conductor reviews and Lior merges.
Include this brief file in the PR.

## When you are done

Post a summary containing: the chunk table (`# | Title | Status | Size | Path`), the `spec-critic` output verbatim,
the triage disposition per finding, the §5.2 items you parked, and the PR URL. Then stop — do not start chunk 01.
