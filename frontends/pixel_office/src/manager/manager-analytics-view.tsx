import type { ReactElement } from "react";
import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

import type { RuntimeManagerUsageOverview } from "@/runtime/types";
import { Button } from "@/components/ui/button";
import { MANAGER_LABELS } from "@/manager/manager-labels";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";

interface ManagerAnalyticsViewProps {
	online: boolean;
}

function Stat({ label, value }: { label: string; value: string }): ReactElement {
	return (
		<div className="rounded-md border border-border bg-surface-1 px-2 py-1.5">
			<p className="text-[10px] text-text-tertiary">{label}</p>
			<p className="text-[13px] font-medium text-text-primary">{value}</p>
		</div>
	);
}

/**
 * Native Analytics surface — usage overview totals (Chart.js trends stay in legacy).
 */
export function ManagerAnalyticsView({ online }: ManagerAnalyticsViewProps): ReactElement {
	const [days, setDays] = useState(1);
	const [overview, setOverview] = useState<RuntimeManagerUsageOverview | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const load = async (nextDays: number = days) => {
		if (!online) {
			setOverview(null);
			return;
		}
		setLoading(true);
		setError(null);
		try {
			const result = await getRuntimeTrpcClient(null).manager.usageOverview.query({ days: nextDays });
			setOverview(result);
			if (result === null) {
				setError("Could not load usage overview.");
			} else if (!result.ready && result.error) {
				setError(result.error);
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : "Could not load usage overview.");
			setOverview(null);
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		void load();
	}, [online, days]);

	if (!online) {
		return (
			<div className="flex flex-1 flex-col items-center justify-center gap-2 p-4 text-center">
				<p className="text-[12px] text-text-secondary">{MANAGER_LABELS.offline}</p>
				<p className="text-[11px] text-text-tertiary">Analytics require the companion.</p>
			</div>
		);
	}

	const formatTokens = (value: number | null): string => {
		if (value === null) {
			return "—";
		}
		if (value >= 1_000_000) {
			return `${(value / 1_000_000).toFixed(1)}M`;
		}
		if (value >= 1_000) {
			return `${(value / 1_000).toFixed(1)}k`;
		}
		return String(Math.round(value));
	};

	return (
		<div className="flex min-h-0 flex-1 flex-col overflow-hidden" data-testid="manager-analytics-view">
			<div className="flex items-center gap-1 border-b border-border px-2 py-1 shrink-0">
				{(
					[
						{ id: 1, label: "1d" },
						{ id: 7, label: "7d" },
						{ id: 30, label: "30d" },
					] as const
				).map((item) => (
					<button
						key={item.id}
						type="button"
						onClick={() => setDays(item.id)}
						className={
							days === item.id
								? "rounded-md border border-border bg-surface-4 px-2 py-1 text-[10px] text-text-primary"
								: "rounded-md border border-transparent px-2 py-1 text-[10px] text-text-secondary hover:bg-surface-2"
						}
					>
						{item.label}
					</button>
				))}
				<span className="flex-1" />
				<Button
					variant="ghost"
					size="sm"
					icon={<RefreshCw size={12} />}
					aria-label="Reload analytics"
					disabled={loading}
					onClick={() => {
						void load();
					}}
				/>
			</div>
			{error ? (
				<p className="shrink-0 border-b border-border px-2 py-1 text-[10px] text-status-red">{error}</p>
			) : null}
			<div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
				{!overview || !overview.ready ? (
					<p className="text-[11px] text-text-tertiary">
						{loading ? "Loading…" : overview?.error ?? "No analytics data."}
					</p>
				) : (
					<div className="flex flex-col gap-3">
						<div className="grid grid-cols-2 gap-1.5">
							<Stat label="Tokens" value={formatTokens(overview.totalTokens)} />
							<Stat
								label="Est. cost"
								value={
									overview.totalCostUsd === null ? "—" : `$${overview.totalCostUsd.toFixed(2)}`
								}
							/>
							<Stat label="Sessions" value={overview.sessionCount === null ? "—" : String(overview.sessionCount)} />
							<Stat
								label="Cache hit"
								value={
									overview.cacheHitRatio === null
										? "—"
										: `${Math.round(overview.cacheHitRatio * 100)}%`
								}
							/>
							<Stat label="Messages" value={overview.messageCount === null ? "—" : String(overview.messageCount)} />
							<Stat label="Flags" value={String(overview.flagCount)} />
						</div>
						<p className="text-[10px] text-text-tertiary">
							Trends charts and session drill-down remain in the legacy Analytics dashboard.
						</p>
					</div>
				)}
			</div>
		</div>
	);
}
