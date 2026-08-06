# spec-critic — the pre-implementation pre-mortem gate (experiment)

> **Зріз: 2026-08-06.** Process tooling, NOT product (PIPELINE §7.4) — like the dev-bus and
> `engine-researcher`. No product ADR. Lives in `.claude/agents/spec-critic.md` +
> PIPELINE §3.1 + a hook in `decompose-feature` Step 5.5 + this doc.

**Status:** INSTALLED — piloting from the next decomposed feature. Verdict after 2–3 features.

## Why (Lior, 2026-08-06)

Prior art: the OMC / `ralplan` ecosystem runs a Planner→Architect→Critic consensus loop *before*
code. We looked at it and found one genuine gap in our own stack: **every adversarial pass we own
fires after the code exists.**

| What we already have | When it fires | Why it does not cover this |
|---|---|---|
| `engine-reviewer` / `hard-reviewer` | on the **diff** | too late — the design error is already spread across N chunks |
| `grill-me` / `grill-with-docs` | on the draft plan / decomposition | **interactive** — they need Lior in the loop, so in an unattended conveyor run they effectively do not fire |
| the `decompose-feature` §7.1 coupling check | on the cut | a **self-check in the same context** that produced the cut — and it is the check with 5 recorded strikes (memory `feedback_decompose_check_runtime_coupling`) |
| Lior's §6.1 live demo | after the code | strongest gate we have, and the most expensive place to learn a design was ambiguous |

So this is **additive, layered** — exactly the `engine-reviewer` + `hard-reviewer` shape: the
self-check stays, an independent fresh-context pass sits on top. Nothing is retired.

**What we did NOT copy from `ralplan`:** the *loop until consensus*. Unbounded token burn between
two LLMs with no arbiter. We have an arbiter standing at this exact joint (Lior, §5.2), so: one
pass → triage → ruling.

## What was built

- **Agent `spec-critic`** (opus, effort high, `Read/Glob/Grep` only — read-only by construction, no
  network). Answers exactly three questions: **Q1** unverified assumptions (→ spike before
  chunking), **Q2** load-bearing terms with two meanings, **Q3** attack on the cut's atomicity
  claim (§7.1). Hard caps: **3 blockers + 3 minor**. Every finding needs `claim` / `cite` /
  `cost if missed` / `disconfirming evidence` — no falsifiable anchor ⇒ dropped. Findings that
  contradict a recorded deferral must be labeled `RE-OPENING: <ref>` and cannot be blockers.
- **PIPELINE §3.1** — the gate itself, its charter, and the rule that protects §6.1.
- **`decompose-feature` Step 5.5** — dispatch the critic after the chunks are written, fold the
  triage back into spec/chunks before announcing the orchestrator next-step.
- **Routing:** findings go to **Jimmy**, not to Lior. Jimmy fixes routine mechanics himself (§5.1)
  and escalates only §5.2 judgment calls. The gate must not add a Lior touch.

## The backtest (before install) — method

We had labeled data: three shipped arcs with **known** escaped defects, plus known **deliberate
deferrals** as negative examples. Three anti-leak layers:

1. **`git archive <commit> | tar -x`** into a scratch dir — the snapshot has **no `.git`**, so
   `git log --all` (and therefore the later fix commits) is structurally unreachable. A
   `git worktree` would NOT have been safe: it carries the full object DB including future commits.
2. **Network forbidden** — otherwise the critic could read the present-day state of a dependency
   the snapshot only knew as unverified.
3. **Temporal holdout (the strong one).** All three specs are dated **2026-07-02 / 07-10 / 07-13**;
   the model's knowledge cutoff is **May 2026**. The outcomes cannot be in the weights.

Cut points (each a single commit that added spec + chunks together):
`b5f3152` Theme A · `f11b2e0` 2c memory-action-tools · `8537826` 2d hybrid-retrieval.

## Backtest results — 9 blockers, 7 map to defects that actually happened

| Arc | Blocker | What actually happened |
|---|---|---|
| Theme A | B1: "EDIT" is **two different objects**; no daemon path for fact-edit (`edit()` takes a `messageId`; nothing stamps `authored_by='human'`) | 🎯 the semantics split after Lior's chunk-03 demo ruling; **chunk-05 inserted mid-feature** |
| Theme A | B2: "re-open from tray focuses the existing window" unverified for a **user-closed** window (no window in the repo had ever been closed, only hidden) | 🎯 `×-destroys-window` — one of the 4 clusters §6.1 caught |
| Theme A | B3: nothing to read — `ConnectionManager` exposes no public state ⇒ **two liveness detectors of one daemon** | 🎯 `liveness transitions` + `banner↔content sync` — two more §6.1 clusters |
| 2d | B3: `embed()` "never throws" + unbounded `messages.content` ⇒ no input cap, no per-row isolation; one long paste stalls the batch. Proposed spike: *"embed the longest real archive row and a 25k-char synthetic"* | 🎯 **D3 truncation** — found mid-demo at chunk-07; fix was 512-cap + poison-row isolation. Predicted the defect, the magnitude, and the fix shape |
| 2d | B1: `memory_search` "scope" never says whether 5f thread-isolation applies | 🎯 "5f isolation restored" — the seam did have to be closed |
| 2c | B1: the shared apply unit **demotes on mismatch and inserts**; exact-vs-normalized comparator ⇒ "a second competing fact instead of a REPLACE", incl. re-cased text | 🎯 the **D1 case-dup** class (root: canonical-language divergence) |
| 2c | B2: the d5 matcher is defeatable by rephrasing / language switch, and the test drives an **echo-stub** that structurally cannot see it | 🎯 the same UA↔EN axis that became 2d's root fix |
| 2c | B3: "action" = tool *call* or applied *mutation*? (cap semantics) | ⚪ unconfirmed — but a real ambiguity |
| 2d | B2: drain quiescence vs probes/demo; a REPLACE deletes its vector | ⚪ unconfirmed |

Bonus: 2c-m1 named **"4 serial `messages.create` vs the 30s handshake"** — i.e. our own
`7-seq-vs-30s` watch-block residual — *before* the code existed.

**Blocker precision: 7/9 = 78%** (pre-registered green threshold was ≥50%).

**Discipline held on all three runs:** cap of 3 respected 3/3 · all four fields present everywhere ·
**zero** attacks on deliberate deferrals — and 2c-B2 spontaneously wrote *"not re-opening the 2d
deferral (`memory-backlog.md` §D:106-110) — NEW in this snapshot: 2c promotes that matcher from
cosmetic dedup to a mandatory 5d guardrail"*, which is the `RE-OPENING` rule working exactly as
designed.

**Unplanned upside — R1 inverted.** The feared failure mode was verification theater (a green critic
relaxing §6.1). Instead the critic's **behavioral-DoD list** is a ready-made demo script: it works
*for* the demo gate. So the list is now a required output.

### Two construction corrections the backtest forced

1. **It is not a "spec critic" — it is a spec↔code reality check.** All the leverage came from
   reading the actual code (`write-gate.ts:193-216`, `store.ts:481-536`,
   `connection-manager.ts:48-98`). A docs-only critic would have produced abstract water. Code read
   access is mandatory.
2. **Cap the minors too.** Blockers were clean 3/3, but minors ran 4–6 per arc (~150k-token
   reports). Triage cost is real ⇒ 3 + 3.

### Honest caveat — the weakest link in this evidence

**The grader (Jimmy) knew the answers.** The ground truth sat in project memory before the run
(semi-pre-registered), but the mapping "B3 → banner↔content sync" was done post-hoc, and post-hoc
mapping is generosity-prone. For the pilot the ground truth must be **written down before** the
critic runs. Do not treat 78% as a measured constant; treat it as "clearly above the ≥50% bar on a
grader-biased scoring".

Cost per feature: ~150k subagent tokens, ~9 min wall-clock, 1× per feature. Cheap.

## What we measure (over 2–3 features)

**🟢 Green flags**
- ≥1 finding per feature that **changed** the spec or the cut before code (the "earning its keep" signal).
- ≥1 assumption converted into a pre-chunk spike.
- Blocker precision ≥50% (judged after the arc ships, against what actually broke).
- **Lior touches per arc did not rise** (≤4) and Jimmy's triage stays ≤10 min per feature.
- The behavioral-DoD list is actually reused in the §6.1 demo script.

**🔴 Red flags**
- 0 spec/cut changes across 2 consecutive features ⇒ decoration.
- >1 finding per feature that re-opens a documented deferral ⇒ it is fighting our decisions.
- Triage >10 min per feature, or Lior touches rise.
- **Any** citation of "spec-critic green" as evidence in a DoD ⇒ **instant kill** (this is R1
  materializing; it is a red flag, not a bug to fix).

Also worth recording per run: did the critic find something `grill-with-docs` had already surfaced
(overlap ⇒ candidate for folding into the skill instead of a separate agent)?

## Kill switch (cheap by construction — no product code, no ADR)

1. `rm .claude/agents/spec-critic.md`
2. Revert PIPELINE §3.1 + the §1 diagram marker + the §2 / §5.1 / §10 / §11.2 rows.
3. Revert `decompose-feature` Step 5.5.
4. Note the verdict here. Nothing else touched — this is process, §7.4.

**Fallback if precision turns out weak but the questions still feel right:** fold Q1/Q2 into
`decompose-feature` as a checklist section instead of a separate agent. Cheaper, zero attention tax
— but it becomes a self-check in the same context again, which is the thing that failed 5× on
coupling. That trade is the fallback, not the plan.

## Pilot run 1 — `voice-mode`: PRE-REGISTERED ground truth

> **Authored 2026-08-06, before any critic output existed.** The backtest's admitted weakness was that the
> grader knew the answers and mapped findings post-hoc (see the Honest caveat above). This section removes that
> for run 1 by committing, in writing, to what counts as a hit **before** the critic speaks.
>
> **Honesty of the claim, precisely:** the decompose session runs in a **separate process** (`claude --model fable`,
> launched by Lior) whose output has not reached this session. Step 5.5 may therefore fire before this file merges.
> What is guaranteed is not the clock — it is that **everything below was authored without sight of any
> `spec-critic` output**, which is checkable from the two sessions' transcripts.

### A. The baseline predictions — what the Opus adviser chat already suspects

The point of writing these down is **marginal value, not absolute value.** If the critic returns exactly this
list, then a long-lived adviser chat that had read the spec could produce the same findings, and a separate
fresh-context agent bought little. Findings **outside** this list that turn out real are the critic's genuine
delta. Both outcomes are informative; only pre-registration makes them distinguishable.

| # | Predicted finding | Class |
|---|---|---|
| P1 | **`getUserMedia` in a non-activated Tauri webview is an unverified platform assumption.** D8's focus rail requires showing the overlay for recording **without** `set_focus()`. Nobody has established that mic capture works — or that the macOS TCC permission prompt even appears — in a window that was deliberately never activated. This is the `transformers.js`-on-Bun class: a load-bearing platform claim with no spike gating it. O7 mentions the TCC *flow* as "mechanical", which is not the same as "can this work at all". | Q1 |
| P2 | **"transcript" carries two meanings.** D9 says the transcript "*is* the archive message" and audio is never persisted. D11 says the busy-case transcript lands as **editable** pending text. An edited transcript then differs from what was spoken — and nothing says which one becomes the archive message, or whether the distiller sees the spoken or the edited text. Same shape as the Theme A `edit` defect. | Q2 |
| P3 | **`voice.whenBusy = reject` offers the behavior D11 forbids.** D11: "**Never** silently refuse — the worst outcome is speaking into a void." D14 ships `reject` as a supported config value. Either the rail is not absolute or the config value should not exist. | Q2 |
| P4 | **The cut will likely share runtime state across "atomic" chunks.** Audio capture, the D5 three-state indicator, the D9 HTTP upload, and the D11 busy seam all touch the same `runSession` / `inFlight` guard and the same connection lifecycle — the exact coupling class that produced Theme A's two-liveness-detectors finding, and the reason §7.1 exists. | Q3 |

**Two named non-predictions**, so no credit is claimed later for them: I do **not** predict what the settings-scope
boundary should be (that is Lior's O6 ruling, not a defect), and I do **not** predict any specific latency or STT
accuracy problem.

### B. Not a delta by construction

Findings in these areas score as **acknowledged, not novel** — the spec already declares them, so surfacing them
is correct behavior but not evidence the gate earns its keep:

- **O1–O7** (follow-up mic window · model manager · local-STT branch · hotkey discoverability · input-during-generation · onboarding wizard · TCC flow) — the spec's own carried opens.
- **The Amendments owed** (ADR-0006 p.1 ×2, the ADR-0007 wording narrowing).
- **The chunk-03-style "already gated" cases** — anything the spec explicitly routes to a spike.
- Restating **gotcha #45** or the frozen-wire constraint (D9) without a new consequence.

### C. Scoring rubric (fixed now)

- **A blocker is CONFIRMED** only when the predicted failure actually materializes during the build or Lior's §6.1
  demo, or when the triage changes the spec / the cut / adds a spike. Adjudicated **after the arc ships**, not on
  plausibility at read time.
- **Precision** = confirmed blockers ÷ blockers reported. Green threshold ≥50% (as set above).
- **Marginal precision** = confirmed blockers **not** in list A ÷ blockers reported. This is the number that decides
  whether a separate agent beats "the adviser chat reads the spec".
- **Recall** is measured against defects the arc actually hits: every defect found during the build or at the demo
  gets asked "was this in the critic's output, in list A, or in neither?"
- **Cost** recorded per run: subagent tokens, wall-clock, and Jimmy's triage minutes.
- **Lior-touch count for the arc** recorded, to check the gate did not add one.

### D. What would falsify the pilot on run 1 alone

- Marginal precision **0** with ≥3 blockers reported ⇒ the separate agent is redundant; fold Q1/Q2 into
  `decompose-feature` as a checklist (the fallback named above).
- Triage exceeded ~10 minutes, or any finding reached Lior that Jimmy should have absorbed.
- Any `RE-OPENING:` finding acted on without new information.
- "spec-critic green" cited anywhere as evidence ⇒ instant kill, per the charter.

## Links

- `.claude/agents/spec-critic.md` · PIPELINE §3.1 (the gate), §6.1 (why green ≠ evidence), §7.1 (the cut attack)
- Sibling process experiments: `2026-06-06-conveyor-pilot.md`, `2026-06-12-conveyor-dev-bus.md`, `2026-06-13-engine-researcher.md`
- Prior art that prompted it: `oh-my-claudecode` / `ralplan` (Planner→Architect→Critic consensus loop)
