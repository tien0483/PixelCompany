"""Tests for repo-local .agent/jacked/data catalog resolution."""
from __future__ import annotations

from pathlib import Path

import pytest

from jacked import data_paths


@pytest.fixture(autouse=True)
def _clear_catalog_env(monkeypatch):
    monkeypatch.delenv(data_paths._CATALOG_ENV, raising=False)


def test_get_catalog_data_root_prefers_agent_tree(tmp_path, monkeypatch):
    agent = tmp_path / ".agent" / "jacked" / "data"
    (agent / "skills" / "demo").mkdir(parents=True)
    (agent / "skills" / "demo" / "SKILL.md").write_text("---\nname: demo\n---\n", encoding="utf-8")
    monkeypatch.chdir(tmp_path)
    assert data_paths.get_catalog_data_root() == agent


def test_get_catalog_data_root_falls_back_to_package():
    root = data_paths.get_catalog_data_root()
    assert root.is_dir()
    assert (root / "skills").is_dir() or (root / "packs.json").is_file()


def test_env_override_wins(tmp_path, monkeypatch):
    agent = tmp_path / "custom-catalog"
    (agent / "packs.json").write_text("{}", encoding="utf-8")
    monkeypatch.setenv(data_paths._CATALOG_ENV, str(agent))
    assert data_paths.get_catalog_data_root() == agent


def test_pixeloffice_repo_layout_from_package():
    repo_agent = data_paths._catalog_from_pixeloffice_layout(Path(__file__).resolve().parent.parent)
    if repo_agent is None:
        pytest.skip("not running from PixelOffice backends/jacked layout")
    assert repo_agent.name == "data"
    assert (repo_agent / "skills").is_dir()
