import type { ReactElement, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ArrowLeft, ChevronDown, ChevronRight, Mail, Pause, Play, Plus, RefreshCw, X } from "lucide-react";

import type {
	RuntimeJackedAccount,
	RuntimeJackedSnapshot,
	RuntimeJackedSwapLog,
} from "@/runtime/types";

import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { JackedAccountActions } from "@/jacked/jacked-account-actions";
import {
	formatPercent,
	formatResetHint,
	formatUsageCacheAge,
	isDonateExhausted,
	pressureBarColor,
} from "@/jacked/jacked-format";
import {
	buildClaudeOAuthInviteEmail,
	type ClaudeOAuthInviteEmail,
} from "@/jacked/jacked-oauth-invite-email";
import { MANAGER_LABELS } from "@/jacked/manager-labels";
import { useJackedSessions } from "@/jacked/use-jacked-sessions";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";

const OAUTH_POLL_MS = 1000;
const OAUTH_BROWSER_MAX_POLLS = 120;
const OAUTH_MANUAL_MAX_POLLS = 600;
/** Default donate cap offered when inviting a colleague via paste-code. */
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
	const width = percent === null ? 0 : Math.max(0, Math.min(100, Math.round(percent)));
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

/** Claude + Cursor accounts managed from PixelOffice. */
function managedAccounts(accounts: RuntimeJackedAccount[]): RuntimeJackedAccount[] {
	return accounts.filter((account) => account.provider === "claude" || account.provider === "cursor");
}

function providerDisplayName(provider: RuntimeJackedAccount["provider"]): string {
	if (provider === "cursor") {
		return "Cursor";
	}
	return "Claude";
}

function sessionBadgeTitle(provider: RuntimeJackedAccount["provider"]): string {
	if (provider === "cursor") {
		return "Cursor Agent sessions currently running on this account";
	}
	return "Claude Code sessions currently running on this account";
}

/** Claude Code "active" seat vs Cursor IDE seat — never share one global badge. */
function accountIsSelected(account: RuntimeJackedAccount, jacked: RuntimeJackedSnapshot | null): boolean {
	if (!jacked) {
		return false;
	}
	if (account.provider === "claude") {
		return account.id === jacked.activeAccountId;
	}
	if (account.provider === "cursor") {
		return account.isActiveForProvider;
	}
	return false;
}

function activeBadgeLabel(provider: RuntimeJackedAccount["provider"]): string {
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
function moveAccount(accounts: RuntimeJackedAccount[], index: number, offset: number): number[] {
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

interface JackedAccountsViewProps {
	online: boolean;
	jacked: RuntimeJackedSnapshot | null;
}

function AccountRow({
	account,
	isSelected,
	busy,
	online,
	sessionCount,
	onUse,
	onRefresh,
	onDonateChange,
	actions,
}: {
	account: RuntimeJackedAccount;
	isSelected: boolean;
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
	const useAccountLabel = isCursorAccount ? "Switch in IDE" : "Use Account";
	const donateExhausted = isDonateExhausted(account);
	const [donateDraft, setDonateDraft] = useState(account.donateLimitPercent);
	const donateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
			data-testid={`jacked-account-${account.id}`}
			className={cn(
				"rounded-md border px-2 py-2",
				isSelected ? "border-border-bright bg-surface-3" : "border-border bg-surface-1",
			)}
		>
			<div className="flex items-start justify-between gap-2">
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-1.5">
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
						{!account.isActive ? (
							<span className="shrink-0 rounded bg-surface-2 px-1 py-0.5 text-[9px] uppercase tracking-wide text-text-tertiary">
								disabled
							</span>
						) : null}
						{!account.canAutoSwap ? (
							<span className="shrink-0 text-[9px] uppercase tracking-wide text-text-tertiary">manual</span>
						) : null}
						{donateExhausted ? (
							<span
								data-testid={`jacked-account-donate-exhausted-${account.id}`}
								className="shrink-0 rounded bg-status-orange/15 px-1 py-0.5 text-[9px] uppercase tracking-wide text-status-orange"
								title="Usage is at or above the donate limit. Auto pick skips this seat; pinned tasks may still use it."
							>
								donate exhausted
							</span>
						) : null}
						{account.subscriptionType ? (
							<span className="shrink-0 rounded bg-surface-2 px-1 py-0.5 text-[9px] uppercase tracking-wide text-text-tertiary">
								{account.subscriptionType}
							</span>
						) : null}
						{sessionCount > 0 ? (
							<span
								data-testid={`jacked-account-sessions-${account.id}`}
								className="shrink-0 rounded bg-status-green/15 px-1 py-0.5 text-[9px] uppercase tracking-wide text-status-green"
								title={sessionBadgeTitle(account.provider)}
							>
								{sessionCount} live
							</span>
						) : null}
					</div>
					<p className="truncate text-[10px] text-text-tertiary">
						{providerDisplayName(account.provider)}
						{account.organizationName ? ` · ${account.organizationName}` : ""}
					</p>
					{account.displayName && account.displayName !== account.email ? (
						<p className="truncate text-[10px] text-text-tertiary">{account.email}</p>
					) : null}
				</div>
			</div>
			{account.canTrackUsage ? (
				<div className="mt-2 flex flex-col gap-1.5" data-testid={`jacked-account-usage-${account.id}`}>
					<UsageWindowBar
						label="5h"
						percent={account.fiveHourPercent}
						resetsAt={account.fiveHourResetsAt}
						canAutoSwap={account.canAutoSwap}
					/>
					<UsageWindowBar
						label="7d"
						percent={account.sevenDayPercent}
						resetsAt={account.sevenDayResetsAt}
						canAutoSwap={account.canAutoSwap}
					/>
					<p className="text-[10px] text-text-tertiary">
						Usage updated {formatUsageCacheAge(account.usageCachedAt)}
					</p>
				</div>
			) : (
				<p className="mt-1 text-[10px] text-text-tertiary">Usage not tracked</p>
			)}
			<label className="mt-2 flex flex-col gap-0.5" data-testid={`jacked-account-donate-${account.id}`}>
				<span className="text-[10px] text-text-tertiary">Donate up to {donateDraft}%</span>
				<input
					type="range"
					min={0}
					max={100}
					step={1}
					value={donateDraft}
					disabled={!online || busy}
					aria-label={`Donate up to percent for ${account.email}`}
					className="w-full accent-[var(--color-accent)]"
					onChange={(event) => {
						scheduleDonatePatch(Number(event.target.value));
					}}
				/>
				<span className="text-[9px] text-text-tertiary">
					Auto skips this seat at the limit; pinned tasks still work.
				</span>
			</label>
			{isCursorAccount ? (
				<p className="mt-1 text-[10px] text-text-tertiary">
					Kanban: pin this account on a Cursor task — no IDE switch needed.
				</p>
			) : null}
			{account.lastError ? (
				<p className="mt-1 text-[10px] text-status-red" title={account.lastError}>
					{account.lastError}
				</p>
			) : null}
			<div className="mt-2 flex gap-1">
				<Button
					variant="ghost"
					size="sm"
					disabled={!online || busy || isSelected || !account.isActive}
					onClick={onUse}
					className="h-6 px-2 text-[10px]"
					title={
						isCursorAccount
							? "Writes this account into the Cursor IDE database. Close Cursor first. Kanban tasks should use card pinning instead."
							: undefined
					}
				>
					{useAccountLabel}
				</Button>
				<Button
					variant="ghost"
					size="sm"
					disabled={!online || busy}
					onClick={onRefresh}
					icon={<RefreshCw size={10} />}
					className="h-6 px-2 text-[10px]"
					aria-label={`Refresh ${account.email}`}
				/>
			</div>
			{actions}
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
export function JackedAccountsView({ online, jacked }: JackedAccountsViewProps): ReactElement {
	const [busyId, setBusyId] = useState<number | "all" | "swap" | "oauth" | "import-cursor" | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [actionStatus, setActionStatus] = useState<string | null>(null);
	const [swapLog, setSwapLog] = useState<RuntimeJackedSwapLog | null>(null);
	const [addAccountStep, setAddAccountStep] = useState<AddAccountMenuStep>("provider");
	const [oauthStatus, setOauthStatus] = useState<string | null>(null);
	const [oauthAuthUrl, setOauthAuthUrl] = useState<string | null>(null);
	const [oauthManual, setOauthManual] = useState(false);
	const [oauthFlowId, setOauthFlowId] = useState<string | null>(null);
	const [oauthCode, setOauthCode] = useState("");
	const [oauthSubmitError, setOauthSubmitError] = useState<string | null>(null);
	const [oauthInviteEmail, setOauthInviteEmail] = useState<ClaudeOAuthInviteEmail | null>(null);
	const [oauthEmailCopied, setOauthEmailCopied] = useState(false);
	const [inviteDonatePercent, setInviteDonatePercent] = useState(DEFAULT_INVITE_DONATE_PERCENT);
	const pendingInviteDonateRef = useRef<Map<string, number>>(new Map());
	const oauthGenerationRef = useRef(0);
	// Proves concurrent multi-account work: each pinned task reports a session under
	// its own account instead of all of them sharing the active credential.
	const sessions = useJackedSessions(online);
	const paused = Boolean(
		jacked?.swapPausedUntil && Date.parse(jacked.swapPausedUntil) > Date.now(),
	);

	useEffect(() => {
		if (!online) {
			setSwapLog(null);
			return;
		}
		let cancelled = false;
		void (async () => {
			try {
				const result = await getRuntimeTrpcClient(null).jacked.swapLog.query({ limit: 8 });
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
	}, [online, jacked?.latestSwap?.at]);

	useEffect(() => {
		return () => {
			oauthGenerationRef.current += 1;
		};
	}, []);

	const run = async (
		id: number | "all" | "swap" | "oauth" | "import-cursor",
		action: () => Promise<{ ok: boolean; error?: string }>,
		successMessage?: string,
	) => {
		setBusyId(id);
		setError(null);
		setActionStatus(null);
		try {
			const result = await action();
			if (!result.ok) {
				setError(result.error ?? "Action failed");
			} else if (successMessage) {
				setActionStatus(successMessage);
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : "Action failed");
		} finally {
			setBusyId(null);
		}
	};

	const clearOauthUi = () => {
		setOauthStatus(null);
		setOauthAuthUrl(null);
		setOauthManual(false);
		setOauthFlowId(null);
		setOauthCode("");
		setOauthSubmitError(null);
		setOauthInviteEmail(null);
		setOauthEmailCopied(false);
	};

	const applyPendingInviteDonate = async (flowId: string, accountId: number | null | undefined) => {
		const donateLimitPercent = pendingInviteDonateRef.current.get(flowId);
		pendingInviteDonateRef.current.delete(flowId);
		if (donateLimitPercent === undefined || accountId === null || accountId === undefined) {
			return;
		}
		try {
			await getRuntimeTrpcClient(null).jacked.updateAccount.mutate({
				accountId,
				donateLimitPercent,
			});
		} catch {
			// Seat still lands; donate can be adjusted manually in Seats.
		}
	};

	const rebuildInviteEmail = (authUrl: string, donateLimitPercent: number) => {
		setOauthInviteEmail(buildClaudeOAuthInviteEmail(authUrl, { donateLimitPercent }));
		setOauthEmailCopied(false);
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

	const pollOauthFlow = async (flowId: string, manual: boolean, generation: number) => {
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
				const poll = await getRuntimeTrpcClient(null).jacked.oauthFlowStatus.query({ flowId });
				if (oauthGenerationRef.current !== generation) {
					return;
				}
				if (!poll) {
					continue;
				}
				if (poll.status === "completed") {
					await applyPendingInviteDonate(flowId, poll.accountId);
					setOauthStatus(
						poll.email ? `Claude account authorized: ${poll.email}` : "Claude account authorized.",
					);
					setOauthAuthUrl(null);
					setOauthFlowId(null);
					setOauthManual(false);
					setOauthInviteEmail(null);
					setBusyId(null);
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

	/**
	 * Shared OAuth driver for Add Account and per-account re-auth: both jacked
	 * endpoints answer with the same flow handle and are polled identically.
	 */
	const beginOAuthFlow = async (
		startFlow: () => Promise<{ ok: boolean; error?: string; flowId?: string; authUrl?: string; mode?: string }>,
		remote: boolean,
		startingStatus: string,
		failureMessage: string,
	) => {
		const generation = oauthGenerationRef.current + 1;
		oauthGenerationRef.current = generation;
		setBusyId("oauth");
		setError(null);
		setOauthSubmitError(null);
		setOauthStatus(startingStatus);
		setOauthAuthUrl(null);
		setOauthManual(false);
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
			if (remote && start.authUrl) {
				const donate = inviteDonatePercent;
				pendingInviteDonateRef.current.set(start.flowId, donate);
				rebuildInviteEmail(start.authUrl, donate);
				setOauthStatus(
					"Adjust donate %, send the invite email, then paste their authorization code below.",
				);
			} else {
				setOauthStatus(
					"A browser tab should open automatically. If it didn't, use the link below.",
				);
			}
			setBusyId(null);
			void pollOauthFlow(start.flowId, manual, generation);
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
				await getRuntimeTrpcClient(null).jacked.startClaudeOAuth.mutate(remote ? { remote: true } : {}),
			remote,
			remote ? "Preparing invite email…" : "Starting Claude OAuth…",
			"Could not start Claude OAuth",
		);
	};

	const copyInviteEmail = async () => {
		if (!oauthInviteEmail) {
			return;
		}
		try {
			await navigator.clipboard.writeText(oauthInviteEmail.body);
			setOauthEmailCopied(true);
		} catch {
			setOauthSubmitError("Could not copy email to clipboard.");
		}
	};

	const startAccountReauth = async (accountId: number, remote = false) => {
		await beginOAuthFlow(
			async () =>
				await getRuntimeTrpcClient(null).jacked.startAccountReauth.mutate(
					remote ? { accountId, remote: true } : { accountId },
				),
			remote,
			"Starting Claude re-authentication…",
			"Could not start re-authentication",
		);
	};

	const startAccountAuthorizeCc = async (accountId: number, remote = false) => {
		await beginOAuthFlow(
			async () =>
				await getRuntimeTrpcClient(null).jacked.startAccountAuthorizeCc.mutate(
					remote ? { accountId, remote: true } : { accountId },
				),
			remote,
			"Starting Claude Code authorization…",
			"Could not authorize Claude Code",
		);
	};

	const submitOauthCode = async () => {
		if (!oauthFlowId || oauthCode.trim().length === 0) {
			return;
		}
		setOauthSubmitError(null);
		setBusyId("oauth");
		try {
			const result = await getRuntimeTrpcClient(null).jacked.submitOAuthCode.mutate({
				flowId: oauthFlowId,
				code: oauthCode.trim(),
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
				oauthGenerationRef.current += 1;
				await applyPendingInviteDonate(oauthFlowId, result.accountId);
				setOauthStatus(
					result.email ? `Claude account authorized: ${result.email}` : "Claude account authorized.",
				);
				setOauthAuthUrl(null);
				setOauthFlowId(null);
				setOauthManual(false);
				setOauthInviteEmail(null);
				setOauthCode("");
				setBusyId(null);
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
			setOauthSubmitError(err instanceof Error ? err.message : "Could not submit code");
			setBusyId(null);
		}
	};

	if (!online && jacked === null) {
		return (
			<div
				data-testid="jacked-accounts-view"
				className="flex h-full min-h-0 flex-1 flex-col items-center justify-center gap-2 bg-surface-1 p-4 text-center"
			>
				<p className="text-[12px] text-text-secondary">{MANAGER_LABELS.offline}</p>
				<p className="text-[11px] text-text-tertiary">{MANAGER_LABELS.offlineHint}</p>
			</div>
		);
	}

	const accounts = managedAccounts(jacked?.accounts ?? []);

	// Swap log entries are not provider-tagged; with Claude-only accounts, history is Claude-oriented.
	const swaps =
		swapLog?.swaps ??
		(jacked?.latestSwap
			? [
					{
						at: jacked.latestSwap.at,
						fromEmail: jacked.latestSwap.fromEmail,
						toEmail: jacked.latestSwap.toEmail,
						reason: jacked.latestSwap.reason,
					},
				]
			: []);

	return (
		<div
			className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-surface-1"
			data-testid="jacked-accounts-view"
		>
			<div className="flex shrink-0 flex-col gap-1 border-b border-border px-2 py-1.5">
				<div className="flex items-center gap-1">
					<span className="flex-1 truncate text-[12px] font-medium text-text-primary">
						{MANAGER_LABELS.seats}
					</span>
					<span className="shrink-0 text-[10px] text-text-tertiary">
						{accounts.length}
						{jacked?.stale ? " · last known" : ""}
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
							void run("all", () => getRuntimeTrpcClient(null).jacked.refreshAllUsage.mutate());
						}}
					>
						Refresh All
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
								data-testid="jacked-add-account-trigger"
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
											data-testid="jacked-add-account-provider-claude"
											onSelect={(event) => {
												event.preventDefault();
												setAddAccountStep("claude");
											}}
										>
											<span>
												<p className="font-medium">Claude Code</p>
												<p className="text-[10px] text-text-tertiary">OAuth or paste invite code</p>
											</span>
											<ChevronRight size={12} className="shrink-0 text-text-tertiary" aria-hidden />
										</DropdownMenu.Item>
										<DropdownMenu.Item
											className="flex cursor-pointer items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-[11px] text-text-primary outline-none data-[highlighted]:bg-surface-3"
											data-testid="jacked-add-account-provider-cursor"
											onSelect={(event) => {
												event.preventDefault();
												setAddAccountStep("cursor");
											}}
										>
											<span>
												<p className="font-medium">Cursor Agent</p>
												<p className="text-[10px] text-text-tertiary">Import signed-in IDE session</p>
											</span>
											<ChevronRight size={12} className="shrink-0 text-text-tertiary" aria-hidden />
										</DropdownMenu.Item>
									</>
								) : null}
								{addAccountStep === "claude" ? (
									<>
										<button
											type="button"
											className="mb-0.5 flex w-full cursor-pointer items-center gap-1 rounded-sm px-2 py-1 text-[10px] text-text-secondary outline-none hover:bg-surface-3 hover:text-text-primary"
											data-testid="jacked-add-account-back"
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
											data-testid="jacked-add-account-oauth"
											onSelect={() => {
												void startClaudeOauth(false);
											}}
										>
											<p className="font-medium">OAuth</p>
											<p className="text-[10px] text-text-tertiary">Sign in on this computer</p>
										</DropdownMenu.Item>
										<DropdownMenu.Item
											className="cursor-pointer rounded-sm px-2 py-1.5 text-[11px] text-text-primary outline-none data-[highlighted]:bg-surface-3"
											data-testid="jacked-add-account-paste-code"
											onSelect={() => {
												void startClaudeOauth(true);
											}}
										>
											<p className="font-medium">Paste code</p>
											<p className="text-[10px] text-text-tertiary">Invite a colleague by email</p>
										</DropdownMenu.Item>
									</>
								) : null}
								{addAccountStep === "cursor" ? (
									<>
										<button
											type="button"
											className="mb-0.5 flex w-full cursor-pointer items-center gap-1 rounded-sm px-2 py-1 text-[10px] text-text-secondary outline-none hover:bg-surface-3 hover:text-text-primary"
											data-testid="jacked-add-account-back"
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
											data-testid="jacked-add-account-import-cursor"
											onSelect={() => {
												void run("import-cursor", () =>
													getRuntimeTrpcClient(null).jacked.importCursorAccount.mutate(),
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
								void run("swap", () => getRuntimeTrpcClient(null).jacked.resumeSwap.mutate());
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
									getRuntimeTrpcClient(null).jacked.pauseSwap.mutate({ minutes: 30 }),
								);
							}}
						>
							Pause swap
						</Button>
					)}
				</div>
				<p className="text-[10px] text-text-tertiary">
					Auto-swap {jacked?.autoSwapEnabled ? "on" : "off"}
					{paused && jacked?.swapPausedUntil
						? ` · paused until ${new Date(jacked.swapPausedUntil).toLocaleString()}`
						: ""}
					{" · "}Claude fleet only
				</p>
			</div>
			{!online && jacked !== null ? (
				<p className="shrink-0 border-b border-border px-2 py-1 text-[10px] text-status-orange">
					Jacked is unreachable — showing last-known seats. Reconnect to use Re-import / Re-auth / Check.
				</p>
			) : null}
			{error ? (
				<p className="shrink-0 border-b border-border px-2 py-1 text-[10px] text-status-red">{error}</p>
			) : null}
			{actionStatus ? (
				<p className="shrink-0 border-b border-border px-2 py-1 text-[10px] text-status-green">{actionStatus}</p>
			) : null}
			{oauthStatus ? (
				<div
					className="shrink-0 border-b border-border px-2 py-1.5"
					data-testid="jacked-oauth-status"
				>
					<div className="flex items-start gap-1">
						<p className="min-w-0 flex-1 text-[10px] text-text-secondary">{oauthStatus}</p>
						{/* Without this, a pending flow would hold the panel until it timed out
						    (10 minutes in paste-code mode) or the page was reloaded. */}
						<Button
							variant="ghost"
							size="sm"
							data-testid="jacked-oauth-dismiss"
							aria-label="Cancel Claude OAuth"
							icon={<X size={10} />}
							className="h-5 shrink-0 px-1 text-[10px]"
							onClick={cancelOauthFlow}
						/>
					</div>
					{oauthInviteEmail ? (
						<div
							className="mt-1.5 rounded border border-border bg-surface-2 p-2"
							data-testid="jacked-oauth-invite-email"
						>
							<label
								className="mb-1.5 flex flex-col gap-0.5"
								data-testid="jacked-oauth-invite-donate"
							>
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
										const next = Number(event.target.value);
										setInviteDonatePercent(next);
										if (oauthFlowId) {
											pendingInviteDonateRef.current.set(oauthFlowId, next);
										}
										if (oauthAuthUrl) {
											rebuildInviteEmail(oauthAuthUrl, next);
										}
									}}
								/>
							</label>
							<p className="text-[10px] font-medium text-text-primary">{oauthInviteEmail.subject}</p>
							<pre className="mt-1 max-h-28 overflow-y-auto whitespace-pre-wrap break-all text-[10px] text-text-secondary">
								{oauthInviteEmail.body}
							</pre>
							<div className="mt-1.5 flex flex-wrap gap-1">
								<Button
									variant="ghost"
									size="sm"
									className="h-6 px-2 text-[10px]"
									data-testid="jacked-oauth-copy-email"
									onClick={() => {
										void copyInviteEmail();
									}}
								>
									{oauthEmailCopied ? "Copied" : "Copy email"}
								</Button>
								<Button
									variant="ghost"
									size="sm"
									icon={<Mail size={10} />}
									className="h-6 px-2 text-[10px]"
									data-testid="jacked-oauth-open-mail"
									onClick={() => {
										window.location.href = oauthInviteEmail.mailto;
									}}
								>
									Open in mail app
								</Button>
							</div>
						</div>
					) : oauthAuthUrl ? (
						<a
							href={oauthAuthUrl}
							target="_blank"
							rel="noopener noreferrer"
							className="mt-0.5 inline-block text-[10px] text-accent underline"
						>
							Open authorization page
						</a>
					) : null}
					{oauthManual && oauthFlowId ? (
						<div className="mt-1.5 flex flex-col gap-1">
							<div className="flex gap-1">
								<input
									type="text"
									value={oauthCode}
									onChange={(event) => setOauthCode(event.target.value)}
									placeholder="Paste authorization code"
									className="min-w-0 flex-1 rounded border border-border bg-surface-2 px-1.5 py-1 text-[10px] text-text-primary"
									autoComplete="off"
									spellCheck={false}
									aria-label="Claude OAuth authorization code"
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
								<p className="text-[10px] text-status-red">{oauthSubmitError}</p>
							) : null}
						</div>
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
								isSelected={accountIsSelected(account, jacked)}
								busy={rowBusy}
								online={online}
								sessionCount={sessions.byAccountId.get(account.id)?.length ?? 0}
								onUse={() => {
									void run(
										account.id,
										async () => {
											const result = await getRuntimeTrpcClient(null).jacked.useAccount.mutate({
												accountId: account.id,
											});
											if (result.ok || account.provider !== "cursor") {
												return result;
											}
											return {
												ok: false,
												error: `${result.error ?? "Could not switch Cursor account."} For Kanban, pin this account on a Cursor task card instead of switching the IDE.`,
											};
										},
										account.provider === "cursor" ? "Cursor IDE seat updated." : "Active Claude seat updated.",
									);
								}}
								onRefresh={() => {
									void run(
										account.id,
										() =>
											getRuntimeTrpcClient(null).jacked.refreshAccount.mutate({
												accountId: account.id,
											}),
										"Usage refreshed.",
									);
								}}
								onDonateChange={(percent) => {
									void getRuntimeTrpcClient(null).jacked.updateAccount.mutate({
										accountId: account.id,
										donateLimitPercent: percent,
									});
								}}
								actions={
									<JackedAccountActions
										account={account}
										online={online}
										busy={rowBusy}
										isFirst={index === 0}
										isLast={index === accounts.length - 1}
										onReauth={() => {
											void startAccountReauth(account.id);
										}}
										onReauthRemote={() => {
											void startAccountReauth(account.id, true);
										}}
										onAuthorizeCc={() => {
											void startAccountAuthorizeCc(account.id);
										}}
										onAuthorizeCcRemote={() => {
											void startAccountAuthorizeCc(account.id, true);
										}}
										onReimport={
											account.provider === "cursor"
												? () => {
														void run(
															account.id,
															() =>
																getRuntimeTrpcClient(null).jacked.reimportCursorAccount.mutate({
																	accountId: account.id,
																}),
															"Cursor session re-imported. Restart the task to use it.",
														);
													}
												: undefined
										}
										onValidate={() => {
											void run(
												account.id,
												() =>
													getRuntimeTrpcClient(null).jacked.validateAccount.mutate({
														accountId: account.id,
													}),
												"Credential check finished.",
											);
										}}
										onToggleEnabled={() => {
											void run(
												account.id,
												() =>
													getRuntimeTrpcClient(null).jacked.updateAccount.mutate({
														accountId: account.id,
														isActive: !account.isActive,
													}),
												account.isActive ? "Seat disabled." : "Seat enabled.",
											);
										}}
										onDelete={() => {
											void run(account.id, () =>
												getRuntimeTrpcClient(null).jacked.deleteAccount.mutate({
													accountId: account.id,
												}),
											);
										}}
										onMoveUp={() => {
											void run(account.id, () =>
												getRuntimeTrpcClient(null).jacked.reorderAccounts.mutate({
													accountIds: moveAccount(accounts, index, -1),
												}),
											);
										}}
										onMoveDown={() => {
											void run(account.id, () =>
												getRuntimeTrpcClient(null).jacked.reorderAccounts.mutate({
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

				<section className="mt-3 border-t border-border pt-2" data-testid="jacked-accounts-swap-history">
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
