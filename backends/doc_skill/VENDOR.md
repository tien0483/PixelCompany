# Vendor Information

## Origin

- **Source:** `/mnt/c/Users/User/Downloads/doc_skill/`
- **Copy date:** 2026-08-08
- **Type:** Vendored Claude Code skill bundle

## Fork Delta

| Change | Status | Notes |
|--------|--------|-------|
| Add `--json` flag to `round_tool.py` status subcommand | Planned (Task 2) | Currently text-only output; will be enhanced in Phase 1 sidecar to support JSON output |

## Known Quirks (Not Modified)

### `harness_doc_site/`
- `build_site.py` and `code_index.py` contain hardcoded fallbacks specific to a prior BIM-viewer project
- These are harmless and expected to be overridden by `site.json` in a workspace
- Left as-is to avoid breaking the vendored skill

### `project-harness/`
- Contains assumptions and configuration specific to the "akselos" project/company
- Kept as-is without modification to preserve skill integrity
