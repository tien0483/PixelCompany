// Reads the Claude account's rolling 5h / 7d usage windows without going through
// the Python Manager.
//
// The standalone Plan Editor package ships no Manager process (see
// `plan-editor-standalone/router.ts`), so the usage numbers the full app gets from
// `/api/auth/accounts` are unreachable there. Upstream, though, that data is a single
// unauthenticated-by-us HTTPS GET: `manager/web/auth.py:871-895` fetches
// `https://api.anthropic.com/api/oauth/usage` with the local Claude Code OAuth token
// and caches four scalars out of the response. This module does the same thing in Node.
//
// Deliberately NOT replicated from the Manager:
//   - token refresh on 401. Rotating the refresh token while Claude Code is running
//     invalidates the CLI's own session (invariant I2 in
//     `backends/manager/docs/architecture/oauth-and-credential-flows.md`). A 401 here is
//     reported as `unauthorized` and the UI degrades to "—".
//   - the macOS Keychain credential store. Reading it means shelling out to `security`,
//     which prompts; the file store is the one Linux/WSL and most dev setups use.
//   - per-account bookkeeping. There is exactly one credential file to look at.
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const OAUTH_BETA_HEADER = "oauth-2025-04-20";
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Upstream rate-limits usage reads at roughly one per account per minute
 * (`_USAGE_RATE_LIMIT_CEILING`, `manager/web/auth.py:49-51`), so every outcome —
 * including failures — is cached for a full window before we ask again.
 */
export const CLAUDE_USAGE_CACHE_TTL_MS = 60_000;

export type ClaudeUsageUnavailableReason = "no-credentials" | "unauthorized" | "unreachable";

export interface ClaudeUsageAvailable {
	available: true;
	/** 0–100 utilization of the rolling 5-hour window, or null when the window is not reported. */
	fiveHourPercent: number | null;
	sevenDayPercent: number | null;
	/** ISO-8601; both `Z` and `+00:00` forms occur upstream. */
	fiveHourResetsAt: string | null;
	sevenDayResetsAt: string | null;
	/** Unix seconds, matching `RuntimeManagerAccount.usageCachedAt`. */
	fetchedAt: number;
}

export interface ClaudeUsageUnavailable {
	available: false;
	reason: ClaudeUsageUnavailableReason;
}

export type ClaudeUsageResult = ClaudeUsageAvailable | ClaudeUsageUnavailable;

export interface ClaudeUsageReaderDependencies {
	/** Overridden in tests; defaults to the process's own credential file + `fetch`. */
	readAccessToken?: () => Promise<string | null>;
	fetchImpl?: typeof fetch;
	now?: () => number;
	cacheTtlMs?: number;
}

export interface ClaudeUsageReader {
	get: () => Promise<ClaudeUsageResult>;
}

function claudeConfigDir(): string {
	const override = process.env.CLAUDE_CONFIG_DIR?.trim();
	return override ? override : join(homedir(), ".claude");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readWindow(source: unknown, key: string): { percent: number | null; resetsAt: string | null } {
	if (!isRecord(source)) {
		return { percent: null, resetsAt: null };
	}
	const raw = source[key];
	if (!isRecord(raw)) {
		return { percent: null, resetsAt: null };
	}
	const utilization = raw.utilization;
	const resetsAt = raw.resets_at;
	return {
		percent: typeof utilization === "number" && Number.isFinite(utilization) ? utilization : null,
		resetsAt: typeof resetsAt === "string" && resetsAt.length > 0 ? resetsAt : null,
	};
}

/** `claudeAiOauth.accessToken` from `$CLAUDE_CONFIG_DIR/.credentials.json` (default `~/.claude`). */
export async function readClaudeAccessToken(): Promise<string | null> {
	try {
		const raw = await readFile(join(claudeConfigDir(), ".credentials.json"), "utf8");
		const parsed: unknown = JSON.parse(raw);
		if (!isRecord(parsed)) {
			return null;
		}
		const oauth = parsed.claudeAiOauth;
		if (!isRecord(oauth)) {
			return null;
		}
		const token = oauth.accessToken;
		return typeof token === "string" && token.length > 0 ? token : null;
	} catch {
		// Missing file, bad JSON, or no read permission all mean the same thing to the caller.
		return null;
	}
}

/**
 * Single-flight, TTL-cached reader for the local Claude account's usage windows.
 * Errors are never thrown: every failure mode maps to an `available: false` reason
 * so the caller can render a placeholder instead of an error state.
 */
export function createClaudeUsageReader(deps: ClaudeUsageReaderDependencies = {}): ClaudeUsageReader {
	const readAccessToken = deps.readAccessToken ?? readClaudeAccessToken;
	const fetchImpl = deps.fetchImpl ?? fetch;
	const now = deps.now ?? Date.now;
	const cacheTtlMs = deps.cacheTtlMs ?? CLAUDE_USAGE_CACHE_TTL_MS;

	let cached: { value: ClaudeUsageResult; expiresAt: number } | null = null;
	let inFlight: Promise<ClaudeUsageResult> | null = null;

	const load = async (): Promise<ClaudeUsageResult> => {
		const token = await readAccessToken();
		if (!token) {
			return { available: false, reason: "no-credentials" };
		}

		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
		try {
			const response = await fetchImpl(USAGE_URL, {
				method: "GET",
				headers: {
					Authorization: `Bearer ${token}`,
					"anthropic-beta": OAUTH_BETA_HEADER,
				},
				signal: controller.signal,
			});
			if (response.status === 401 || response.status === 403) {
				return { available: false, reason: "unauthorized" };
			}
			if (!response.ok) {
				return { available: false, reason: "unreachable" };
			}
			const body: unknown = await response.json();
			const fiveHour = readWindow(body, "five_hour");
			const sevenDay = readWindow(body, "seven_day");
			return {
				available: true,
				fiveHourPercent: fiveHour.percent,
				sevenDayPercent: sevenDay.percent,
				fiveHourResetsAt: fiveHour.resetsAt,
				sevenDayResetsAt: sevenDay.resetsAt,
				fetchedAt: Math.floor(now() / 1000),
			};
		} catch {
			// Network error, abort, or a non-JSON body. Never log — the request carries a bearer token.
			return { available: false, reason: "unreachable" };
		} finally {
			clearTimeout(timeout);
		}
	};

	return {
		get: async (): Promise<ClaudeUsageResult> => {
			const currentMs = now();
			if (cached && cached.expiresAt > currentMs) {
				return cached.value;
			}
			if (inFlight) {
				return await inFlight;
			}
			inFlight = load()
				.then((value) => {
					cached = { value, expiresAt: now() + cacheTtlMs };
					return value;
				})
				.finally(() => {
					inFlight = null;
				});
			return await inFlight;
		},
	};
}
