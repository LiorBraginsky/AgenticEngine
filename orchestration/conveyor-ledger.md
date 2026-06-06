# Conveyor ledger

> Append-only run log for the conveyor pilot (PIPELINE §11). One line per worker outcome.
> Format: `DONE|BLOCKED <feature> <NN> — <PR#|gate> — <note>  (YYYY-MM-DD)`.
> This is the cheap state surface Jimmy reads to build the next handoff brief
> (`orchestration/bin/conveyor-next.sh`) and to tally pilot metrics
> (`experiments/2026-06-06-conveyor-pilot.md`).

<!-- entries below, newest at bottom -->
