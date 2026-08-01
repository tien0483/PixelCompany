import type { ReactElement } from "react";

import type { RuntimeManagerSnapshot } from "@/runtime/types";

import { cn } from "@/components/ui/cn";
import { formatPercent } from "@/manager/manager-format";

interface ManagerStatusBarProps {
	online: boolean;
	manager: RuntimeManagerSnapshot | null;
}

/**
 * Compact health strip for the Jacked sidebar — version, online, pressure, swap.
 */
export function ManagerStatusBar({ online, manager }: ManagerStatusBarProps): ReactElement {
	const pressurePct = manager ? Math.round(manager.pressure * 100) : null;
	const accountCount = manager?.accounts.length ?? 0;
	const enabledCount = manager?.accounts.filter((account) => account.isActive).length ?? 0;
	const hasActive = manager?.activeAccountId != null;

	return (
		<div
			data-testid="manager-status-bar"
			className="flex flex-col gap-1 border-b border-border px-2 py-2 shrink-0"
		>
			<div className="flex items-center gap-2 text-[11px]">
				<span
					className={cn(
						"inline-block h-1.5 w-1.5 rounded-full",
						online ? "bg-status-green" : "bg-status-red",
					)}
					aria-hidden
				/>
				<span className="text-text-primary font-medium">{online ? "Online" : "Offline"}</span>
				{manager?.version ? (
					<span className="text-text-tertiary truncate">v{manager.version}</span>
				) : null}
				{manager?.stale ? <span className="text-status-orange">stale</span> : null}
			</div>
			<div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-text-tertiary">
				<span>
					{accountCount} account{accountCount === 1 ? "" : "s"}
					{enabledCount > 0 ? ` · ${enabledCount} enabled` : ""}
					{hasActive ? " · 1 active" : ""}
				</span>
				{pressurePct !== null ? <span>pressure {formatPercent(pressurePct)}</span> : null}
				{manager ? (
					<span>
						auto-swap {manager.autoSwapEnabled ? "on" : "off"}
						{manager.swapPausedUntil ? " (paused)" : ""}
					</span>
				) : null}
			</div>
		</div>
	);
}
