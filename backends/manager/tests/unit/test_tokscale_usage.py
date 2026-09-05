"""Unit tests for manager.web.tokscale_usage."""

from __future__ import annotations

import json
import subprocess
from datetime import date

from manager.web.tokscale_usage import (
    aggregate_tokscale_entries,
    cache_hit_ratio,
    clear_tokscale_cache,
    date_flags_for_days,
    fetch_tokscale_overview,
    resolve_tokscale_argv,
)


SAMPLE_ENTRIES = [
    {
        "client": "claude",
        "provider": "anthropic",
        "model": "claude-opus-4",
        "input": 1000,
        "output": 200,
        "cacheRead": 3000,
        "cacheWrite": 100,
        "reasoning": 0,
        "messageCount": 5,
        "cost": 1.5,
    },
    {
        "client": "codex",
        "provider": "openai",
        "model": "gpt-5",
        "input": 500,
        "output": 50,
        "cacheRead": 0,
        "cacheWrite": 0,
        "reasoning": 40,
        "messageCount": 2,
        "cost": 0.25,
    },
    {
        "client": "cursor",
        "provider": "anthropic",
        "model": "claude-sonnet",
        "input": 200,
        "output": 100,
        "cacheRead": 800,
        "cacheWrite": 0,
        "messageCount": 3,
        "cost": 0.4,
    },
]


class TestDateFlags:
    def test_one_day_is_today(self):
        assert date_flags_for_days(1) == ["--today"]

    def test_seven_days_is_week(self):
        assert date_flags_for_days(7) == ["--week"]

    def test_thirty_days_uses_since(self):
        flags = date_flags_for_days(30, today=date(2026, 9, 5))
        assert flags == ["--since", "2026-08-07"]


class TestCacheHit:
    def test_ratio(self):
        assert cache_hit_ratio(75, 25) == 0.75

    def test_zero_denom(self):
        assert cache_hit_ratio(0, 0) is None


class TestAggregate:
    def test_overall_and_breakdowns(self):
        ov = aggregate_tokscale_entries(SAMPLE_ENTRIES)
        # tokens: (1000+200+3000+100) + (500+50+0+0+40) + (200+100+800) = 4300+590+1100 = 5990
        assert ov["total_tokens"] == 5990
        assert ov["total_cost_usd"] == 2.15
        assert ov["message_count"] == 10
        assert ov["session_count"] is None
        # cache: 3000+0+800=3800, input 1000+500+200=1700 → 3800/5500
        assert ov["cache_hit_ratio"] == round(3800 / 5500, 4)

        providers = {r["provider"]: r for r in ov["by_provider"]}
        assert set(providers) == {"anthropic", "openai"}
        assert providers["anthropic"]["total_cost_usd"] == 1.9
        assert providers["openai"]["total_cost_usd"] == 0.25
        assert ov["by_provider"][0]["provider"] == "anthropic"

        clients = {(r["client"], r["provider"]): r for r in ov["by_client"]}
        assert ("claude", "anthropic") in clients
        assert ("cursor", "anthropic") in clients
        assert ("codex", "openai") in clients

    def test_empty(self):
        ov = aggregate_tokscale_entries([])
        assert ov["total_tokens"] is None
        assert ov["by_provider"] == []
        assert ov["by_client"] == []


class TestFetch:
    def setup_method(self):
        clear_tokscale_cache()

    def test_success(self):
        payload = {"groupBy": "client,provider,model", "entries": SAMPLE_ENTRIES}

        def run(argv):
            assert "models" in argv
            assert "--json" in argv
            assert "client,provider,model" in argv
            return subprocess.CompletedProcess(argv, 0, stdout=json.dumps(payload), stderr="")

        result = fetch_tokscale_overview(7, run=run, use_cache=False)
        assert result["source"] == "tokscale"
        assert result["error"] is None
        assert result["overview"]["total_tokens"] == 5990

    def test_nonzero_exit(self):
        def run(argv):
            return subprocess.CompletedProcess(argv, 1, stdout="", stderr="boom\n")

        result = fetch_tokscale_overview(1, run=run, use_cache=False)
        assert result["source"] == "none"
        assert result["overview"]["total_tokens"] is None
        assert "boom" in (result["error"] or "")

    def test_bad_json(self):
        def run(argv):
            return subprocess.CompletedProcess(argv, 0, stdout="not-json", stderr="")

        result = fetch_tokscale_overview(1, run=run, use_cache=False)
        assert result["source"] == "none"
        assert "invalid JSON" in (result["error"] or "")


class TestResolveArgv:
    def test_env_bin(self, monkeypatch):
        monkeypatch.setenv("TOKSCALE_BIN", "/opt/tokscale")
        monkeypatch.setattr("manager.web.tokscale_usage.shutil.which", lambda _: None)
        assert resolve_tokscale_argv(["models"])[0] == "/opt/tokscale"
