import type { ReactElement } from "react";
import { useEffect, useState } from "react";

import type { RuntimeManagerSnapshot, RuntimeManagerSwapLog } from "@/runtime/types";
import { Button } from "@/components/ui/button";
import { MANAGER_LABELS } from "@/manager/manager-labels";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";

interface ManagerSettingsViewProps {
	online: boolean;
	manager: RuntimeManagerSnapshot | null;
}

/**
 * Native Settings surface — auto-swap controls + recent swaps.
 * Deep Jacked dashboard settings are not embedded; use Installations / Analytics natives.
 */
export function ManagerSettingsView({ online, manager }: ManagerSettingsViewProps): ReactElement {
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [swapLog, setSwapLog] = useState<RuntimeManagerSwapLog | null>(null);

	useEffect(() => {
		if (!online) {
			setSwapLog(null);
			return;
		}
		let cancelled = false;
		void (async () => {
			try {
				const result = await getRuntimeTrpcClient(null).manager.swapLog.query({ limit: 8 });
				if (!cancelled) {
					setSwapLog(result);
				}
			} catch {
				if (!cancelled) {
					setSwapLog(null);
				}
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [online, manager?.latestSwap?.at]);

	const pause = async (minutes: number) => {
		setBusy(true);
		setError(null);
		try {
			const result = await getRuntimeTrpcClient(null).manager.pauseSwap.mutate({ minutes });
			if (!result.ok) {
				setError(result.error ?? "Pause failed");
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : "Pause failed");
		} finally {
			setBusy(false);
		}
	};

	const resume = async () => {
		setBusy(true);
		setError(null);
		try {
			const result = await getRuntimeTrpcClient(null).manager.resumeSwap.mutate();
			if (!result.ok) {
				setError(result.error ?? "Resume failed");
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : "Resume failed");
		} finally {
			setBusy(false);
		}
	};

	if (!online && manager === null) {
		return (
			<div className="flex flex-1 flex-col items-center justify-center gap-2 p-4 text-center">
				<p className="text-[12px] text-text-secondary">{MANAGER_LABELS.offline}</p>
				<p className="text-[11px] text-text-tertiary">Settings require the companion.</p>
			</div>
		);
	}

	const installedFeatures = manager?.features.filter((feature) => feature.installed).length ?? 0;

	return (
		<div className="flex min-h-0 flex-1 flex-col overflow-hidden" data-testid="manager-settings-view">
			{error ? (
				<p className="shrink-0 border-b border-border px-2 py-1 text-[10px] text-status-red">{error}</p>
			) : null}
			<div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
				<div className="flex flex-col gap-3">
					<section className="rounded-md border border-border bg-surface-1 px-2 py-2">
						<p className="text-[11px] font-medium text-text-primary">Auto-swap</p>
						<p className="mt-0.5 text-[10px] text-text-tertiary">
							{manager?.autoSwapEnabled ? "Enabled" : "Disabled"}
							{manager?.swapPausedUntil
								? ` · paused until ${new Date(manager.swapPausedUntil).toLocaleString()}`
								: ""}
						</p>
						<div className="mt-2 flex flex-wrap gap-1">
							<Button
								variant="ghost"
								size="sm"
								className="h-6 px-2 text-[10px]"
								disabled={!online || busy}
								onClick={() => {
									void pause(30);
								}}
							>
								Pause 30m
							</Button>
							<Button
								variant="ghost"
								size="sm"
								className="h-6 px-2 text-[10px]"
								disabled={!online || busy}
								onClick={() => {
									void pause(120);
								}}
							>
								Pause 2h
							</Button>
							<Button
								variant="ghost"
								size="sm"
								className="h-6 px-2 text-[10px]"
								disabled={!online || busy || !manager?.swapPausedUntil}
								onClick={() => {
									void resume();
								}}
							>
								Resume
							</Button>
						</div>
					</section>

					<section className="rounded-md border border-border bg-surface-1 px-2 py-2">
						<p className="text-[11px] font-medium text-text-primary">Features</p>
						<p className="mt-0.5 text-[10px] text-text-tertiary">
							{installedFeatures} installed · toggle shelves in Office library
						</p>
					</section>

					<section>
						<p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-text-tertiary">
							Recent swaps
						</p>
						{!swapLog || swapLog.swaps.length === 0 ? (
							<p className="text-[11px] text-text-tertiary">No swap history.</p>
						) : (
							<div className="flex flex-col gap-1">
								{swapLog.swaps.map((swap, index) => (
									<div
										key={`${swap.at}-${index}`}
										className="rounded-md border border-border bg-surface-1 px-2 py-1.5 text-[10px]"
									>
										<p className="text-text-primary">
											{swap.fromEmail ?? "?"} → {swap.toEmail ?? "?"}
										</p>
										<p className="text-text-tertiary">
											{new Date(swap.at).toLocaleString()}
											{swap.reason ? ` · ${swap.reason}` : ""}
										</p>
									</div>
								))}
							</div>
						)}
					</section>
				</div>
			</div>
		</div>
	);
}
