"""Unit tests for Antigravity quota retrieval and normalization."""

from pathlib import Path
from unittest.mock import AsyncMock, patch
import pytest

from manager.antigravity.usage import (
    _parse_buckets,
    normalize_pools,
    _fetch_pool,
    fetch_antigravity_usage,
    _POOLS,
)


def test_parse_buckets_quota_summary_groups():
    """Verify parsing of retrieveUserQuotaSummary format with groups."""
    payload = {
        "groups": [
            {
                "displayName": "Gemini Models",
                "buckets": [
                    {
                        "bucketId": "gemini-weekly",
                        "window": "weekly",
                        "remainingFraction": 0.15,
                        "resetTime": "2026-08-28T08:46:37Z",
                    },
                    {
                        "bucketId": "gemini-5h",
                        "window": "5h",
                        "remainingFraction": 0.60,
                        "resetTime": "2026-08-26T10:06:29Z",
                    },
                ],
            },
            {
                "displayName": "Claude and GPT models",
                "buckets": [
                    {
                        "bucketId": "3p-weekly",
                        "window": "weekly",
                        "remainingFraction": 0.40,
                        "resetTime": "2026-08-29T17:11:29Z",
                    },
                    {
                        "bucketId": "3p-5h",
                        "window": "5h",
                        "remainingFraction": 1.0,
                        "resetTime": "2026-08-26T11:08:17Z",
                    },
                ],
            },
        ]
    }
    buckets = _parse_buckets(payload)
    assert len(buckets) == 4

    weekly = [b for b in buckets if b["is_weekly"]]
    assert len(weekly) == 2
    # Gemini weekly: 1 - 0.15 = 85%
    gemini_weekly = next(b for b in weekly if "gemini" in b["model_id"])
    assert round(gemini_weekly["used_percent"], 1) == 85.0
    assert gemini_weekly["reset_time"] == "2026-08-28T08:46:37Z"

    five_h = [b for b in buckets if b["is_5h"]]
    assert len(five_h) == 2
    # Gemini 5h: 1 - 0.60 = 40%
    gemini_5h = next(b for b in five_h if "gemini" in b["model_id"])
    assert round(gemini_5h["used_percent"], 1) == 40.0


def test_normalize_pools_groups_worst_windows():
    """Verify normalize_pools selects worst used% for 5h and weekly across groups."""
    pools = [
        {
            "name": "antigravity",
            "buckets": [
                {
                    "model_id": "Gemini Models:gemini-weekly",
                    "used_percent": 85.0,
                    "reset_time": "2026-08-28T08:46:37Z",
                    "is_5h": False,
                    "is_weekly": True,
                },
                {
                    "model_id": "Gemini Models:gemini-5h",
                    "used_percent": 40.0,
                    "reset_time": "2026-08-26T10:06:29Z",
                    "is_5h": True,
                    "is_weekly": False,
                },
                {
                    "model_id": "Claude and GPT models:3p-weekly",
                    "used_percent": 60.0,
                    "reset_time": "2026-08-29T17:11:29Z",
                    "is_5h": False,
                    "is_weekly": True,
                },
                {
                    "model_id": "Claude and GPT models:3p-5h",
                    "used_percent": 0.0,
                    "reset_time": "2026-08-26T11:08:17Z",
                    "is_5h": True,
                    "is_weekly": False,
                },
            ],
        }
    ]
    norm = normalize_pools(pools)
    # five_hour should pick Gemini 5h (40% > 0%)
    assert norm["five_hour"]["utilization"] == 40.0
    assert norm["five_hour"]["resets_at"] == "2026-08-26T10:06:29Z"
    assert norm["five_hour"]["reported"] is True

    # seven_day should pick Gemini weekly (85% > 60%)
    assert norm["seven_day"]["utilization"] == 85.0
    assert norm["seven_day"]["resets_at"] == "2026-08-28T08:46:37Z"
    assert norm["seven_day"]["reported"] is True


def test_normalize_pools_legacy_fallback():
    """Verify fallback to pro/flash model heuristic when windows are absent."""
    pools = [
        {
            "name": "legacy",
            "buckets": [
                {
                    "model_id": "gemini-1.5-pro",
                    "used_percent": 33.0,
                    "reset_time": "2026-08-26T12:00:00Z",
                    "is_5h": False,
                    "is_weekly": False,
                    "is_pro": True,
                    "is_flash": False,
                },
                {
                    "model_id": "gemini-1.5-flash",
                    "used_percent": 12.0,
                    "reset_time": "2026-08-26T13:00:00Z",
                    "is_5h": False,
                    "is_weekly": False,
                    "is_pro": False,
                    "is_flash": True,
                },
            ],
        }
    ]
    norm = normalize_pools(pools)
    assert norm["five_hour"]["utilization"] == 33.0
    assert norm["seven_day"]["utilization"] == 12.0


@pytest.mark.anyio
async def test_fetch_pool_calls_summary_endpoint():
    """Verify _fetch_pool calls retrieveUserQuotaSummary with project_id."""
    pool = _POOLS[0]
    client = AsyncMock()

    load_resp = AsyncMock()
    load_resp.status_code = 200
    load_resp.json = lambda: {
        "cloudaicompanionProject": "test-project-123",
        "paidTier": {"name": "Google AI Pro"},
    }

    quota_resp = AsyncMock()
    quota_resp.status_code = 200
    quota_resp.json = lambda: {
        "groups": [
            {
                "displayName": "Gemini Models",
                "buckets": [
                    {
                        "bucketId": "gemini-5h",
                        "window": "5h",
                        "remainingFraction": 0.5,
                        "resetTime": "2026-08-26T10:00:00Z",
                    }
                ],
            }
        ]
    }

    client.post = AsyncMock(side_effect=[load_resp, quota_resp])

    result = await _fetch_pool(client, "test-token", pool)
    assert result["project_id"] == "test-project-123"
    assert result["tier"] == "Google AI Pro"
    assert len(result["buckets"]) == 1
    assert result["buckets"][0]["used_percent"] == 50.0

    # Ensure second call targeted retrieveUserQuotaSummary with project
    second_call_url = client.post.call_args_list[1][0][0]
    second_call_body = client.post.call_args_list[1][1]["json"]
    assert "retrieveUserQuotaSummary" in second_call_url
    assert second_call_body == {"project": "test-project-123"}
