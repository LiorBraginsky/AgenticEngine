#!/usr/bin/env bash
# conveyor-room — the conveyor control room (PIPELINE §11, Layout A).
#
# One tmux session `conveyor`, one window `room`, split horizontally:
#   pane 0 (top)    = live board   (conveyor-status.sh --watch)
#   pane 1 (bottom) = current worker (conveyor-next.sh --launch respawns it here)
#
# Run with no args to create the room if absent, then attach. `tmux attach -t conveyor`
# also works once it exists. Detach with Ctrl-b d (does NOT kill the worker).
#
# Usage: conveyor-room.sh [board-refresh-secs]   (default 10)
set -uo pipefail
BIN="$(cd "$(dirname "$0")" && pwd)"
SECS="${1:-10}"

if ! command -v tmux >/dev/null 2>&1; then echo "tmux not installed (brew install tmux)" >&2; exit 1; fi

if ! tmux has-session -t conveyor 2>/dev/null; then
  tmux new-session -d -s conveyor -n room "bash '$BIN/conveyor-status.sh' --watch $SECS"
  tmux split-window -t conveyor:room -v "printf 'worker pane — conveyor-next.sh <feature> --launch respawns the worker here.\\n\\n'; exec \"\${SHELL:-/bin/zsh}\""
  tmux select-layout -t conveyor:room even-vertical
  tmux select-pane -t conveyor:room.0
fi

exec tmux attach -t conveyor
