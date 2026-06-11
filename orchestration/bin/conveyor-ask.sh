#!/usr/bin/env bash
# conveyor-ask — WORKER → CONDUCTOR question channel (dev-bus; PIPELINE §11 run-rung pilot).
#
# A conveyor worker calls this when it hits a DESIGN SEAM it should route UP to Jimmy
# (the conductor, who sits "above" all workers and is more authoritative than a worker
# deciding alone in its box). It records the question and returns IMMEDIATELY — the worker
# then ends its turn and waits to be nudged back with the answer. This is the transport the
# run-rung promised (PIPELINE §11.4); kept as DEV tooling, separate from the product daemon.
#
# Usage:
#   <question markdown on STDIN> | conveyor-ask.sh <feature> <seam-slug>
# Example (worker):
#   printf '%s\n' "Where does the per-install token live? Options: 1)… 2)… My rec: 1 because…" \
#     | bash orchestration/bin/conveyor-ask.sh security-hardening token-home
#
# bash-3.2 / BSD-safe.
set -uo pipefail
REPO="$(git -C "$(dirname "$0")" rev-parse --show-toplevel 2>/dev/null)" || REPO="$PWD"
BUS="$REPO/orchestration/.conveyor/bus"
mkdir -p "$BUS/q" "$BUS/a"
LOG="$BUS/log.tsv"
[ -f "$LOG" ] || printf 'ts\tid\tfeature\tseam\tevent\tdecided_by\tlatency_s\n' > "$LOG"

feature="${1:-unknown}"; seam="${2:-seam}"
ts="$(date '+%Y-%m-%dT%H:%M:%S')"
seq=$(( $(ls "$BUS/q" 2>/dev/null | grep -cE '^[0-9]') + 1 ))
id="$(printf '%03d-%s' "$seq" "$seam")"
qfile="$BUS/q/$id.md"
{
  printf '<!-- feature=%s seam=%s asked=%s -->\n\n' "$feature" "$seam" "$ts"
  cat
} > "$qfile"
printf '%s\t%s\t%s\t%s\tASKED\t\t\n' "$ts" "$id" "$feature" "$seam" >> "$LOG"

cat <<EOF
QUEUED → conductor.  q#$id recorded at ${qfile#"$REPO"/}.
NOW: end your turn with the single line "WAITING q#$id" and STOP.
Do NOT decide this seam yourself and do NOT open an interactive menu — the conductor
(Jimmy) will write the answer to orchestration/.conveyor/bus/a/$id.md and nudge you to
continue. If you are ever nudged with "TIMEOUT-PROCEED q#$id", only THEN fall back to
your own recommendation (record that it was unanswered).
EOF
