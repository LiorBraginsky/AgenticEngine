# Conveyor ledger

> Append-only run log for the conveyor pilot (PIPELINE §11). One line per worker outcome.
> Format: `DONE|BLOCKED <feature> <NN> — <PR#|gate> — <note>  (YYYY-MM-DD)`.
> This is the cheap state surface Jimmy reads to build the next handoff brief
> (`orchestration/bin/conveyor-next.sh`) and to tally pilot metrics
> (`experiments/2026-06-06-conveyor-pilot.md`).

<!-- entries below, newest at bottom -->

DONE memory-foundation 04 — PR #26 — thread-isolation 5f: scope-tag enforcement in retrieve (Position-B, distiller unchanged); real-I/O proofs green (237 pass/0 fail), reviewer-clean (0 blockers), frozen surfaces byte-unchanged  (2026-06-06)
MERGED memory-foundation 04 — PR #26 (merge d61fdde) — Jimmy independently re-verified all-green (typecheck 0 / lint:strict 0 / bun test 237 pass 0 fail / frozen protocol+mock-agent diff empty / own review 0 blockers); post-merge main re-tested green. NO CI on repo → local command-evidence is the crawl-rung net (§11.4); auto-merged + archived. Worker copy-paste relays=0 (self-serve worked). Worker flag: engine-orchestrator skill-def stale vs §5.2/§11 narrowing (Phase-1 plan-approval + Phase-3 "never merge" lines) — pilot-review candidate.  (2026-06-06)
BLOCKED memory-foundation 05 — gate: ADR-0013 acceptance (§5.2 ADR gate) — worker self-split MF-05 at an architectural seam into T1 (Hatch read API + S1 projection-tombstone + distillation_events surfacing; verified-done on-branch, 139 tests) / T2 (token-gated HTTP write route + History surface + in-overlay provenance affordance + route-closing live demo); Lior BLESSED the split (principled cut, not salami). Conductor chat died on a 529 mid-shepherding — only in-context bookkeeping lost, work survived in git; state re-derived from disk per design.  (2026-06-06)
DONE memory-foundation 05-T1 — PR #28 — BLESSED INCREMENT, NOT MF-05-done (chunk file stays in-progress until T2 + the §6.1 live demo). ADR-0013 ACCEPTED ca30317 (Option B per-install token; binding read-token rider = pre-public-release hardening gate) → T2 unblocked.  (2026-06-10)
