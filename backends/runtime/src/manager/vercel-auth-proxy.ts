/**
 * Server-side proxy to the Pixel Office usage Vercel app.
 * Browser calls hit CORS/preflight redirects; the runtime fetches instead.
 */

const DEFAULT_BASE_URL =
	"https://pixel-office-usage-j4jls5hjl-pixel-company.vercel.app";

export function resolveUsageAuthBaseUrl(
	envValue: string | undefined = process.env.PIXEL_OFFICE_USAGE_URL,
): string {
	const trimmed = typeof envValue === "string" ? envValue.trim() : "";
	if (trimmed.length > 0) {
		return trimmed.replace(/\/+$/, "");
	}
	return DEFAULT_BASE_URL;
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

export async function createUsageAuthSession(
	authLink: string,
	options?: {
		baseUrl?: string;
		sessionId?: string;
		fetchImpl?: typeof fetch;
	},
): Promise<UsageAuthSessionCreated> {
	const baseUrl = options?.baseUrl ?? resolveUsageAuthBaseUrl();
	const sessionId = options?.sessionId ?? crypto.randomUUID();
	const fetchImpl = options?.fetchImpl ?? fetch;
	const response = await fetchImpl(`${baseUrl}/api/session/create`, {
		method: "POST",
		headers: { "Content-Type": "application/json", Accept: "application/json" },
		body: JSON.stringify({ sessionId, authLink }),
		redirect: "follow",
	});
	if (!response.ok) {
		throw new Error(`Could not create authorization session (${String(response.status)})`);
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
		formUrl: data.formUrl.trim(),
	};
}

export async function lookupUsageAuthCode(
	sessionId: string,
	options?: {
		baseUrl?: string;
		fetchImpl?: typeof fetch;
	},
): Promise<UsageAuthCodeLookup> {
	const baseUrl = options?.baseUrl ?? resolveUsageAuthBaseUrl();
	const fetchImpl = options?.fetchImpl ?? fetch;
	const url = `${baseUrl}/api/auth-code?sessionId=${encodeURIComponent(sessionId)}`;
	let response: Response;
	try {
		response = await fetchImpl(url, {
			method: "GET",
			headers: { Accept: "application/json" },
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
			error: `Authorization form poll failed (${String(response.status)})`,
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
