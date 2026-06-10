#!/usr/bin/env bash
# conveyor-status — at-a-glance board for the conveyor control room (PIPELINE §11).
#
# Renders state FROM DISK (ledger + git + chunks-todo + tmux + gh) so it is accurate
# even when every chat is dead — disk is canonical, chats are disposable. READ-ONLY:
# it never writes the repo or touches a worker's tree.
#
# Usage:
#   conveyor-status.sh              one-shot render
#   conveyor-status.sh --watch [s]  live board, refresh every s seconds (default 10)
#
# Written for bash 3.2 (macOS) + BSD sed/grep — no GNU-isms (no sed `I` flag).
set -uo pipefail   # NOT -e: a missing gh/tmux must never abort the board

REPO="$(git -C "$(dirname "$0")" rev-parse --show-toplevel 2>/dev/null)" || REPO="$PWD"
LEDGER="$REPO/orchestration/conveyor-ledger.md"
CHUNKS="$REPO/orchestration/chunks-todo"

render() {
  local now branch w b found f st
  now="$(date '+%Y-%m-%d %H:%M')"
  branch="$(git -C "$REPO" branch --show-current 2>/dev/null)"
  printf '\033[1mCONVEYOR\033[0m  %s   tree: %s\n' "$now" "$branch"
  printf '%s\n' "────────────────────────────────────────────────────────────"

  printf '\033[1mRUNNING (live workers)\033[0m\n'
  w="$(tmux ls 2>/dev/null | grep -i 'conv\|conveyor')"
  if [ -n "$w" ]; then printf '%s\n' "$w" | sed 's/^/  /'; else printf '  (none)\n'; fi

  printf '\033[1mQUEUE (chunks-todo)\033[0m\n'
  found=0
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    st="$(grep -m1 -iE '^[[:space:]]*\**status:' "$f" | sed -E 's/.*:[*]*[[:space:]]*//; s/[[:space:]]*$//')"
    case "$(printf '%s' "$st" | tr 'A-Z' 'a-z')" in
      todo|in-progress|blocked)
        printf '  %-46s %s\n' "$(basename "$(dirname "$f")")/$(basename "$f")" "$st"; found=1 ;;
    esac
  done < <(find "$CHUNKS" -maxdepth 2 -name '[0-9]*.md' ! -path '*/archive/*' 2>/dev/null | sort)
  [ "$found" -eq 0 ] && printf '  (empty — all archived)\n'

  printf '\033[1mBLOCKED → LIOR\033[0m\n'
  b="$(grep -iE '^(BLOCKED|ESCALATED)' "$LEDGER" 2>/dev/null | tail -3)"
  if [ -n "$b" ]; then printf '%s\n' "$b" | cut -c1-118 | sed 's/^/  /'; else printf '  (none)\n'; fi

  printf '\033[1mRECENT (ledger)\033[0m\n'
  b="$(grep -iE '^(DONE|MERGED)' "$LEDGER" 2>/dev/null | tail -3)"
  if [ -n "$b" ]; then printf '%s\n' "$b" | cut -c1-118 | sed 's/^/  /'; else printf '  (none)\n'; fi

  printf '\033[1mOPEN PRs\033[0m\n'
  gh -R LiorBraginsky/AgenticEngine pr list --state open -L 6 2>/dev/null | sed 's/^/  /' || true

  printf '%s\n' "────────────────────────────────────────────────────────────"
}

if [ "${1:-}" = "--watch" ]; then
  secs="${2:-10}"
  while true; do clear 2>/dev/null; render; printf 'watch %ss · Ctrl-C to stop\n' "$secs"; sleep "$secs"; done
else
  render
fi
