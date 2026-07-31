#!/bin/bash
# Build a Vite frontend in WSL.
# Usage: build_papp.sh [repo_root] [papp_name]
#   repo_root defaults to the main checkout.
#   papp_name defaults to demo_ai_dashboard.
export PATH="/home/ubuntu/.nvm/versions/node/v22.22.1/bin:$PATH"
REPO_ROOT="${1:-/mnt/e/akselos-dev-3.10/akselos-dev-2}"
PAPP_NAME="${2:-demo_ai_dashboard}"
cd "$REPO_ROOT/dashboard/papps/frontends" || exit 1
# Bypass tsc -b because of non-fatal wasm bindings error
VITE_MY_APP="$PAPP_NAME" npx vite build
