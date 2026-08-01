import type { ReactElement, ReactNode } from "react";
import { useCallback, useMemo, useState } from "react";
import { Fzf } from "fzf";
import { Search } from "lucide-react";

import type { RuntimeManagerFeature, RuntimeManagerSnapshot } from "@/runtime/types";

import { cn } from "@/components/ui/cn";
import { FeatureToggleButton } from "@/manager/feature-toggle-button";
import { MANAGER_LABELS } from "@/manager/manager-labels";
import { notifySkillInventoryChanged } from "@/runtime/skill-inventory-events";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";

export interface FeatureShelfCopy {
	title: string;
	description: string;
	empty: string;
}

export interface FeatureShelfViewProps {
	online: boolean;
	manager: RuntimeManagerSnapshot | null;
	copy: FeatureShelfCopy;
	/** Chooses which of the snapshot's features belong on this shelf. */
	select: (feature: RuntimeManagerFeature) => boolean;
	/** Rendered above the list — used by Training to host packs. */
	header?: ReactNode;
	testId: string;
}

function featureKey(feature: RuntimeManagerFeature): string {
	return `${feature.category}/${feature.name}`;
}

/**
 * One browsable, filterable shelf of jacked features with per-row install toggles.
 *
 * Every category the Manager surfaces (staff, playbooks, training, handbook) is the
 * same interaction over a different slice of `manager.features`, which the runtime
 * already streams in full — so a shelf needs no fetch of its own, and toggling reuses
 * the existing `manager.setFeatureEnabled` procedure.
 */
export function FeatureShelfView({
	online,
	manager,
	copy,
	select,
	header,
	testId,
}: FeatureShelfViewProps): ReactElement {
	const [query, setQuery] = useState("");
	const [pendingKey, setPendingKey] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	const features = useMemo(() => {
		const matching = (manager?.features ?? []).filter(select);
		// Installed first, then alphabetical — the shelf reads as "who works here".
		return matching.sort((left, right) => {
			if (left.installed !== right.installed) {
				return left.installed ? -1 : 1;
			}
			return left.displayName.localeCompare(right.displayName);
		});
	}, [manager?.features, select]);

	const visible = useMemo(() => {
		const trimmed = query.trim();
		if (!trimmed) {
			return features;
		}
		const finder = new Fzf(features, {
			selector: (feature) => `${feature.displayName} ${feature.name} ${feature.description}`,
		});
		return finder.find(trimmed).map((entry) => entry.item);
	}, [features, query]);

	const toggle = useCallback(
		async (feature: RuntimeManagerFeature) => {
			const key = featureKey(feature);
			setPendingKey(key);
			setError(null);
			try {
				const result = await getRuntimeTrpcClient(null).manager.setFeatureEnabled.mutate({
					category: feature.category,
					name: feature.name,
					enabled: !feature.installed,
				});
				if (!result.ok) {
					setError(result.error ?? "Could not change that.");
				} else {
					notifySkillInventoryChanged();
				}
			} catch (err) {
				setError(err instanceof Error ? err.message : "Could not change that.");
			} finally {
				setPendingKey(null);
			}
		},
		[],
	);

	if (!online && manager === null) {
		return (
			<div
				data-testid={testId}
				className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 p-4 text-center"
			>
				<p className="text-[12px] text-text-secondary">{MANAGER_LABELS.offline}</p>
			</div>
		);
	}

	const installedCount = features.filter((feature) => feature.installed).length;

	return (
		<div className="flex min-h-0 flex-1 flex-col overflow-hidden" data-testid={testId}>
			<div className="shrink-0 border-b border-border px-2 py-1.5">
				<div className="flex items-center gap-1">
					<span className="flex-1 truncate text-[12px] font-medium text-text-primary">{copy.title}</span>
					<span className="shrink-0 text-[10px] text-text-tertiary">
						{installedCount}/{features.length}
					</span>
				</div>
				<p className="mt-0.5 text-[10px] text-text-tertiary">{copy.description}</p>
				<div className="mt-1.5 flex items-center gap-1 rounded border border-border bg-surface-2 px-1.5">
					<Search size={10} className="shrink-0 text-text-tertiary" aria-hidden />
					<input
						type="text"
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						placeholder="Filter"
						aria-label={`Filter ${copy.title}`}
						data-testid={`${testId}-filter`}
						className="min-w-0 flex-1 bg-transparent py-1 text-[10px] text-text-primary outline-none"
						autoComplete="off"
						spellCheck={false}
					/>
				</div>
			</div>
			{error ? (
				<p className="shrink-0 border-b border-border px-2 py-1 text-[10px] text-status-red">{error}</p>
			) : null}
			<div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
				{header}
				{visible.length === 0 ? (
					<p className="text-[11px] text-text-tertiary">{query.trim() ? "No matches." : copy.empty}</p>
				) : (
					<ul className="flex flex-col gap-1">
						{visible.map((feature) => {
							const key = featureKey(feature);
							const busy = pendingKey === key;
							return (
								<li
									key={key}
									data-testid={`${testId}-row-${feature.name}`}
									className={cn(
										"rounded-md border px-2 py-1.5",
										feature.installed ? "border-border-bright bg-surface-3" : "border-border bg-surface-1",
									)}
								>
									<div className="flex items-start gap-2">
										<div className="min-w-0 flex-1">
											<p className="truncate text-[11px] font-medium text-text-primary">
												{feature.displayName}
											</p>
											{feature.description ? (
												<p className="mt-0.5 line-clamp-2 text-[10px] text-text-tertiary">
													{feature.description}
												</p>
											) : null}
										</div>
										<FeatureToggleButton
											installed={feature.installed}
											busy={busy}
											disabled={!online}
											onToggle={() => {
												void toggle(feature);
											}}
											subjectLabel={feature.displayName}
										/>
									</div>
								</li>
							);
						})}
					</ul>
				)}
				<p className="mt-2 border-t border-border pt-1.5 text-[10px] text-text-tertiary">
					{MANAGER_LABELS.globalInstallNotice}
				</p>
			</div>
		</div>
	);
}
