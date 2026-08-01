import type { ReactElement } from "react";

import type { RuntimeAgentId, RuntimeManagerAccount } from "@/runtime/types";

import { NativeSelect } from "@/components/ui/native-select";
import { formatPercent, isDonateExhausted } from "@/manager/manager-format";

const AUTO_VALUE = "auto";

export interface TaskAccountPickerProps {
	accounts: RuntimeManagerAccount[];
	value: number | undefined;
	activeAccountId: number | null;
	agentId: RuntimeAgentId | null;
	disabled?: boolean;
	onChange: (managerAccountId: number | null) => void;
}

function accountLabel(account: RuntimeManagerAccount): string {
	const name = account.displayName ?? account.email;
	const usage = account.canTrackUsage ? ` · 5h ${formatPercent(account.fiveHourPercent)}` : "";
	const disabled = account.isActive ? "" : " · disabled";
	const donate = isDonateExhausted(account) ? " · donate exhausted" : "";
	return `${name}${usage}${disabled}${donate}`;
}

function agentAccountLabel(agentId: RuntimeAgentId | null): string {
	if (agentId === "cursor") {
		return "Cursor account for this task";
	}
	return "Claude account for this task";
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
	const underLimit = poolBase.filter((account) => !isDonateExhausted(account));
	const pool = underLimit.length > 0 ? underLimit : poolBase;
	if (agentId === "cursor") {
		return pool.find((account) => account.isActiveForProvider) ?? pool[0] ?? null;
	}
	return pool.find((account) => account.id === activeAccountId) ?? pool[0] ?? null;
}

/**
 * Pins one board task to a specific Jacked account for the task's agent.
 *
 * Claude tasks use CLAUDE_CONFIG_DIR. Cursor Auto uses the same `agent login`
 * as a normal terminal; an explicit Cursor pin injects CURSOR_API_KEY.
 */
export function TaskAccountPicker({
	accounts,
	value,
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
	const valueInFleet = value !== undefined && accounts.some((account) => account.id === value);
	const selectValue = valueInFleet ? String(value) : AUTO_VALUE;

	return (
		<label className="flex min-w-0 items-center gap-1.5 text-[11px] text-text-secondary">
			<span className="shrink-0">Account</span>
			<NativeSelect
				size="sm"
				data-testid="task-account-picker"
				aria-label={agentAccountLabel(agentId)}
				disabled={disabled || accounts.length === 0}
				value={selectValue}
				onChange={(event) => {
					const next = event.target.value;
					onChange(next === AUTO_VALUE ? null : Number(next));
				}}
			>
				<option value={AUTO_VALUE}>{autoLabel}</option>
				{accounts.map((account) => (
					<option key={account.id} value={String(account.id)}>
						{accountLabel(account)}
					</option>
				))}
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
