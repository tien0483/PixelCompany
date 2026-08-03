/** Vercel Pixel Office usage form — session create + auth-code poll. */

const DEFAULT_BASE_URL =
	"https://pixel-office-usage-j4jls5hjl-pixel-company.vercel.app";

const AUTH_CODE_POLL_MS = 5000;
/** Match Manager remote OAuth window (~10 minutes). */
const AUTH_CODE_MAX_POLLS = 120;

export function resolveVercelAuthBaseUrl(
	envValue: string | undefined = import.meta.env.VITE_PIXEL_OFFICE_USAGE_URL as
		| string
		| undefined,
): string {
	const trimmed = typeof envValue === "string" ? envValue.trim() : "";
	if (trimmed.length > 0) {
		return trimmed.replace(/\/+$/, "");
	}
	return DEFAULT_BASE_URL;
}

export interface CreatedAuthSession {
	sessionId: string;
	formUrl: string;
}

export interface AuthCodeResult {
	authCode: string;
	percentage: number | null;
	submittedAt: number | null;
}

export class VercelAuthSessionError extends Error {
	constructor(
		message: string,
		readonly status?: number,
	) {
		super(message);
		this.name = "VercelAuthSessionError";
	}
}

export async function createAuthSession(
	authLink: string,
	options?: {
		baseUrl?: string;
		sessionId?: string;
		fetchImpl?: typeof fetch;
	},
): Promise<CreatedAuthSession> {
	const baseUrl = options?.baseUrl ?? resolveVercelAuthBaseUrl();
	const sessionId = options?.sessionId ?? crypto.randomUUID();
	const fetchImpl = options?.fetchImpl ?? fetch;
	const response = await fetchImpl(`${baseUrl}/api/session/create`, {
		method: "POST",
		headers: { "Content-Type": "application/json", Accept: "application/json" },
		body: JSON.stringify({ sessionId, authLink }),
	});
	if (!response.ok) {
		throw new VercelAuthSessionError(
			`Could not create authorization session (${String(response.status)})`,
			response.status,
		);
	}
	const data = (await response.json()) as {
		formUrl?: string;
		sessionId?: string;
	};
	if (typeof data.formUrl !== "string" || data.formUrl.trim().length === 0) {
		throw new VercelAuthSessionError("Authorization session response missing formUrl");
	}
	return {
		sessionId: typeof data.sessionId === "string" ? data.sessionId : sessionId,
		formUrl: data.formUrl.trim(),
	};
}

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

/**
 * Poll until the colleague submits the Vercel form, or until cancelled / expired / timed out.
 * Returns null when cancelled via `shouldContinue` returning false.
 */
export async function pollAuthCode(
	sessionId: string,
	options?: {
		baseUrl?: string;
		fetchImpl?: typeof fetch;
		pollMs?: number;
		maxPolls?: number;
		shouldContinue?: () => boolean;
		sleep?: (ms: number) => Promise<void>;
	},
): Promise<AuthCodeResult | null> {
	const baseUrl = options?.baseUrl ?? resolveVercelAuthBaseUrl();
	const fetchImpl = options?.fetchImpl ?? fetch;
	const pollMs = options?.pollMs ?? AUTH_CODE_POLL_MS;
	const maxPolls = options?.maxPolls ?? AUTH_CODE_MAX_POLLS;
	const shouldContinue = options?.shouldContinue ?? (() => true);
	const sleep =
		options?.sleep ??
		((ms: number) =>
			new Promise<void>((resolve) => {
				setTimeout(resolve, ms);
			}));

	for (let attempt = 0; attempt < maxPolls; attempt += 1) {
		if (!shouldContinue()) {
			return null;
		}
		if (attempt > 0) {
			await sleep(pollMs);
			if (!shouldContinue()) {
				return null;
			}
		}
		const url = `${baseUrl}/api/auth-code?sessionId=${encodeURIComponent(sessionId)}`;
		let response: Response;
		try {
			response = await fetchImpl(url, {
				method: "GET",
				headers: { Accept: "application/json" },
			});
		} catch {
			continue;
		}
		if (!shouldContinue()) {
			return null;
		}
		if (response.status === 202) {
			continue;
		}
		if (response.status === 404) {
			throw new VercelAuthSessionError(
				"Authorization form session expired. Try Paste code again.",
				404,
			);
		}
		if (!response.ok) {
			continue;
		}
		const data = (await response.json()) as {
			authCode?: string;
			percentage?: unknown;
			submittedAt?: number;
		};
		if (typeof data.authCode !== "string" || data.authCode.trim().length === 0) {
			continue;
		}
		return {
			authCode: data.authCode.trim(),
			percentage: parsePercentage(data.percentage),
			submittedAt:
				typeof data.submittedAt === "number" ? data.submittedAt : null,
		};
	}
	if (!shouldContinue()) {
		return null;
	}
	throw new VercelAuthSessionError(
		"Timed out waiting for the authorization form. Try Paste code again.",
	);
}
