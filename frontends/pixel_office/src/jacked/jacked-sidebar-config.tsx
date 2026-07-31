import type { ReactElement } from "react";
import { useState } from "react";
import { Pause, Play, RefreshCw, Settings } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { RuntimeJackedSnapshot } from "@/runtime/types";
import { MANAGER_LABELS } from "@/jacked/manager-labels";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";

interface JackedSidebarConfigProps {
	online: boolean;
	jacked: RuntimeJackedSnapshot | null;
	/** Switch left sidebar to Jacked → Settings (Accounts live upper-right only). */
	onOpenJackedSettings: () => void;
}

/**
 * Lower-left Jacked config strip: refresh, auto-swap pause/resume, settings.
 */
export function JackedSidebarConfig({
	online,
	jacked,
	onOpenJackedSettings,
}: JackedSidebarConfigProps): ReactElement {
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const paused = Boolean(
		jacked?.swapPausedUntil && Date.parse(jacked.swapPausedUntil) > Date.now(),
	);

	const run = async (action: () => Promise<{ ok: boolean; error?: string | null }>) => {
		setBusy(true);
		setError(null);
		try {
			const result = await action();
			if (!result.ok) {
				setError(result.error ?? "Action failed");
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : "Action failed");
		} finally {
			setBusy(false);
		}
	};

	return (
		<div
			data-testid="jacked-sidebar-config"
			className="shrink-0 border-t border-border bg-surface-1 px-2 py-2"
		>
			{error ? <p className="mb-1 truncate text-[10px] text-status-red">{error}</p> : null}
			<div className="flex flex-wrap gap-1">
				<Button
					variant="ghost"
					size="sm"
					className="h-7 px-2 text-[10px]"
					disabled={!online || busy}
					icon={<RefreshCw size={12} />}
					aria-label={MANAGER_LABELS.refreshAllUsage}
					onClick={() => {
						void run(() => getRuntimeTrpcClient(null).jacked.refreshAllUsage.mutate());
					}}
				>
					Refresh
				</Button>
				{paused ? (
					<Button
						variant="ghost"
						size="sm"
						className="h-7 px-2 text-[10px]"
						disabled={!online || busy}
						icon={<Play size={12} />}
						aria-label="Resume auto-swap"
						onClick={() => {
							void run(() => getRuntimeTrpcClient(null).jacked.resumeSwap.mutate());
						}}
					>
						Resume
					</Button>
				) : (
					<Button
						variant="ghost"
						size="sm"
						className="h-7 px-2 text-[10px]"
						disabled={!online || busy}
						icon={<Pause size={12} />}
						aria-label="Pause auto-swap for 30 minutes"
						onClick={() => {
							void run(() =>
								getRuntimeTrpcClient(null).jacked.pauseSwap.mutate({ minutes: 30 }),
							);
						}}
					>
						Pause
					</Button>
				)}
				<Button
					variant="ghost"
					size="sm"
					className="h-7 px-2 text-[10px]"
					icon={<Settings size={12} />}
					aria-label={MANAGER_LABELS.openSettings}
					onClick={onOpenJackedSettings}
				>
					Settings
				</Button>
			</div>
			{!online ? (
				<p className="mt-1 text-[10px] text-text-tertiary">{MANAGER_LABELS.configDisabled}</p>
			) : null}
		</div>
	);
}
