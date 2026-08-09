#!/usr/bin/env bash
# PreToolUse guard: block /understand-family graph *builds* from a task worktree.
#
# Why this is needed at all: `.ua/` is gitignored, so the runtime's
# `syncIgnoredPathsIntoWorktree` symlinks a worktree's `.ua/` straight back at
# the main repo's `.ua/`. On top of that, the understand skill performs its own
# worktree redirect (skills/understand/SKILL.md, "Worktree redirect") and
# rewrites PROJECT_ROOT to the main repo root. Both routes land in the same
# directory, so two task agents running `/understand` concurrently do not get
# private graphs — they interleave writes into the shared
# `.ua/intermediate/batch-*.json` and clobber `knowledge-graph.json`.
#
# Read-only consumers (`understand-chat`, `-explain`, `-diff`, `-dashboard`)
# are deliberately allowed: they only read the graph, which is exactly the
# workflow task agents are supposed to use.
#
# Escape hatch: set UA_ALLOW_WORKTREE_BUILD=1 for a deliberate one-off.
set -uo pipefail

payload=$(cat)

skill=$(printf '%s' "$payload" | python3 -c 'import json,sys
try:
    d = json.load(sys.stdin)
except Exception:
    print(""); raise SystemExit
print((d.get("tool_input") or {}).get("skill", ""))' 2>/dev/null)

# Only the graph-building skills. Strip any `plugin:` prefix before matching.
case "${skill##*:}" in
	understand|understand-domain|understand-figma|understand-knowledge) ;;
	*) exit 0 ;;
esac

[ "${UA_ALLOW_WORKTREE_BUILD:-0}" = "1" ] && exit 0

git_dir=$(git rev-parse --git-dir 2>/dev/null) || exit 0
common_dir=$(git rev-parse --git-common-dir 2>/dev/null) || exit 0
[ -n "$git_dir" ] && [ -n "$common_dir" ] || exit 0

git_abs=$(cd "$git_dir" 2>/dev/null && pwd -P) || exit 0
common_abs=$(cd "$common_dir" 2>/dev/null && pwd -P) || exit 0

# Equal in a normal checkout (and in a submodule); they differ only in a worktree.
[ "$git_abs" = "$common_abs" ] && exit 0

main_root=$(dirname "$common_abs")

python3 - "$skill" "$main_root" <<'PY'
import json, sys

skill, main_root = sys.argv[1], sys.argv[2]
reason = (
    f"/{skill} is blocked inside a task worktree.\n\n"
    f"`.ua/` here is a symlink to the main repo's graph ({main_root}/.ua), and the "
    "understand skill redirects PROJECT_ROOT there anyway — so this build would write "
    "into the shared graph and race any other task agent doing the same.\n\n"
    f"Build it once from {main_root} instead. To read the existing graph from here, use "
    "`understand-chat`, `understand-explain`, or `understand-diff` — those are allowed.\n"
    "Deliberate override: UA_ALLOW_WORKTREE_BUILD=1."
)
print(json.dumps({
    "hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "deny",
        "permissionDecisionReason": reason,
    }
}))
PY
exit 0
