#!/usr/bin/env bash
# conveyor-bus — CONDUCTOR side of the worker↔conductor dev-bus (PIPELINE §11 run-rung pilot).
#
# Jimmy (the conductor) uses this to read worker questions, answer them (applying his
# "above-everything" authority; §5.2 forks get a provisional answer + a flag for Lior),
# and to BLOCK-until-event so the conductor chat can run an event loop via run_in_background.
#
#   conveyor-bus.sh list                       # show unanswered questions
#   conveyor-bus.sh answer <id> <decided_by>   # answer body on STDIN; by = jimmy | jimmy-provisional | lior
#   conveyor-bus.sh stats                       # the experiment metric: how often workers ask
#   conveyor-bus.sh wait [poll-secs] [max-secs] [ledger-match]
#                                               # block until new-q / worker-ledger-report / worker-menu;
#                                               # ledger-match MUST be chunk-specific (e.g. "my-feature 01")
#                                               # or ledger reports are NEVER matched (default = no-match sentinel)
#                                               #   (run with run_in_background; exits on the first event)
# bash-3.2 / BSD-safe. TSV parsed with awk -F'\t' (no fragile literal-tab greps).
set -uo pipefail
REPO="$(git -C "$(dirname "$0")" rev-parse --show-toplevel 2>/dev/null)" || REPO="$PWD"
BUS="$REPO/orchestration/.conveyor/bus"; LOG="$BUS/log.tsv"
LEDGER="$REPO/orchestration/conveyor-ledger.md"
WORKER_PANE="${CONVEYOR_PANE:-conveyor:room.1}"
mkdir -p "$BUS/q" "$BUS/a"
TAB="$(printf '\t')"

unanswered() {
  local q id
  for q in "$BUS"/q/*.md; do
    [ -f "$q" ] || continue
    id="$(basename "$q" .md)"
    [ -f "$BUS/a/$id.md" ] || printf '%s\n' "$id"
  done
}

case "${1:-list}" in
  list)
    n=0
    for id in $(unanswered); do
      n=$((n+1)); printf '── q#%s ──\n' "$id"; sed 's/^/   /' "$BUS/q/$id.md"; echo
    done
    [ "$n" -eq 0 ] && echo "(no unanswered questions)"
    ;;
  answer)
    id="${2:?need id}"; by="${3:-jimmy}"
    [ -f "$BUS/q/$id.md" ] || { echo "no such q#$id" >&2; exit 1; }
    cat > "$BUS/a/$id.md"   # answer body from stdin
    asked_ts="$(awk -F"$TAB" -v id="$id" '$2==id && $5=="ASKED"{print $1; exit}' "$LOG" 2>/dev/null)"
    now="$(date '+%Y-%m-%dT%H:%M:%S')"; lat=""
    if [ -n "$asked_ts" ]; then
      a=$(date -j -f '%Y-%m-%dT%H:%M:%S' "$asked_ts" '+%s' 2>/dev/null || echo "")
      b=$(date -j -f '%Y-%m-%dT%H:%M:%S' "$now" '+%s' 2>/dev/null || echo "")
      [ -n "$a" ] && [ -n "$b" ] && lat=$((b-a))
    fi
    printf '%s\t%s\t\t\tANSWERED\t%s\t%s\n' "$now" "$id" "$by" "$lat" >> "$LOG"
    echo "answered q#$id (by=$by, latency=${lat:-?}s)"
    ;;
  stats)
    if [ ! -f "$LOG" ]; then echo "dev-bus stats — (no log yet)"; exit 0; fi
    awk -F"$TAB" '
      $5=="ASKED"{asked++}
      $5=="ANSWERED"{ans++; if($6=="jimmy")j++; if($6 ~ /provisional/)p++; if($7!="")lat=lat" "$2"="$6"/"$7"s"}
      END{
        printf "dev-bus stats — asked=%d answered=%d (jimmy=%d · provisional=%d) pending=%d\n", asked+0, ans+0, j+0, p+0, (asked-ans)+0
        if(ans>0) printf "  per-q (id=by/latency):%s\n", lat
      }' "$LOG"
    ;;
  wait)
    secs="${2:-20}"; max="${3:-1800}"; elapsed=0
    # 4th arg = ledger-match for THIS worker's report (e.g. "security-hardening 01");
    # must be chunk-specific so a PRIOR DONE line (e.g. an earlier decompose) doesn't false-fire.
    lmatch="${4:-zzz-no-match-sentinel}"
    while :; do
      [ -n "$(unanswered)" ] && { echo "EVENT new-question"; exit 0; }
      grep -qiE "^(DONE|BLOCKED).*${lmatch}" "$LEDGER" 2>/dev/null \
        && { echo "EVENT worker-ledger-report ($lmatch)"; exit 0; }
      tmux capture-pane -t "$WORKER_PANE" -p 2>/dev/null | grep -qiE 'Enter to select|❯ 1\.' \
        && { echo "EVENT worker-menu (protocol slip — redirect to bus)"; exit 0; }
      [ "$elapsed" -ge "$max" ] && { echo "EVENT heartbeat (no event in ${max}s — reassess worker liveness)"; exit 0; }
      sleep "$secs"; elapsed=$((elapsed+secs))
    done
    ;;
  *) echo "usage: conveyor-bus.sh list | answer <id> <by> | stats | wait [poll-secs] [max-secs] [ledger-match]" >&2; exit 2 ;;
esac
