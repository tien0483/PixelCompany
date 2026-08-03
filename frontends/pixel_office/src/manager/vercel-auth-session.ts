/**
 * Vercel usage-form auth session — browser talks to runtime tRPC, which proxies
 * to Vercel (avoids CORS / preflight redirects from localhost).
 */

import { getRuntimeTrpcClient } from "@/runtime/trpc-client";

const AUTH_CODE_POLL_MS = 5000;
/** Match Manager remote OAuth window (~10 minutes). */
const AUTH_CODE_MAX_POLLS = 120;

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
		sessionId?: string;
	},
): Promise<CreatedAuthSession> {
	try {
		return await getRuntimeTrpcClient(null).manager.createUsageAuthSession.mutate({
			authLink,
			...(options?.sessionId === undefined ? {} : { sessionId: options.sessionId }),
		});
	} catch (err) {
		throw new VercelAuthSessionError(
			err instanceof Error
				? err.message
				: "Could not create authorization form session",
		);
	}
}

/**
 * Poll until the colleague submits the Vercel form, or until cancelled / expired / timed out.
 * Returns null when cancelled via `shouldContinue` returning false.
 */
export async function pollAuthCode(
	sessionId: string,
	options?: {
		pollMs?: number;
		maxPolls?: number;
		shouldContinue?: () => boolean;
		sleep?: (ms: number) => Promise<void>;
	},
): Promise<AuthCodeResult | null> {
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
		let lookup: {
			status: "pending" | "ready" | "expired" | "error";
			authCode: string | null;
			percentage: number | null;
			submittedAt: number | null;
			error: string | null;
		};
		try {
			lookup = await getRuntimeTrpcClient(null).manager.getUsageAuthCode.query({
				sessionId,
			});
		} catch {
			continue;
		}
		if (!shouldContinue()) {
			return null;
		}
		if (lookup.status === "pending") {
			continue;
		}
		if (lookup.status === "expired") {
			throw new VercelAuthSessionError(
				lookup.error ?? "Authorization form session expired. Try Paste code again.",
				404,
			);
		}
		if (lookup.status === "error") {
			throw new VercelAuthSessionError(
				lookup.error ?? "Authorization form poll failed",
			);
		}
		if (typeof lookup.authCode !== "string" || lookup.authCode.trim().length === 0) {
			continue;
		}
		return {
			authCode: lookup.authCode.trim(),
			percentage: lookup.percentage,
			submittedAt: lookup.submittedAt,
		};
	}
	if (!shouldContinue()) {
		return null;
	}
	throw new VercelAuthSessionError(
		"Timed out waiting for the authorization form. Try Paste code again.",
	);
}
