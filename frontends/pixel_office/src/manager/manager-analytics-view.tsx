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

function formatTokens(value: number | null | undefined): string {
	if (value === null || value === undefined) {
		return "—";
	}
	if (value >= 1_000_000) {
		return `${(value / 1_000_000).toFixed(1)}M`;
	}
	if (value >= 1_000) {
		return `${(value / 1_000).toFixed(1)}k`;
	}
	return String(Math.round(value));
}

function formatCost(value: number | null | undefined): string {
	if (value === null || value === undefined) {
		return "—";
	}
	return `$${value.toFixed(2)}`;
}

function formatCacheHit(value: number | null | undefined): string {
	if (value === null || value === undefined) {
		return "—";
	}
	return `${Math.round(value * 100)}%`;
}

/**
 * Native Analytics surface — tokscale usage overview + Claude anomaly flag count.
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
			} else if (result.error) {
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

	const byProvider = overview?.byProvider ?? [];
	const byClient = overview?.byClient ?? [];
	const showUsage = overview?.ready === true;

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
				{loading && !overview ? (
					<p className="text-[11px] text-text-tertiary">Loading…</p>
				) : (
					<div className="flex flex-col gap-3">
						<div className="grid grid-cols-2 gap-1.5">
							<Stat
								label="Tokens"
								value={showUsage ? formatTokens(overview?.totalTokens) : "—"}
							/>
							<Stat
								label="Est. cost"
								value={showUsage ? formatCost(overview?.totalCostUsd) : "—"}
							/>
							<Stat
								label="Cache hit"
								value={showUsage ? formatCacheHit(overview?.cacheHitRatio) : "—"}
							/>
							<Stat
								label="Flags"
								value={overview ? String(overview.flagCount) : "—"}
							/>
							{overview?.sessionCount !== null && overview?.sessionCount !== undefined ? (
								<Stat label="Sessions" value={String(overview.sessionCount)} />
							) : null}
							{overview?.messageCount !== null && overview?.messageCount !== undefined ? (
								<Stat label="Messages" value={String(overview.messageCount)} />
							) : null}
						</div>

						{showUsage && byProvider.length > 0 ? (
							<div className="flex flex-col gap-1">
								<p className="text-[10px] font-medium text-text-secondary">By provider</p>
								<div className="flex flex-col gap-1">
									{byProvider.map((row) => (
										<div
											key={row.provider}
											className="rounded-md border border-border bg-surface-1 px-2 py-1.5"
										>
											<div className="flex items-baseline justify-between gap-2">
												<p className="text-[12px] text-text-primary">{row.provider}</p>
												<p className="text-[11px] text-text-secondary">{formatCost(row.totalCostUsd)}</p>
											</div>
											<p className="text-[10px] text-text-tertiary">
												{formatTokens(row.totalTokens)} · cache {formatCacheHit(row.cacheHitRatio)}
											</p>
										</div>
									))}
								</div>
							</div>
						) : null}

						{showUsage && byClient.length > 0 ? (
							<div className="flex flex-col gap-1">
								<p className="text-[10px] font-medium text-text-secondary">By agent</p>
								<div className="flex flex-col gap-1">
									{byClient.map((row) => (
										<div
											key={`${row.client}:${row.provider}`}
											className="rounded-md border border-border bg-surface-1 px-2 py-1.5"
										>
											<div className="flex items-baseline justify-between gap-2">
												<p className="text-[12px] text-text-primary">
													{row.client}
													<span className="text-text-tertiary"> / {row.provider}</span>
												</p>
												<p className="text-[11px] text-text-secondary">{formatCost(row.totalCostUsd)}</p>
											</div>
											<p className="text-[10px] text-text-tertiary">
												{formatTokens(row.totalTokens)} · cache {formatCacheHit(row.cacheHitRatio)}
											</p>
										</div>
									))}
								</div>
							</div>
						) : null}

						{!showUsage && !loading && !error ? (
							<p className="text-[11px] text-text-tertiary">No analytics data.</p>
						) : null}

						<p className="text-[10px] text-text-tertiary">
							{overview?.source === "tokscale" ? "Source: tokscale" : "Source: unavailable"}
						</p>
					</div>
				)}
			</div>
		</div>
	);
}
