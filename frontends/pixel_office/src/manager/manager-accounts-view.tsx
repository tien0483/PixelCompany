import * as Collapsible from "@radix-ui/react-collapsible";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
	ArrowLeft,
	ChevronDown,
	ChevronRight,
	Pause,
	Play,
	Plus,
	RefreshCw,
	X,
} from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { ManagerAccountActions } from "@/manager/manager-account-actions";
import {
	formatPercent,
	formatResetHint,
	formatUsageCacheAge,
	isDonateExhausted,
	pressureBarColor,
} from "@/manager/manager-format";
import { MANAGER_LABELS } from "@/manager/manager-labels";
import { buildClaudeCcOAuthInviteEmail } from "@/manager/manager-oauth-cc-invite-email";
import {
	buildClaudeOAuthInviteEmail,
	buildClaudeReauthInviteEmail,
	type ClaudeOAuthInviteEmail,
	copyClaudeOAuthInviteEmail,
} from "@/manager/manager-oauth-invite-email";
import { useManagerSessions } from "@/manager/use-manager-sessions";
import {
	createAuthSession,
	pollAuthCode,
	VercelAuthSessionError,
} from "@/manager/vercel-auth-session";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import type {
	RuntimeManagerAccount,
	RuntimeManagerSnapshot,
	RuntimeManagerSwapLog,
} from "@/runtime/types";

const OAUTH_POLL_MS = 1000;
const OAUTH_BROWSER_MAX_POLLS = 120;
const OAUTH_MANUAL_MAX_POLLS = 600;
/** Default donate cap for local manual paste (colleague % comes from the Vercel form). */
const DEFAULT_INVITE_DONATE_PERCENT = 70;
const DONATE_PATCH_DEBOUNCE_MS = 400;

function UsageWindowBar({
	label,
	percent,
	resetsAt,
	canAutoSwap,
}: {
	label: string;
	percent: number | null;
	resetsAt: string | null;
	canAutoSwap: boolean;
}): ReactElement {
	const width =
		percent === null ? 0 : Math.max(0, Math.min(100, Math.round(percent)));
	const resetHint = formatResetHint(resetsAt);
	return (
		<div className="flex flex-col gap-0.5">
			<div className="flex items-center justify-between gap-2 text-[10px] text-text-tertiary">
				<span>
					{label} {formatPercent(percent)}
				</span>
				{resetHint ? <span className="truncate">{resetHint}</span> : null}
			</div>
			<div className="h-1 overflow-hidden rounded bg-surface-2">
				<div
					className="h-full transition-[width] duration-300"
					style={{
						width: `${width}%`,
						background: pressureBarColor(width / 100, canAutoSwap),
					}}
				/>
			</div>
		</div>
	);
}

type AddAccountMenuStep = "provider" | "claude" | "cursor";

type OauthFlowKind = "account" | "cc";

/** Claude + Cursor accounts managed from PixelOffice. */
function managedAccounts(
	accounts: RuntimeManagerAccount[],
): RuntimeManagerAccount[] {
	return accounts.filter(
		(account) => account.provider === "claude" || account.provider === "cursor",
	);
}

function providerDisplayName(
	provider: RuntimeManagerAccount["provider"],
): string {
	if (provider === "cursor") {
		return "Cursor";
	}
	return "Claude";
}

function sessionBadgeTitle(
	provider: RuntimeManagerAccount["provider"],
): string {
	if (provider === "cursor") {
		return "Cursor Agent sessions currently running on this account";
	}
	return "Claude Code sessions currently running on this account";
}

/** Claude Code "active" seat vs Cursor IDE seat — never share one global badge. */
function accountIsSelected(
	account: RuntimeManagerAccount,
	manager: RuntimeManagerSnapshot | null,
): boolean {
	if (!manager) {
		return false;
	}
	if (account.provider === "claude") {
		return account.id === manager.activeAccountId;
	}
	if (account.provider === "cursor") {
		return account.isActiveForProvider;
	}
	return false;
}

function activeBadgeLabel(provider: RuntimeManagerAccount["provider"]): string {
	if (provider === "cursor") {
		return "in IDE";
	}
	return "active";
}

/**
 * Full id order with one account shifted by `offset`.
 *
 * jacked's reorder endpoint takes the complete order and turns index into priority,
 * so a single move still submits every id.
 */
function moveAccount(
	accounts: RuntimeManagerAccount[],
	index: number,
	offset: number,
): number[] {
	const ids = accounts.map((account) => account.id);
	const target = index + offset;
	if (target < 0 || target >= ids.length) {
		return ids;
	}
	const moved = ids[index];
	const displaced = ids[target];
	if (moved === undefined || displaced === undefined) {
		return ids;
	}
	ids[index] = displaced;
	ids[target] = moved;
	return ids;
}

interface ManagerAccountsViewProps {
	online: boolean;
	manager: RuntimeManagerSnapshot | null;
}

function AccountRow({
	account,
	isSelected,
	isPrimary,
	busy,
	online,
	sessionCount,
	onUse,
	onRefresh,
	onDonateChange,
	actions,
}: {
	account: RuntimeManagerAccount;
	isSelected: boolean;
	/** First in fleet priority order (priority=0). */
	isPrimary: boolean;
	busy: boolean;
	online: boolean;
	/** Live agent sessions currently running on this account. */
	sessionCount: number;
	onUse: () => void;
	onRefresh: () => void;
	onDonateChange: (percent: number) => void;
	actions: ReactNode;
}): ReactElement {
	const isCursorAccount = account.provider === "cursor";
	const donateExhausted = isDonateExhausted(account);
	const isSeatDisabled = !account.isActive;
	const donateLocked = account.donateLimitLocked;
	const ccAuthRequired = !isCursorAccount && (!account.hasCcToken || account.ccNeedsAuth);
	const seatControlsLocked = !online || busy || isSeatDisabled;
	const [donateDraft, setDonateDraft] = useState(account.donateLimitPercent);
	const donateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	// Only the active seat is expanded by default; the rest collapse to their
	// header (name + badges). Re-syncs when activation moves to another seat.
	const [open, setOpen] = useState(isSelected);

	useEffect(() => {
		setOpen(isSelected);
	}, [isSelected]);

	useEffect(() => {
		setDonateDraft(account.donateLimitPercent);
	}, [account.donateLimitPercent]);

	useEffect(() => {
		return () => {
			if (donateTimerRef.current !== null) {
				clearTimeout(donateTimerRef.current);
			}
		};
	}, []);

	const scheduleDonatePatch = (percent: number) => {
		setDonateDraft(percent);
		if (donateTimerRef.current !== null) {
			clearTimeout(donateTimerRef.current);
		}
		donateTimerRef.current = setTimeout(() => {
			onDonateChange(percent);
		}, DONATE_PATCH_DEBOUNCE_MS);
	};

	return (
		<div
			data-testid={`manager-account-${account.id}`}
			data-seat-disabled={isSeatDisabled ? "true" : "false"}
			className={cn(
				"rounded-md border px-2 py-2",
				isSeatDisabled
					? "border-border/60 bg-surface-0"
					: isSelected
						? "border-border-bright bg-surface-3"
						: "border-border bg-surface-1",
			)}
		>
			<Collapsible.Root open={open} onOpenChange={setOpen}>
				<Collapsible.Trigger asChild>
					<button
						type="button"
						className="flex w-full items-start justify-between gap-2 text-left"
						aria-label={`${open ? "Collapse" : "Expand"} ${account.email}`}
					>
						<div className="min-w-0 flex-1">
							<div
								className={cn(
									"flex items-center gap-1.5",
									isSeatDisabled && "opacity-50 saturate-0",
								)}
							>
								<span className="truncate text-[12px] font-medium text-text-primary">
									{account.displayName ?? account.email}
								</span>
								{isSelected ? (
								<span
									className="shrink-0 rounded bg-accent/20 px-1 py-0.5 text-[9px] uppercase tracking-wide text-accent"
									title={
										isCursorAccount
											? "This seat is written into the Cursor IDE database"
											: "Active in Claude Code"
									}
								>
									{activeBadgeLabel(account.provider)}
								</span>
							) : null}
							{isPrimary ? (
								<span
									className="shrink-0 rounded bg-surface-2 px-1 py-0.5 text-[9px] uppercase tracking-wide text-text-secondary"
									title="Primary seat in fleet order — Use Account or move up/down to change"
								>
									primary
								</span>
							) : null}
							{!account.isActive ? (
								<span className="shrink-0 rounded bg-surface-2 px-1 py-0.5 text-[9px] uppercase tracking-wide text-text-tertiary">
									deactivated
								</span>
							) : null}
							{!account.canAutoSwap ? (
								<span className="shrink-0 text-[9px] uppercase tracking-wide text-text-tertiary">
									manual
								</span>
							) : null}
							{donateExhausted ? (
								<span
									data-testid={`manager-account-donate-exhausted-${account.id}`}
									className="shrink-0 rounded bg-status-orange/15 px-1 py-0.5 text-[9px] uppercase tracking-wide text-status-orange"
									title={
										donateLocked
											? "Usage is at or above your locked donate cap. This seat is blocked for Auto pick and for pinned tasks until usage resets."
											: "Usage is at or above your donate cap. Auto pick skips this seat; pinned or direct use still works."
									}
								>
									over donate cap
								</span>
							) : null}
							{donateLocked ? (
								<span
									data-testid={`manager-account-donate-locked-${account.id}`}
									className="shrink-0 rounded bg-surface-2 px-1 py-0.5 text-[9px] uppercase tracking-wide text-text-tertiary"
									title="Donate cap was agreed in the invite email and cannot be changed"
								>
									donate locked
								</span>
							) : null}
							{account.subscriptionType ? (
								<span className="shrink-0 rounded bg-surface-2 px-1 py-0.5 text-[9px] uppercase tracking-wide text-text-tertiary">
									{account.subscriptionType}
								</span>
							) : null}
								{sessionCount > 0 ? (
									<span
										data-testid={`manager-account-sessions-${account.id}`}
										className="shrink-0 rounded bg-status-green/15 px-1 py-0.5 text-[9px] uppercase tracking-wide text-status-green"
										title={sessionBadgeTitle(account.provider)}
									>
										{sessionCount} live
									</span>
								) : null}
							</div>
						</div>
						{open ? (
							<ChevronDown
								size={14}
								className="mt-0.5 shrink-0 text-text-tertiary transition-colors hover:text-text-secondary"
								aria-hidden
							/>
						) : (
							<ChevronRight
								size={14}
								className="mt-0.5 shrink-0 text-text-tertiary transition-colors hover:text-text-secondary"
								aria-hidden
							/>
						)}
					</button>
				</Collapsible.Trigger>
				<Collapsible.Content className="overflow-hidden data-[state=closed]:animate-[kb-collapsible-up_200ms_ease-out] data-[state=open]:animate-[kb-collapsible-down_200ms_ease-out]">
					<div className={cn(isSeatDisabled && "opacity-50 saturate-0")}>
						<p className="truncate text-[10px] text-text-tertiary">
							{providerDisplayName(account.provider)}
							{account.organizationName ? ` · ${account.organizationName}` : ""}
						</p>
						{account.displayName && account.displayName !== account.email ? (
							<p className="truncate text-[10px] text-text-tertiary">
								{account.email}
							</p>
						) : null}
						{account.canTrackUsage ? (
					<div
						className="mt-2 flex flex-col gap-1.5"
						data-testid={`manager-account-usage-${account.id}`}
					>
						{/* Cursor Plan & Usage uses Cursor Models / Other Models pools (monthly),
					    stored in the shared five_hour / seven_day columns. Claude keeps 5h/7d. */}
						<UsageWindowBar
							label={isCursorAccount ? "Cursor" : "5h"}
							percent={account.fiveHourPercent}
							resetsAt={account.fiveHourResetsAt}
							canAutoSwap={account.canAutoSwap}
						/>
						<UsageWindowBar
							label={isCursorAccount ? "Other" : "7d"}
							percent={account.sevenDayPercent}
							resetsAt={account.sevenDayResetsAt}
							canAutoSwap={account.canAutoSwap}
						/>
						<p className="text-[10px] text-text-tertiary">
							Usage updated {formatUsageCacheAge(account.usageCachedAt)}
						</p>
					</div>
				) : (
					<p className="mt-1 text-[10px] text-text-tertiary">
						Usage not tracked
					</p>
				)}
				<label
					className="mt-2 flex flex-col gap-0.5"
					data-testid={`manager-account-donate-${account.id}`}
				>
					<span className="text-[10px] text-text-tertiary">
						Donate up to {donateDraft}%
						{donateLocked
							? " (locked from invite)"
							: ccAuthRequired
								? " (locked — needs CC auth)"
								: ""}
					</span>
					<input
						type="range"
						min={0}
						max={100}
						step={1}
						value={donateDraft}
						disabled={seatControlsLocked || donateLocked || ccAuthRequired}
						aria-label={`Donate up to percent for ${account.email}`}
						className="w-full accent-[var(--color-accent)] disabled:opacity-40"
						onChange={(event) => {
							if (donateLocked || ccAuthRequired) {
								return;
							}
							scheduleDonatePatch(Number(event.target.value));
						}}
					/>
					<span className="text-[9px] text-text-tertiary">
						{donateLocked
							? "Invite seats keep the donate cap agreed in email."
							: ccAuthRequired
								? "Authorize Claude Code tokens for this seat to set a donate cap."
								: "Auto skips this seat at the limit; pinned tasks still work."}
					</span>
				</label>
				{isCursorAccount ? (
					<p className="mt-1 text-[10px] text-text-tertiary">
						Kanban: pin this account on a Cursor task — no IDE switch needed.
					</p>
				) : null}
				{account.lastError ? (
					<p
						className="mt-1 text-[10px] text-status-red"
						title={account.lastError}
					>
						{account.lastError}
					</p>
				) : null}
			</div>
			<div
				className={cn(
					"mt-2 flex gap-1",
					isSeatDisabled && "opacity-50 saturate-0",
				)}
			>
				<Button
					variant="ghost"
					size="sm"
					disabled={seatControlsLocked || isSelected}
					onClick={onUse}
					className="h-6 px-2 text-[10px]"
					title={
						isCursorAccount
							? "Use this Cursor seat in the IDE (writes state.vscdb — close Cursor first). Kanban tasks can pin instead."
							: "Use this Claude Code seat as the active credential"
					}
				>
					Use Account
				</Button>
				<Button
					variant="ghost"
					size="sm"
					disabled={seatControlsLocked}
					onClick={onRefresh}
					icon={<RefreshCw size={10} />}
					className="h-6 px-2 text-[10px]"
					aria-label={`Refresh ${account.email}`}
				/>
			</div>
			{actions}
				</Collapsible.Content>
			</Collapsible.Root>
		</div>
	);
}

/**
 * The Seats surface — Claude and Cursor accounts the office works under.
 *
 * Full accounts surface — account cards, meters, Use/Refresh, toolbar
 * (Refresh All / Add Account → provider → method / auto-swap), and recent swap history.
 * Mounted in the home upper-right pane only (not duplicated in the left Jacked sidebar).
 */
export function ManagerAccountsView({
	online,
	manager,
}: ManagerAccountsViewProps): ReactElement {
	const [busyId, setBusyId] = useState<
		number | "all" | "swap" | "oauth" | "import-cursor" | "import-claude" | null
	>(null);
	const [error, setError] = useState<string | null>(null);
	const [actionStatus, setActionStatus] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const [swapLog, setSwapLog] = useState<RuntimeManagerSwapLog | null>(null);
	const [addAccountStep, setAddAccountStep] =
		useState<AddAccountMenuStep>("provider");
	const [oauthStatus, setOauthStatus] = useState<string | null>(null);
	const [oauthAuthUrl, setOauthAuthUrl] = useState<string | null>(null);
	const [oauthManual, setOauthManual] = useState(false);
	/** Remote paste-code path using the Vercel form (no local paste / donate slider). */
	const [oauthRemoteForm, setOauthRemoteForm] = useState(false);
	const [oauthFlowId, setOauthFlowId] = useState<string | null>(null);
	const [oauthCode, setOauthCode] = useState("");
	const [oauthSubmitError, setOauthSubmitError] = useState<string | null>(null);
	const [oauthInviteEmail, setOauthInviteEmail] =
		useState<ClaudeOAuthInviteEmail | null>(null);
	const [oauthEmailCopied, setOauthEmailCopied] = useState(false);
	const [oauthFlowKind, setOauthFlowKind] = useState<OauthFlowKind>("account");
	const [inviteDonatePercent, setInviteDonatePercent] = useState(
		DEFAULT_INVITE_DONATE_PERCENT,
	);
	const oauthGenerationRef = useRef(0);
	const oauthFlowKindRef = useRef<OauthFlowKind>("account");
	/** True when remote flow is Add Account (apply donate % from the Vercel form). */
	const oauthApplyFormDonateRef = useRef(false);
	// Proves concurrent multi-account work: each pinned task reports a session under
	// its own account instead of all of them sharing the active credential.
	const sessions = useManagerSessions(online);
	const paused = Boolean(
		manager?.swapPausedUntil &&
			Date.parse(manager.swapPausedUntil) > Date.now(),
	);

	useEffect(() => {
		if (!online) {
			setSwapLog(null);
			return;
		}
		let cancelled = false;
		void (async () => {
			try {
				const result = await getRuntimeTrpcClient(null).manager.swapLog.query({
					limit: 8,
				});
				if (!cancelled) {
					setSwapLog(result);
				}
			} catch {
				if (!cancelled) {
					setSwapLog(null);
				}
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [online, manager?.latestSwap?.at]);

	useEffect(() => {
		return () => {
			oauthGenerationRef.current += 1;
		};
	}, []);

	/** Best-effort message for a caught value that isn't guaranteed to be an Error. */
	const describeThrown = (err: unknown): string => {
		if (err instanceof Error) {
			return err.message;
		}
		if (typeof err === "string" && err.trim() !== "") {
			return err;
		}
		if (typeof err === "object" && err !== null && "message" in err && typeof err.message === "string") {
			return err.message;
		}
		return "Action failed";
	};

	const run = async (
		id: number | "all" | "swap" | "oauth" | "import-cursor" | "import-claude",
		action: () => Promise<{ ok: boolean; error?: string }>,
		successMessage?: string,
	) => {
		setBusyId(id);
		setError(null);
		setActionStatus(null);
		setNotice(null);
		try {
			const result = await action();
			if (!result.ok) {
				setError(result.error ?? "Action failed");
			} else if (successMessage) {
				setActionStatus(successMessage);
			}
		} catch (err) {
			setError(describeThrown(err));
		} finally {
			setBusyId(null);
		}
	};

	/**
	 * Validate returns a tri-state verdict, not a binary ok/error — a `valid:true`
	 * result can still carry a message (rate-limited/indeterminate probe), so it
	 * can't share `run()`'s green-or-red rendering without losing that distinction.
	 */
	const checkCredential = async (account: RuntimeManagerAccount) => {
		setBusyId(account.id);
		setError(null);
		setActionStatus(null);
		setNotice(null);
		const label = account.displayName ?? account.email;
		try {
			const result = await getRuntimeTrpcClient(null).manager.validateAccount.mutate({
				accountId: account.id,
			});
			if (!result.ok) {
				setError(result.error ?? `Credential check failed for ${label}.`);
				return;
			}
			if (result.verdict === "indeterminate" || result.error !== undefined) {
				setNotice(result.error ?? `Couldn't fully verify ${label} — try again.`);
				return;
			}
			setActionStatus(`${label}: profile and live inference both OK.`);
		} catch (err) {
			setError(describeThrown(err));
		} finally {
			setBusyId(null);
		}
	};

	const clearOauthUi = () => {
		setOauthStatus(null);
		setOauthAuthUrl(null);
		setOauthManual(false);
		setOauthRemoteForm(false);
		setOauthFlowId(null);
		setOauthCode("");
		setOauthSubmitError(null);
		setOauthInviteEmail(null);
		setOauthEmailCopied(false);
		oauthFlowKindRef.current = "account";
		oauthApplyFormDonateRef.current = false;
		setOauthFlowKind("account");
	};

	const completeOAuthUi = (flowKind: OauthFlowKind, email?: string | null) => {
		const ccHint =
			flowKind === "account"
				? " Add CC separately when you want auto-refresh (~8h without it)."
				: "";
		setOauthStatus(
			flowKind === "cc"
				? email
					? `Claude Code (CC) authorized for ${email}.`
					: "Claude Code (CC) authorized."
				: email
					? `Claude account authorized: ${email}.${ccHint}`
					: `Claude account authorized.${ccHint}`,
		);
		setOauthAuthUrl(null);
		setOauthFlowId(null);
		setOauthManual(false);
		setOauthRemoteForm(false);
		setOauthInviteEmail(null);
		setOauthCode("");
		oauthFlowKindRef.current = "account";
		oauthApplyFormDonateRef.current = false;
		setOauthFlowKind("account");
		setBusyId(null);
	};

	/**
	 * Abandons an in-flight OAuth flow: the generation bump makes the running poll a
	 * no-op, so the pane returns to normal without waiting out the timeout.
	 * jacked expires the orphaned flow on its own.
	 */
	const cancelOauthFlow = () => {
		oauthGenerationRef.current += 1;
		clearOauthUi();
		setBusyId(null);
	};

	const pollOauthFlow = async (
		flowId: string,
		manual: boolean,
		generation: number,
		flowKind: OauthFlowKind = "account",
	) => {
		const maxPolls = manual ? OAUTH_MANUAL_MAX_POLLS : OAUTH_BROWSER_MAX_POLLS;
		for (let i = 0; i < maxPolls; i += 1) {
			if (oauthGenerationRef.current !== generation) {
				return;
			}
			await new Promise((resolve) => {
				setTimeout(resolve, OAUTH_POLL_MS);
			});
			if (oauthGenerationRef.current !== generation) {
				return;
			}
			try {
				const poll = await getRuntimeTrpcClient(
					null,
				).manager.oauthFlowStatus.query({ flowId });
				if (oauthGenerationRef.current !== generation) {
					return;
				}
				if (!poll) {
					continue;
				}
				if (poll.status === "completed") {
					completeOAuthUi(flowKind, poll.email);
					return;
				}
				if (poll.status === "error") {
					setError(poll.error ?? "OAuth failed");
					clearOauthUi();
					setBusyId(null);
					return;
				}
				if (poll.status === "not_found") {
					setError("OAuth flow expired. Try Add Account again.");
					clearOauthUi();
					setBusyId(null);
					return;
				}
			} catch {
				// Keep polling through transient errors.
			}
		}
		if (oauthGenerationRef.current !== generation) {
			return;
		}
		setError("OAuth timed out. Try Add Account again.");
		clearOauthUi();
		setBusyId(null);
	};

	const submitOauthCode = async (
		codeOverride?: string,
		donateOverride?: number,
		flowIdOverride?: string,
	) => {
		const code = (codeOverride ?? oauthCode).trim();
		const flowId = flowIdOverride ?? oauthFlowId;
		if (!flowId || code.length === 0) {
			return;
		}
		setOauthSubmitError(null);
		setBusyId("oauth");
		const donateForNewSeat =
			donateOverride !== undefined
				? donateOverride
				: oauthFlowKindRef.current === "account" && oauthManual && !oauthRemoteForm
					? inviteDonatePercent
					: undefined;
		try {
			const result = await getRuntimeTrpcClient(
				null,
			).manager.submitOAuthCode.mutate({
				flowId,
				code,
				...(donateForNewSeat === undefined
					? {}
					: { donateLimitPercent: donateForNewSeat }),
			});
			if (!result) {
				setOauthSubmitError("Could not submit authorization code.");
				setBusyId(null);
				return;
			}
			if (result.submitError) {
				setOauthSubmitError(result.submitError);
				setBusyId(null);
				return;
			}
			if (result.status === "completed") {
				completeOAuthUi(oauthFlowKindRef.current, result.email);
				return;
			}
			if (result.status === "error") {
				setError(result.error ?? "OAuth failed");
				clearOauthUi();
				setBusyId(null);
				return;
			}
			setBusyId(null);
		} catch (err) {
			setOauthSubmitError(
				err instanceof Error ? err.message : "Could not submit code",
			);
			setBusyId(null);
		}
	};

	const pollVercelFormAndSubmit = async (
		sessionId: string,
		flowId: string,
		generation: number,
	) => {
		try {
			const result = await pollAuthCode(sessionId, {
				shouldContinue: () => oauthGenerationRef.current === generation,
			});
			if (result === null || oauthGenerationRef.current !== generation) {
				return;
			}
			setOauthStatus("Authorization received from form — submitting…");
			const donate =
				oauthApplyFormDonateRef.current && result.percentage !== null
					? result.percentage
					: undefined;
			await submitOauthCode(result.authCode, donate, flowId);
		} catch (err) {
			if (oauthGenerationRef.current !== generation) {
				return;
			}
			const message =
				err instanceof VercelAuthSessionError
					? err.message
					: err instanceof Error
						? err.message
						: "Authorization form poll failed";
			setError(message);
			clearOauthUi();
			setBusyId(null);
		}
	};

	/**
	 * Shared OAuth driver for Add Account and per-account re-auth: both jacked
	 * endpoints answer with the same flow handle and are polled identically.
	 */
	const beginOAuthFlow = async (
		startFlow: () => Promise<{
			ok: boolean;
			error?: string;
			flowId?: string;
			authUrl?: string;
			mode?: string;
		}>,
		remote: boolean,
		startingStatus: string,
		failureMessage: string,
		flowKind: OauthFlowKind = "account",
		/** Add Account paste-code — apply donate % from the Vercel form. */
		applyFormDonate = false,
		inviteContext?: { accountEmail?: string },
	) => {
		const generation = oauthGenerationRef.current + 1;
		oauthGenerationRef.current = generation;
		oauthFlowKindRef.current = flowKind;
		oauthApplyFormDonateRef.current = applyFormDonate;
		setOauthFlowKind(flowKind);
		setBusyId("oauth");
		setError(null);
		setOauthSubmitError(null);
		setOauthStatus(startingStatus);
		setOauthAuthUrl(null);
		setOauthManual(false);
		setOauthRemoteForm(false);
		setOauthFlowId(null);
		setOauthCode("");
		setOauthInviteEmail(null);
		setOauthEmailCopied(false);
		try {
			const start = await startFlow();
			if (oauthGenerationRef.current !== generation) {
				return;
			}
			if (!start.ok || !start.flowId) {
				setError(start.error ?? failureMessage);
				clearOauthUi();
				setBusyId(null);
				return;
			}
			const manual = remote || start.mode === "manual";
			setOauthManual(manual);
			setOauthFlowId(start.flowId);
			setOauthAuthUrl(start.authUrl ?? null);

			if (remote) {
				if (!start.authUrl) {
					setError("OAuth started without an authorization URL.");
					clearOauthUi();
					setBusyId(null);
					return;
				}
				try {
					const session = await createAuthSession(start.authUrl);
					if (oauthGenerationRef.current !== generation) {
						return;
					}
					const invite =
						flowKind === "cc"
							? buildClaudeCcOAuthInviteEmail(session.formUrl, {
									accountEmail: inviteContext?.accountEmail,
								})
							: applyFormDonate
								? buildClaudeOAuthInviteEmail(session.formUrl)
								: buildClaudeReauthInviteEmail(session.formUrl, {
										accountEmail: inviteContext?.accountEmail,
									});
					setOauthInviteEmail(invite);
					setOauthRemoteForm(true);
					setOauthStatus(
						flowKind === "cc"
							? inviteContext?.accountEmail
								? `Copy the CC invite email for ${inviteContext.accountEmail}, send it, then wait for the form.`
								: "Copy the CC invite email below, send it, then wait for the form."
							: applyFormDonate
								? "Copy the invite email below, send it, then wait for your colleague to submit the form."
								: inviteContext?.accountEmail
									? `Copy the re-auth invite for ${inviteContext.accountEmail}, send it, then wait for the form.`
									: "Copy the re-auth invite email below, send it, then wait for the form.",
					);
					setBusyId(null);
					void pollOauthFlow(start.flowId, true, generation, flowKind);
					void pollVercelFormAndSubmit(
						session.sessionId,
						start.flowId,
						generation,
					);
					return;
				} catch (err) {
					if (oauthGenerationRef.current !== generation) {
						return;
					}
					const message =
						err instanceof VercelAuthSessionError
							? err.message
							: err instanceof Error
								? err.message
								: "Could not create authorization form session";
					setError(message);
					clearOauthUi();
					setBusyId(null);
					return;
				}
			}

			if (manual && start.authUrl) {
				setOauthStatus(
					flowKind === "cc"
						? "Open the Claude Code (CC) authorization link, then paste the code below."
						: "Open the authorization link, then paste the code below.",
				);
				window.open(start.authUrl, "_blank", "noopener,noreferrer");
			} else {
				setOauthStatus(
					"A browser tab should open automatically. If it didn't, use the link below.",
				);
			}
			setBusyId(null);
			void pollOauthFlow(start.flowId, manual, generation, flowKind);
		} catch (err) {
			if (oauthGenerationRef.current !== generation) {
				return;
			}
			setError(err instanceof Error ? err.message : failureMessage);
			clearOauthUi();
			setBusyId(null);
		}
	};

	const startClaudeOauth = async (remote: boolean) => {
		await beginOAuthFlow(
			async () =>
				await getRuntimeTrpcClient(null).manager.startClaudeOAuth.mutate(
					remote ? { remote: true } : {},
				),
			remote,
			remote ? "Preparing invite email…" : "Starting Claude OAuth…",
			"Could not start Claude OAuth",
			"account",
			remote,
		);
	};

	const copyInviteEmail = async () => {
		if (!oauthInviteEmail) {
			return;
		}
		try {
			await copyClaudeOAuthInviteEmail(oauthInviteEmail);
			setOauthEmailCopied(true);
		} catch {
			setOauthSubmitError("Could not copy email to clipboard.");
		}
	};

	const startAccountReauth = async (
		accountId: number,
		remote = false,
		accountEmail?: string,
	) => {
		await beginOAuthFlow(
			async () =>
				await getRuntimeTrpcClient(null).manager.startAccountReauth.mutate(
					remote ? { accountId, remote: true } : { accountId },
				),
			remote,
			remote ? "Preparing re-auth invite email…" : "Starting Claude re-authentication…",
			"Could not start re-authentication",
			"account",
			false,
			{ accountEmail },
		);
	};

	const startAccountAuthorizeCc = async (
		accountId: number,
		remote = false,
		accountEmail?: string,
	) => {
		await beginOAuthFlow(
			async () =>
				await getRuntimeTrpcClient(null).manager.startAccountAuthorizeCc.mutate(
					remote ? { accountId, remote: true } : { accountId },
				),
			remote,
			remote
				? "Preparing CC invite email…"
				: "Starting Claude Code authorization…",
			"Could not authorize Claude Code",
			"cc",
			false,
			{ accountEmail },
		);
	};

	if (!online && manager === null) {
		return (
			<div
				data-testid="manager-accounts-view"
				className="flex h-full min-h-0 flex-1 flex-col items-center justify-center gap-2 bg-surface-1 p-4 text-center"
			>
				<p className="text-[12px] text-text-secondary">
					{MANAGER_LABELS.offline}
				</p>
				<p className="text-[11px] text-text-tertiary">
					{MANAGER_LABELS.offlineHint}
				</p>
			</div>
		);
	}

	const accounts = managedAccounts(manager?.accounts ?? []);

	// Swap log entries are not provider-tagged; with Claude-only accounts, history is Claude-oriented.
	const swaps =
		swapLog?.swaps ??
		(manager?.latestSwap
			? [
					{
						at: manager.latestSwap.at,
						fromEmail: manager.latestSwap.fromEmail,
						toEmail: manager.latestSwap.toEmail,
						reason: manager.latestSwap.reason,
					},
				]
			: []);

	return (
		<div
			className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-surface-1"
			data-testid="manager-accounts-view"
		>
			<div className="flex shrink-0 flex-col gap-1 border-b border-border px-2 py-1.5">
				<div className="flex items-center gap-1">
					<span className="flex-1 truncate text-[12px] font-medium text-text-primary">
						{MANAGER_LABELS.seats}
					</span>
					<span className="shrink-0 text-[10px] text-text-tertiary">
						{accounts.length}
						{manager?.stale ? " · last known" : ""}
					</span>
				</div>
				<div className="flex flex-wrap items-center gap-1">
					<Button
						variant="ghost"
						size="sm"
						disabled={!online || busyId !== null}
						icon={<RefreshCw size={12} />}
						aria-label={MANAGER_LABELS.refreshAllUsage}
						className="h-7 px-2 text-[10px]"
						onClick={() => {
							void run("all", async () => {
								const result = await getRuntimeTrpcClient(
									null,
								).manager.refreshAllUsage.mutate();
								// Opportunistically realign the CLI login with the active
								// seat on every full refresh (best-effort — never fail the
								// refresh over a reconcile hiccup).
								try {
									await getRuntimeTrpcClient(
										null,
									).manager.reconcileActive.mutate();
								} catch {
									/* ignore — Sync CLI button covers manual retry */
								}
								return result;
							});
						}}
					>
						Refresh All
					</Button>
					<Button
						variant="ghost"
						size="sm"
						disabled={!online || busyId !== null}
						aria-label="Sync the Claude CLI login to the active seat"
						title="Re-write the Claude CLI credential so it matches the active seat"
						className="h-7 px-2 text-[10px]"
						onClick={() => {
							void run(
								"swap",
								() =>
									getRuntimeTrpcClient(null).manager.reconcileActive.mutate(),
								"CLI synced to the active seat.",
							);
						}}
					>
						Sync CLI
					</Button>
					<DropdownMenu.Root
						onOpenChange={(open) => {
							if (!open) {
								setAddAccountStep("provider");
							}
						}}
					>
						<DropdownMenu.Trigger asChild>
							<Button
								variant="ghost"
								size="sm"
								disabled={!online || busyId !== null}
								icon={<Plus size={12} />}
								iconRight={<ChevronDown size={10} aria-hidden />}
								aria-label="Add account"
								className="h-7 px-2 text-[10px]"
								data-testid="manager-add-account-trigger"
							>
								Add Account
							</Button>
						</DropdownMenu.Trigger>
						<DropdownMenu.Portal>
							<DropdownMenu.Content
								side="bottom"
								align="start"
								sideOffset={4}
								className="z-50 min-w-[13rem] rounded-md border border-border-bright bg-surface-1 p-1 shadow-lg"
								onCloseAutoFocus={(event) => event.preventDefault()}
							>
								{addAccountStep === "provider" ? (
									<>
										<p className="px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-text-tertiary">
											Choose agent
										</p>
										<DropdownMenu.Item
											className="flex cursor-pointer items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-[11px] text-text-primary outline-none data-[highlighted]:bg-surface-3"
											data-testid="manager-add-account-provider-claude"
											onSelect={(event) => {
												event.preventDefault();
												setAddAccountStep("claude");
											}}
										>
											<span>
												<p className="font-medium">Claude Code</p>
												<p className="text-[10px] text-text-tertiary">
													OAuth or paste invite code
												</p>
											</span>
											<ChevronRight
												size={12}
												className="shrink-0 text-text-tertiary"
												aria-hidden
											/>
										</DropdownMenu.Item>
										<DropdownMenu.Item
											className="flex cursor-pointer items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-[11px] text-text-primary outline-none data-[highlighted]:bg-surface-3"
											data-testid="manager-add-account-provider-cursor"
											onSelect={(event) => {
												event.preventDefault();
												setAddAccountStep("cursor");
											}}
										>
											<span>
												<p className="font-medium">Cursor Agent</p>
												<p className="text-[10px] text-text-tertiary">
													Import signed-in IDE session
												</p>
											</span>
											<ChevronRight
												size={12}
												className="shrink-0 text-text-tertiary"
												aria-hidden
											/>
										</DropdownMenu.Item>
									</>
								) : null}
								{addAccountStep === "claude" ? (
									<>
										<button
											type="button"
											className="mb-0.5 flex w-full cursor-pointer items-center gap-1 rounded-sm px-2 py-1 text-[10px] text-text-secondary outline-none hover:bg-surface-3 hover:text-text-primary"
											data-testid="manager-add-account-back"
											onClick={() => setAddAccountStep("provider")}
										>
											<ArrowLeft size={10} aria-hidden />
											Back
										</button>
										<p className="px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-text-tertiary">
											Claude Code
										</p>
										<DropdownMenu.Item
											className="cursor-pointer rounded-sm px-2 py-1.5 text-[11px] text-text-primary outline-none data-[highlighted]:bg-surface-3"
											data-testid="manager-add-account-oauth"
											onSelect={() => {
												void startClaudeOauth(false);
											}}
										>
											<p className="font-medium">OAuth</p>
											<p className="text-[10px] text-text-tertiary">
												Sign in on this computer
											</p>
										</DropdownMenu.Item>
										<DropdownMenu.Item
											className="cursor-pointer rounded-sm px-2 py-1.5 text-[11px] text-text-primary outline-none data-[highlighted]:bg-surface-3"
											data-testid="manager-add-account-paste-code"
											onSelect={() => {
												void startClaudeOauth(true);
											}}
										>
											<p className="font-medium">Paste code</p>
											<p className="text-[10px] text-text-tertiary">
												Invite a colleague by email
											</p>
										</DropdownMenu.Item>
										<DropdownMenu.Item
											className="cursor-pointer rounded-sm px-2 py-1.5 text-[11px] text-text-primary outline-none data-[highlighted]:bg-surface-3"
											data-testid="manager-add-account-import-claude"
											onSelect={() => {
												void run("import-claude", () =>
													getRuntimeTrpcClient(
														null,
													).manager.importClaudeAccount.mutate(),
												);
											}}
										>
											<p className="font-medium">Import local CLI login</p>
											<p className="text-[10px] text-text-tertiary">
												Use the Claude Code account already signed in on this
												computer
											</p>
										</DropdownMenu.Item>
									</>
								) : null}
								{addAccountStep === "cursor" ? (
									<>
										<button
											type="button"
											className="mb-0.5 flex w-full cursor-pointer items-center gap-1 rounded-sm px-2 py-1 text-[10px] text-text-secondary outline-none hover:bg-surface-3 hover:text-text-primary"
											data-testid="manager-add-account-back"
											onClick={() => setAddAccountStep("provider")}
										>
											<ArrowLeft size={10} aria-hidden />
											Back
										</button>
										<p className="px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-text-tertiary">
											Cursor Agent
										</p>
										<DropdownMenu.Item
											className="cursor-pointer rounded-sm px-2 py-1.5 text-[11px] text-text-primary outline-none data-[highlighted]:bg-surface-3"
											data-testid="manager-add-account-import-cursor"
											onSelect={() => {
												void run("import-cursor", () =>
													getRuntimeTrpcClient(
														null,
													).manager.importCursorAccount.mutate(),
												);
											}}
										>
											<p className="font-medium">Import from Cursor IDE</p>
											<p className="text-[10px] text-text-tertiary">
												Sign in to Cursor first, then import that session
											</p>
										</DropdownMenu.Item>
									</>
								) : null}
							</DropdownMenu.Content>
						</DropdownMenu.Portal>
					</DropdownMenu.Root>
					{paused ? (
						<Button
							variant="ghost"
							size="sm"
							disabled={!online || busyId !== null}
							icon={<Play size={12} />}
							aria-label="Resume auto-swap"
							className="h-7 px-2 text-[10px]"
							onClick={() => {
								void run("swap", () =>
									getRuntimeTrpcClient(null).manager.resumeSwap.mutate(),
								);
							}}
						>
							Resume
						</Button>
					) : (
						<Button
							variant="ghost"
							size="sm"
							disabled={!online || busyId !== null}
							icon={<Pause size={12} />}
							aria-label="Pause auto-swap for 30 minutes"
							className="h-7 px-2 text-[10px]"
							onClick={() => {
								void run("swap", () =>
									getRuntimeTrpcClient(null).manager.pauseSwap.mutate({
										minutes: 30,
									}),
								);
							}}
						>
							Pause swap
						</Button>
					)}
				</div>
				<p className="text-[10px] text-text-tertiary">
					Auto-swap {manager?.autoSwapEnabled ? "on" : "off"}
					{paused && manager?.swapPausedUntil
						? ` · paused until ${new Date(manager.swapPausedUntil).toLocaleString()}`
						: ""}
					{" · "}Claude fleet only
				</p>
			</div>
			{!online && manager !== null ? (
				<p className="shrink-0 border-b border-border px-2 py-1 text-[10px] text-status-orange">
					Manager is unreachable — showing last-known seats. Reconnect to use
					Re-import / Re-auth / Check.
				</p>
			) : null}
			{error ? (
				<p
					data-testid="manager-action-error"
					className="shrink-0 border-b border-border px-2 py-1 text-[10px] text-status-red"
				>
					{error}
				</p>
			) : null}
			{actionStatus ? (
				<p
					data-testid="manager-action-status"
					className="shrink-0 border-b border-border px-2 py-1 text-[10px] text-status-green"
				>
					{actionStatus}
				</p>
			) : null}
			{notice ? (
				<p
					data-testid="manager-check-notice"
					className="shrink-0 border-b border-border px-2 py-1 text-[10px] text-status-orange"
				>
					{notice}
				</p>
			) : null}
			{oauthStatus ? (
				<div
					className="shrink-0 border-b border-border px-2 py-1.5"
					data-testid="manager-oauth-status"
				>
					<div className="flex items-start gap-1">
						<p className="min-w-0 flex-1 text-[10px] text-text-secondary">
							{oauthStatus}
						</p>
						{/* Without this, a pending flow would hold the panel until it timed out
						    (10 minutes in paste-code mode) or the page was reloaded. */}
						<Button
							variant="ghost"
							size="sm"
							data-testid="manager-oauth-dismiss"
							aria-label="Cancel Claude OAuth"
							icon={<X size={10} />}
							className="h-5 shrink-0 px-1 text-[10px]"
							onClick={cancelOauthFlow}
						/>
					</div>
					{oauthInviteEmail ? (
						<div
							className="mt-1.5 rounded border border-border bg-surface-2 p-2"
							data-testid="manager-oauth-invite-email"
						>
							<Button
								variant="primary"
								size="sm"
								className="h-7 w-full text-[10px]"
								data-testid="manager-oauth-copy-email"
								onClick={() => {
									void copyInviteEmail();
								}}
							>
								{oauthEmailCopied
									? "Copied — paste into mail compose (Ctrl+V)"
									: oauthFlowKind === "cc"
										? "Copy CC invite email"
										: "Copy invite email"}
							</Button>
							<p className="mt-1.5 text-[10px] text-text-tertiary">
								{oauthFlowKind === "cc"
									? "Includes the Vercel form link and the ~8h refresh-token explanation. Waiting for form submission…"
									: "Includes the Vercel form link. Waiting for your colleague to submit the form…"}
							</p>
						</div>
					) : null}
					{!oauthRemoteForm &&
					oauthManual &&
					oauthFlowKind === "account" &&
					oauthFlowId ? (
						<div
							className="mt-1.5 rounded border border-border bg-surface-2 p-2"
							data-testid="manager-oauth-invite-donate"
						>
							<label className="flex flex-col gap-0.5">
								<span className="text-[10px] text-text-tertiary">
									Donate up to {inviteDonatePercent}%
								</span>
								<input
									type="range"
									min={0}
									max={100}
									step={1}
									value={inviteDonatePercent}
									aria-label="Invite donate up to percent"
									className="w-full accent-[var(--color-accent)]"
									onChange={(event) => {
										setInviteDonatePercent(Number(event.target.value));
									}}
								/>
							</label>
						</div>
					) : null}
					{oauthInviteEmail ? null : oauthAuthUrl ? (
						<a
							href={oauthAuthUrl}
							target="_blank"
							rel="noopener noreferrer"
							className="mt-0.5 inline-block text-[10px] text-accent underline"
						>
							Open authorization page
						</a>
					) : null}
					{oauthManual && oauthFlowId && !oauthRemoteForm ? (
						<div className="mt-1.5 flex flex-col gap-1">
							<div className="flex gap-1">
								<input
									type="text"
									value={oauthCode}
									onChange={(event) => setOauthCode(event.target.value)}
									placeholder={
										oauthFlowKind === "cc"
											? "Paste Claude Code (CC) authorization code"
											: "Paste authorization code"
									}
									className="min-w-0 flex-1 rounded border border-border bg-surface-2 px-1.5 py-1 text-[10px] text-text-primary"
									autoComplete="off"
									spellCheck={false}
									aria-label={
										oauthFlowKind === "cc"
											? "Claude Code authorization code"
											: "Claude OAuth authorization code"
									}
								/>
								<Button
									variant="ghost"
									size="sm"
									disabled={busyId !== null || oauthCode.trim().length === 0}
									className="h-7 px-2 text-[10px]"
									onClick={() => {
										void submitOauthCode();
									}}
								>
									Submit
								</Button>
								<Button
									variant="ghost"
									size="sm"
									className="h-7 px-2 text-[10px]"
									onClick={cancelOauthFlow}
								>
									Cancel
								</Button>
							</div>
							{oauthSubmitError ? (
								<p className="text-[10px] text-status-red">
									{oauthSubmitError}
								</p>
							) : null}
						</div>
					) : null}
					{oauthRemoteForm && oauthSubmitError ? (
						<p className="mt-1 text-[10px] text-status-red">{oauthSubmitError}</p>
					) : null}
				</div>
			) : null}
			<div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
				{accounts.length === 0 ? (
					<p className="text-[11px] text-text-tertiary">
						No accounts yet. Use Add Account → Claude Code or Cursor Agent.
					</p>
				) : (
					<div className="flex flex-col gap-1.5">
						{accounts.map((account, index) => {
							const rowBusy =
								busyId === account.id ||
								busyId === "oauth" ||
								busyId === "import-cursor" ||
								busyId === "all";
							return (
								<AccountRow
									key={account.id}
									account={account}
									isSelected={accountIsSelected(account, manager)}
									isPrimary={index === 0}
									busy={rowBusy}
									online={online}
									sessionCount={
										sessions.byAccountId.get(account.id)?.length ?? 0
									}
									onUse={() => {
										void run(
											account.id,
											async () => {
												const result = await getRuntimeTrpcClient(
													null,
												).manager.useAccount.mutate({
													accountId: account.id,
												});
												if (result.ok || account.provider !== "cursor") {
													return result;
												}
												return {
													ok: false,
													error: `${result.error ?? "Could not use Cursor account."} For Kanban, pin this account on a Cursor task card instead.`,
												};
											},
											"Seat updated and set as primary.",
										);
									}}
									onRefresh={() => {
										void run(
											account.id,
											() =>
												getRuntimeTrpcClient(
													null,
												).manager.refreshAccount.mutate({
													accountId: account.id,
												}),
											"Usage refreshed.",
										);
									}}
									onDonateChange={(percent) => {
										void getRuntimeTrpcClient(
											null,
										).manager.updateAccount.mutate({
											accountId: account.id,
											donateLimitPercent: percent,
										});
									}}
									actions={
										<ManagerAccountActions
											account={account}
											online={online}
											busy={rowBusy}
											isFirst={index === 0}
											isLast={index === accounts.length - 1}
											onReauth={() => {
												void startAccountReauth(account.id);
											}}
											onReauthRemote={() => {
												void startAccountReauth(
													account.id,
													true,
													account.email,
												);
											}}
											onAuthorizeCc={() => {
												void startAccountAuthorizeCc(account.id);
											}}
											onAuthorizeCcRemote={() => {
												void startAccountAuthorizeCc(
													account.id,
													true,
													account.email,
												);
											}}
											onReimport={
												account.provider === "cursor"
													? () => {
															void run(
																account.id,
																() =>
																	getRuntimeTrpcClient(
																		null,
																	).manager.reimportCursorAccount.mutate({
																		accountId: account.id,
																	}),
																"Cursor session re-imported. Restart the task to use it.",
															);
														}
													: undefined
											}
											onValidate={() => {
												void checkCredential(account);
											}}
											onToggleEnabled={() => {
												void run(
													account.id,
													() =>
														getRuntimeTrpcClient(
															null,
														).manager.updateAccount.mutate({
															accountId: account.id,
															isActive: !account.isActive,
														}),
													account.isActive ? "Seat deactivated." : "Seat activated.",
												);
											}}
											onDelete={() => {
												void run(account.id, () =>
													getRuntimeTrpcClient(
														null,
													).manager.deleteAccount.mutate({
														accountId: account.id,
													}),
												);
											}}
											onMoveUp={() => {
												void run(account.id, () =>
													getRuntimeTrpcClient(
														null,
													).manager.reorderAccounts.mutate({
														accountIds: moveAccount(accounts, index, -1),
													}),
												);
											}}
											onMoveDown={() => {
												void run(account.id, () =>
													getRuntimeTrpcClient(
														null,
													).manager.reorderAccounts.mutate({
														accountIds: moveAccount(accounts, index, 1),
													}),
												);
											}}
										/>
									}
								/>
							);
						})}
					</div>
				)}

				<section
					className="mt-3 border-t border-border pt-2"
					data-testid="manager-accounts-swap-history"
				>
					<p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-text-tertiary">
						Swap history
					</p>
					{swaps.length === 0 ? (
						<p className="text-[11px] text-text-tertiary">No swap history.</p>
					) : (
						<div className="flex flex-col gap-1">
							{swaps.map((swap, index) => (
								<div
									key={`${swap.at}-${index}`}
									className="rounded-md border border-border bg-surface-1 px-2 py-1.5 text-[10px]"
								>
									<p className="text-text-primary">
										{swap.fromEmail ?? "?"} → {swap.toEmail ?? "?"}
									</p>
									<p className="text-text-tertiary">
										{new Date(swap.at).toLocaleString()}
										{swap.reason ? ` · ${swap.reason}` : ""}
									</p>
								</div>
							))}
						</div>
					)}
				</section>
			</div>
		</div>
	);
}
