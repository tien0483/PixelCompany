import { type ReactElement } from "react";

import { autoFallbackAccount } from "@/manager/task-account-picker";
import type { SeatChoice } from "@/manager/use-seat-choice";
import type { RuntimeManagerAccount } from "@/runtime/types";

const MANAGER_VALUE_PREFIX = "manager:";

/**
 * Which Claude seat a one-shot surface's agents bill — the Review tab's audit, chat
 * and rules passes, the Plans editor's brief, generate and draft passes.
 *
 * A compact select rather than `TaskAccountPicker`: that component is a labelled form
 * block with agent-switching and subagent rows, none of which apply here — these
 * surfaces never change agent, and their agents spawn no subagents.
 *
 * Auto here means the Manager's *active* seat, not the least-used one a board card's
 * Auto resolves to. That is deliberate: these are the surfaces the active seat exists
 * to serve, and moving them off it is what pushed task load onto it in the first place.
 */
export function SeatPicker({
	claudeAccounts,
	activeAccountId,
	value,
	disabled = false,
	label = "Claude seat for review agents",
	title = "Claude seat the review agents bill",
	onChange,
}: {
	/** Already narrowed to Claude seats by the caller, which needs the same list. */
	claudeAccounts: RuntimeManagerAccount[];
	activeAccountId: number | null;
	/**
	 * The seat the next run will actually use — the caller's resolved id, not the raw
	 * stored choice, so the select cannot disagree with what gets billed. Undefined
	 * only while the Manager snapshot is still loading, or on explicit Auto.
	 */
	value: number | undefined;
	disabled?: boolean;
	/** Accessible name, so the Plans copy does not announce itself as review. */
	label?: string;
	title?: string;
	/** `"auto"` rather than `undefined`, so declining the default is remembered. */
	onChange: (choice: SeatChoice) => void;
}): ReactElement | null {
	// Nothing to choose between, and no Manager to fall back to either — the select
	// would be a control with one disabled option.
	if (claudeAccounts.length === 0) {
		return null;
	}

	const fallback = autoFallbackAccount(claudeAccounts, activeAccountId, "claude");
	const autoLabel = fallback ? `Auto · ${fallback.displayName ?? fallback.email}` : "Auto (active account)";
	// An account that disappeared from Manager must not stick as the select's value.
	const isKnown = value !== undefined && claudeAccounts.some((account) => account.id === value);

	return (
		<select
			aria-label={label}
			title={title}
			disabled={disabled}
			value={isKnown ? `${MANAGER_VALUE_PREFIX}${value}` : "auto"}
			onChange={(event) => {
				const next = event.target.value;
				onChange(next.startsWith(MANAGER_VALUE_PREFIX) ? Number(next.slice(MANAGER_VALUE_PREFIX.length)) : "auto");
			}}
			className="max-w-44 truncate rounded border border-border bg-surface-2 px-1.5 py-0.5 text-[11px] text-text-secondary focus:border-border-focus focus:outline-none disabled:opacity-40"
		>
			<option value="auto">{autoLabel}</option>
			{claudeAccounts.map((account) => (
				<option key={account.id} value={`${MANAGER_VALUE_PREFIX}${account.id}`}>
					{account.displayName ?? account.email}
				</option>
			))}
		</select>
	);
}
