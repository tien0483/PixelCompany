import type { ReactElement } from "react";

import type { RuntimeAgentId, RuntimeJackedAccount } from "@/runtime/types";

import { NativeSelect } from "@/components/ui/native-select";
import { formatPercent } from "@/jacked/jacked-format";

const AUTO_VALUE = "auto";

export interface TaskAccountPickerProps {
	accounts: RuntimeJackedAccount[];
	value: number | undefined;
	activeAccountId: number | null;
	agentId: RuntimeAgentId | null;
	disabled?: boolean;
	onChange: (jackedAccountId: number | null) => void;
}

function accountLabel(account: RuntimeJackedAccount): string {
	const name = account.displayName ?? account.email;
	const usage = account.canTrackUsage ? ` · 5h ${formatPercent(account.fiveHourPercent)}` : "";
	const disabled = account.isActive ? "" : " · disabled";
	return `${name}${usage}${disabled}`;
}

function agentAccountLabel(agentId: RuntimeAgentId | null): string {
	if (agentId === "cursor") {
		return "Cursor account for this task";
	}
	return "Claude account for this task";
}

function autoFallbackAccount(
	accounts: RuntimeJackedAccount[],
	activeAccountId: number | null,
	agentId: RuntimeAgentId | null,
): RuntimeJackedAccount | null {
	if (agentId === "cursor") {
		return accounts.find((account) => account.isActiveForProvider) ?? accounts[0] ?? null;
	}
	return accounts.find((account) => account.id === activeAccountId) ?? accounts[0] ?? null;
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

export function jackedProviderForAgent(agentId: RuntimeAgentId | null | undefined): RuntimeJackedAccount["provider"] | null {
	if (agentId === "claude") {
		return "claude";
	}
	if (agentId === "cursor") {
		return "cursor";
	}
	return null;
}

export function filterJackedAccountsForAgent(
	accounts: RuntimeJackedAccount[],
	agentId: RuntimeAgentId | null | undefined,
): RuntimeJackedAccount[] {
	const provider = jackedProviderForAgent(agentId);
	if (provider === null) {
		return [];
	}
	return accounts.filter((account) => account.provider === provider);
}
