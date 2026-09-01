import { isRuntimeAgentLaunchSupported } from "@runtime-agent-catalog";
import { pickBestClaudeAutoSeat } from "@runtime-manager-seat-ranking";
import type { ReactElement } from "react";

import type {
	RuntimeAgentId,
	RuntimeClineApiSeat,
	RuntimeManagerAccount,
	RuntimeTaskClineSettings,
	RuntimeTaskLaunchSettings,
} from "@/runtime/types";

import { NativeSelect } from "@/components/ui/native-select";
import { formatPercent, formatResetCountdown, isAuthBroken, isDonateExhausted } from "@/manager/manager-format";

const AUTO_VALUE = "auto";
const MANAGER_VALUE_PREFIX = "manager:";
const API_VALUE_PREFIX = "api:";

/**
 * What the card's seat picker resolved to. API seats are Cline providers rather
 * than Manager accounts, so selecting one also switches the card's agent — the
 * caller owns that, since it holds agentId and clineSettings.
 */
export type TaskSeatSelection =
	| { kind: "auto" }
	| { kind: "manager"; accountId: number; provider: RuntimeManagerAccount["provider"] }
	| { kind: "api"; providerId: string; modelId: string | null };

export interface ApplyTaskSeatSelectionHandlers {
	currentAgentId: RuntimeAgentId | null;
	onManagerAccountIdChange?: (value: number | undefined) => void;
	onAgentIdChange?: (value: RuntimeAgentId | undefined) => void;
	onClineSettingsChange?: (value: RuntimeTaskClineSettings | undefined) => void;
	accounts?: RuntimeManagerAccount[];
	activeAccountId?: number | null;
}

/**
 * Applies a seat choice across the three card fields it can touch. Manager and
 * API seats are mutually exclusive: a card runs on one agent, so pinning either
 * kind clears the other's field.
 */
export function applyTaskSeatSelection(
	selection: TaskSeatSelection,
	handlers: ApplyTaskSeatSelectionHandlers,
): void {
	const {
		currentAgentId,
		onManagerAccountIdChange,
		onAgentIdChange,
		onClineSettingsChange,
		accounts,
		activeAccountId,
	} = handlers;

	if (selection.kind === "api") {
		onManagerAccountIdChange?.(undefined);
		onAgentIdChange?.("cline");
		onClineSettingsChange?.({
			providerId: selection.providerId,
			...(selection.modelId ? { modelId: selection.modelId } : {}),
		});
		return;
	}

	if (selection.kind === "auto") {
		onManagerAccountIdChange?.(undefined);
		if (currentAgentId === "cline") {
			onClineSettingsChange?.(undefined);
		}
		if (accounts && accounts.length > 0) {
			const fallback = autoTaskSeatAccount(accounts, activeAccountId ?? null, currentAgentId);
			const fallbackAgentId = agentIdForManagerProvider(fallback?.provider);
			if (fallbackAgentId && fallbackAgentId !== currentAgentId) {
				onAgentIdChange?.(fallbackAgentId);
			}
		}
		return;
	}

	// Leaving an API seat means leaving Cline; the caller's default agent takes over.
	if (currentAgentId === "cline") {
		onClineSettingsChange?.(undefined);
		onAgentIdChange?.(agentIdForManagerProvider(selection.provider) ?? undefined);
	} else if (selection.kind === "manager") {
		const seatAgentId = agentIdForManagerProvider(selection.provider);
		if (seatAgentId && seatAgentId !== currentAgentId) {
			onAgentIdChange?.(seatAgentId);
		}
	}

	onManagerAccountIdChange?.(selection.accountId);
}

/** A seat the session's subagents bill instead of the card's own; null = inherit. */
export type TaskSubagentSeatSelection = { providerId: string; modelId: string | null } | null;

/**
 * Folds a subagent-seat choice into the card's launch settings.
 *
 * Returns undefined once the settings hold nothing else, so clearing the pin on an
 * otherwise-untouched card leaves no empty object behind for the runtime to normalize away.
 */
export function applyTaskSubagentSeatSelection(
	selection: TaskSubagentSeatSelection,
	current: RuntimeTaskLaunchSettings | undefined,
): RuntimeTaskLaunchSettings | undefined {
	const { subagentSeatProviderId: _providerId, subagentSeatModelId: _modelId, ...rest } = current ?? {};
	if (selection === null) {
		return Object.keys(rest).length > 0 ? rest : undefined;
	}
	return {
		...rest,
		subagentSeatProviderId: selection.providerId,
		...(selection.modelId ? { subagentSeatModelId: selection.modelId } : {}),
	};
}

export interface TaskAccountPickerProps {
	accounts: RuntimeManagerAccount[];
	/** API-key seats, offered alongside Manager accounts in the same list. */
	apiSeats?: RuntimeClineApiSeat[];
	value: number | undefined;
	/** Provider id pinned via the card's clineSettings, when the card runs on Cline. */
	clineProviderId?: string | null;
	activeAccountId: number | null;
	agentId: RuntimeAgentId | null;
	disabled?: boolean;
	onChange: (selection: TaskSeatSelection) => void;
	/** Seat the live session launched on. Omit where no session can exist (create dialog). */
	sessionAccountId?: number | null;
	/** `sessionAccountId` resolved against the *full* account list, not the agent-filtered one. */
	sessionAccount?: RuntimeManagerAccount | null;
	/** Provider id of the card's pinned subagent seat, from its launch settings. */
	subagentSeatProviderId?: string | null;
	/** Omit to hide the subagent row entirely (callers that do not own launch settings). */
	onSubagentSeatChange?: (selection: TaskSubagentSeatSelection) => void;
	/** True while a live session runs on a different subagent seat than the card now pins. */
	subagentSeatAppliesOnRestart?: boolean;
}

/** How a seat is named everywhere in this picker: its display name, else its email. */
export function seatDisplayName(account: RuntimeManagerAccount): string {
	return account.displayName ?? account.email;
}

function accountLabel(account: RuntimeManagerAccount): string {
	const name = seatDisplayName(account);
	const usageLabel = account.provider === "cursor" ? "Cursor" : "5h";
	const usage = account.canTrackUsage ? ` · ${usageLabel} ${formatPercent(account.fiveHourPercent)}` : "";
	const deactivated = account.isActive ? "" : " · deactivated";
	const needsReauth = isAuthBroken(account) ? " · needs re-auth" : "";
	const donate = isDonateExhausted(account) ? (account.donateLimitLocked ? " · over cap (locked)" : " · over cap") : "";
	return `${name}${usage}${deactivated}${needsReauth}${donate}`;
}

function agentAccountLabel(agentId: RuntimeAgentId | null): string {
	if (agentId === "cursor") {
		return "Cursor account for this task";
	}
	if (agentId === "gemini") {
		return "Antigravity account for this task";
	}
	if (agentId === "cline") {
		return "API seat for this task";
	}
	return "Claude account for this task";
}

export function apiSeatLabel(seat: RuntimeClineApiSeat): string {
	return seat.defaultModelId ? `${seat.name} · ${seat.defaultModelId}` : seat.name;
}

function parseSeatSelection(
	value: string,
	accounts: RuntimeManagerAccount[],
	apiSeats: RuntimeClineApiSeat[],
): TaskSeatSelection {
	if (value.startsWith(MANAGER_VALUE_PREFIX)) {
		const accountId = Number(value.slice(MANAGER_VALUE_PREFIX.length));
		const account = accounts.find((candidate) => candidate.id === accountId);
		return { kind: "manager", accountId, provider: account?.provider ?? "claude" };
	}
	if (value.startsWith(API_VALUE_PREFIX)) {
		const providerId = value.slice(API_VALUE_PREFIX.length);
		const seat = apiSeats.find((candidate) => candidate.providerId === providerId);
		return { kind: "api", providerId, modelId: seat?.defaultModelId ?? null };
	}
	return { kind: "auto" };
}

/**
 * Narrows a fleet the way the runtime's `pickHealthyPool` does: prefer auth-healthy
 * seats, then under-donate-cap seats within that set, each stage widening again
 * rather than emptying out so a fully broken fleet still names a seat.
 */
function healthySeatPool(accounts: RuntimeManagerAccount[]): RuntimeManagerAccount[] {
	const enabled = accounts.filter((account) => account.isActive);
	const poolBase = enabled.length > 0 ? enabled : accounts;
	const authHealthy = poolBase.filter((account) => !isAuthBroken(account));
	const healthyBase = authHealthy.length > 0 ? authHealthy : poolBase;
	const underLimit = healthyBase.filter((account) => !isDonateExhausted(account));
	return underLimit.length > 0 ? underLimit : healthyBase;
}

/**
 * The seat a card's Auto option resolves to for Claude — nearest 7d reset first, then
 * least used, with a 5h-saturated seat sunk to the back.
 *
 * The ranking is not reimplemented here: `pickBestClaudeAutoSeat` is the same module the
 * runtime's `pickLeastUsedClaudeAccountId` calls, so this label cannot name one seat while
 * the launch pins another. Only the pool narrowing is duplicated (`healthySeatPool`).
 */
export function autoBestSeatAccount(accounts: RuntimeManagerAccount[]): RuntimeManagerAccount | null {
	return pickBestClaudeAutoSeat(healthySeatPool(accounts));
}

/**
 * Label for the Auto option — prefer under-donate seats so Auto does not advertise
 * an exhausted seat as the fallback. Explicit pins still list every account.
 *
 * Claude *board tasks* no longer use this: their Auto is `autoBestSeatAccount`, so
 * they stop piling onto the active seat. It stays the resolver for the Cursor and
 * Antigravity provider-active seats, and for the Plans and Review tabs, whose Auto
 * deliberately means "the seat Manager has active".
 */
export function autoFallbackAccount(
	accounts: RuntimeManagerAccount[],
	activeAccountId: number | null,
	agentId: RuntimeAgentId | null,
): RuntimeManagerAccount | null {
	const pool = healthySeatPool(accounts);
	if (agentId === "cursor" || agentId === "gemini") {
		return pool.find((account) => account.isActiveForProvider) ?? pool[0] ?? null;
	}
	return pool.find((account) => account.id === activeAccountId) ?? pool[0] ?? null;
}

/**
 * The seat a *card's* Auto option resolves to, per agent. Claude cards get the
 * best-ranked seat (a real per-task pin, made at launch); Cursor and Antigravity keep
 * following their provider-active seat, since neither can be pinned per task —
 * Cursor Auto inherits `agent login` and Antigravity's credentials are machine-wide.
 */
export function autoTaskSeatAccount(
	accounts: RuntimeManagerAccount[],
	activeAccountId: number | null,
	agentId: RuntimeAgentId | null,
): RuntimeManagerAccount | null {
	if (agentId === "cursor" || agentId === "gemini") {
		return autoFallbackAccount(accounts, activeAccountId, agentId);
	}
	return autoBestSeatAccount(accounts);
}

/**
 * Label for the resolved Auto seat. Claude cards append the winning seat's 7d runway,
 * because that deadline — not the 5h reading the option rows show — is what decided the
 * pick, and an otherwise-unexplained "Auto · bob" reads as arbitrary. Cursor and
 * Antigravity Auto follows their provider-active seat, so there is nothing to explain.
 */
export function autoOptionLabel(
	account: RuntimeManagerAccount,
	agentId: RuntimeAgentId | null,
	nowMs: number = Date.now(),
): string {
	const name = seatDisplayName(account);
	if (agentId === "cursor" || agentId === "gemini") {
		return `Auto · ${name}`;
	}
	const runway = formatResetCountdown(account.sevenDayResetsAt, nowMs);
	return runway ? `Auto · ${name} · 7d in ${runway}` : `Auto · ${name}`;
}

export interface RunningSeatHintInput {
	/** Seat the live session launched on (`sessionSummary.managerAccountId`); null when there is none. */
	sessionAccountId: number | null | undefined;
	/** That seat resolved against the full account snapshot — null when it is no longer listed. */
	sessionAccount: RuntimeManagerAccount | null | undefined;
	/** The card's stored pin; undefined means the card is on Auto. */
	pinnedAccountId: number | undefined;
	/** Seat the card's Auto option currently predicts, i.e. what a restart would launch on. */
	autoAccount: RuntimeManagerAccount | null;
}

/**
 * Line naming the seat the *running* session is on, for the cases where the select cannot.
 *
 * The select's value is the card's setting, not the session's: an Auto card stores no seat
 * at all (the launch resolves one from live usage, `resolveAutoClaudeAccountId`), and a
 * pinned card keeps naming its pin after failover or login recovery moved the session
 * elsewhere. Both read as "the panel is lying about which account this task runs on".
 *
 * Returns null when the select already names the live seat — a hint there would be noise.
 */
export function runningSeatHint(input: RunningSeatHintInput): string | null {
	const { sessionAccountId, sessionAccount, pinnedAccountId, autoAccount } = input;
	if (typeof sessionAccountId !== "number") {
		return null;
	}
	if (pinnedAccountId === sessionAccountId) {
		return null;
	}
	// A seat deleted since the launch still has to be named; the id is all that is left.
	const liveName = sessionAccount ? seatDisplayName(sessionAccount) : `account ${String(sessionAccountId)}`;
	if (typeof pinnedAccountId === "number") {
		// The drift restart button already names the pin, so do not repeat it here.
		return `Running on ${liveName}`;
	}
	if (autoAccount && autoAccount.id !== sessionAccountId) {
		return `Running on ${liveName} · restarts on ${seatDisplayName(autoAccount)}`;
	}
	return `Running on ${liveName}`;
}

/**
 * Pins one board task to a specific seat — a Manager account or an API-key seat.
 *
 * Claude tasks use CLAUDE_CONFIG_DIR. Cursor Auto uses the same `agent login`
 * as a normal terminal; an explicit Cursor pin injects CURSOR_API_KEY. API seats
 * are Cline providers, so picking one moves the card onto the Cline agent.
 */
export function TaskAccountPicker({
	accounts,
	apiSeats = [],
	value,
	clineProviderId,
	activeAccountId,
	agentId,
	disabled = false,
	onChange,
	sessionAccountId = null,
	sessionAccount = null,
	subagentSeatProviderId,
	onSubagentSeatChange,
	subagentSeatAppliesOnRestart = false,
}: TaskAccountPickerProps): ReactElement {
	const fallbackAccount = autoTaskSeatAccount(accounts, activeAccountId, agentId);
	const autoLabel = fallbackAccount ? autoOptionLabel(fallbackAccount, agentId) : "Auto (active account)";
	// Orphaned pins (wrong provider after an agent switch) must not stick as a
	// select value — fall back to Auto so the next start can resolve correctly.
	const pinnedSeat =
		agentId === "cline" && clineProviderId
			? apiSeats.find((seat) => seat.providerId === clineProviderId)
			: undefined;
	const valueInFleet = value !== undefined && accounts.some((account) => account.id === value);
	const sessionSeatHint = runningSeatHint({
		sessionAccountId,
		sessionAccount,
		pinnedAccountId: value,
		autoAccount: fallbackAccount,
	});
	let selectValue = AUTO_VALUE;
	if (pinnedSeat) {
		selectValue = `${API_VALUE_PREFIX}${pinnedSeat.providerId}`;
	} else if (valueInFleet) {
		selectValue = `${MANAGER_VALUE_PREFIX}${value}`;
	}

	// Subagents are a Claude Code concept: the split rides on CLAUDE_CODE_SUBAGENT_MODEL,
	// which no other CLI reads, and a Cline card already pins its provider on the row above.
	const showSubagentRow = onSubagentSeatChange !== undefined && (agentId === "claude" || agentId === "orchestrator") && apiSeats.length > 0;
	// A pin naming a seat that has since lost its key (or been deleted) must not stick as a
	// select value — show Inherit, which is also what the launch will fall back to.
	const pinnedSubagentSeat = subagentSeatProviderId
		? apiSeats.find((seat) => seat.providerId === subagentSeatProviderId)
		: undefined;

	return (
		<div className="flex min-w-0 flex-col gap-1">
			<label className="flex min-w-0 items-center gap-1.5 text-[11px] text-text-secondary">
				<span className="shrink-0">Account</span>
				<NativeSelect
					size="sm"
					data-testid="task-account-picker"
					aria-label={agentAccountLabel(agentId)}
					disabled={disabled || (accounts.length === 0 && apiSeats.length === 0)}
					value={selectValue}
					onChange={(event) => {
						onChange(parseSeatSelection(event.target.value, accounts, apiSeats));
					}}
				>
					<option value={AUTO_VALUE}>{autoLabel}</option>
					{accounts.map((account) => (
						<option
							key={account.id}
							value={`${MANAGER_VALUE_PREFIX}${account.id}`}
							disabled={isDonateExhausted(account)}
						>
							{accountLabel(account)}
						</option>
					))}
					{apiSeats.length > 0 ? (
						<optgroup label="API seats (Cline)">
							{apiSeats.map((seat) => (
								<option key={seat.providerId} value={`${API_VALUE_PREFIX}${seat.providerId}`}>
									{apiSeatLabel(seat)}
								</option>
							))}
						</optgroup>
					) : null}
				</NativeSelect>
			</label>
			{sessionSeatHint ? (
				<p className="text-[10px] text-text-tertiary" data-testid="task-session-account-hint">
					{sessionSeatHint}
				</p>
			) : null}
			{showSubagentRow ? (
				<>
					<label className="flex min-w-0 items-center gap-1.5 text-[11px] text-text-secondary">
						<span className="shrink-0">Subagents</span>
						<NativeSelect
							size="sm"
							data-testid="task-subagent-seat-picker"
							aria-label="API seat this task's subagents run on"
							disabled={disabled}
							value={pinnedSubagentSeat ? pinnedSubagentSeat.providerId : ""}
							onChange={(event) => {
								const providerId = event.target.value;
								if (!providerId) {
									onSubagentSeatChange(null);
									return;
								}
								const seat = apiSeats.find((candidate) => candidate.providerId === providerId);
								onSubagentSeatChange({ providerId, modelId: seat?.defaultModelId ?? null });
							}}
						>
							<option value="">Inherit (this task's seat)</option>
							{apiSeats.map((seat) => (
								<option key={seat.providerId} value={seat.providerId}>
									{apiSeatLabel(seat)}
								</option>
							))}
						</NativeSelect>
					</label>
					{subagentSeatAppliesOnRestart ? (
						<p className="text-[10px] text-text-tertiary" data-testid="task-subagent-seat-restart-hint">
							The running session launched on a different subagent seat. Applies on restart.
						</p>
					) : null}
				</>
			) : null}
		</div>
	);
}

export function managerProviderForAgent(agentId: RuntimeAgentId | null | undefined): RuntimeManagerAccount["provider"] | null {
	if (agentId === "claude") {
		return "claude";
	}
	if (agentId === "cursor") {
		return "cursor";
	}
	if (agentId === "gemini") {
		return "antigravity";
	}
	return null;
}

/** Maps a Manager seat provider to the launchable coding agent id. */
export function agentIdForManagerProvider(
	provider: RuntimeManagerAccount["provider"] | null | undefined,
): RuntimeAgentId | null {
	if (provider === "claude") {
		return "claude";
	}
	if (provider === "cursor") {
		return "cursor";
	}
	if (provider === "antigravity") {
		return "gemini";
	}
	return null;
}

/**
 * Current active, non-disabled Manager seat used to drive Create-task defaults.
 *
 * Prefer Claude's `activeAccountId`, then Cursor's IDE-active seat / Antigravity active seat,
 * then the first remaining enabled seat. Disabled seats are never returned.
 */
export function resolveActiveManagerSeat(
	accounts: RuntimeManagerAccount[],
	activeAccountId: number | null,
): RuntimeManagerAccount | null {
	const enabled = accounts.filter((account) => account.isActive);
	if (enabled.length === 0) {
		return null;
	}
	const byActiveId =
		typeof activeAccountId === "number"
			? enabled.find((account) => account.id === activeAccountId)
			: undefined;
	if (byActiveId) {
		return byActiveId;
	}
	const providerActive = enabled.find(
		(account) => (account.provider === "cursor" || account.provider === "antigravity") && account.isActiveForProvider,
	);
	if (providerActive) {
		return providerActive;
	}
	return enabled[0] ?? null;
}

export interface ResolveCreateTaskDefaultAgentIdInput {
	accounts: RuntimeManagerAccount[];
	activeAccountId: number | null;
	selectedAgentId?: RuntimeAgentId | null;
	/** Installed agent ids from runtime config; used only as a last-resort fallback. */
	installedAgentIds?: readonly RuntimeAgentId[];
}

/**
 * Create-task Agent default: active non-disabled Manager seat's provider, then
 * Settings `selectedAgentId`, then first installed launchable agent.
 */
export function resolveCreateTaskDefaultAgentId(
	input: ResolveCreateTaskDefaultAgentIdInput,
): RuntimeAgentId | null {
	const seat = resolveActiveManagerSeat(input.accounts, input.activeAccountId);
	const seatAgentId = agentIdForManagerProvider(seat?.provider);
	if (seatAgentId !== null && isRuntimeAgentLaunchSupported(seatAgentId)) {
		return seatAgentId;
	}
	const selected = input.selectedAgentId ?? null;
	if (selected !== null && isRuntimeAgentLaunchSupported(selected)) {
		return selected;
	}
	const installed = input.installedAgentIds ?? [];
	for (const agentId of installed) {
		if (isRuntimeAgentLaunchSupported(agentId)) {
			return agentId;
		}
	}
	return null;
}

/**
 * True when a stored task pin can no longer be honored and should fall back to
 * Auto: the seat belongs to the other provider, or it was disabled in Manager and
 * has dropped out of the eligible list.
 *
 * An empty snapshot means Manager is offline or still loading, not that every seat
 * vanished, so it never clears — otherwise every boot would wipe good pins.
 */
export function shouldClearManagerAccountPin(input: {
	pinnedAccountId: number | null | undefined;
	snapshotAccounts: RuntimeManagerAccount[];
	eligibleAccounts: RuntimeManagerAccount[];
}): boolean {
	if (typeof input.pinnedAccountId !== "number") {
		return false;
	}
	if (input.snapshotAccounts.length === 0) {
		return false;
	}
	return !input.eligibleAccounts.some((account) => account.id === input.pinnedAccountId);
}

export function filterManagerAccountsForAgent(
	accounts: RuntimeManagerAccount[],
	agentId: RuntimeAgentId | null | undefined,
	options?: { kanbanEligibleOnly?: boolean },
): RuntimeManagerAccount[] {
	const provider = managerProviderForAgent(agentId);
	if (provider === null) {
		return [];
	}
	return accounts.filter((account) => {
		if (account.provider !== provider) {
			return false;
		}
		if (options?.kanbanEligibleOnly && !account.isActive) {
			return false;
		}
		return true;
	});
}
