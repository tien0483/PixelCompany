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

const DEFAULT_BASE_URL = "https://pixel-office-usage.vercel.app";

export function resolveUsageAuthBaseUrl(
	envValue: string | undefined = process.env.PIXEL_OFFICE_USAGE_URL,
): string {
	const trimmed = typeof envValue === "string" ? envValue.trim() : "";
	if (trimmed.length > 0) {
		return trimmed.replace(/\/+$/, "");
	}
	return DEFAULT_BASE_URL;
}

export function resolveUsageAuthBypassSecret(
	envValue: string | undefined = process.env.PIXEL_OFFICE_USAGE_BYPASS_SECRET,
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

export interface UsageAuthSessionCreated {
	sessionId: string;
	formUrl: string;
}

export type UsageAuthCodeLookup =
	| {
			status: "pending";
			authCode: null;
			percentage: null;
			submittedAt: null;
			error: null;
	  }
	| {
			status: "ready";
			authCode: string;
			percentage: number | null;
			submittedAt: number | null;
			error: null;
	  }
	| {
			status: "expired";
			authCode: null;
			percentage: null;
			submittedAt: null;
			error: string;
	  }
	| {
			status: "error";
			authCode: null;
			percentage: null;
			submittedAt: null;
			error: string;
	  };

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
		body: JSON.stringify({ sessionId, authLink }),
		redirect: "follow",
	});
	if (!response.ok) {
		throw new Error(describeHttpFailure(response.status, "Could not create authorization session"));
	}
	const data = (await response.json()) as {
		formUrl?: string;
		sessionId?: string;
	};
	if (typeof data.formUrl !== "string" || data.formUrl.trim().length === 0) {
		throw new Error("Authorization session response missing formUrl");
	}
	return {
		sessionId: typeof data.sessionId === "string" ? data.sessionId : sessionId,
		formUrl: normalizeFormUrl(data.formUrl.trim(), baseUrl, sessionId),
	};
}

/**
 * Some Vercel envs still mint formUrl against localhost. Rewrite to the public base
 * while preserving the sessionId query so emailed links are usable.
 */
export function normalizeFormUrl(
	formUrl: string,
	baseUrl: string,
	sessionId: string,
): string {
	try {
		const parsed = new URL(formUrl);
		const host = parsed.hostname.toLowerCase();
		if (host === "localhost" || host === "127.0.0.1") {
			const publicUrl = new URL(baseUrl);
			publicUrl.searchParams.set(
				"sessionId",
				parsed.searchParams.get("sessionId") ?? sessionId,
			);
			return publicUrl.toString();
		}
	} catch {
		// Fall through and return the original string.
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
		};
	}
	if (response.status === 202) {
		return {
			status: "pending",
			authCode: null,
			percentage: null,
			submittedAt: null,
			error: null,
		};
	}
	if (response.status === 404) {
		return {
			status: "expired",
			authCode: null,
			percentage: null,
			submittedAt: null,
			error: "Authorization form session expired. Try Paste code again.",
		};
	}
	if (!response.ok) {
		return {
			status: "error",
			authCode: null,
			percentage: null,
			submittedAt: null,
			error: describeHttpFailure(response.status, "Authorization form poll failed"),
		};
	}
	const data = (await response.json()) as {
		authCode?: string;
		percentage?: unknown;
		submittedAt?: number;
	};
	if (typeof data.authCode !== "string" || data.authCode.trim().length === 0) {
		return {
			status: "pending",
			authCode: null,
			percentage: null,
			submittedAt: null,
			error: null,
		};
	}
	return {
		status: "ready",
		authCode: data.authCode.trim(),
		percentage: parsePercentage(data.percentage),
		submittedAt: typeof data.submittedAt === "number" ? data.submittedAt : null,
		error: null,
	};
}
