---
name: build_papp
description: "Vite/WASM frontend build script wrapper — use to correctly build any Papp frontend inside WSL using the provided shell script. Triggers: 'build the frontend', 'use the build_papp skill', 'rebuild papp'."
---

# build_papp

This skill provides a straightforward mechanism to rebuild the Vite frontend for a Papp inside WSL.

### Usage
Execute the script with the worktree (or main checkout) and the Papp name:
```bash
wsl bash .agent/skills/build_papp/scripts/build_papp.sh <worktree_path> <papp_name>
```

### Concurrent Usage
When testing multiple branches simultaneously, execute builds in parallel (using `&`) and redirect their output to distinct log files so they don't interleave in the terminal:

```bash
# Build Branch A in background
wsl bash .agent/skills/build_papp/scripts/build_papp.sh /mnt/e/akselos-dev-3.10/branch_a_wt my_papp > build_a.log 2>&1 &
PID_A=$!

# Wait for both to finish
wait $PID_A
```

Always wait for the "✓ built in Xm Ys" confirmation in the logs before refreshing the browser for each respective branch.
