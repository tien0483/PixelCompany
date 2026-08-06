/**
 * Vercel usage-form auth session — browser talks to runtime tRPC, which proxies
 * to Vercel (avoids CORS / preflight redirects from localhost).
 */

import { getRuntimeTrpcClient } from "@/runtime/trpc-client";

const AUTH_CODE_POLL_MS = 5000;
/** Match Manager remote OAuth window (~10 minutes). */
const AUTH_CODE_MAX_POLLS = 120;

/**
 * Which steps the colleague-facing form renders.
 * - `authorize`: usage-share percentage, authorize, paste code.
 * - `cc`: authorize + paste code only; no percentage is collected.
 */
export type UsageAuthType = "authorize" | "cc";

/** Who the session is for — the form scores its leaderboard per `sender`. */
export interface AuthSessionIdentity {
	authType?: UsageAuthType;
	/** Colleague who shares the usage. */
	sender?: string;
	/** Whoever borrows the usage; reference only. */
	receiver?: string;
	/** Legacy seat label; the form falls back to it when `sender` is absent. */
	accountName?: string;
}

export interface CreatedAuthSession {
	sessionId: string;
	formUrl: string;
	authType: UsageAuthType | null;
	sender: string | null;
	receiver: string | null;
}

export interface AuthCodeResult {
	authCode: string;
	/** Null for `cc` sessions — the form never asks for a percentage. */
	percentage: number | null;
	submittedAt: number | null;
	authType: UsageAuthType | null;
	accountName: string | null;
	sender: string | null;
	receiver: string | null;
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

/** The contract rejects empty strings, so blank identity fields are dropped. */
function optionalField(
	key: string,
	value: string | undefined,
): Record<string, string> {
	const trimmed = value?.trim() ?? "";
	return trimmed.length > 0 ? { [key]: trimmed } : {};
}

export async function createAuthSession(
	authLink: string,
	options?: AuthSessionIdentity & {
		sessionId?: string;
	},
): Promise<CreatedAuthSession> {
	try {
		return await getRuntimeTrpcClient(null).manager.createUsageAuthSession.mutate({
			authLink,
			...(options?.sessionId === undefined ? {} : { sessionId: options.sessionId }),
			...(options?.authType === undefined ? {} : { authType: options.authType }),
			...optionalField("sender", options?.sender),
			...optionalField("receiver", options?.receiver),
			...optionalField("accountName", options?.accountName),
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
			authType: UsageAuthType | null;
			accountName: string | null;
			sender: string | null;
			receiver: string | null;
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
			authType: lookup.authType,
			accountName: lookup.accountName,
			sender: lookup.sender,
			receiver: lookup.receiver,
		};
	}
	if (!shouldContinue()) {
		return null;
	}
	throw new VercelAuthSessionError(
		"Timed out waiting for the authorization form. Try Paste code again.",
	);
}
