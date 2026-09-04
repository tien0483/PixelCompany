/**
 * Server-side proxy to the Pixel Office usage Vercel app.
 * Browser calls hit CORS/preflight redirects; the runtime fetches instead.
 *
 * Preview deployments often enable Vercel Deployment Protection (401 login wall).
 * Set PIXEL_OFFICE_USAGE_BYPASS_SECRET to the project's Protection Bypass for
 * Automation secret so the runtime can call the APIs. Colleague form links still
 * need a public production URL (or protection disabled) — do not put the bypass
 * secret in emailed formUrl.
 */

import { readBrandEnv } from "../brand";

const DEFAULT_BASE_URL = "https://pixel-office-usage.vercel.app";

export function resolveUsageAuthBaseUrl(
	envValue: string | undefined = readBrandEnv("USAGE_URL"),
): string {
	const trimmed = typeof envValue === "string" ? envValue.trim() : "";
	if (trimmed.length > 0) {
		return trimmed.replace(/\/+$/, "");
	}
	return DEFAULT_BASE_URL;
}

export function resolveUsageAuthBypassSecret(
	envValue: string | undefined = readBrandEnv("USAGE_BYPASS_SECRET"),
): string | null {
	const trimmed = typeof envValue === "string" ? envValue.trim() : "";
	return trimmed.length > 0 ? trimmed : null;
}

function usageAuthHeaders(
	extra: Record<string, string>,
	bypassSecret: string | null = resolveUsageAuthBypassSecret(),
): Record<string, string> {
	if (bypassSecret === null) {
		return extra;
	}
	return {
		...extra,
		"x-vercel-protection-bypass": bypassSecret,
	};
}

/**
 * Which steps the colleague-facing form renders.
 * - `authorize`: usage-share percentage, authorize, paste code (all three steps).
 * - `cc`: authorize + paste code only; no percentage is collected.
 */
export type UsageAuthType = "authorize" | "cc";

export interface UsageAuthSessionCreated {
	sessionId: string;
	formUrl: string;
	authType: UsageAuthType | null;
	/** Who shares the usage — the leaderboard subject. */
	sender: string | null;
	/** Who borrows the usage — stored for reference only. */
	receiver: string | null;
}

/** Identity fields the form echoes back alongside the code. */
interface UsageAuthIdentity {
	authType: UsageAuthType | null;
	accountName: string | null;
	sender: string | null;
	receiver: string | null;
}

const EMPTY_IDENTITY: UsageAuthIdentity = {
	authType: null,
	accountName: null,
	sender: null,
	receiver: null,
};

export type UsageAuthCodeLookup =
	| ({
			status: "pending";
			authCode: null;
			percentage: null;
			submittedAt: null;
			error: null;
	  } & UsageAuthIdentity)
	| ({
			status: "ready";
			authCode: string;
			/** Absent for `cc` sessions — the form never asks. */
			percentage: number | null;
			submittedAt: number | null;
			error: null;
	  } & UsageAuthIdentity)
	| ({
			status: "expired";
			authCode: null;
			percentage: null;
			submittedAt: null;
			error: string;
	  } & UsageAuthIdentity)
	| ({
			status: "error";
			authCode: null;
			percentage: null;
			submittedAt: null;
			error: string;
	  } & UsageAuthIdentity);

function parsePercentage(raw: unknown): number | null {
	if (typeof raw === "number" && Number.isFinite(raw)) {
		return Math.max(0, Math.min(100, Math.round(raw)));
	}
	if (typeof raw === "string" && raw.trim().length > 0) {
		const parsed = Number.parseInt(raw.trim(), 10);
		if (Number.isFinite(parsed)) {
			return Math.max(0, Math.min(100, parsed));
		}
	}
	return null;
}

function parseAuthType(raw: unknown): UsageAuthType | null {
	return raw === "authorize" || raw === "cc" ? raw : null;
}

function parseIdentityField(raw: unknown): string | null {
	return typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : null;
}

/** Drop blank optionals so the form falls back to its own defaults. */
function optionalField(
	key: string,
	value: string | undefined,
): Record<string, string> {
	const trimmed = typeof value === "string" ? value.trim() : "";
	return trimmed.length > 0 ? { [key]: trimmed } : {};
}

function describeHttpFailure(status: number, action: string): string {
	if (status === 401 || status === 403) {
		return (
			`${action} returned ${String(status)} — the Vercel deployment is protected. ` +
			`Disable Deployment Protection for a public production URL, or set ` +
			`PIXEL_OFFICE_USAGE_BYPASS_SECRET to the project's Protection Bypass for Automation secret.`
		);
	}
	return `${action} (${String(status)})`;
}

export async function createUsageAuthSession(
	authLink: string,
	options?: {
		baseUrl?: string;
		sessionId?: string;
		bypassSecret?: string | null;
		fetchImpl?: typeof fetch;
		/** Defaults to `authorize` on the form when omitted. */
		authType?: UsageAuthType;
		/** Colleague who shares the usage — required for leaderboard scoring. */
		sender?: string;
		/** Whoever borrows the usage; reference only. */
		receiver?: string;
		/** Legacy seat label; the form falls back to it when `sender` is absent. */
		accountName?: string;
	},
): Promise<UsageAuthSessionCreated> {
	const baseUrl = options?.baseUrl ?? resolveUsageAuthBaseUrl();
	const sessionId = options?.sessionId ?? crypto.randomUUID();
	const fetchImpl = options?.fetchImpl ?? fetch;
	const bypassSecret =
		options?.bypassSecret === undefined
			? resolveUsageAuthBypassSecret()
			: options.bypassSecret;
	const response = await fetchImpl(`${baseUrl}/api/session/create`, {
		method: "POST",
		headers: usageAuthHeaders(
			{ "Content-Type": "application/json", Accept: "application/json" },
			bypassSecret,
		),
		body: JSON.stringify({
			sessionId,
			authLink,
			...optionalField("authType", options?.authType),
			...optionalField("sender", options?.sender),
			...optionalField("receiver", options?.receiver),
			...optionalField("accountName", options?.accountName),
		}),
		redirect: "follow",
	});
	if (!response.ok) {
		throw new Error(describeHttpFailure(response.status, "Could not create authorization session"));
	}
	const data = (await response.json()) as {
		formUrl?: string;
		sessionId?: string;
		authType?: unknown;
		sender?: unknown;
		receiver?: unknown;
	};
	if (typeof data.formUrl !== "string" || data.formUrl.trim().length === 0) {
		throw new Error("Authorization session response missing formUrl");
	}
	return {
		sessionId: typeof data.sessionId === "string" ? data.sessionId : sessionId,
		formUrl: normalizeFormUrl(data.formUrl.trim(), baseUrl, sessionId),
		authType: parseAuthType(data.authType),
		sender: parseIdentityField(data.sender),
		receiver: parseIdentityField(data.receiver),
	};
}

/**
 * Some Vercel envs still mint formUrl against localhost. Rewrite to the public base
 * while preserving the sessionId query so emailed links are usable.
 *
 * The returned URL is also pinned to the configured base origin. This value comes
 * back from the remote broker and then goes straight into an email the *user*
 * sends under their own name (`manager-oauth-invite-email.ts`), so a compromised
 * or misconfigured broker could otherwise put any link in front of a colleague
 * who has been told to expect an authorization form. Anything off-origin is
 * rebuilt from the base we dialled plus the session id we already hold, which is
 * exactly what the localhost branch below has always done.
 */
export function normalizeFormUrl(
	formUrl: string,
	baseUrl: string,
	sessionId: string,
): string {
	const rebuildFromBase = (suppliedSessionId?: string | null): string => {
		const publicUrl = new URL(baseUrl);
		publicUrl.searchParams.set("sessionId", suppliedSessionId ?? sessionId);
		return publicUrl.toString();
	};
	let parsed: URL;
	let base: URL;
	try {
		parsed = new URL(formUrl);
		base = new URL(baseUrl);
	} catch {
		// An unparseable base is a configuration error we cannot repair here; an
		// unparseable formUrl is not something to put in an email either.
		return formUrl;
	}
	const host = parsed.hostname.toLowerCase();
	if (host === "localhost" || host === "127.0.0.1") {
		return rebuildFromBase(parsed.searchParams.get("sessionId"));
	}
	if (parsed.origin !== base.origin) {
		return rebuildFromBase(parsed.searchParams.get("sessionId"));
	}
	return formUrl;
}

export async function lookupUsageAuthCode(
	sessionId: string,
	options?: {
		baseUrl?: string;
		bypassSecret?: string | null;
		fetchImpl?: typeof fetch;
	},
): Promise<UsageAuthCodeLookup> {
	const baseUrl = options?.baseUrl ?? resolveUsageAuthBaseUrl();
	const fetchImpl = options?.fetchImpl ?? fetch;
	const bypassSecret =
		options?.bypassSecret === undefined
			? resolveUsageAuthBypassSecret()
			: options.bypassSecret;
	const url = `${baseUrl}/api/auth-code?sessionId=${encodeURIComponent(sessionId)}`;
	let response: Response;
	try {
		response = await fetchImpl(url, {
			method: "GET",
			headers: usageAuthHeaders({ Accept: "application/json" }, bypassSecret),
			redirect: "follow",
		});
	} catch (err) {
		return {
			status: "error",
			authCode: null,
			percentage: null,
			submittedAt: null,
			error: err instanceof Error ? err.message : "Failed to reach authorization form",
			...EMPTY_IDENTITY,
		};
	}
	if (response.status === 202) {
		return {
			status: "pending",
			authCode: null,
			percentage: null,
			submittedAt: null,
			error: null,
			...EMPTY_IDENTITY,
		};
	}
	if (response.status === 404) {
		return {
			status: "expired",
			authCode: null,
			percentage: null,
			submittedAt: null,
			error: "Authorization form session expired. Try Paste code again.",
			...EMPTY_IDENTITY,
		};
	}
	if (!response.ok) {
		return {
			status: "error",
			authCode: null,
			percentage: null,
			submittedAt: null,
			error: describeHttpFailure(response.status, "Authorization form poll failed"),
			...EMPTY_IDENTITY,
		};
	}
	const data = (await response.json()) as {
		authCode?: string;
		percentage?: unknown;
		submittedAt?: number;
		authType?: unknown;
		accountName?: unknown;
		sender?: unknown;
		receiver?: unknown;
	};
	if (typeof data.authCode !== "string" || data.authCode.trim().length === 0) {
		return {
			status: "pending",
			authCode: null,
			percentage: null,
			submittedAt: null,
			error: null,
			...EMPTY_IDENTITY,
		};
	}
	return {
		status: "ready",
		authCode: data.authCode.trim(),
		// `cc` sessions omit `percentage` entirely; parsePercentage answers null.
		percentage: parsePercentage(data.percentage),
		submittedAt: typeof data.submittedAt === "number" ? data.submittedAt : null,
		error: null,
		authType: parseAuthType(data.authType),
		accountName: parseIdentityField(data.accountName),
		sender: parseIdentityField(data.sender),
		receiver: parseIdentityField(data.receiver),
	};
}
