import type { ReactElement, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ChevronDown, Mail, Pause, Play, Plus, RefreshCw, X } from "lucide-react";

import type {
	RuntimeJackedAccount,
	RuntimeJackedSnapshot,
	RuntimeJackedSwapLog,
} from "@/runtime/types";

import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { JackedAccountActions } from "@/jacked/jacked-account-actions";
import { formatPercent, pressureBarColor } from "@/jacked/jacked-format";
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

/** PixelOffice only surfaces Claude accounts. */
function claudeAccounts(accounts: RuntimeJackedAccount[]): RuntimeJackedAccount[] {
	return accounts.filter((account) => account.provider === "claude");
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
	actions,
}: {
	account: RuntimeJackedAccount;
	isSelected: boolean;
	busy: boolean;
	online: boolean;
	/** Live Claude Code sessions currently running on this account. */
	sessionCount: number;
	onUse: () => void;
	onRefresh: () => void;
	actions: ReactNode;
}): ReactElement {
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
							<span className="shrink-0 rounded bg-accent/20 px-1 py-0.5 text-[9px] uppercase tracking-wide text-accent">
								active
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
						{sessionCount > 0 ? (
							<span
								data-testid={`jacked-account-sessions-${account.id}`}
								className="shrink-0 rounded bg-status-green/15 px-1 py-0.5 text-[9px] uppercase tracking-wide text-status-green"
								title="Claude Code sessions currently running on this account"
							>
								{sessionCount} live
							</span>
						) : null}
					</div>
					<p className="truncate text-[10px] text-text-tertiary">
						Claude
						{account.organizationName ? ` · ${account.organizationName}` : ""}
					</p>
					{account.displayName && account.displayName !== account.email ? (
						<p className="truncate text-[10px] text-text-tertiary">{account.email}</p>
					) : null}
				</div>
			</div>
			{account.canTrackUsage ? (
				<div className="mt-2 flex flex-col gap-1">
					<div className="flex justify-between text-[10px] text-text-tertiary">
						<span>5h {formatPercent(account.fiveHourPercent)}</span>
						<span>7d {formatPercent(account.sevenDayPercent)}</span>
					</div>
					<div className="h-1 overflow-hidden rounded bg-surface-2">
						<div
							className="h-full transition-[width] duration-300"
							style={{
								width: `${Math.round(account.pressure * 100)}%`,
								background: pressureBarColor(account.pressure, account.canAutoSwap),
							}}
						/>
					</div>
				</div>
			) : (
				<p className="mt-1 text-[10px] text-text-tertiary">Usage not tracked</p>
			)}
			<div className="mt-2 flex gap-1">
				<Button
					variant="ghost"
					size="sm"
					disabled={!online || busy || isSelected || !account.isActive}
					onClick={onUse}
					className="h-6 px-2 text-[10px]"
				>
					Use Account
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
 * The Seats surface — Claude accounts the office works under.
 *
 * Full accounts surface — Claude-only account cards, meters, Use/Refresh,
 * toolbar (Refresh All / Add Account via Claude OAuth / auto-swap), and recent swap history.
 * Mounted in the home upper-right pane only (not duplicated in the left Jacked sidebar).
 */
export function JackedAccountsView({ online, jacked }: JackedAccountsViewProps): ReactElement {
	const [busyId, setBusyId] = useState<number | "all" | "swap" | "oauth" | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [swapLog, setSwapLog] = useState<RuntimeJackedSwapLog | null>(null);
	const [oauthStatus, setOauthStatus] = useState<string | null>(null);
	const [oauthAuthUrl, setOauthAuthUrl] = useState<string | null>(null);
	const [oauthManual, setOauthManual] = useState(false);
	const [oauthFlowId, setOauthFlowId] = useState<string | null>(null);
	const [oauthCode, setOauthCode] = useState("");
	const [oauthSubmitError, setOauthSubmitError] = useState<string | null>(null);
	const [oauthInviteEmail, setOauthInviteEmail] = useState<ClaudeOAuthInviteEmail | null>(null);
	const [oauthEmailCopied, setOauthEmailCopied] = useState(false);
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
		id: number | "all" | "swap" | "oauth",
		action: () => Promise<{ ok: boolean; error?: string }>,
	) => {
		setBusyId(id);
		setError(null);
		try {
			const result = await action();
			if (!result.ok) {
				setError(result.error ?? "Action failed");
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
				setOauthInviteEmail(buildClaudeOAuthInviteEmail(start.authUrl));
				setOauthStatus(
					"Send the invite email to your colleague, then paste their authorization code below.",
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

	const accounts = claudeAccounts(jacked?.accounts ?? []);

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
					<DropdownMenu.Root>
						<DropdownMenu.Trigger asChild>
							<Button
								variant="ghost"
								size="sm"
								disabled={!online || busyId !== null}
								icon={<Plus size={12} />}
								iconRight={<ChevronDown size={10} aria-hidden />}
								aria-label="Add Claude account"
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
								className="z-50 min-w-[11rem] rounded-md border border-border-bright bg-surface-1 p-1 shadow-lg"
								onCloseAutoFocus={(event) => event.preventDefault()}
							>
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
					{" · "}OAuth only
				</p>
			</div>
			{error ? (
				<p className="shrink-0 border-b border-border px-2 py-1 text-[10px] text-status-red">{error}</p>
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
						No Claude accounts yet. Use Add Account to start Claude OAuth.
					</p>
				) : (
					<div className="flex flex-col gap-1.5">
						{accounts.map((account, index) => (
							<AccountRow
								key={account.id}
								account={account}
								isSelected={account.id === jacked?.activeAccountId}
								busy={busyId !== null}
								online={online}
								sessionCount={sessions.byAccountId.get(account.id)?.length ?? 0}
								onUse={() => {
									void run(account.id, () =>
										getRuntimeTrpcClient(null).jacked.useAccount.mutate({
											accountId: account.id,
										}),
									);
								}}
								onRefresh={() => {
									void run(account.id, () =>
										getRuntimeTrpcClient(null).jacked.refreshAccount.mutate({
											accountId: account.id,
										}),
									);
								}}
								actions={
									<JackedAccountActions
										account={account}
										online={online}
										busy={busyId !== null}
										isFirst={index === 0}
										isLast={index === accounts.length - 1}
										onReauth={() => {
											void startAccountReauth(account.id);
										}}
										onValidate={() => {
											void run(account.id, () =>
												getRuntimeTrpcClient(null).jacked.validateAccount.mutate({
													accountId: account.id,
												}),
											);
										}}
										onToggleEnabled={() => {
											void run(account.id, () =>
												getRuntimeTrpcClient(null).jacked.updateAccount.mutate({
													accountId: account.id,
													isActive: !account.isActive,
												}),
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
						))}
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
