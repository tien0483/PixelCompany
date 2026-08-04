"""Tests for the shared 1-token inference probe (backends/manager/manager/web/inference_probe.py).

Uses asyncio.run() wrappers (project convention — no pytest-asyncio)."""
import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

from manager.web.inference_probe import PROBE_MODEL, probe_inference


def _fake_client(mock_resp):
    mock_client = AsyncMock()
    mock_client.post.return_value = mock_resp
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    return mock_client


class TestProbeInference:
    def test_probe_200_returns_ok(self):
        mock_resp = MagicMock()
        mock_resp.status_code = 200

        async def _run():
            with patch("httpx.AsyncClient", return_value=_fake_client(mock_resp)):
                return await probe_inference("tok")

        result = asyncio.run(_run())
        assert result.verdict == "ok"
        assert result.ok is True
        assert result.proves_credential_bad is False
        assert result.indeterminate is False

    def test_probe_403_parses_permission_error_type_and_message(self):
        mock_resp = MagicMock()
        mock_resp.status_code = 403
        mock_resp.json.return_value = {
            "type": "error",
            "error": {"type": "permission_error", "message": "Your account has been suspended."},
        }
        mock_resp.text = ""

        async def _run():
            with patch("httpx.AsyncClient", return_value=_fake_client(mock_resp)):
                return await probe_inference("tok")

        result = asyncio.run(_run())
        assert result.verdict == "forbidden"
        assert result.proves_credential_bad is True
        assert result.error_type == "permission_error"
        assert result.error_message == "Your account has been suspended."

    def test_probe_401_returns_unauthorized(self):
        mock_resp = MagicMock()
        mock_resp.status_code = 401
        mock_resp.json.return_value = {"type": "error", "error": {"type": "authentication_error", "message": "bad token"}}

        async def _run():
            with patch("httpx.AsyncClient", return_value=_fake_client(mock_resp)):
                return await probe_inference("tok")

        result = asyncio.run(_run())
        assert result.verdict == "unauthorized"
        assert result.proves_credential_bad is True

    def test_probe_429_returns_rate_limited(self):
        mock_resp = MagicMock()
        mock_resp.status_code = 429
        mock_resp.json.return_value = {"type": "error", "error": {"type": "rate_limit_error", "message": "slow down"}}

        async def _run():
            with patch("httpx.AsyncClient", return_value=_fake_client(mock_resp)):
                return await probe_inference("tok")

        result = asyncio.run(_run())
        assert result.verdict == "rate_limited"
        assert result.indeterminate is True
        assert result.proves_credential_bad is False

    def test_probe_400_returns_bad_request(self):
        mock_resp = MagicMock()
        mock_resp.status_code = 400
        mock_resp.json.return_value = {"type": "error", "error": {"type": "invalid_request_error", "message": "bad model"}}

        async def _run():
            with patch("httpx.AsyncClient", return_value=_fake_client(mock_resp)):
                return await probe_inference("tok")

        result = asyncio.run(_run())
        assert result.verdict == "bad_request"
        assert result.indeterminate is True

    def test_probe_500_returns_upstream_error(self):
        mock_resp = MagicMock()
        mock_resp.status_code = 500
        mock_resp.json.side_effect = Exception("no body")
        mock_resp.text = "internal error"

        async def _run():
            with patch("httpx.AsyncClient", return_value=_fake_client(mock_resp)):
                return await probe_inference("tok")

        result = asyncio.run(_run())
        assert result.verdict == "upstream_error"
        assert result.indeterminate is True

    def test_probe_timeout_returns_network_error(self):
        import httpx

        async def _run():
            mock_client_cls = MagicMock()
            mock_client = AsyncMock()
            mock_client.post.side_effect = httpx.ReadTimeout("timed out")
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client_cls.return_value = mock_client
            with patch("httpx.AsyncClient", mock_client_cls):
                return await probe_inference("tok")

        result = asyncio.run(_run())
        assert result.verdict == "network_error"
        assert result.status_code is None
        assert result.indeterminate is True

    def test_probe_non_json_body_falls_back_to_trimmed_text(self):
        mock_resp = MagicMock()
        mock_resp.status_code = 403
        mock_resp.json.side_effect = Exception("not json")
        mock_resp.text = "  plain text upstream error  "

        async def _run():
            with patch("httpx.AsyncClient", return_value=_fake_client(mock_resp)):
                return await probe_inference("tok")

        result = asyncio.run(_run())
        assert result.error_type is None
        assert result.error_message == "plain text upstream error"

    def test_probe_message_is_length_capped(self):
        mock_resp = MagicMock()
        mock_resp.status_code = 403
        long_message = "x" * 5000
        mock_resp.json.return_value = {"type": "error", "error": {"type": "permission_error", "message": long_message}}

        async def _run():
            with patch("httpx.AsyncClient", return_value=_fake_client(mock_resp)):
                return await probe_inference("tok")

        result = asyncio.run(_run())
        assert result.error_message is not None
        assert len(result.error_message) <= 300

    def test_probe_body_is_one_token_haiku(self):
        """Guards the probe staying cheap — one token, one call."""
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_client = _fake_client(mock_resp)

        async def _run():
            with patch("httpx.AsyncClient", return_value=mock_client):
                return await probe_inference("tok")

        asyncio.run(_run())
        mock_client.post.assert_called_once()
        _, kwargs = mock_client.post.call_args
        assert kwargs["json"]["max_tokens"] == 1
        assert kwargs["json"]["model"] == PROBE_MODEL
