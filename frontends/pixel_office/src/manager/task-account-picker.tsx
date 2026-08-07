import { isRuntimeAgentLaunchSupported } from "@runtime-agent-catalog";
import type { ReactElement } from "react";

import type {
	RuntimeAgentId,
	RuntimeClineApiSeat,
	RuntimeManagerAccount,
	RuntimeTaskClineSettings,
} from "@/runtime/types";

import { NativeSelect } from "@/components/ui/native-select";
import { formatPercent, isAuthBroken, isDonateExhausted } from "@/manager/manager-format";

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
	const { currentAgentId, onManagerAccountIdChange, onAgentIdChange, onClineSettingsChange } = handlers;

	if (selection.kind === "api") {
		onManagerAccountIdChange?.(undefined);
		onAgentIdChange?.("cline");
		onClineSettingsChange?.({
			providerId: selection.providerId,
			...(selection.modelId ? { modelId: selection.modelId } : {}),
		});
		return;
	}

	// Leaving an API seat means leaving Cline; the caller's default agent takes over.
	if (currentAgentId === "cline") {
		onClineSettingsChange?.(undefined);
		onAgentIdChange?.(selection.kind === "manager" ? (agentIdForManagerProvider(selection.provider) ?? undefined) : undefined);
	} else if (selection.kind === "manager") {
		const seatAgentId = agentIdForManagerProvider(selection.provider);
		if (seatAgentId && seatAgentId !== currentAgentId) {
			onAgentIdChange?.(seatAgentId);
		}
	}

	onManagerAccountIdChange?.(selection.kind === "manager" ? selection.accountId : undefined);
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
}

function accountLabel(account: RuntimeManagerAccount): string {
	const name = account.displayName ?? account.email;
	const usage = account.canTrackUsage ? ` · 5h ${formatPercent(account.fiveHourPercent)}` : "";
	const deactivated = account.isActive ? "" : " · deactivated";
	const needsReauth = isAuthBroken(account) ? " · needs re-auth" : "";
	const donate = isDonateExhausted(account) ? (account.donateLimitLocked ? " · over cap (locked)" : " · over cap") : "";
	return `${name}${usage}${deactivated}${needsReauth}${donate}`;
}

function agentAccountLabel(agentId: RuntimeAgentId | null): string {
	if (agentId === "cursor") {
		return "Cursor account for this task";
	}
	if (agentId === "cline") {
		return "API seat for this task";
	}
	return "Claude account for this task";
}

function apiSeatLabel(seat: RuntimeClineApiSeat): string {
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
 * Label for the Auto option — prefer under-donate seats so Auto does not advertise
 * an exhausted seat as the fallback. Explicit pins still list every account.
 */
export function autoFallbackAccount(
	accounts: RuntimeManagerAccount[],
	activeAccountId: number | null,
	agentId: RuntimeAgentId | null,
): RuntimeManagerAccount | null {
	const enabled = accounts.filter((account) => account.isActive);
	const poolBase = enabled.length > 0 ? enabled : accounts;
	const authHealthy = poolBase.filter((account) => !isAuthBroken(account));
	const healthyBase = authHealthy.length > 0 ? authHealthy : poolBase;
	const underLimit = healthyBase.filter((account) => !isDonateExhausted(account));
	const pool = underLimit.length > 0 ? underLimit : healthyBase;
	if (agentId === "cursor") {
		return pool.find((account) => account.isActiveForProvider) ?? pool[0] ?? null;
	}
	return pool.find((account) => account.id === activeAccountId) ?? pool[0] ?? null;
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
}: TaskAccountPickerProps): ReactElement {
	const fallbackAccount = autoFallbackAccount(accounts, activeAccountId, agentId);
	const autoLabel = fallbackAccount
		? `Auto · ${fallbackAccount.displayName ?? fallbackAccount.email}`
		: "Auto (active account)";
	// Orphaned pins (wrong provider after an agent switch) must not stick as a
	// select value — fall back to Auto so the next start can resolve correctly.
	const pinnedSeat =
		agentId === "cline" && clineProviderId
			? apiSeats.find((seat) => seat.providerId === clineProviderId)
			: undefined;
	const valueInFleet = value !== undefined && accounts.some((account) => account.id === value);
	let selectValue = AUTO_VALUE;
	if (pinnedSeat) {
		selectValue = `${API_VALUE_PREFIX}${pinnedSeat.providerId}`;
	} else if (valueInFleet) {
		selectValue = `${MANAGER_VALUE_PREFIX}${value}`;
	}

	return (
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
	);
}

export function managerProviderForAgent(agentId: RuntimeAgentId | null | undefined): RuntimeManagerAccount["provider"] | null {
	if (agentId === "claude") {
		return "claude";
	}
	if (agentId === "cursor") {
		return "cursor";
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
	return null;
}

/**
 * Current active, non-disabled Manager seat used to drive Create-task defaults.
 *
 * Prefer Claude's `activeAccountId`, then Cursor's IDE-active seat, then the first
 * remaining enabled seat. Disabled seats are never returned.
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
	const cursorActive = enabled.find(
		(account) => account.provider === "cursor" && account.isActiveForProvider,
	);
	if (cursorActive) {
		return cursorActive;
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
