import type { ReactElement } from "react";

import { useClaudeUsage } from "@/html/use-claude-usage";
import { formatPercent, formatResetHint, formatUsageCacheAge, pressureBarColor } from "@/manager/manager-format";

function unavailableHint(reason: "no-credentials" | "unauthorized" | "unreachable"): string {
	switch (reason) {
		case "no-credentials":
			return "No Claude credentials found — sign in with the Claude Code CLI.";
		case "unauthorized":
			return "Claude rejected the stored credential. Run `claude` to sign in again.";
		case "unreachable":
			return "Could not reach Anthropic to read usage.";
	}
}

function UsageRow({
	label,
	percent,
	resetsAt,
}: {
	label: string;
	percent: number | null;
	resetsAt: string | null;
}): ReactElement {
	const width = percent === null ? 0 : Math.max(0, Math.min(100, Math.round(percent)));
	const resetHint = formatResetHint(resetsAt);
	return (
		<div className="flex flex-col gap-px" title={resetHint ? `${label} · ${resetHint}` : label}>
			<div className="flex items-center justify-between gap-1.5 text-[9px] leading-none text-text-tertiary">
				<span>{label}</span>
				<span className="tabular-nums text-text-secondary">{formatPercent(percent)}</span>
			</div>
			<div className="h-[3px] w-full overflow-hidden rounded bg-surface-2">
				<div
					className="h-full transition-[width] duration-300"
					style={{ width: `${width}%`, background: pressureBarColor(width / 100, true) }}
				/>
			</div>
		</div>
	);
}

/**
 * Compact 5h / 7d meter for the plan editor toolbar, sitting beside the Claude
 * connection dot. Same windows and the same formatters as Manager → Seats
 * (`UsageWindowBar` in `manager-accounts-view.tsx`), shrunk to toolbar height.
 */
export function PlanClaudeUsageChip(): ReactElement {
	const usage = useClaudeUsage();

	if (!usage.available) {
		return (
			<div
				className="hidden h-7 w-[74px] shrink-0 flex-col justify-center gap-0.5 rounded-md border border-border bg-surface-3 px-1.5 py-0.5 text-[9px] leading-none text-text-tertiary lg:flex"
				title={unavailableHint(usage.reason)}
				data-testid="plan-claude-usage-chip"
			>
				<div className="flex items-center justify-between gap-1.5">
					<span>5h</span>
					<span>—</span>
				</div>
				<div className="flex items-center justify-between gap-1.5">
					<span>7d</span>
					<span>—</span>
				</div>
			</div>
		);
	}

	return (
		<div
			className="hidden h-7 w-[74px] shrink-0 flex-col justify-center gap-0.5 rounded-md border border-border bg-surface-3 px-1.5 py-0.5 lg:flex"
			title={`Claude usage · updated ${formatUsageCacheAge(usage.fetchedAt)}`}
			data-testid="plan-claude-usage-chip"
		>
			<UsageRow label="5h" percent={usage.fiveHourPercent} resetsAt={usage.fiveHourResetsAt} />
			<UsageRow label="7d" percent={usage.sevenDayPercent} resetsAt={usage.sevenDayResetsAt} />
		</div>
	);
}
