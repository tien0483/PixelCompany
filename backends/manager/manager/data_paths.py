"""Resolve PixelOffice Manager data (catalog + runtime).

Catalog lives under ``<repo>/agent-data/catalog/`` (skills, agents, commands,
rules, packs). Runtime assets live under ``<repo>/agent-data/runtime/``
(hooks, web UI, lenses, guardrails, git-hooks, templates).

Both used to sit under ``<repo>/.agent/manager/``; those paths stay in the
candidate lists so an un-migrated checkout still resolves.
"""
from __future__ import annotations

import os
from pathlib import Path

_CATALOG_ENV = "PIXELOFFICE_AGENT_MANAGER_DATA"
_CATALOG_ENV_LEGACY = "PIXELOFFICE_AGENT_JACKED_DATA"
_RUNTIME_ENV = "PIXELOFFICE_AGENT_MANAGER_RUNTIME"
_RUNTIME_ENV_LEGACY = "PIXELOFFICE_AGENT_JACKED_RUNTIME"

_AGENT_DATA_REL = Path("agent-data")
_LEGACY_MANAGER_REL = Path(".agent") / "manager"

# Preferred first; the legacy location is only reached when the new one is absent.
_CATALOG_RELS = (_AGENT_DATA_REL / "catalog", _LEGACY_MANAGER_REL / "data")
_RUNTIME_RELS = (_AGENT_DATA_REL / "runtime", _LEGACY_MANAGER_REL / "runtime")

_CATALOG_REL = _CATALOG_RELS[0]
_RUNTIME_REL = _RUNTIME_RELS[0]


def get_package_data_root() -> Path:
    """Legacy alias — prefer :func:`get_runtime_data_root`."""
    return get_runtime_data_root()


def _is_catalog_root(path: Path) -> bool:
    return (path / "skills").is_dir() or (path / "packs.json").is_file()


def _is_runtime_root(path: Path) -> bool:
    return (path / "hooks").is_dir() or (path / "web").is_dir()


def _walk_parents(start: Path, *, max_depth: int = 10) -> list[Path]:
    current = start.resolve()
    seen: set[Path] = set()
    roots: list[Path] = []
    for _ in range(max_depth):
        if current in seen:
            break
        seen.add(current)
        roots.append(current)
        parent = current.parent
        if parent == current:
            break
        current = parent
    return roots


def _env_path(name: str, *, legacy: str | None = None) -> Path | None:
    raw = os.environ.get(name, "").strip()
    if not raw and legacy:
        raw = os.environ.get(legacy, "").strip()
    if not raw:
        return None
    return Path(raw).expanduser()


def _pixeloffice_repo_root(package_dir: Path) -> Path | None:
    backend = package_dir.parent
    if backend.parent.name != "backends":
        return None
    if backend.name not in ("manager", "jacked"):
        return None
    return backend.parent.parent


def _catalog_from_pixeloffice_layout(package_dir: Path) -> Path | None:
    repo_root = _pixeloffice_repo_root(package_dir)
    if repo_root is None:
        return None
    for rel in _CATALOG_RELS:
        candidate = repo_root / rel
        if _is_catalog_root(candidate):
            return candidate
    return None


def _runtime_from_pixeloffice_layout(package_dir: Path) -> Path | None:
    repo_root = _pixeloffice_repo_root(package_dir)
    if repo_root is None:
        return None
    for rel in _RUNTIME_RELS:
        candidate = repo_root / rel
        if _is_runtime_root(candidate):
            return candidate
    return None


def _shipped_runtime_root() -> Path:
    return Path(__file__).resolve().parent / "data"


def resolve_agent_catalog_data_root() -> Path | None:
    """Repo-local catalog when present."""
    override = _env_path(_CATALOG_ENV, legacy=_CATALOG_ENV_LEGACY)
    if override is not None:
        return override if _is_catalog_root(override) else None

    for base in _walk_parents(Path.cwd()):
        for rel in _CATALOG_RELS:
            candidate = base / rel
            if _is_catalog_root(candidate):
                return candidate

    return _catalog_from_pixeloffice_layout(Path(__file__).resolve().parent)


def resolve_agent_runtime_data_root() -> Path | None:
    """Repo-local runtime assets when present."""
    override = _env_path(_RUNTIME_ENV, legacy=_RUNTIME_ENV_LEGACY)
    if override is not None:
        return override if _is_runtime_root(override) else None

    for base in _walk_parents(Path.cwd()):
        for rel in _RUNTIME_RELS:
            candidate = base / rel
            if _is_runtime_root(candidate):
                return candidate

    return _runtime_from_pixeloffice_layout(Path(__file__).resolve().parent)


def get_catalog_data_root() -> Path:
    """Skills/agents/commands/rules/packs source root."""
    agent = resolve_agent_catalog_data_root()
    if agent is not None:
        return agent
    shipped = _shipped_runtime_root()
    if _is_catalog_root(shipped):
        return shipped
    return shipped


def get_runtime_data_root() -> Path:
    """Hooks/web/lenses/guardrails/git-hooks/templates source root."""
    agent = resolve_agent_runtime_data_root()
    if agent is not None:
        return agent
    shipped = _shipped_runtime_root()
    if _is_runtime_root(shipped):
        return shipped
    return shipped


def resolve_catalog_file(relative: str) -> Path:
    """Resolve a catalog-relative file with package fallback."""
    rel = Path(relative)
    agent = resolve_agent_catalog_data_root()
    if agent is not None:
        candidate = agent / rel
        if candidate.exists():
            return candidate
    return get_catalog_data_root() / rel


def resolve_runtime_file(relative: str) -> Path:
    """Resolve a runtime-relative file with package fallback."""
    rel = Path(relative)
    agent = resolve_agent_runtime_data_root()
    if agent is not None:
        candidate = agent / rel
        if candidate.exists():
            return candidate
    return get_runtime_data_root() / rel
