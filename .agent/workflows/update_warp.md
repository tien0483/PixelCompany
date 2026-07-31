---
name: update_warp
description: Synchronize WARP architecture and search index before major transitions.
---
# Update Warp Workflow

Synchronize architecture and search index before major transitions or commits.

## Steps
1. Execute the update command based on your host OS:
   - **Windows:** `powershell -ExecutionPolicy Bypass -File ./warp.ps1 update`
   - **Linux / Zsh:** `./warp.sh update`
2. Review any changes in the graph or index via `onwatch status`.
3. Proceed with commit or deployment.
