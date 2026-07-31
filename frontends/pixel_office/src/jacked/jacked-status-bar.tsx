import type { ReactElement } from "react";

import type { RuntimeJackedSnapshot } from "@/runtime/types";

import { cn } from "@/components/ui/cn";
import { formatPercent } from "@/jacked/jacked-format";

interface JackedStatusBarProps {
	online: boolean;
	jacked: RuntimeJackedSnapshot | null;
}

/**
 * Compact health strip for the Jacked sidebar — version, online, pressure, swap.
 */
export function JackedStatusBar({ online, jacked }: JackedStatusBarProps): ReactElement {
	const pressurePct = jacked ? Math.round(jacked.pressure * 100) : null;
	const accountCount = jacked?.accounts.length ?? 0;
	const enabledCount = jacked?.accounts.filter((account) => account.isActive).length ?? 0;
	const hasActive = jacked?.activeAccountId != null;

	return (
		<div
			data-testid="jacked-status-bar"
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
				{jacked?.version ? (
					<span className="text-text-tertiary truncate">v{jacked.version}</span>
				) : null}
				{jacked?.stale ? <span className="text-status-orange">stale</span> : null}
			</div>
			<div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-text-tertiary">
				<span>
					{accountCount} account{accountCount === 1 ? "" : "s"}
					{enabledCount > 0 ? ` · ${enabledCount} enabled` : ""}
					{hasActive ? " · 1 active" : ""}
				</span>
				{pressurePct !== null ? <span>pressure {formatPercent(pressurePct)}</span> : null}
				{jacked ? (
					<span>
						auto-swap {jacked.autoSwapEnabled ? "on" : "off"}
						{jacked.swapPausedUntil ? " (paused)" : ""}
					</span>
				) : null}
			</div>
		</div>
	);
}
