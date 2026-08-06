/**
 * Owns the remote paste-code invite: who is sharing the account, creating the
 * Vercel form session with that identity, and copying the invite email.
 *
 * The session is created on the Copy click rather than when the OAuth flow
 * starts — the form scores its leaderboard per `sender`, and `sender` is
 * immutable once `POST /api/session/create` has run. Deferring also means the
 * form's 1h expiry starts when the email is actually sent.
 */

import { useEffect, useRef, useState } from "react";
import { buildClaudeCcOAuthInviteEmail } from "@/manager/manager-oauth-cc-invite-email";
import {
	buildClaudeOAuthInviteEmail,
	buildClaudeReauthInviteEmail,
	type ClaudeOAuthInviteEmail,
	copyClaudeOAuthInviteEmail,
} from "@/manager/manager-oauth-invite-email";
import {
	createAuthSession,
	type UsageAuthType,
	VercelAuthSessionError,
} from "@/manager/vercel-auth-session";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";

export type OauthFlowKind = "account" | "cc";

/** An OAuth flow waiting for the operator to name the sender and copy the email. */
export interface PendingInviteFlow {
	/** Anthropic authorization URL the form's Authorize button opens. */
	authUrl: string;
	/** Manager-side flow the pasted code is submitted against. */
	flowId: string;
	/** Guards against a cancelled flow resolving late. */
	generation: number;
	flowKind: OauthFlowKind;
	/** Add Account only — apply the donate % the form collects. */
	applyFormDonate: boolean;
	/** Known seat email for Re-auth and CC; prefills the sender fields. */
	accountEmail?: string;
}

export interface ClaudeInviteSessionCallbacks {
	/** False once the flow was cancelled or superseded. */
	isCurrent: (generation: number) => boolean;
	onStatus: (status: string) => void;
	onError: (message: string) => void;
	/** Fired once the form session exists — start the pollers here. */
	onSessionStarted: (sessionId: string, flow: PendingInviteFlow) => void;
}

export interface ClaudeInviteSession {
	senderName: string;
	setSenderName: (value: string) => void;
	senderEmail: string;
	setSenderEmail: (value: string) => void;
	pending: PendingInviteFlow | null;
	email: ClaudeOAuthInviteEmail | null;
	/** Local git identity — who borrows the usage. Null until resolved. */
	receiver: string | null;
	/** True once the Vercel session exists — sender fields are frozen from here. */
	sessionStarted: boolean;
	copied: boolean;
	copyError: string | null;
	busy: boolean;
	canCopy: boolean;
	begin: (flow: PendingInviteFlow) => void;
	reset: () => void;
	copyEmail: () => Promise<void>;
}

/** Good enough to catch typos; the form does the real delivery check. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidSenderEmail(value: string): boolean {
	return EMAIL_PATTERN.test(value.trim());
}

/**
 * Only Add Account asks the colleague for a usage percentage. Re-auth and CC
 * discard it, so their forms render the two-step (`cc`) variant instead.
 */
export function resolveAuthType(flow: PendingInviteFlow): UsageAuthType {
	return flow.flowKind === "cc" || !flow.applyFormDonate ? "cc" : "authorize";
}

function buildInviteEmail(
	flow: PendingInviteFlow,
	formUrl: string,
	senderName: string,
): ClaudeOAuthInviteEmail {
	const options = {
		accountEmail: flow.accountEmail,
		senderName,
	};
	if (flow.flowKind === "cc") {
		return buildClaudeCcOAuthInviteEmail(formUrl, options);
	}
	return flow.applyFormDonate
		? buildClaudeOAuthInviteEmail(formUrl, options)
		: buildClaudeReauthInviteEmail(formUrl, options);
}

function waitingStatus(flow: PendingInviteFlow): string {
	if (flow.flowKind === "cc") {
		return flow.accountEmail
			? `CC invite copied for ${flow.accountEmail} — send it, then wait for the form.`
			: "CC invite copied — send it, then wait for the form.";
	}
	if (flow.applyFormDonate) {
		return "Invite copied — send it, then wait for your colleague to submit the form.";
	}
	return flow.accountEmail
		? `Re-auth invite copied for ${flow.accountEmail} — send it, then wait for the form.`
		: "Re-auth invite copied — send it, then wait for the form.";
}

export function useClaudeInviteSession(
	callbacks: ClaudeInviteSessionCallbacks,
): ClaudeInviteSession {
	const [senderName, setSenderName] = useState("");
	const [senderEmail, setSenderEmail] = useState("");
	const [pending, setPending] = useState<PendingInviteFlow | null>(null);
	const [email, setEmail] = useState<ClaudeOAuthInviteEmail | null>(null);
	const [sessionStarted, setSessionStarted] = useState(false);
	const [copied, setCopied] = useState(false);
	const [copyError, setCopyError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [receiver, setReceiver] = useState<string | null>(null);

	// The borrower is whoever runs this office, which is exactly what the repo's
	// git identity records. Read once — it does not change mid-session.
	useEffect(() => {
		let cancelled = false;
		void (async () => {
			try {
				const identity = await getRuntimeTrpcClient(null).manager.gitIdentity.query();
				if (!cancelled) {
					setReceiver(identity.label);
				}
			} catch {
				// receiver is reference-only on the form; a missing one is harmless.
			}
		})();
		return () => {
			cancelled = true;
		};
	}, []);

	// Callbacks close over view state that changes every render; a ref keeps the
	// handlers below from capturing a stale snapshot.
	const callbacksRef = useRef(callbacks);
	callbacksRef.current = callbacks;

	const reset = () => {
		setSenderName("");
		setSenderEmail("");
		setPending(null);
		setEmail(null);
		setSessionStarted(false);
		setCopied(false);
		setCopyError(null);
		setBusy(false);
	};

	const begin = (flow: PendingInviteFlow) => {
		const seat = flow.accountEmail?.trim() ?? "";
		setSenderName(seat);
		setSenderEmail(seat);
		setPending(flow);
		setEmail(null);
		setSessionStarted(false);
		setCopied(false);
		setCopyError(null);
		setBusy(false);
	};

	const copyEmail = async () => {
		if (pending === null || busy) {
			return;
		}
		setCopyError(null);
		// Re-copying must not mint a second session — the first one is already
		// being polled and carries the sender the form scored against.
		if (email !== null) {
			try {
				await copyClaudeOAuthInviteEmail(email);
				setCopied(true);
			} catch {
				setCopyError("Could not copy email to clipboard.");
			}
			return;
		}
		if (!isValidSenderEmail(senderEmail)) {
			setCopyError("Enter the sender's email before copying the invite.");
			return;
		}
		setBusy(true);
		try {
			const session = await createAuthSession(pending.authUrl, {
				authType: resolveAuthType(pending),
				sender: senderEmail,
				...(receiver === null ? {} : { receiver }),
				accountName: senderName.trim().length > 0 ? senderName : senderEmail,
			});
			if (!callbacksRef.current.isCurrent(pending.generation)) {
				return;
			}
			const invite = buildInviteEmail(pending, session.formUrl, senderName);
			setEmail(invite);
			setSessionStarted(true);
			try {
				await copyClaudeOAuthInviteEmail(invite);
				setCopied(true);
			} catch {
				// The session is live either way — surface the clipboard failure but
				// still start polling so a manually shared link keeps working.
				setCopyError("Session created, but the email could not be copied.");
			}
			if (!callbacksRef.current.isCurrent(pending.generation)) {
				return;
			}
			callbacksRef.current.onStatus(waitingStatus(pending));
			callbacksRef.current.onSessionStarted(session.sessionId, pending);
		} catch (err) {
			if (!callbacksRef.current.isCurrent(pending.generation)) {
				return;
			}
			callbacksRef.current.onError(
				err instanceof VercelAuthSessionError || err instanceof Error
					? err.message
					: "Could not create authorization form session",
			);
		} finally {
			setBusy(false);
		}
	};

	return {
		senderName,
		setSenderName,
		senderEmail,
		setSenderEmail,
		pending,
		email,
		receiver,
		sessionStarted,
		copied,
		copyError,
		busy,
		canCopy: email !== null || isValidSenderEmail(senderEmail),
		begin,
		reset,
		copyEmail,
	};
}
