"""Resolve Jacked catalog data (skills, agents, commands, rules, packs).

PixelOffice keeps the editable catalog under ``<repo>/.agent/jacked/data/``.
Package-shipped runtime assets (hooks, web UI, git-hooks, lenses) stay in
``jacked/data/`` beside this module.
"""
from __future__ import annotations

import os
from pathlib import Path

_CATALOG_ENV = "PIXELOFFICE_AGENT_JACKED_DATA"
_AGENT_REL = Path(".agent") / "jacked" / "data"


def get_package_data_root() -> Path:
    """Shipped package data: hooks, web dashboard, lenses, git-hooks, …"""
    return Path(__file__).resolve().parent / "data"


def _is_catalog_root(path: Path) -> bool:
    return (path / "skills").is_dir() or (path / "packs.json").is_file()


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


def _catalog_from_pixeloffice_layout(package_dir: Path) -> Path | None:
    """``backends/jacked/jacked`` → repo ``.agent/jacked/data``."""
    backend_jacked = package_dir.parent
    if backend_jacked.name != "jacked" or backend_jacked.parent.name != "backends":
        return None
    candidate = backend_jacked.parent.parent / _AGENT_REL
    return candidate if _is_catalog_root(candidate) else None


def resolve_agent_catalog_data_root() -> Path | None:
    """Repo-local catalog when present; ``None`` if only package data exists."""
    override = os.environ.get(_CATALOG_ENV, "").strip()
    if override:
        path = Path(override).expanduser()
        return path if _is_catalog_root(path) else None

    for base in _walk_parents(Path.cwd()):
        candidate = base / _AGENT_REL
        if _is_catalog_root(candidate):
            return candidate

    from_package = _catalog_from_pixeloffice_layout(Path(__file__).resolve().parent)
    if from_package is not None:
        return from_package

    return None


def get_catalog_data_root() -> Path:
    """Skills/agents/commands/rules/packs source root (``.agent`` preferred)."""
    agent = resolve_agent_catalog_data_root()
    if agent is not None:
        return agent
    return get_package_data_root()


def resolve_catalog_file(relative: str) -> Path:
    """Resolve a catalog-relative file with package fallback."""
    rel = Path(relative)
    agent = resolve_agent_catalog_data_root()
    if agent is not None:
        candidate = agent / rel
        if candidate.exists():
            return candidate
    return get_package_data_root() / rel
