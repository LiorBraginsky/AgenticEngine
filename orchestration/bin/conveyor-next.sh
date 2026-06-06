#!/usr/bin/env bash
# conveyor-next — crawl-rung conveyor driver (PIPELINE.md §11).
#
# Finds the next `Status: todo` chunk, generates a handoff brief FROM DISK
# (git + chunk file + ledger), then either prints it or launches a fresh
# interactive orchestrator chat in tmux. Interactive `claude` (no `-p`) =
# subscription billing.
#
# Usage:
#   conveyor-next.sh [feature] [--print|--launch|--copy]
#     feature   chunks-todo/<feature>/ to drain (auto-detected if only one active)
#     --print   (default) write+print the brief; show the launch command, don't run it
#     --launch  spawn `tmux new-session -d` running interactive `claude` with the brief
#     --copy    also pbcopy the brief (macOS)
#
# Design: disk is canonical, chat is disposable (§11.1). The brief is a pure
# function of disk state, so a fresh chat can always be (re)launched losslessly.
# Written for bash 3.2 (macOS default) — no mapfile.
set -euo pipefail

MODE=print
COPY=0
FEATURE=""
for a in "$@"; do
  case "$a" in
    --print)   MODE=print ;;
    --launch)  MODE=launch ;;
    --copy)    COPY=1 ;;
    -*)        echo "unknown flag: $a" >&2; exit 2 ;;
    *)         FEATURE="$a" ;;
  esac
done

REPO_ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
CHUNKS="$REPO_ROOT/orchestration/chunks-todo"
LEDGER="$REPO_ROOT/orchestration/conveyor-ledger.md"
BRIEF_DIR="$REPO_ROOT/orchestration/.conveyor/briefs"
mkdir -p "$BRIEF_DIR"

# --- pick the active feature folder ----------------------------------------
if [ -z "$FEATURE" ]; then
  features=()
  while IFS= read -r d; do features+=("$d"); done \
    < <(find "$CHUNKS" -mindepth 1 -maxdepth 1 -type d ! -name archive -exec basename {} \; | sort)
  if [ "${#features[@]}" -eq 0 ]; then echo "no active feature folders under $CHUNKS" >&2; exit 1; fi
  if [ "${#features[@]}" -gt 1 ]; then
    { echo "multiple active features — specify one:"; printf '  %s\n' "${features[@]}"; } >&2; exit 1
  fi
  FEATURE="${features[0]}"
fi
FDIR="$CHUNKS/$FEATURE"
[ -d "$FDIR" ] || { echo "no such feature folder: $FDIR" >&2; exit 1; }

# --- find the lowest-numbered chunk still `Status: todo` -------------------
next_chunk=""
while IFS= read -r f; do
  if grep -qiE '^[[:space:]]*\**status:\**[[:space:]]*todo' "$f"; then next_chunk="$f"; break; fi
done < <(find "$FDIR" -maxdepth 1 -name '[0-9]*.md' | sort)

if [ -z "$next_chunk" ]; then
  if find "$FDIR" -maxdepth 1 -name '[0-9]*.md' | grep -q .; then
    echo "no 'todo' chunks in '$FEATURE' (remaining are in-progress/blocked — resume/unblock manually)" >&2
  else
    echo "feature '$FEATURE' drained → time for Jimmy to refresh (PIPELINE §11.1)" >&2
  fi
  exit 3
fi

nn="$(basename "$next_chunk" | grep -oE '^[0-9]+')"
title="$(grep -m1 -E '^#[[:space:]]' "$next_chunk" | sed -E 's/^#[[:space:]]*//')"
rel="${next_chunk#"$REPO_ROOT"/}"
branch="$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD)"
clean=$([ -z "$(git -C "$REPO_ROOT" status --porcelain)" ] && echo clean || echo DIRTY)
recent="$(git -C "$REPO_ROOT" log --oneline -3)"
ledger_tail=""
[ -f "$LEDGER" ] && ledger_tail="$(tail -n 8 "$LEDGER")"

# --- build the brief (pure function of disk) -------------------------------
brief_file="$BRIEF_DIR/${FEATURE}-${nn}.md"
cat > "$brief_file" <<EOF
You are a fresh **engine-orchestrator** worker chat in the AgenticEngine conveyor
(PIPELINE.md §11). Build exactly ONE chunk, then report and stop.

## Your task
/engine-orchestrator do chunk ${nn} from ${rel}

Chunk: "${title}"

## Disk context (as of launch)
- branch: ${branch} (working tree: ${clean})
- recent commits:
$(printf '%s\n' "$recent" | sed 's/^/    /')
- ledger tail:
$(printf '%s\n' "${ledger_tail:-  (none yet)}" | sed 's/^/    /')

## Self-serve rule (read BEFORE you escalate)
When unsure about PROCESS or a CONTRACT, read it yourself first — do not ask Jimmy:
PIPELINE.md (esp. §5 gates, §6 verified-done, §7 governance), the relevant ADRs in
orchestration/docs/adr/, and the feature spec in orchestration/docs/specs/. Escalate
ONLY what the docs do not answer (§5.2 / §7.2 citation test).

## Gates (PIPELINE §5.2, narrowed 2026-06-06)
- Proceed autonomously through the plan UNLESS the §7.2 citation test fires (the plan
  cites a frozen conflict, introduces new scope, or hits a real blocker).
- STOP + report BLOCKED for: behavioral demo sign-off, freeze/stop-the-line, ADR
  acceptance, north-star/roadmap conflict.
- Merge is auto on all-green (CI + reviewer-clean + frozen surfaces byte-unchanged +
  demo-if-behavioral). A red gate is a hard stop — do not merge.

## Report contract (last action before you end your turn)
Append ONE line to ${LEDGER#"$REPO_ROOT"/} and post the same to Jimmy:
  - DONE    ${FEATURE} ${nn} — <PR#> — <one-line what shipped>
  - BLOCKED ${FEATURE} ${nn} — <gate> — <what Jimmy must route to Lior>
Then stop. Do NOT pick up the next chunk — Jimmy launches it.
EOF

echo "── next: ${FEATURE} chunk ${nn} — ${title}"
echo "── brief: ${brief_file#"$REPO_ROOT"/}"
echo

if [ "$COPY" -eq 1 ] && command -v pbcopy >/dev/null 2>&1; then
  pbcopy < "$brief_file"; echo "(brief copied to clipboard)"; echo
fi

session="conv-${FEATURE}-${nn}"
case "$MODE" in
  print)
    cat "$brief_file"
    echo
    echo "── to launch a fresh orchestrator chat:"
    echo "   tmux new-session -d -s '$session' \"claude \\\"\$(cat '$brief_file')\\\"\""
    ;;
  launch)
    command -v tmux   >/dev/null 2>&1 || { echo "tmux not installed" >&2; exit 1; }
    command -v claude >/dev/null 2>&1 || { echo "claude CLI not found" >&2; exit 1; }
    tmux new-session -d -s "$session" "claude \"\$(cat '$brief_file')\""
    echo "── launched tmux session '$session' (interactive claude → subscription)."
    echo "   watch: tmux attach -t $session    |    kill: tmux kill-session -t $session"
    ;;
esac
