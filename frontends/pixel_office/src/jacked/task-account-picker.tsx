import type { ReactElement } from "react";

import type { RuntimeJackedAccount } from "@/runtime/types";

import { NativeSelect } from "@/components/ui/native-select";
import { formatPercent } from "@/jacked/jacked-format";

const AUTO_VALUE = "auto";

export interface TaskAccountPickerProps {
	/** Claude accounts from the jacked snapshot; already provider-filtered by the caller. */
	accounts: RuntimeJackedAccount[];
	/** Account currently pinned to the card, or undefined to follow auto-swap. */
	value: number | undefined;
	/** Account jacked reports as globally active, used to label the auto option. */
	activeAccountId: number | null;
	disabled?: boolean;
	onChange: (jackedAccountId: number | null) => void;
}

function accountLabel(account: RuntimeJackedAccount): string {
	const name = account.displayName ?? account.email;
	const usage = account.canTrackUsage ? ` · 5h ${formatPercent(account.fiveHourPercent)}` : "";
	const disabled = account.isActive ? "" : " · disabled";
	return `${name}${usage}${disabled}`;
}

/**
 * Pins one board task to a specific Claude account.
 *
 * A pinned task launches Claude Code against that account's own credential
 * directory (CLAUDE_CONFIG_DIR), so several tasks can run on different accounts
 * simultaneously. Left on "Auto", the task uses whichever account jacked has
 * active and follows its auto-swap rotation.
 */
export function TaskAccountPicker({
	accounts,
	value,
	activeAccountId,
	disabled = false,
	onChange,
}: TaskAccountPickerProps): ReactElement {
	const activeAccount = accounts.find((account) => account.id === activeAccountId) ?? null;
	const autoLabel = activeAccount
		? `Auto · ${activeAccount.displayName ?? activeAccount.email}`
		: "Auto (active account)";

	return (
		<label className="flex min-w-0 items-center gap-1.5 text-[11px] text-text-secondary">
			<span className="shrink-0">Account</span>
			<NativeSelect
				size="sm"
				data-testid="task-account-picker"
				aria-label="Claude account for this task"
				disabled={disabled || accounts.length === 0}
				value={value === undefined ? AUTO_VALUE : String(value)}
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
