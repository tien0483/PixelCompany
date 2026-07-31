# Jacked Claude-only accounts + native OAuth (2026-07-30)

## Change

PixelOffice Jacked surface is **Claude-only** with **OAuth-only** Add Account.

### Add Account OAuth flow

1. UI calls tRPC `jacked.startClaudeOAuth` → Kanban `JackedClient` `POST {JACKED_URL}/api/auth/accounts/add?provider=claude`.
2. Jacked starts Anthropic PKCE OAuth; returns `{ flow_id, auth_url, mode }` (`browser` on loopback, `manual` when remote).
3. UI opens `auth_url` and polls tRPC `jacked.oauthFlowStatus` until `completed` / `error` / timeout.
4. Manual mode: paste authorization code via `jacked.submitOAuthCode` (still OAuth — not API-key / token paste for other providers).
5. On success, monitor refresh picks up the new Claude account.

Same-origin fallback still exists: `GET|POST /api/jacked-proxy/...` → Jacked.

### Claude-only filtering

- Snapshot (`jacked-client.fetchSnapshot`): drops non-Claude accounts; clears `activeAccountId` if it pointed at another provider; pressure from Claude only.
- Accounts view: lists Claude only; title “Claude Accounts”; no Codex/Cursor/Antigravity chooser.
- Office meter wall (`office-jacked-semantics`): meters Claude only.
- E2E harness jacked fixture: two Claude accounts (no multi-provider rows).

### Env / callback

| Var | Default | Notes |
|-----|---------|--------|
| `JACKED_URL` (Kanban server) | `http://127.0.0.1:8321` | Companion base for tRPC bridge |
| `VITE_JACKED_URL` (web-ui) | `http://127.0.0.1:8321` | External dashboard link only |
| OAuth callback | `http://localhost:45100-45199/callback` | Jacked-owned browser mode; Anthropic registers this client |
| Manual redirect | `https://platform.claude.com/oauth/code/callback` | When `remote=true` / non-loopback to Jacked |

Do **not** paste API keys in this UI. Claude OAuth only.

## Gaps

- Full Playwright OAuth path not exercised (needs live Anthropic + Jacked).
- Jacked Python dashboard still offers multi-provider Add when opened externally; PixelOffice native UI does not.
