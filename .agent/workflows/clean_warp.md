---
name: clean_warp
description: Remove WARP intelligence artifacts for a target directory.
---
# Clean Warp Workflow

Remove WARP artifacts to free up space or switch contexts cleanly.

## Steps
1. Identify the target directory to clean.
2. Execute the clean command based on your host OS:
   - **Windows:** `powershell -ExecutionPolicy Bypass -File ./warp.ps1 clean <target>`
   - **Linux / Zsh:** `./warp.sh clean <target>`
3. Verify artifacts are removed.
