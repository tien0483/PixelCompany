# Tokscale-backed Manager Analytics

**Date:** 2026-09-05  
**Status:** Approved (pending implementation plan)  
**Scope:** Manager Analytics usage overview — tokscale as usage backend; Claude scanner kept for anomaly flags only

## Problem

Manager Analytics (`ManagerAnalyticsView`) shows Claude-only totals from the local JSONL scanner (`usage_analytics.db`). Users run several seats/accounts and multiple agents (Claude Code, Cursor, Codex, Gemini, Cline, …). Headline numbers miss non-Claude usage, and there is no rollup by LLM provider or agent client. Per-account breakdown is not wanted — overall usage, split by provider (and secondarily by client × provider).

## Goals

1. Use [tokscale](https://github.com/junhoyeo/tokscale) as the **source of truth for tokens, estimated cost, and cache hit**.
2. Aggregate **overall**, then **by provider**, then **by client × provider** — never by Manager seat/account.
3. Keep the existing Claude JSONL scanner and anomaly pipeline for **Flags** only (hybrid).
4. Expand the native Analytics UI to show those rollups while preserving the 1d / 7d / 30d chips and Refresh.

## Non-goals

- Per-seat / per-account usage tables
- Replacing anomaly detection or the Claude scanner entirely
- Tokscale TUI, leaderboard, social submit, or embedding the tokscale web frontend
- Live WebSocket token streaming from tokscale
- Chart.js trends / legacy dashboard rewrite in this pass
- Vendoring tokscale as an in-repo native dependency

## Decisions (locked)

| Topic | Choice |
|-------|--------|
| Grouping | Overall + by provider + by client × provider (secondary) |
| Scanner | Hybrid: Claude DB → Flags only; tokscale → usage metrics |
| Headline totals | Tokscale only (avoid double-count with Claude scanner) |
| Integration | On-demand CLI (`tokscale … --json`), ~60s in-memory cache by `days` |
| API | Extend existing `GET /api/analytics/usage-overview` (no new procedure) |

## Architecture

```
Analytics UI (1d/7d/30d, Refresh)
  → runtime tRPC manager.usageOverview
    → manager-client GET /api/analytics/usage-overview?days=N
      → Manager route:
          1. run tokscale (cached) → parse/aggregate into `overview` (+ by_provider / by_client)
          2. read analytics_db → `flags` array only (empty if DB not ready)
          3. return `{ overview, flags, source, error }` — never 503 only because the Claude DB is missing
```

Shell-out lives in **Manager** (Python), next to today’s analytics routes. Runtime widens `RuntimeManagerUsageOverview` and updates `fetchUsageOverview` to map the new fields (and to keep `flagCount` when tokscale reports an `error` but `flags` is still present).

### Tokscale invocation

One call per cache miss:

```text
tokscale models --json --group-by client,provider,model <date-flag>
```

Date chips map to tokscale flags (local timezone, as tokscale documents):

| UI chip | Flag |
|---------|------|
| 1d | `--today` |
| 7d | `--week` |
| 30d | `--since YYYY-MM-DD` where the date is today − 29 calendar days (inclusive ~30-day window). Do **not** use `--month` (calendar month ≠ trailing 30 days). |

Binary resolution order:

1. `TOKSCALE_BIN` (absolute path or command name)
2. `tokscale` on `PATH`
3. `npx --yes tokscale@latest` (same argv after the package)

Hard timeout: **60 seconds**. Fixed argv only — never interpolate user strings into a shell. `days` must be one of `{1, 7, 30}` at the UI; the route may still accept the existing `1..365` query range but only the three chips are required to work correctly for v1 (other `days` values use `--since` computed the same way).

### Aggregation

From each tokscale model row (fields named as tokscale emits; adapter maps snake/camel as needed):

- Sum `input` + `output` + cache read/write (+ reasoning if present) into **totalTokens** (use tokscale’s own total field when present).
- Sum estimated **cost** into **totalCostUsd**.
- **cacheHitRatio** = `cache_read / (cache_read + input)` when both denominators are available and denominator &gt; 0; otherwise `null`. Do not invent a ratio from cost alone.
- Roll rows into:
  - **overall** (all rows)
  - **byProvider** keyed by `provider`
  - **byClient** keyed by `(client, provider)`

No account/seat dimension. Multiple Claude seats that write into paths tokscale already scans are counted once in overall/provider totals.

### Caching

- Key: `days` (and the resolved since-date string for 30d / arbitrary days).
- TTL: **60s** for successful responses.
- Failures: do not cache (or ≤5s) so Refresh after install recovers immediately.

## API contract

Extend `GET /api/analytics/usage-overview?days=N`. Keep the existing wire envelope that `manager-client` already understands:

```json
{
  "overview": { /* usage metrics, snake_case */ },
  "flags": [ /* anomaly flag objects; length → flagCount */ ],
  "source": "tokscale" | "none",
  "error": null
}
```

**Behavior change:** do **not** return HTTP 503 solely because `analytics_db` is missing. Today the route 503s when the Claude scan DB is not ready; after this change the route always attempts tokscale and returns 200 with `flags: []` when the DB is absent. 503 remains only for true Manager/process failures if any (prefer 200 + `error` string for tokscale problems so the client can show Flags + install hint together).

`overview` fields (snake_case on the wire; runtime maps to camelCase):

```ts
{
  total_tokens: number | null
  total_cost_usd: number | null
  cache_hit_ratio: number | null   // 0..1
  session_count: number | null     // only if tokscale exposes a reliable count; else null
  message_count: number | null     // null if unavailable
  by_provider: Array<{
    provider: string
    total_tokens: number
    total_cost_usd: number
    cache_hit_ratio: number | null
  }>
  by_client: Array<{
    client: string
    provider: string
    total_tokens: number
    total_cost_usd: number
    cache_hit_ratio: number | null
  }>
}
```

Flattened runtime type (`RuntimeManagerUsageOverview`) adds `source`, `byProvider`, `byClient` beside the existing totals. `flagCount` stays `flags.length` in `manager-client` (unchanged derivation).

Sort `by_provider` / `by_client` by `total_cost_usd` descending.

### Failure behavior

| Case | Usage fields | Flags | `source` | `error` |
|------|--------------|-------|----------|---------|
| tokscale OK | filled | from DB (or `[]`) | `tokscale` | null |
| binary missing / timeout / non-zero / bad JSON | null / empty arrays | still from DB (or `[]`) | `none` | short human message + install hint |
| analytics_db missing | usage still from tokscale if OK | `[]` → flagCount 0 | tokscale or none | usage error only if tokscale failed |

Runtime `ready` is `true` when tokscale aggregation succeeded. If tokscale fails, `ready` is `false` and the UI shows the error while still displaying Flags when `flagCount > 0`.

## UI

File: `frontends/pixel_office/src/manager/manager-analytics-view.tsx`

Keep: period chips (1d / 7d / 30d), Refresh, offline empty state, existing surface/text tokens.

**Overall stats (priority order):** Tokens → Est. cost → Cache hit → Flags.  
Show Sessions / Messages only when the corresponding field is non-null.

**By provider:** compact list/table — Provider | Tokens | Est. cost | Cache hit.

**By agent (client × provider):** secondary list — Client | Provider | Tokens | Est. cost | Cache hit.

**Errors:** if tokscale missing, show a one-line install hint (`npm i -g tokscale` or `npx tokscale@latest`). Replace the “Trends charts remain in legacy…” footer with `Source: tokscale` when `source === "tokscale"`.

No new design-system components; reuse the existing `Stat` pattern and small bordered rows consistent with Manager panes.

## Files to touch (expected)

| Area | Files |
|------|--------|
| Manager | New helper module for resolve/run/parse/aggregate/cache; `manager/api/routes/analytics.py` (`usage-overview`); unit tests under `backends/manager/tests/unit/` |
| Runtime | `api-contract.ts` (`RuntimeManagerUsageOverviewSchema` + `byProvider` / `byClient` / `source`); `manager-client.ts` `fetchUsageOverview` mapping for new overview keys and top-level `source`/`error` without treating tokscale `error` as a total hard-fail that drops `flagCount` when `flags` is present |
| UI | `manager-analytics-view.tsx` |

Claude scanner (`analytics_scanner.py`, `analytics_db.py`, anomaly modules) — **no behavioral change** except continuing to supply `flagCount`.

## Testing

1. **Unit (Manager):** fixture tokscale JSON → overall / byProvider / byClient; cache-hit formula; empty rows; date-flag mapping for 1/7/30.
2. **Route:** mock subprocess success and failure; assert Flags still returned on tokscale failure; schema keys present.
3. **UI (optional if cheap):** render provider rows; show install hint when `error` set and usage null.

## Risks

- **tokscale JSON shape drift:** pin adapter to documented `--json` fields; tests use fixtures; tolerate missing optional fields as null.
- **First-load latency / npx cold start:** prefer PATH/`TOKSCALE_BIN`; 60s timeout; 60s cache.
- **Cursor / Trae / Warp needing prior `tokscale … sync`:** document in the empty/error hint; do not auto-login or sync in v1.
- **Seat-local Claude dirs:** tokscale’s Claude paths are the standard homes; seat-pinned `CLAUDE_CONFIG_DIR` projects that only symlink into `~/.claude/projects` are covered; exotic layouts outside tokscale’s discovery remain out of scope (same as today’s scanner limits for non-standard paths).

## Success criteria

- Analytics overall Tokens / Est. cost / Cache hit match a manual `tokscale models --json --group-by client,provider,model` rollup for the same window (within rounding).
- Provider table sums to overall totals; client×provider table sums to overall.
- With tokscale uninstalled, UI shows an actionable error and still shows Flags when the Claude DB has them.
- No per-account columns anywhere in the Analytics pane.
