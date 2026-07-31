---
name: init_warp
description: Initialize WARP architecture and search intelligence for a target directory.
---
# Init Warp Workflow

Initialize WARP for a new target to gain architectural and search intelligence.

## Steps
1. Identify the target directory.
2. Execute the init command based on your host OS:
   - **Windows:** `powershell -ExecutionPolicy Bypass -File ./warp.ps1 init <target>`
   - **Linux / Zsh:** `./warp.sh init <target>`
3. Review the `graphify-out/GRAPH_REPORT.md` to understand the architecture.
4. Verify indexing with `onwatch status`.
