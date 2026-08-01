// Read-mostly client for the Manager dashboard API on 127.0.0.1:8321.
//
// Manager is an optional companion process. Every call here resolves to null or a
// failure result instead of throwing when the port is closed, and the caller is expected
// to render normally in that case.
import { WebSocket } from "ws";
import type {
	RuntimeManagerAccount,
	RuntimeManagerAccountLaunchDir,
	RuntimeManagerAccountLaunchCredential,
	RuntimeManagerFeature,
	RuntimeManagerFeatureCategory,
	RuntimeManagerHookLogs,
	RuntimeManagerInstallationsOverview,
	RuntimeManagerOAuthFlowStatus,
	RuntimeManagerOAuthStartResponse,
	RuntimeManagerPacing,
	RuntimeManagerPack,
	RuntimeManagerPacks,
	RuntimeManagerProvider,
	RuntimeManagerServerLogs,
	RuntimeManagerSession,
	RuntimeManagerSessions,
	RuntimeManagerSnapshot,
	RuntimeManagerSwap,
	RuntimeManagerSwapLog,
	RuntimeManagerUsageOverview,
} from "../core/api-contract";

const DEFAULT_BASE_URL = "http://127.0.0.1:8321";
const REQUEST_TIMEOUT_MS = 4000;
const LONG_REQUEST_TIMEOUT_MS = 30000;
const WS_RECONNECT_DELAY_MS = 5000;

/**
 * Providers Manager can hold accounts for, and what Kanban may do with them.
 *
 * Mirrors jacked's own capability registry. Kanban keeps a copy so the office can grey
 * out a manual-only fleet without a round trip, but jacked remains authoritative: it
 * refuses an unsafe swap regardless of what this table says.
 */
const PROVIDER_CAPABILITIES: Record<RuntimeManagerProvider, { canAutoSwap: boolean; canTrackUsage: boolean }> = {
	claude: { canAutoSwap: true, canTrackUsage: true },
	codex: { canAutoSwap: true, canTrackUsage: true },
	antigravity: { canAutoSwap: true, canTrackUsage: true },
	// Cursor stores its session in the IDE's sqlite state, so switching requires the app
	// to be closed. Never automate it.
	cursor: { canAutoSwap: false, canTrackUsage: true },
};

const FEATURE_CATEGORIES: RuntimeManagerFeatureCategory[] = ["agents", "commands", "hooks", "knowledge"];

export interface ManagerClient {
	/** Resolved companion base URL (no trailing slash). */
	baseUrl: string;
	fetchSnapshot: () => Promise<RuntimeManagerSnapshot | null>;
	setFeatureEnabled: (
		category: RuntimeManagerFeatureCategory,
		name: string,
		enabled: boolean,
	) => Promise<{ ok: boolean; error?: string }>;
	pauseSwap: (minutes: number) => Promise<{ ok: boolean; error?: string }>;
	resumeSwap: () => Promise<{ ok: boolean; error?: string }>;
	useAccount: (accountId: number) => Promise<{ ok: boolean; error?: string }>;
	/** Refresh cached usage windows for one account (jacked POST …/refresh-usage). */
	refreshAccount: (accountId: number) => Promise<{ ok: boolean; error?: string }>;
	refreshAllUsage: () => Promise<{ ok: boolean; error?: string }>;
	/** Enable/disable, relabel, or set donate limit on an account. */
	updateAccount: (input: {
		accountId: number;
		isActive?: boolean;
		displayName?: string | null;
		donateLimitPercent?: number;
	}) => Promise<{ ok: boolean; error?: string }>;
	/** Soft-delete an account; jacked refuses to remove the primary while others are active. */
	deleteAccount: (accountId: number) => Promise<{ ok: boolean; error?: string }>;
	/** Re-check a stored credential without switching to it. */
	validateAccount: (accountId: number) => Promise<{ ok: boolean; error?: string }>;
	/** Auto-swap priority: first id becomes highest priority. */
	reorderAccounts: (accountIds: number[]) => Promise<{ ok: boolean; error?: string }>;
	/** Re-run OAuth against an existing account row instead of adding a duplicate. */
	startAccountReauth: (accountId: number, remote?: boolean) => Promise<RuntimeManagerOAuthStartResponse>;
	/** Authorize independent Claude Code tokens on an existing account (no primary re-auth). */
	startAccountAuthorizeCc: (accountId: number, remote?: boolean) => Promise<RuntimeManagerOAuthStartResponse>;
	/** Live Claude Code sessions grouped per account. */
	fetchActiveSessions: () => Promise<RuntimeManagerSessions | null>;
	/** Curated skill packs with per-pack install counts. */
	fetchPacks: () => Promise<RuntimeManagerPacks | null>;
	/** Install (enable) or remove (disable) a whole pack. */
	setPackEnabled: (name: string, enabled: boolean) => Promise<{ ok: boolean; error?: string }>;
	/** Prepare (and return) the per-account CLAUDE_CONFIG_DIR for a pinned launch. */
	fetchAccountLaunchDir: (accountId: number) => Promise<RuntimeManagerAccountLaunchDir | null>;
	/** Read the Cursor API key snapshot for a pinned Cursor launch. */
	fetchAccountLaunchCredential: (accountId: number) => Promise<RuntimeManagerAccountLaunchCredential | null>;
	/** Import the signed-in Cursor IDE user as a jacked account. */
	importCursorAccount: () => Promise<{ ok: boolean; error?: string; accountId?: number; email?: string }>;
	/** Refresh an existing Cursor account slot from the live IDE session. */
	reimportCursorAccount: (accountId: number) => Promise<{ ok: boolean; error?: string; accountId?: number; email?: string }>;
	fetchInstallationsOverview: () => Promise<RuntimeManagerInstallationsOverview | null>;
	fetchServerLogs: (limit?: number) => Promise<RuntimeManagerServerLogs | null>;
	fetchHookLogs: (limit?: number) => Promise<RuntimeManagerHookLogs | null>;
	fetchUsageOverview: (days?: number) => Promise<RuntimeManagerUsageOverview | null>;
	fetchSwapLog: (limit?: number) => Promise<RuntimeManagerSwapLog | null>;
	/** Start Claude OAuth only (POST /api/auth/accounts/add?provider=claude). */
	startClaudeOAuth: (remote?: boolean) => Promise<RuntimeManagerOAuthStartResponse>;
	/** Poll jacked OAuth flow status. */
	getOAuthFlowStatus: (flowId: string) => Promise<RuntimeManagerOAuthFlowStatus | null>;
	/** Submit authorization code for a manual OAuth flow. */
	submitOAuthCode: (
		flowId: string,
		code: string,
		donateLimitPercent?: number,
	) => Promise<RuntimeManagerOAuthFlowStatus | null>;
	/** Forward an arbitrary jacked HTTP path (same-origin proxy helper). */
	proxyRequest: (
		method: string,
		jackedPath: string,
		body?: string | null,
		contentType?: string | null,
	) => Promise<{ status: number; body: string; contentType: string }>;
	/** Wildcard subscription to jacked's topic bus. Returns an unsubscribe function. */
	subscribe: (onEvent: (topic: string) => void) => () => void;
	close: () => void;
}

export interface CreateManagerClientDependencies {
	baseUrl?: string;
	warn: (message: string) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(source: Record<string, unknown>, key: string): string | null {
	const value = source[key];
	return typeof value === "string" && value.length > 0 ? value : null;
}

function readNumber(source: Record<string, unknown>, key: string): number | null {
	const value = source[key];
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readBoolean(source: Record<string, unknown>, key: string): boolean {
	return source[key] === true;
}

function parseProvider(value: unknown): RuntimeManagerProvider {
	if (value === "codex" || value === "cursor" || value === "antigravity") {
		return value;
	}
	return "claude";
}

/**
 * Collapse a provider's usage windows into one 0-1 number.
 *
 * The office needs a single dial for lighting and stamina, and the windows are not
 * comparable in duration, so the tightest one wins: whichever limit is closest to
 * stopping work is the one that should show on the floor.
 */
function toPressure(percentages: (number | null)[]): number {
	let worst = 0;
	for (const percent of percentages) {
		if (percent === null) {
			continue;
		}
		worst = Math.max(worst, percent / 100);
	}
	return Math.min(1, Math.max(0, worst));
}

/** Manager stores window resets as ISO-8601 strings; the runtime contract wants epoch ms. */
function parseIsoToEpochMs(source: Record<string, unknown>, key: string): number | null {
	const value = source[key];
	if (typeof value !== "string" || value.length === 0) {
		return null;
	}
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) ? parsed : null;
}

/** Constrained-window threshold; mirrors Manager usage_pacing's default (compute_best_account_summary). */
const PACING_CONSTRAINED_THRESHOLD = 90;

/**
 * Map Manager's `compute_best_account_summary` payload onto the runtime pacing shape.
 * `allExhausted` is derived: the summary's best-account worst window is the most-headroom
 * account, so once it is at/above the constrained threshold every eligible seat is walled.
 */
export function parsePacing(raw: unknown): RuntimeManagerPacing | null {
	if (!isRecord(raw)) {
		return null;
	}
	const worstWindowPct = readNumber(raw, "best_account_worst_window_pct");
	const pauseUntil = parseIsoToEpochMs(raw, "pause_until");
	const allExhausted = worstWindowPct !== null && worstWindowPct >= PACING_CONSTRAINED_THRESHOLD;
	return { pauseUntil, worstWindowPct, allExhausted };
}

function parseAccount(raw: unknown): RuntimeManagerAccount | null {
	if (!isRecord(raw)) {
		return null;
	}
	const id = readNumber(raw, "id");
	const email = readString(raw, "email");
	if (id === null || email === null) {
		return null;
	}
	const provider = parseProvider(raw.provider);
	const fallback = PROVIDER_CAPABILITIES[provider];
	const usage = isRecord(raw.usage) ? raw.usage : null;
	const fiveHourPercent = usage ? readNumber(usage, "five_hour") : readNumber(raw, "cached_usage_5h");
	const sevenDayPercent = usage ? readNumber(usage, "seven_day") : readNumber(raw, "cached_usage_7d");
	const fiveHourResetsAt = usage
		? readString(usage, "five_hour_resets_at")
		: readString(raw, "cached_5h_resets_at");
	const sevenDayResetsAt = usage
		? readString(usage, "seven_day_resets_at")
		: readString(raw, "cached_7d_resets_at");
	const donateRaw = readNumber(raw, "donate_limit_percent");
	const donateLimitPercent =
		donateRaw === null ? 100 : Math.max(0, Math.min(100, Math.round(donateRaw)));
	// Prefer jacked's registry flags from the API; local table is offline fallback only.
	const canAutoSwap = typeof raw.can_auto_swap === "boolean" ? raw.can_auto_swap : fallback.canAutoSwap;
	const canTrackUsage = typeof raw.can_track_usage === "boolean" ? raw.can_track_usage : fallback.canTrackUsage;

	return {
		id,
		provider,
		email,
		displayName: readString(raw, "display_name"),
		organizationName: readString(raw, "organization_name"),
		isActive: readBoolean(raw, "is_active"),
		fiveHourPercent,
		sevenDayPercent,
		fiveHourResetsAt,
		sevenDayResetsAt,
		usageCachedAt: readNumber(raw, "usage_cached_at"),
		subscriptionType: readString(raw, "subscription_type"),
		donateLimitPercent,
		donateLimitLocked: readBoolean(raw, "donate_limit_locked"),
		pressure: toPressure([fiveHourPercent, sevenDayPercent]),
		nextRefreshAt: readNumber(raw, "next_refresh_at"),
		canAutoSwap,
		canTrackUsage,
		hasCcToken: readBoolean(raw, "has_cc_token"),
		ccNeedsAuth: readBoolean(raw, "cc_needs_auth"),
		isActiveForProvider: readBoolean(raw, "is_active_for_provider"),
		validationStatus: readString(raw, "validation_status"),
		lastError: readString(raw, "last_error"),
	};
}

function parseFeatures(raw: unknown): RuntimeManagerFeature[] {
	if (!isRecord(raw)) {
		return [];
	}
	const features: RuntimeManagerFeature[] = [];
	for (const category of FEATURE_CATEGORIES) {
		const entries = raw[category];
		if (!Array.isArray(entries)) {
			continue;
		}
		for (const entry of entries) {
			if (!isRecord(entry)) {
				continue;
			}
			const name = readString(entry, "name");
			if (name === null) {
				continue;
			}
			features.push({
				category,
				name,
				displayName: readString(entry, "display_name") ?? name,
				description: readString(entry, "description") ?? "",
				installed: readBoolean(entry, "installed"),
			});
		}
	}
	return features;
}

function parseSwapEntry(raw: unknown): RuntimeManagerSwap | null {
	if (!isRecord(raw)) {
		return null;
	}
	const timestamp = readString(raw, "timestamp");
	const at = timestamp === null ? Date.now() : Date.parse(timestamp);
	return {
		at: Number.isFinite(at) ? at : Date.now(),
		fromEmail: readString(raw, "from_email"),
		toEmail: readString(raw, "to_email"),
		reason: readString(raw, "reason"),
	};
}

function parseLatestSwap(raw: unknown): RuntimeManagerSwap | null {
	if (!isRecord(raw)) {
		return null;
	}
	const swaps = raw.swaps;
	if (!Array.isArray(swaps) || swaps.length === 0) {
		return null;
	}
	return parseSwapEntry(swaps[0]);
}

function parseInstalledComponent(raw: unknown): { name: string; displayName: string; installed: boolean } | null {
	if (!isRecord(raw)) {
		return null;
	}
	const name = readString(raw, "name");
	if (name === null) {
		return null;
	}
	return {
		name,
		displayName: readString(raw, "display_name") ?? name,
		installed: readBoolean(raw, "installed"),
	};
}

function parseInstallationsOverview(raw: unknown): RuntimeManagerInstallationsOverview | null {
	if (!isRecord(raw)) {
		return null;
	}
	const globalInstall = isRecord(raw.global_install) ? raw.global_install : null;
	if (globalInstall === null) {
		return null;
	}
	const parseList = (key: string) => {
		const entries = globalInstall[key];
		if (!Array.isArray(entries)) {
			return [];
		}
		const out: Array<{ name: string; displayName: string; installed: boolean }> = [];
		for (const entry of entries) {
			const parsed = parseInstalledComponent(entry);
			if (parsed) {
				out.push(parsed);
			}
		}
		return out;
	};
	const projectsRaw = raw.projects;
	const projects: RuntimeManagerInstallationsOverview["projects"] = [];
	if (Array.isArray(projectsRaw)) {
		for (const entry of projectsRaw) {
			if (!isRecord(entry)) {
				continue;
			}
			const repoPath = readString(entry, "repo_path");
			const repoName = readString(entry, "repo_name");
			if (repoPath === null || repoName === null) {
				continue;
			}
			projects.push({
				repoPath,
				repoName,
				commandsRun: readNumber(entry, "commands_run") ?? 0,
				hookExecutions: readNumber(entry, "hook_executions") ?? 0,
				lastActivity: readString(entry, "last_activity"),
				uniqueSessions: readNumber(entry, "unique_sessions") ?? 0,
				hasGuardrails: readBoolean(entry, "has_guardrails"),
				hasLessons: readBoolean(entry, "has_lessons"),
				lessonsCount: readNumber(entry, "lessons_count") ?? 0,
			});
		}
	}
	return {
		version: readString(globalInstall, "version") ?? "unknown",
		agents: parseList("agents"),
		commands: parseList("commands"),
		hooks: parseList("hooks"),
		knowledge: parseList("knowledge"),
		skills: parseList("skills"),
		projects,
		totalProjects: readNumber(raw, "total_projects") ?? projects.length,
	};
}

function resolveBaseUrl(configured: string | undefined): string {
	const fromEnv = (process.env.MANAGER_URL ?? process.env.JACKED_URL)?.trim();
	return (configured ?? (fromEnv !== undefined && fromEnv.length > 0 ? fromEnv : DEFAULT_BASE_URL)).replace(/\/$/, "");
}

export function createManagerClient(deps: CreateManagerClientDependencies): ManagerClient {
	const baseUrl = resolveBaseUrl(deps.baseUrl);
	let didWarnUnreachable = false;
	let socket: WebSocket | null = null;
	let reconnectTimer: NodeJS.Timeout | null = null;
	let isClosed = false;
	const subscribers = new Set<(topic: string) => void>();

	const request = async (
		path: string,
		init?: RequestInit,
		timeoutMs: number = REQUEST_TIMEOUT_MS,
	): Promise<unknown | null> => {
		const controller = new AbortController();
		const timeout = setTimeout(() => {
			controller.abort();
		}, timeoutMs);
		try {
			const response = await fetch(`${baseUrl}${path}`, { ...init, signal: controller.signal });
			if (!response.ok) {
				return null;
			}
			return (await response.json()) as unknown;
		} catch {
			if (!didWarnUnreachable) {
				didWarnUnreachable = true;
				deps.warn(`Manager is not reachable at ${baseUrl}; office vitality data is disabled.`);
			}
			return null;
		} finally {
			clearTimeout(timeout);
		}
	};

	const fetchSnapshot = async (): Promise<RuntimeManagerSnapshot | null> => {
		const health = await request("/api/health");
		if (!isRecord(health) || health.status !== "ok") {
			return null;
		}
		didWarnUnreachable = false;

		const [accountsRaw, menubarRaw, swapSettingsRaw, featuresRaw, swapLogRaw, lessonsRaw, versionRaw, pacingRaw] =
			await Promise.all([
				request("/api/auth/accounts?include_inactive=true"),
				request("/api/menubar-summary"),
				request("/api/settings/swap-settings"),
				request("/api/features"),
				request("/api/settings/swap-log?limit=1"),
				request("/api/analytics/lessons"),
				request("/api/version"),
				request("/api/usage-pacing"),
			]);

		const accounts: RuntimeManagerAccount[] = [];
		if (Array.isArray(accountsRaw)) {
			for (const raw of accountsRaw) {
				const account = parseAccount(raw);
				if (account && (account.provider === "claude" || account.provider === "cursor")) {
					accounts.push(account);
				}
			}
		}

		let activeAccountId: number | null = null;
		if (isRecord(menubarRaw)) {
			activeAccountId = readNumber(menubarRaw, "active_account_id");
		}
		if (activeAccountId !== null && !accounts.some((account) => account.id === activeAccountId)) {
			activeAccountId = null;
		}

		const swapSettings = isRecord(swapSettingsRaw) ? swapSettingsRaw : null;

		const fetchedAt = Date.now();
		return {
			version: isRecord(versionRaw) ? readString(versionRaw, "current") : null,
			accounts,
			activeAccountId,
			pressure: accounts.reduce((worst, account) => Math.max(worst, account.pressure), 0),
			swapPausedUntil: swapSettings ? readString(swapSettings, "auto_swap_paused_until") : null,
			autoSwapEnabled: swapSettings ? readBoolean(swapSettings, "auto_swap_enabled") : false,
			pacing: parsePacing(pacingRaw),
			features: parseFeatures(featuresRaw),
			latestSwap: parseLatestSwap(swapLogRaw),
			lessonsActive: isRecord(lessonsRaw) ? readNumber(lessonsRaw, "active") : null,
			fetchedAt,
			stale: false,
			lastSuccessAt: fetchedAt,
		};
	};

	const mutate = async (
		path: string,
		init: RequestInit,
		timeoutMs: number = REQUEST_TIMEOUT_MS,
	): Promise<{ ok: boolean; error?: string }> => {
		const controller = new AbortController();
		const timeout = setTimeout(() => {
			controller.abort();
		}, timeoutMs);
		try {
			const response = await fetch(`${baseUrl}${path}`, { ...init, signal: controller.signal });
			let payload: unknown = null;
			try {
				payload = await response.json();
			} catch {
				payload = null;
			}
			if (!response.ok) {
				const message =
					isRecord(payload) && typeof payload.error === "string"
						? payload.error
						: isRecord(payload) && isRecord(payload.error) && typeof payload.error.message === "string"
							? payload.error.message
							: isRecord(payload) && typeof payload.detail === "string"
								? payload.detail
								: `Manager returned HTTP ${String(response.status)}.`;
				return { ok: false, error: message };
			}
			if (isRecord(payload) && typeof payload.error === "string") {
				return { ok: false, error: payload.error };
			}
			didWarnUnreachable = false;
			return { ok: true };
		} catch {
			if (!didWarnUnreachable) {
				didWarnUnreachable = true;
				deps.warn(`Manager is not reachable at ${baseUrl}; office vitality data is disabled.`);
			}
			return { ok: false, error: "Manager is not reachable." };
		} finally {
			clearTimeout(timeout);
		}
	};

	/**
	 * POSTs a jacked OAuth-start endpoint (add or re-auth) and normalizes the flow
	 * handle. Both endpoints answer with the same `{flow_id, auth_url, mode}` shape.
	 */
	const startOAuthFlow = async (path: string): Promise<RuntimeManagerOAuthStartResponse> => {
		const controller = new AbortController();
		const timeout = setTimeout(() => {
			controller.abort();
		}, LONG_REQUEST_TIMEOUT_MS);
		try {
			const response = await fetch(`${baseUrl}${path}`, {
				method: "POST",
				signal: controller.signal,
			});
			let payload: unknown = null;
			try {
				payload = await response.json();
			} catch {
				payload = null;
			}
			if (!response.ok) {
				const message =
					isRecord(payload) && isRecord(payload.error) && typeof payload.error.message === "string"
						? payload.error.message
						: isRecord(payload) && typeof payload.error === "string"
							? payload.error
							: `Manager returned HTTP ${String(response.status)}.`;
				return { ok: false, error: message };
			}
			if (!isRecord(payload)) {
				return { ok: false, error: "Invalid OAuth start response." };
			}
			const flowId = readString(payload, "flow_id");
			if (flowId === null) {
				const message =
					isRecord(payload.error) && typeof payload.error.message === "string"
						? payload.error.message
						: typeof payload.error === "string"
							? payload.error
							: "No flow ID returned from jacked.";
				return { ok: false, error: message };
			}
			const modeRaw = readString(payload, "mode");
			const mode = modeRaw === "manual" || modeRaw === "browser" ? modeRaw : undefined;
			didWarnUnreachable = false;
			return {
				ok: true,
				flowId,
				authUrl: readString(payload, "auth_url") ?? undefined,
				mode,
			};
		} catch {
			if (!didWarnUnreachable) {
				didWarnUnreachable = true;
				deps.warn(`Manager is not reachable at ${baseUrl}; office vitality data is disabled.`);
			}
			return { ok: false, error: "Manager is not reachable." };
		} finally {
			clearTimeout(timeout);
		}
	};

	const connect = () => {
		if (isClosed || socket !== null) {
			return;
		}
		const wsUrl = `${baseUrl.replace(/^http/, "ws")}/api/ws?topics=*`;
		let next: WebSocket;
		try {
			next = new WebSocket(wsUrl);
		} catch {
			scheduleReconnect();
			return;
		}
		socket = next;
		next.on("message", (data) => {
			try {
				const parsed: unknown = JSON.parse(data.toString());
				if (!isRecord(parsed) || typeof parsed.type !== "string" || parsed.type === "ping") {
					return;
				}
				for (const subscriber of subscribers) {
					subscriber(parsed.type);
				}
			} catch {
				// Ignore malformed frames; the next event will resync.
			}
		});
		next.on("error", () => {
			// Handled by the close listener so reconnection has a single path.
		});
		next.on("close", () => {
			if (socket === next) {
				socket = null;
			}
			scheduleReconnect();
		});
	};

	function scheduleReconnect(): void {
		if (isClosed || reconnectTimer !== null || subscribers.size === 0) {
			return;
		}
		const timer = setTimeout(() => {
			reconnectTimer = null;
			connect();
		}, WS_RECONNECT_DELAY_MS);
		timer.unref();
		reconnectTimer = timer;
	}

	const close = () => {
		isClosed = true;
		subscribers.clear();
		if (reconnectTimer !== null) {
			clearTimeout(reconnectTimer);
			reconnectTimer = null;
		}
		if (socket !== null) {
			try {
				socket.terminate();
			} catch {
				// Ignore termination errors during shutdown.
			}
			socket = null;
		}
	};

	return {
		baseUrl,
		fetchSnapshot,
		setFeatureEnabled: async (category, name, enabled) =>
			await mutate(`/api/features/${category}/${encodeURIComponent(name)}`, {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ enabled }),
			}),
		pauseSwap: async (minutes) =>
			await mutate(`/api/settings/swap-pause?minutes=${minutes.toString()}`, { method: "POST" }),
		resumeSwap: async () => await mutate("/api/settings/swap-resume", { method: "POST" }),
		useAccount: async (accountId) =>
			await mutate(`/api/auth/accounts/${String(accountId)}/use`, { method: "POST" }, LONG_REQUEST_TIMEOUT_MS),
		// Seats "Refresh" is usage refresh. Token re-auth / Cursor re-import use
		// dedicated endpoints (startAccountReauth / reimportCursorAccount).
		refreshAccount: async (accountId) =>
			await mutate(
				`/api/auth/accounts/${String(accountId)}/refresh-usage`,
				{ method: "POST" },
				LONG_REQUEST_TIMEOUT_MS,
			),
		refreshAllUsage: async () =>
			await mutate("/api/auth/accounts/refresh-all-usage", { method: "POST" }, LONG_REQUEST_TIMEOUT_MS),
		updateAccount: async ({ accountId, isActive, displayName, donateLimitPercent }) => {
			// jacked rejects an empty patch, and `display_name` is keyed off presence
			// (not null-ness), so only send what the caller actually set.
			const body: Record<string, unknown> = {};
			if (isActive !== undefined) {
				body.is_active = isActive;
			}
			if (displayName !== undefined) {
				body.display_name = displayName;
			}
			if (donateLimitPercent !== undefined) {
				body.donate_limit_percent = donateLimitPercent;
			}
			if (Object.keys(body).length === 0) {
				return { ok: false, error: "Nothing to update." };
			}
			return await mutate(`/api/auth/accounts/${String(accountId)}`, {
				method: "PATCH",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body),
			});
		},
		deleteAccount: async (accountId) => await mutate(`/api/auth/accounts/${String(accountId)}`, { method: "DELETE" }),
		validateAccount: async (accountId) =>
			await mutate(`/api/auth/accounts/${String(accountId)}/validate`, { method: "POST" }, LONG_REQUEST_TIMEOUT_MS),
		reorderAccounts: async (accountIds) =>
			await mutate("/api/auth/accounts/reorder", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ order: accountIds }),
			}),
		fetchActiveSessions: async () => {
			const raw = await request("/api/auth/active-sessions");
			if (!isRecord(raw) || !isRecord(raw.sessions)) {
				return null;
			}
			const sessions: RuntimeManagerSession[] = [];
			// jacked groups by account id, keyed as a string.
			for (const [accountKey, entries] of Object.entries(raw.sessions)) {
				const accountId = Number(accountKey);
				if (!Number.isInteger(accountId) || !Array.isArray(entries)) {
					continue;
				}
				for (const entry of entries) {
					if (!isRecord(entry)) {
						continue;
					}
					sessions.push({
						accountId,
						sessionId: readString(entry, "session_id") ?? "",
						repoPath: readString(entry, "repo_path"),
						lastActivityAt: readString(entry, "last_activity_at"),
						isSubagent: readBoolean(entry, "is_subagent"),
						agentType: readString(entry, "agent_type"),
					});
				}
			}
			return { sessions };
		},
		fetchPacks: async () => {
			const raw = await request("/api/packs", undefined, LONG_REQUEST_TIMEOUT_MS);
			if (!isRecord(raw) || !Array.isArray(raw.packs)) {
				return null;
			}
			const packs: RuntimeManagerPack[] = [];
			for (const entry of raw.packs) {
				if (!isRecord(entry)) {
					continue;
				}
				const name = readString(entry, "name");
				if (name === null) {
					continue;
				}
				packs.push({
					name,
					displayName: readString(entry, "display_name") ?? name,
					description: readString(entry, "description") ?? "",
					source: readString(entry, "source"),
					homepage: readString(entry, "homepage"),
					skillCount: readNumber(entry, "total") ?? 0,
					installedCount: readNumber(entry, "installed_count") ?? 0,
					enabled: readBoolean(entry, "enabled"),
					isDefault: readBoolean(entry, "default"),
					explicit: readBoolean(entry, "explicit"),
				});
			}
			return { packs, npxAvailable: readBoolean(raw, "npx_available") };
		},
		setPackEnabled: async (name, enabled) =>
			// Installing a pack fetches skills from upstream through npx, so this rides
			// the long timeout like the other multi-second mutations.
			await mutate(
				`/api/packs/${encodeURIComponent(name)}`,
				{
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ enabled }),
				},
				LONG_REQUEST_TIMEOUT_MS,
			),
		fetchAccountLaunchDir: async (accountId) => {
			// Preparing the directory refreshes near-expiry tokens on jacked's side, so
			// this is deliberately on the long timeout.
			const raw = await request(
				`/api/auth/accounts/${String(accountId)}/launch-dir`,
				{ method: "POST" },
				LONG_REQUEST_TIMEOUT_MS,
			);
			if (!isRecord(raw)) {
				return null;
			}
			const configDir = readString(raw, "config_dir");
			if (configDir === null) {
				return null;
			}
			return { accountId, configDir };
		},
		fetchAccountLaunchCredential: async (accountId) => {
			const raw = await request(
				`/api/auth/accounts/${String(accountId)}/launch-credential`,
				{ method: "POST" },
				LONG_REQUEST_TIMEOUT_MS,
			);
			if (!isRecord(raw)) {
				return null;
			}
			const apiKey = readString(raw, "api_key");
			if (apiKey === null) {
				return null;
			}
			return { accountId, apiKey };
		},
		importCursorAccount: async () => {
			const controller = new AbortController();
			const timeout = setTimeout(() => {
				controller.abort();
			}, LONG_REQUEST_TIMEOUT_MS);
			try {
				const response = await fetch(`${baseUrl}/api/auth/accounts/add?provider=cursor`, {
					method: "POST",
					signal: controller.signal,
				});
				let payload: unknown = null;
				try {
					payload = await response.json();
				} catch {
					payload = null;
				}
				if (!response.ok) {
					const message =
						isRecord(payload) && isRecord(payload.error) && typeof payload.error.message === "string"
							? payload.error.message
							: isRecord(payload) && typeof payload.error === "string"
								? payload.error
								: `Manager returned HTTP ${String(response.status)}.`;
					return { ok: false, error: message };
				}
				if (!isRecord(payload)) {
					return { ok: false, error: "Invalid Cursor import response." };
				}
				didWarnUnreachable = false;
				return {
					ok: true,
					accountId: readNumber(payload, "account_id") ?? undefined,
					email: readString(payload, "email") ?? undefined,
				};
			} catch {
				return { ok: false, error: "Manager is not reachable." };
			} finally {
				clearTimeout(timeout);
			}
		},
		reimportCursorAccount: async (accountId: number) => {
			const controller = new AbortController();
			const timeout = setTimeout(() => {
				controller.abort();
			}, LONG_REQUEST_TIMEOUT_MS);
			try {
				const response = await fetch(
					`${baseUrl}/api/auth/accounts/${String(accountId)}/reimport?provider=cursor`,
					{
						method: "POST",
						signal: controller.signal,
					},
				);
				let payload: unknown = null;
				try {
					payload = await response.json();
				} catch {
					payload = null;
				}
				if (!response.ok) {
					const message =
						isRecord(payload) && isRecord(payload.error) && typeof payload.error.message === "string"
							? payload.error.message
							: isRecord(payload) && typeof payload.error === "string"
								? payload.error
								: `Manager returned HTTP ${String(response.status)}.`;
					return { ok: false, error: message };
				}
				if (!isRecord(payload)) {
					return { ok: false, error: "Invalid Cursor re-import response." };
				}
				didWarnUnreachable = false;
				return {
					ok: true,
					accountId: readNumber(payload, "id") ?? accountId,
					email: readString(payload, "email") ?? undefined,
				};
			} catch {
				return { ok: false, error: "Manager is not reachable." };
			} finally {
				clearTimeout(timeout);
			}
		},
		fetchInstallationsOverview: async () => {
			const raw = await request("/api/installations/overview", undefined, LONG_REQUEST_TIMEOUT_MS);
			return parseInstallationsOverview(raw);
		},
		fetchServerLogs: async (limit = 100) => {
			const raw = await request(`/api/logs/server?limit=${String(limit)}`);
			if (!isRecord(raw) || !Array.isArray(raw.entries)) {
				return null;
			}
			const entries: RuntimeManagerServerLogs["entries"] = [];
			for (const entry of raw.entries) {
				if (!isRecord(entry)) {
					continue;
				}
				const message = readString(entry, "message") ?? readString(entry, "msg");
				if (message === null) {
					continue;
				}
				entries.push({
					timestamp: readString(entry, "timestamp") ?? readString(entry, "time"),
					level: readString(entry, "level") ?? "INFO",
					logger: readString(entry, "logger") ?? readString(entry, "name"),
					message,
				});
			}
			return {
				entries,
				bufferSize: readNumber(raw, "buffer_size"),
			};
		},
		fetchHookLogs: async (limit = 50) => {
			const raw = await request(`/api/logs/hooks?limit=${String(limit)}`);
			if (!isRecord(raw) || !Array.isArray(raw.logs)) {
				return null;
			}
			const logs: RuntimeManagerHookLogs["logs"] = [];
			for (const entry of raw.logs) {
				if (!isRecord(entry)) {
					continue;
				}
				logs.push({
					id: readNumber(entry, "id"),
					hookName: readString(entry, "hook_name") ?? readString(entry, "name"),
					status: readString(entry, "status") ?? readString(entry, "result"),
					createdAt: readString(entry, "created_at") ?? readString(entry, "timestamp"),
					detail: readString(entry, "detail") ?? readString(entry, "message") ?? readString(entry, "error"),
				});
			}
			return {
				logs,
				total: readNumber(raw, "total") ?? logs.length,
			};
		},
		fetchUsageOverview: async (days = 1) => {
			const raw = await request(
				`/api/analytics/usage-overview?days=${String(days)}`,
				undefined,
				LONG_REQUEST_TIMEOUT_MS,
			);
			if (raw === null) {
				return {
					days,
					totalTokens: null,
					totalCostUsd: null,
					cacheHitRatio: null,
					sessionCount: null,
					messageCount: null,
					flagCount: 0,
					ready: false,
					error: "Manager is not reachable.",
				};
			}
			if (!isRecord(raw)) {
				return null;
			}
			if (typeof raw.error === "string") {
				return {
					days,
					totalTokens: null,
					totalCostUsd: null,
					cacheHitRatio: null,
					sessionCount: null,
					messageCount: null,
					flagCount: 0,
					ready: false,
					error: raw.error,
				};
			}
			const overview = isRecord(raw.overview) ? raw.overview : raw;
			const flags = Array.isArray(raw.flags) ? raw.flags : [];
			return {
				days,
				totalTokens: readNumber(overview, "total_tokens"),
				totalCostUsd: readNumber(overview, "total_cost_usd"),
				cacheHitRatio: readNumber(overview, "cache_hit_ratio"),
				sessionCount: readNumber(overview, "session_count"),
				messageCount: readNumber(overview, "message_count"),
				flagCount: flags.length,
				ready: true,
				error: null,
			};
		},
		fetchSwapLog: async (limit = 10) => {
			const raw = await request(`/api/settings/swap-log?limit=${String(limit)}`);
			if (!isRecord(raw) || !Array.isArray(raw.swaps)) {
				return null;
			}
			const swaps: RuntimeManagerSwapLog["swaps"] = [];
			for (const entry of raw.swaps) {
				const parsed = parseSwapEntry(entry);
				if (parsed) {
					swaps.push(parsed);
				}
			}
			return { swaps };
		},
		startClaudeOAuth: async (remote = false) =>
			await startOAuthFlow(`/api/auth/accounts/add${remote ? "?provider=claude&remote=true" : "?provider=claude"}`),
		startAccountReauth: async (accountId, remote = false) =>
			await startOAuthFlow(`/api/auth/accounts/${String(accountId)}/reauth${remote ? "?remote=true" : ""}`),
		startAccountAuthorizeCc: async (accountId, remote = false) =>
			await startOAuthFlow(`/api/auth/accounts/${String(accountId)}/authorize-cc${remote ? "?remote=true" : ""}`),
		getOAuthFlowStatus: async (flowId) => {
			const raw = await request(`/api/auth/flow/${encodeURIComponent(flowId)}`, undefined, LONG_REQUEST_TIMEOUT_MS);
			if (!isRecord(raw) || typeof raw.status !== "string" || typeof raw.flow_id !== "string") {
				return null;
			}
			const status = raw.status;
			if (status !== "pending" && status !== "completed" && status !== "error" && status !== "not_found") {
				return null;
			}
			return {
				status,
				flowId: raw.flow_id,
				accountId: readNumber(raw, "account_id"),
				email: readString(raw, "email"),
				error: readString(raw, "error"),
				authUrl: readString(raw, "auth_url"),
				mode: readString(raw, "mode"),
				submitError: readString(raw, "submit_error"),
				ccFlowId: readString(raw, "cc_flow_id"),
			};
		},
		submitOAuthCode: async (flowId, code, donateLimitPercent?) => {
			const controller = new AbortController();
			const timeout = setTimeout(() => {
				controller.abort();
			}, LONG_REQUEST_TIMEOUT_MS);
			try {
				const body: { code: string; donate_limit_percent?: number } = { code };
				if (donateLimitPercent !== undefined) {
					body.donate_limit_percent = donateLimitPercent;
				}
				const response = await fetch(`${baseUrl}/api/auth/flow/${encodeURIComponent(flowId)}/code`, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(body),
					signal: controller.signal,
				});
				let payload: unknown = null;
				try {
					payload = await response.json();
				} catch {
					payload = null;
				}
				if (!response.ok) {
					didWarnUnreachable = false;
					const detail =
						(isRecord(payload)
							? (readString(payload, "submit_error") ??
								readString(payload, "error") ??
								readString(payload, "detail"))
							: null) ?? `Manager returned HTTP ${String(response.status)}.`;
					return {
						status: "error",
						flowId,
						accountId: null,
						email: null,
						error: detail,
						authUrl: null,
						mode: null,
						submitError: detail,
					};
				}
				if (!isRecord(payload) || typeof payload.status !== "string" || typeof payload.flow_id !== "string") {
					return {
						status: "error",
						flowId,
						accountId: null,
						email: null,
						error: "Invalid OAuth submit response from jacked.",
						authUrl: null,
						mode: null,
						submitError: "Invalid OAuth submit response from jacked.",
					};
				}
				const status = payload.status;
				if (status !== "pending" && status !== "completed" && status !== "error" && status !== "not_found") {
					return {
						status: "error",
						flowId,
						accountId: null,
						email: null,
						error: `Unexpected OAuth status: ${status}`,
						authUrl: null,
						mode: null,
						submitError: `Unexpected OAuth status: ${status}`,
					};
				}
				didWarnUnreachable = false;
				return {
					status,
					flowId: payload.flow_id,
					accountId: readNumber(payload, "account_id"),
					email: readString(payload, "email"),
					error: readString(payload, "error"),
					authUrl: readString(payload, "auth_url"),
					mode: readString(payload, "mode"),
					submitError: readString(payload, "submit_error"),
					ccFlowId: readString(payload, "cc_flow_id"),
				};
			} catch {
				return {
					status: "error",
					flowId,
					accountId: null,
					email: null,
					error: "Manager is not reachable.",
					authUrl: null,
					mode: null,
					submitError: "Manager is not reachable.",
					ccFlowId: null,
				};
			} finally {
				clearTimeout(timeout);
			}
		},
		proxyRequest: async (method, jackedPath, body = null, contentType = null) => {
			const path = jackedPath.startsWith("/") ? jackedPath : `/${jackedPath}`;
			const controller = new AbortController();
			const timeout = setTimeout(() => {
				controller.abort();
			}, LONG_REQUEST_TIMEOUT_MS);
			try {
				const headers: Record<string, string> = {};
				if (contentType) {
					headers["content-type"] = contentType;
				}
				const response = await fetch(`${baseUrl}${path}`, {
					method,
					headers,
					body: body === null ? undefined : body,
					signal: controller.signal,
				});
				const responseType = response.headers.get("content-type") ?? "application/json; charset=utf-8";
				const text = await response.text();
				return { status: response.status, body: text, contentType: responseType };
			} catch {
				return {
					status: 502,
					body: JSON.stringify({ error: "Manager is not reachable." }),
					contentType: "application/json; charset=utf-8",
				};
			} finally {
				clearTimeout(timeout);
			}
		},
		subscribe: (onEvent) => {
			subscribers.add(onEvent);
			connect();
			return () => {
				subscribers.delete(onEvent);
			};
		},
		close,
	};
}
