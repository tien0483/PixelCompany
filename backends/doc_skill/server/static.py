# Copyright (C) 2026 Akselos
"""Serves the generated doc-site HTML out of a project's workspace directory.

`resolve_static_path` is the only place a request-supplied sub-path ever touches the filesystem, so
it is deliberately paranoid: it resolves symlinks with `os.path.realpath` and requires the result to
share the workspace's real path via `os.path.commonpath`, exactly like `registry.py`'s
`resolve_workspace` traversal guard. `../` segments and symlink escapes are both rejected the same
way.
"""

from __future__ import annotations

import os
import pathlib

CONTENT_TYPES = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.md': 'text/markdown',
    '.js': 'text/javascript',
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
}
DEFAULT_CONTENT_TYPE = 'application/octet-stream'


class TraversalError(ValueError):
    """The requested sub-path resolves outside the workspace directory."""


def guess_content_type(path: pathlib.Path) -> str:
    return CONTENT_TYPES.get(path.suffix.lower(), DEFAULT_CONTENT_TYPE)


def resolve_static_path(workspace_dir: str | pathlib.Path, sub_path: str) -> pathlib.Path:
    """Resolves `workspace_dir / sub_path`, verifying it stays inside `workspace_dir`.

    `sub_path` is whatever came after `/site/{id}/` in the request URL (already URL-decoded, no
    leading slash expected but tolerated). Raises `TraversalError` if the resolved real path is not
    under the workspace's real path — this catches both lexical `../` traversal and a symlink inside
    the workspace pointing outside it.
    """
    workspace_real = pathlib.Path(os.path.realpath(str(workspace_dir)))
    # `sub_path` may be empty (directory index) — pathlib.Path('') stays '.', which joins to the
    # workspace root itself, which is what we want.
    candidate = workspace_real / sub_path.lstrip('/')
    resolved_real = pathlib.Path(os.path.realpath(str(candidate)))

    try:
        common = os.path.commonpath([str(workspace_real), str(resolved_real)])
    except ValueError:
        raise TraversalError(f'path escapes workspace: {sub_path}') from None
    if common != str(workspace_real):
        raise TraversalError(f'path escapes workspace: {sub_path}')

    return resolved_real


def load_static_file(workspace_dir: str | pathlib.Path, sub_path: str) -> tuple[bytes, str] | None:
    """Returns `(body_bytes, content_type)` for a `/site/{id}/<sub_path>` request.

    Returns `None` if nothing exists at the resolved path (caller should respond 404). Raises
    `TraversalError` if the path escapes the workspace (caller should respond 403). A directory (or
    empty `sub_path`) serves that directory's `index.html`.
    """
    resolved = resolve_static_path(workspace_dir, sub_path)
    if resolved.is_dir():
        resolved = resolved / 'index.html'
    if not resolved.is_file():
        return None
    return resolved.read_bytes(), guess_content_type(resolved)
