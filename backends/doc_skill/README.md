# doc_skill Backend

Vendored documentation-pipeline skill bundle plus lightweight sidecar server.

## Overview

This backend packages a set of Claude Code skills focused on documentation generation, code indexing, and project harness automation. The actual execution is delegated to the vendored skill scripts themselves — the sidecar server (added in Phase 1) wraps these Python tools rather than reimplementing them.

## Contents

- `skills/caveman/` — Caveman mode skill (compressed communication)
- `skills/harness/` — Harness automation skill
- `skills/harness_doc_site/` — Documentation site builder
- `skills/project-harness/` — Project harness and templating

## Sidecar Server (Phase 1)

**Port:** 8323

The sidecar server will provide a lightweight HTTP interface to trigger and monitor skill execution. See Phase 1 task for implementation details.

## Notes

- **Filesystem performance:** Prefer native Linux filesystem target repos over WSL `/mnt/*` paths when using this feature. WSL's 9p protocol overhead makes `/mnt/*` I/O significantly slower.
- **No Node dependencies:** This backend is pure Python. No `package.json` or npm workspaces required.
