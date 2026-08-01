import type { ReactElement } from "react";
import { useCallback, useEffect, useState } from "react";

import type { RuntimeJackedPack } from "@/runtime/types";

import { cn } from "@/components/ui/cn";
import { FeatureToggleButton } from "@/jacked/feature-toggle-button";
import { MANAGER_LABELS } from "@/jacked/manager-labels";
import { notifySkillInventoryChanged } from "@/runtime/skill-inventory-events";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";

/**
 * Curated skill packs, shown above the individual Training entries.
 *
 * Packs are sets: enabling one installs a whole curriculum from an upstream repo via
 * npx, which is why install state is a count and a toggle can take many seconds.
 * Packs are not part of the account snapshot, so this panel owns its own fetch and
 * refetches after each toggle.
 */
export function TrainingPacksPanel({ online }: { online: boolean }): ReactElement | null {
	const [packs, setPacks] = useState<RuntimeJackedPack[] | null>(null);
	const [npxAvailable, setNpxAvailable] = useState(true);
	const [pendingName, setPendingName] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	const load = useCallback(async () => {
		try {
			const result = await getRuntimeTrpcClient(null).jacked.packs.query();
			setPacks(result?.packs ?? null);
			setNpxAvailable(result?.npxAvailable ?? true);
		} catch {
			setPacks(null);
		}
	}, []);

	useEffect(() => {
		if (!online) {
			setPacks(null);
			return;
		}
		void load();
	}, [load, online]);

	const toggle = useCallback(
		async (pack: RuntimeJackedPack) => {
			setPendingName(pack.name);
			setError(null);
			try {
				const result = await getRuntimeTrpcClient(null).jacked.setPackEnabled.mutate({
					name: pack.name,
					enabled: !pack.enabled,
				});
				if (!result.ok) {
					setError(result.error ?? "Could not change that pack.");
				}
				// jacked installs off-thread, so re-read rather than trusting the ack.
				await load();
				notifySkillInventoryChanged();
			} catch (err) {
				setError(err instanceof Error ? err.message : "Could not change that pack.");
			} finally {
				setPendingName(null);
			}
		},
		[load],
	);

	if (!packs || packs.length === 0) {
		return null;
	}

	return (
		<section className="mb-2" data-testid="training-packs-panel">
			<p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-text-tertiary">
				{MANAGER_LABELS.packs.title}
			</p>
			<p className="mb-1.5 text-[10px] text-text-tertiary">{MANAGER_LABELS.packs.description}</p>
			{!npxAvailable ? (
				<p className="mb-1.5 text-[10px] text-status-orange">{MANAGER_LABELS.packs.npxRequired}</p>
			) : null}
			{error ? <p className="mb-1.5 text-[10px] text-status-red">{error}</p> : null}
			<ul className="flex flex-col gap-1">
				{packs.map((pack) => {
					const busy = pendingName === pack.name;
					return (
						<li
							key={pack.name}
							data-testid={`training-pack-${pack.name}`}
							className={cn(
								"rounded-md border px-2 py-1.5",
								pack.enabled ? "border-border-bright bg-surface-3" : "border-border bg-surface-1",
							)}
						>
							<div className="flex items-start gap-2">
								<div className="min-w-0 flex-1">
									<div className="flex items-center gap-1.5">
										<span className="truncate text-[11px] font-medium text-text-primary">
											{pack.displayName}
										</span>
										<span className="shrink-0 text-[9px] text-text-tertiary">
											{pack.installedCount}/{pack.skillCount}
										</span>
										{pack.isDefault && !pack.explicit ? (
											<span className="shrink-0 text-[9px] uppercase tracking-wide text-text-tertiary">
												default
											</span>
										) : null}
									</div>
									<p className="mt-0.5 line-clamp-2 text-[10px] text-text-tertiary">{pack.description}</p>
									{pack.homepage ? (
										<a
											href={pack.homepage}
											target="_blank"
											rel="noopener noreferrer"
											className="mt-0.5 inline-block text-[10px] text-accent underline"
										>
											{pack.source ?? pack.homepage}
										</a>
									) : null}
								</div>
								<FeatureToggleButton
									installed={pack.enabled}
									busy={busy}
									disabled={!online || !npxAvailable}
									subjectLabel={pack.displayName}
									onToggle={() => {
										void toggle(pack);
									}}
								/>
							</div>
						</li>
					);
				})}
			</ul>
		</section>
	);
}
