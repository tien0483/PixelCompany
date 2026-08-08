# Copyright (C) 2026 Akselos
"""Registry of known doc-pipeline projects, backed by a single JSON file.

State file (default): ``~/.agent/doc-skill/projects.json``. Every function here takes an optional
``path`` override so tests never have to touch the real file.

This registry is the *only* path allowlist in the sidecar: every HTTP endpoint other than
``POST /api/projects`` / ``POST /api/projects/adopt`` takes a project ``id`` and looks up its
``workspaceDir``/``targetRepo`` here — nothing else accepts an arbitrary filesystem path straight
from a request.
"""

from __future__ import annotations

import datetime
import hashlib
import json
import os
import pathlib
import tempfile
import threading

DEFAULT_STATE_PATH = pathlib.Path.home() / '.agent' / 'doc-skill' / 'projects.json'

# Guards every read-modify-write sequence against `ThreadingHTTPServer`'s real concurrent request
# threads (e.g. two `POST /api/projects` calls, or a `POST` racing a `DELETE`, both loading the same
# on-disk snapshot and one silently clobbering the other's change on save). Reentrant because
# `adopt_project` calls `register_project`, which also takes the lock, from the same thread.
_LOCK = threading.RLock()


class PathError(ValueError):
    """A target_repo / workspaceDir pair failed the containment check, or adoption preconditions."""


def _state_path(path: pathlib.Path | str | None) -> pathlib.Path:
    return pathlib.Path(path) if path is not None else DEFAULT_STATE_PATH


def load_registry(path: pathlib.Path | str | None = None) -> dict:
    p = _state_path(path)
    if not p.exists():
        return {'projects': []}
    try:
        data = json.loads(p.read_text(encoding='utf-8'))
    except (json.JSONDecodeError, OSError):
        return {'projects': []}
    data.setdefault('projects', [])
    return data


def save_registry(data: dict, path: pathlib.Path | str | None = None) -> None:
    """Writes the registry atomically: temp file in the same directory, then `os.replace`.

    `os.replace` is an atomic rename on POSIX and Windows, so a reader (or a process kill) never
    observes a partially-written file — the old contents remain visible until the new file is fully
    written and flushed. Callers that mutate the registry must hold `_LOCK` around their whole
    load-modify-save sequence; this function alone only makes a single save atomic, not a
    read-modify-write pair against concurrent writers.
    """
    p = _state_path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(dir=str(p.parent), prefix='.projects-', suffix='.json.tmp')
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            f.write(json.dumps(data, indent=2) + '\n')
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp_name, str(p))
    except BaseException:
        try:
            os.unlink(tmp_name)
        except OSError:
            pass
        raise


def list_projects(path: pathlib.Path | str | None = None) -> list[dict]:
    return load_registry(path).get('projects', [])


def get_project(project_id: str, path: pathlib.Path | str | None = None) -> dict | None:
    for p in list_projects(path):
        if p['id'] == project_id:
            return p
    return None


def make_id(workspace_abs: pathlib.Path | str) -> str:
    return hashlib.sha1(str(workspace_abs).encode('utf-8')).hexdigest()[:12]


def resolve_workspace(target_repo: str, workspace_dir: str) -> tuple[pathlib.Path, pathlib.Path]:
    """Resolves ``workspace_dir`` against ``target_repo`` and enforces containment.

    ``workspace_dir`` is joined onto ``target_repo`` when relative (absolute paths are joined
    as-is, which only matters if they already land inside ``target_repo``). Both `..` segments and
    symlink escapes are caught the same way ``static.py``'s traversal guard works: resolve with
    ``os.path.realpath`` and require the result to share ``target_repo``'s real path as a prefix via
    ``os.path.commonpath``.

    Returns ``(target_repo_abs, workspace_abs)``, both real paths. Raises ``PathError`` on any
    validation failure.
    """
    target_repo_path = pathlib.Path(target_repo)
    if not target_repo_path.is_dir():
        raise PathError(f'target_repo does not exist or is not a directory: {target_repo}')
    target_real = pathlib.Path(os.path.realpath(str(target_repo_path)))

    ws = pathlib.Path(workspace_dir)
    joined = ws if ws.is_absolute() else target_repo_path / ws
    resolved_real = pathlib.Path(os.path.realpath(str(joined)))

    try:
        common = os.path.commonpath([str(target_real), str(resolved_real)])
    except ValueError:
        # Different drives (Windows) or otherwise incomparable — treat as an escape.
        raise PathError(f'workspaceDir escapes target_repo: {workspace_dir}') from None
    if common != str(target_real):
        raise PathError(f'workspaceDir escapes target_repo: {workspace_dir}')

    return target_real, resolved_real


def _now_iso() -> str:
    return datetime.datetime.now(datetime.timezone.utc).isoformat().replace('+00:00', 'Z')


def register_project(name: str, target_repo: str, workspace_dir: str, tagline: str = '',
                      path: pathlib.Path | str | None = None) -> dict:
    """Validates the path pair, then upserts a project record keyed by the workspace's id."""
    target_repo_abs, workspace_abs = resolve_workspace(target_repo, workspace_dir)
    record = {
        'id': make_id(workspace_abs),
        'name': name,
        'targetRepo': str(target_repo_abs),
        'workspaceDir': str(workspace_abs),
        'tagline': tagline or '',
        'createdAt': _now_iso(),
    }
    with _LOCK:
        data = load_registry(path)
        data['projects'] = [p for p in data['projects'] if p['id'] != record['id']]
        data['projects'].append(record)
        save_registry(data, path)
    return record


def adopt_project(target_repo: str, workspace_dir: str, name: str | None = None, tagline: str = '',
                   path: pathlib.Path | str | None = None) -> dict:
    """Same path validation as `register_project`, plus: `site.json` must already exist.

    This is how a hand-built or previously-scaffolded workspace (never run through `op_init` by this
    sidecar) gets registered without re-running `init_doc_site.py` and clobbering it.
    """
    target_repo_abs, workspace_abs = resolve_workspace(target_repo, workspace_dir)
    site_json = workspace_abs / 'site.json'
    if not site_json.exists():
        raise PathError(f'no site.json at {workspace_abs} — not an existing workspace')

    proj_name = name
    if not proj_name:
        try:
            site = json.loads(site_json.read_text(encoding='utf-8'))
            proj_name = site.get('project') or workspace_abs.name
        except (json.JSONDecodeError, OSError):
            proj_name = workspace_abs.name

    return register_project(proj_name, str(target_repo_abs), str(workspace_abs), tagline, path)


def unregister_project(project_id: str, path: pathlib.Path | str | None = None) -> bool:
    """Removes the project from the registry JSON only — never touches files on disk."""
    with _LOCK:
        data = load_registry(path)
        before = len(data['projects'])
        data['projects'] = [p for p in data['projects'] if p['id'] != project_id]
        save_registry(data, path)
        return len(data['projects']) != before
