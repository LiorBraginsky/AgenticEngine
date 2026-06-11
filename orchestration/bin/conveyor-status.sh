#!/usr/bin/env bash
# conveyor-status — control-room board (PIPELINE §11).
#
# Renders FROM DISK (ledger + git + chunks + tmux + gh). READ-ONLY and **zero Claude
# tokens** — pure shell/git/gh, no model calls. Accurate even if every chat is dead.
#
#   conveyor-status.sh              one-shot
#   conveyor-status.sh --watch [s]  live loop (default 10s)
#
# bash-3.2 / BSD-sed safe — no GNU-isms.
set -uo pipefail

REPO="$(git -C "$(dirname "$0")" rev-parse --show-toplevel 2>/dev/null)" || REPO="$PWD"
LEDGER="$REPO/orchestration/conveyor-ledger.md"
CHUNKS="$REPO/orchestration/chunks-todo"
LAUNCHES="$REPO/orchestration/.conveyor/launches.log"
GH_REPO="LiorBraginsky/AgenticEngine"

chunk_status() { grep -m1 -iE '^[[:space:]]*\**status:' "$1" 2>/dev/null | sed -E 's/.*:[*]*[[:space:]]*//; s/[[:space:]]*$//'; }

render() {
  local now branch wcmd cur q f line
  now="$(date '+%H:%M')"
  branch="$(git -C "$REPO" branch --show-current 2>/dev/null)"

  # ── headline: WORKING (worker pane running claude) or IDLE ──
  wcmd="$(tmux list-panes -t conveyor:room.1 -F '#{pane_current_command}' 2>/dev/null | head -1)"
  if printf '%s' "$wcmd" | grep -qiE 'claude|node'; then
    cur=""
    for f in "$CHUNKS"/*/[0-9]*.md; do
      [ -f "$f" ] || continue
      case "$(chunk_status "$f" | tr 'A-Z' 'a-z')" in
        in-progress) cur="$(basename "$(dirname "$f")")/$(basename "$f" .md)"; break ;;
      esac
    done
    printf '\033[1;32m▶ WORKING\033[0m  %s     %s · %s\n' "${cur:-?}" "$now" "$branch"
  else
    q=0
    for f in "$CHUNKS"/*/[0-9]*.md; do
      [ -f "$f" ] || continue
      case "$(chunk_status "$f" | tr 'A-Z' 'a-z')" in todo|in-progress|blocked) q=$((q+1)) ;; esac
    done
    printf '\033[1m■ IDLE\033[0m    queue: %s     %s · %s\n' "$q" "$now" "$branch"
  fi

  # ── needs you: show ONLY if the MOST-RECENT status line is unresolved
  #    (a later DONE/MERGED clears a prior BLOCKED/ESCALATED). ──
  line="$(grep -iE '^(DONE|MERGED|BLOCKED|ESCALATED)' "$LEDGER" 2>/dev/null | tail -1)"
  if printf '%s' "$line" | grep -qiE '^(BLOCKED|ESCALATED)'; then
    printf '\033[1;31m⛔ NEEDS YOU:\033[0m %s\n' "$(printf '%s' "$line" | cut -c1-88)"
  else
    printf '\033[1;32m✓ NEEDS YOU: —\033[0m\n'
  fi
  printf '%s\n' "──────────────────────────────────────────────────────────"

  # ── stats (pure shell, 0 tokens) ──
  local chunks plans specs adrs commits workers prs toks
  chunks=$(find "$CHUNKS/archive" -name '[0-9]*.md' 2>/dev/null | wc -l | tr -d ' ')
  plans=$(find "$REPO/orchestration/docs/plans" -name '*.md' ! -name 'README*' 2>/dev/null | wc -l | tr -d ' ')
  specs=$(find "$REPO/orchestration/docs/specs" -name '*.md' ! -name 'README*' 2>/dev/null | wc -l | tr -d ' ')
  adrs=$(ls "$REPO/orchestration/docs/adr/"[0-9]*.md 2>/dev/null | wc -l | tr -d ' ')
  commits=$(git -C "$REPO" rev-list --count HEAD 2>/dev/null || echo '?')
  workers=$([ -f "$LAUNCHES" ] && wc -l < "$LAUNCHES" | tr -d ' ' || echo 0)
  toks=$(grep -hoE 'tok=[0-9]+' "$LEDGER" 2>/dev/null | grep -oE '[0-9]+' | awk '{s+=$1} END{if(s<=0)print "—"; else if(s<1000000) printf "%.0fk", s/1000; else printf "%.1fM", s/1000000}')
  prs=$(gh -R "$GH_REPO" pr list --state merged --limit 300 2>/dev/null | wc -l | tr -d ' ')
  printf '\033[1mSTATS\033[0m  chunks done %s · plans %s · specs %s · ADRs %s\n' "$chunks" "$plans" "$specs" "$adrs"
  printf '       PRs merged %s · commits %s · workers run %s\n' "${prs:-?}" "$commits" "$workers"
  printf '       tokens ≈%s (ballpark · ledger self-report; exact = dashboard)\n' "$toks"
  printf '%s\n' "──────────────────────────────────────────────────────────"

  # ── recent ──
  printf '\033[1mRECENT\033[0m\n'
  grep -iE '^(DONE|MERGED)' "$LEDGER" 2>/dev/null | tail -3 | cut -c1-70 | sed 's/^/  /' || printf '  (none)\n'
}

if [ "${1:-}" = "--watch" ]; then
  secs="${2:-10}"
  while true; do clear 2>/dev/null; render; printf 'watch %ss · 0 tokens · Ctrl-C to stop\n' "$secs"; sleep "$secs"; done
else
  render
fi
