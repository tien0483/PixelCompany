"""Tests for repo-local .agent/manager catalog and runtime resolution."""
from __future__ import annotations

from pathlib import Path

import pytest

from manager import data_paths


@pytest.fixture(autouse=True)
def _clear_manager_env(monkeypatch):
    monkeypatch.delenv(data_paths._CATALOG_ENV, raising=False)
    monkeypatch.delenv(data_paths._CATALOG_ENV_LEGACY, raising=False)
    monkeypatch.delenv(data_paths._RUNTIME_ENV, raising=False)
    monkeypatch.delenv(data_paths._RUNTIME_ENV_LEGACY, raising=False)


def test_get_catalog_data_root_prefers_manager_tree(tmp_path, monkeypatch):
    agent = tmp_path / ".agent" / "manager" / "data"
    (agent / "skills" / "demo").mkdir(parents=True)
    (agent / "skills" / "demo" / "SKILL.md").write_text("---\nname: demo\n---\n", encoding="utf-8")
    monkeypatch.chdir(tmp_path)
    assert data_paths.get_catalog_data_root() == agent


def test_get_runtime_data_root_prefers_manager_tree(tmp_path, monkeypatch):
    runtime = tmp_path / ".agent" / "manager" / "runtime"
    (runtime / "hooks").mkdir(parents=True)
    (runtime / "hooks" / "demo.py").write_text("# demo\n", encoding="utf-8")
    monkeypatch.chdir(tmp_path)
    assert data_paths.get_runtime_data_root() == runtime


def test_get_catalog_data_root_resolves_pixeloffice_manager_catalog():
    root = data_paths.get_catalog_data_root()
    assert root.is_dir()
    assert (root / "skills").is_dir()
    assert (root / "packs.json").is_file()
    normalized = str(root).replace("\\", "/")
    assert "agent-data/catalog" in normalized


def test_get_runtime_data_root_resolves_pixeloffice_manager_runtime():
    root = data_paths.get_runtime_data_root()
    assert root.is_dir()
    assert (root / "hooks").is_dir()
    assert (root / "web").is_dir()
    normalized = str(root).replace("\\", "/")
    assert "agent-data/runtime" in normalized


def test_catalog_env_override_wins(tmp_path, monkeypatch):
    agent = tmp_path / "custom-catalog"
    agent.mkdir(parents=True)
    (agent / "packs.json").write_text("{}", encoding="utf-8")
    monkeypatch.setenv(data_paths._CATALOG_ENV, str(agent))
    assert data_paths.get_catalog_data_root() == agent


def test_legacy_jacked_catalog_env_still_works(tmp_path, monkeypatch):
    agent = tmp_path / "legacy-catalog"
    agent.mkdir(parents=True)
    (agent / "packs.json").write_text("{}", encoding="utf-8")
    monkeypatch.setenv(data_paths._CATALOG_ENV_LEGACY, str(agent))
    assert data_paths.get_catalog_data_root() == agent


def test_runtime_env_override_wins(tmp_path, monkeypatch):
    runtime = tmp_path / "custom-runtime"
    (runtime / "web").mkdir(parents=True)
    monkeypatch.setenv(data_paths._RUNTIME_ENV, str(runtime))
    assert data_paths.get_runtime_data_root() == runtime


def test_pixeloffice_repo_layout_from_package():
    repo_catalog = data_paths._catalog_from_pixeloffice_layout(Path(__file__).resolve().parent.parent)
    if repo_catalog is None:
        pytest.skip("not running from PixelOffice backends/manager layout")
    assert repo_catalog.name == "catalog"
    assert (repo_catalog / "skills").is_dir()

    repo_runtime = data_paths._runtime_from_pixeloffice_layout(Path(__file__).resolve().parent.parent)
    assert repo_runtime is not None
    assert repo_runtime.name == "runtime"
    assert (repo_runtime / "hooks").is_dir()
