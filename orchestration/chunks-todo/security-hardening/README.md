# Security hardening pass — post-ceremony decomposition (+ process-experiment CONCLUSION)

## What this is

The pre-public-release **security hardening pass**: un-defer the **per-install token**
(ADR-0003 p.5), move the **cloud secret to the OS Keychain** (#38), **token-gate the
`/memory/*` read path** (ADR-0013 binding rider), and **caller-auth thread writes/adoption**
(ADR-0014 regret-(a) binding rider). Spec: [[../../docs/specs/2026-06-12-security-hardening]]
(`status: draft` — **Lior §5.2 sign-off pending**; decompose PR stays open until accepted).

Design seams were resolved on the **conveyor dev-bus** (q#001–q#003,
`orchestration/.conveyor/bus/`), then the decomposition was adversarially grilled by a fresh
engine-reviewer subagent (1 BLOCKER + 3 MAJOR folded — see PR description).

**Roadmap reconciliation (bus q#001):** the roadmap's "all secrets in the OS Keychain" is read as
"all **cloud/off-machine** secrets" — the per-install token is local-only and stays in its 0600
file (`TokenStore`, shipped MF-05), which ADR-0003 p.5's "file-system-permission-protected"
letter sanctions. Doc-reconciliation, not a roadmap change.

## Chunks

| # | Title | Status | Closes | Depends on |
|---|-------|--------|--------|------------|
| 01 | API key → macOS Keychain (+ env-isolated prod proof) | todo | #38 | none (∥ 02/03) |
| 02 | Per-install WS token via subprotocol + thread-adoption auth + timing-safe verify | todo | #31 + ADR-0014 rider | none |
| 03 | Token-gate `/memory/*` reads + history paste-extend | todo | ADR-0013 rider | 02 (§7.1 runtime coupling: shared `verify` + `index.ts` fetch handler) |

Already done / explicitly deferred: 127.0.0.1-binding (shipped, `index.ts:19`); launchd
packaging, pairing/per-device tokens, rate-limiting, rotation UI, plugin/MCP supply chain,
web-admin wiring — all recorded with WHY in spec §5.

---

## ⚗️ Process-experiment CONCLUSION (2026-06-12) — ceremony vs light-direct, the verdict

**The experiment (Lior, 2026-06-04):** write this "thin, already-decided" pass light-direct
(no spec/brainstorm/grill), then later run the full ceremony and diff — does ceremony materially
change a thin decomposition? Baseline = commit `b7d1839`, preserved byte-identical in
[`_light-direct-baseline/`](_light-direct-baseline/).

### The diff (draft → post-ceremony)

| Axis | Light-direct draft (Jun 5) | Post-ceremony (Jun 12) |
|------|---------------------------|------------------------|
| Chunks | 2 | **3** (+ a spec) |
| Dependency | 02 **depends on** 01 ("token needs a Keychain home") | **inverted**: 01 ∥ 02 parallelizable; NEW dep 03→02 (runtime coupling) |
| Token home | implicit: Keychain (chunk 01 provides it) | **0600 file, NOT Keychain** (q#001 — TokenStore already shipped in MF-05; Keychain = cloud secrets only) |
| WS transport | OPEN ("needs real thought") | **decided: subprotocol** (q#002 — conductor OVERRIDE of the decomposer's query-param rec) |
| Origin allowlist | OPEN (replace vs complement) | **decided: augment** (layer 2) |
| Launchd | DoD demanded "prod launchd daemon loads key" | **descoped**: repo has NO launchd surface at all — the draft's DoD silently smuggled in a packaging feature (q#003-L2; L3 = Lior's demo option) |
| New scope | — (predates both) | ADR-0013 read-token rider (chunk 03) + ADR-0014 thread-auth rider (in 02) |
| Spec | none | **yes** (conductor-ordered: multi-surface auth model = PIPELINE §3 territory) |
| Buildability traps | none recorded | grill found the overlay reality (factory signature, reconnect re-present, stale forbidding comment, Rust fs gap, memory-smoke.ts, env-i PATH) |

### Verdict — was the ceremony worth it? **YES for this pass — with an honest split of credit.**

1. **~Half the delta is world-change, not ceremony.** Between Jun 5 and Jun 12, MF-05 shipped the
   TokenStore and TWO binding ADR riders landed on this pass (0013 read-token, 0014 thread-auth).
   ANY re-decompose — even light-direct — would have grown the scope. The experiment's premise
   ("thin, already-decided") partially dissolved before the ceremony ran.
2. **But the ceremony caught what a light-direct re-draft likely would NOT:** (a) the
   **dependency inversion** (the draft's 02→01 rested on a premise the shipped code already
   falsified — found by reading the repo, forced by brainstorm seam #1); (b) the **launchd
   packaging smuggle** hidden in a DoD line (found by checking that no plist exists); (c) the
   **transport override** — the conductor reversed the decomposer's own recommendation on
   security-posture grounds, exactly the "ask up, don't self-decide" value the bus exists for;
   (d) the **grill's BLOCKER** — the draft (and the first post-ceremony cut!) mis-located the
   overlay's WS client and missed that reconnect would silently never re-present the token.
3. **Cost:** 3 bus round-trips (overnight, zero Lior interrupts) + 1 grill subagent + 1 fable
   decompose session. For a **security** pass, (b)+(c)+(d) alone justify it.

**Standing-question feed (the "is ceremony worth it for thin features" question):** the useful
discriminator is NOT "thin vs thick" but **"has the world moved since the draft?"** — if ≥1
ADR/rider/shipped-chunk has touched the feature's surfaces since the light-direct draft was
written, re-run the ceremony (the draft's premises are suspect); if genuinely nothing moved, a
light-direct draft + a grill-only pass (skip brainstorm) is likely sufficient. Security-touching
features: always ceremony — the override in (c) shows recommendation-quality differs at the
conductor tier.

### Experiment hygiene

- The "before" is preserved byte-identical: [`_light-direct-baseline/`](_light-direct-baseline/)
  (+ git history at `b7d1839`).
- This README replaced the draft's framing; the draft README is in git history (`b7d1839`).
- Bus transcripts: `orchestration/.conveyor/bus/q|a/001-003*` (q#002-2a carries the flagged
  conductor override for Lior's AM review).
