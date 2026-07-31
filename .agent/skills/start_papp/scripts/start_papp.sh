#!/bin/bash
# Start a papp backend FROM ITS WORKTREE in WSL.
#
# Usage: start_papp.sh [--isolated-port <PORT>] [--state-dir <DIR>] [--papp-name <NAME>] [--collection <COLL>] [worktree_root]
WORKTREE="$(pwd)"
ISOLATED_PORT=""
STATE_DIR=""
PAPP_NAME="demo_ai_dashboard"
COLLECTION="akselos-testing/demo_ai_dashboard"

while [[ $# -gt 0 ]]; do
  case $1 in
    --isolated-port)
      ISOLATED_PORT="$2"
      shift 2
      ;;
    --state-dir)
      STATE_DIR="$2"
      shift 2
      ;;
    --papp-name)
      PAPP_NAME="$2"
      shift 2
      ;;
    --collection)
      COLLECTION="$2"
      shift 2
      ;;
    *)
      WORKTREE="$1"
      shift
      ;;
  esac
done

if [ -z "$STATE_DIR" ]; then
    # Auto-detect state dir if possible
    STATE_DIR=$(ls "$WORKTREE/data/papp_data/$COLLECTION/" | grep "state-" | head -n 1)
    if [ -z "$STATE_DIR" ]; then
        echo "Error: --state-dir not provided and could not be auto-detected in $WORKTREE/data/papp_data/$COLLECTION/" >&2
        exit 1
    fi
fi

ENV_JSON="$WORKTREE/data/papp_data/$COLLECTION/$STATE_DIR/1.env_vars.json"

if [ ! -f "$ENV_JSON" ]; then
    echo "env_vars file not found: $ENV_JSON" >&2
    exit 1
fi

# Export every KEY=VALUE pair from the json (existing shell env wins).
while IFS=$'\t' read -r key value; do
    [ -z "${!key+x}" ] && export "$key=$value"
done < <(/usr/bin/python3 -c "import json,sys;[print(f'{k}\t{v}') for k,v in json.load(open(sys.argv[1])).items()]" "$ENV_JSON")

# Load .env.local files (never committed): papp dir first, then frontends (where the OpenRouter
# key historically lives as VITE_-prefixed vars). Existing env wins; VITE_OPENROUTER_* names are
# mirrored to the plain OPENROUTER_* names the backend agent reads.
for ENV_LOCAL in "$WORKTREE/dashboard/papps/backends/$PAPP_NAME/.env.local" \
                 "$WORKTREE/dashboard/papps/frontends/.env.local" \
                 "/mnt/e/akselos-dev-3.10/akselos-dev-2/dashboard/papps/frontends/.env.local"; do
    [ -f "$ENV_LOCAL" ] || continue
    while IFS='=' read -r key value; do
        case "$key" in ''|\#*) continue;; esac
        key="$(echo "$key" | tr -d ' ')"
        value="${value%\"}"; value="${value#\"}"; value="${value%\'}"; value="${value#\'}"
        [ -z "${!key+x}" ] && export "$key=$value"
        case "$key" in VITE_OPENROUTER_*)
            plain="${key#VITE_}"
            [ -z "${!plain+x}" ] && export "$plain=$value"
        ;; esac
    done < "$ENV_LOCAL"
done

cd "$WORKTREE/dashboard/papps/backends/$PAPP_NAME" || exit 1

if [ -n "$ISOLATED_PORT" ]; then
    echo "Starting isolated uvicorn for $PAPP_NAME on port $ISOLATED_PORT..."
    exec /usr/local/bin/uvicorn papp_main:fast_api --host 127.0.0.1 --port "$ISOLATED_PORT"
else
    exec /usr/bin/python3 papp_main.py
fi
