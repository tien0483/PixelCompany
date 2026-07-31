#!/usr/bin/env bash
# Rebuilds frontends/pixel_office/dist when its source changed between two refs.
# Called by .githooks/post-merge and .githooks/post-checkout so the UI dist never
# drifts from whatever commit main is actually on (dist is gitignored and the
# runtime falls back to serving it as-is otherwise).
#
# Usage: rebuild-ui-if-changed.sh <old-ref> [new-ref]
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

# Git hooks run in a minimal, non-login shell — nvm-managed node (and npx/vite
# with it) is not on PATH unless we source nvm ourselves, and the system node
# on PATH otherwise may be too old (mirrors the WSL system-python3-vs-venv
# issue documented above for jacked).
if [ -s "$HOME/.nvm/nvm.sh" ]; then
	# shellcheck disable=SC1091
	. "$HOME/.nvm/nvm.sh"
	nvm use --silent default >/dev/null 2>&1 || nvm use --silent node >/dev/null 2>&1 || true
fi
if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
	echo "[git-hook] Skipping UI rebuild: need Node >= 22 on PATH (install: nvm install 22)." >&2
	exit 0
fi

OLD_REF="${1:-}"
NEW_REF="${2:-HEAD}"
UI_DIR="frontends/pixel_office"
WATCH_PATHS=("$UI_DIR/src" "$UI_DIR/package.json" "$UI_DIR/vite.config.ts" "$UI_DIR/index.html")

needs_build=1
if [ -f "$UI_DIR/dist/index.html" ] \
	&& [ -n "$OLD_REF" ] \
	&& [ "$OLD_REF" != "0000000000000000000000000000000000000000" ] \
	&& git cat-file -e "$OLD_REF" 2>/dev/null \
	&& git diff --quiet "$OLD_REF" "$NEW_REF" -- "${WATCH_PATHS[@]}" 2>/dev/null; then
	needs_build=0
fi

if [ "$needs_build" -eq 0 ]; then
	exit 0
fi

echo "[git-hook] $UI_DIR changed (or dist missing) — rebuilding..."
# vite build directly, not the "build" npm script — that script also runs
# `tsc --noEmit`, which fails on pre-existing baseline type errors unrelated to
# any given change. scripts/solo.mjs's buildUi() makes the same choice.
(cd "$UI_DIR" && npx vite build)
