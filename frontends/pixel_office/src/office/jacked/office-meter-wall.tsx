import type { ReactElement } from "react";

import type { OfficeJackedSemantics, ProviderMeter } from "./office-jacked-semantics.js";
import { MANAGER_LABELS } from "@/jacked/manager-labels";

function pressureColor(pressure: number, canAutoSwap: boolean): string {
	if (!canAutoSwap) {
		return "var(--color-text-tertiary)";
	}
	if (pressure >= 0.9) {
		return "var(--color-status-red)";
	}
	if (pressure >= 0.7) {
		return "var(--color-status-orange)";
	}
	return "var(--color-status-green)";
}

/** Prefer active/high-pressure meters so the strip does not become a dashboard. */
function selectPrimaryMeters(meters: ProviderMeter[]): ProviderMeter[] {
	// At most four fleets exist today; keep them all visible.
	if (meters.length <= 4) {
		return meters;
	}
	const sorted = [...meters].sort((a, b) => b.pressure - a.pressure);
	return sorted.slice(0, 4);
}

interface OfficeMeterWallProps {
	semantics: OfficeJackedSemantics;
	/** When jacked is offline, show a muted chip instead of vanishing. */
	jackedOnline: boolean;
	/** Last-known-good retained after a probe failure — show meters but flag them. */
	jackedStale?: boolean;
}

/**
 * Overlay strip showing jacked provider usage.
 *
 * Cursor meters carry a manual-only badge because auto-swap is permanently off
 * for that provider. Shelf toggles live in OfficeLibraryPanel.
 */
export function OfficeMeterWall({
	semantics,
	jackedOnline,
	jackedStale = false,
}: OfficeMeterWallProps): ReactElement {
	if (!jackedOnline && !jackedStale) {
		return (
			<div
				data-testid="office-jacked-offline"
				className="inline-flex rounded-md bg-surface-1/90 px-3 py-1.5 text-[11px] text-text-tertiary shadow-sm backdrop-blur"
			>
				{MANAGER_LABELS.offline}
			</div>
		);
	}

	if (semantics.meters.length === 0) {
		return (
			<div
				data-testid="office-jacked-empty-meters"
				className="inline-flex rounded-md bg-surface-1/90 px-3 py-1.5 text-[11px] text-text-tertiary shadow-sm backdrop-blur"
			>
				{jackedStale ? MANAGER_LABELS.metersStale : "No usage meters"}
			</div>
		);
	}

	const meters = selectPrimaryMeters(semantics.meters);

	return (
		<div
			data-testid="office-meter-wall"
			className="inline-flex max-w-full flex-wrap items-center gap-3 rounded-md bg-surface-1/90 px-3 py-2 text-[12px] text-text-secondary shadow-sm backdrop-blur"
		>
				{jackedStale ? (
					<span
						data-testid="office-jacked-stale"
						className="text-[10px] uppercase tracking-wide text-text-tertiary"
					>
						cached
					</span>
				) : null}
				{meters.map((meter) => (
					<div key={meter.provider} className="flex min-w-[7rem] flex-col gap-1">
						<div className="flex items-center justify-between gap-2">
							<span className="font-medium text-text-primary">{meter.label}</span>
							{meter.canAutoSwap ? null : (
								<span className="text-[10px] uppercase tracking-wide text-text-tertiary">manual</span>
							)}
						</div>
						<div className="h-1.5 overflow-hidden rounded bg-surface-2">
							<div
								className="h-full transition-[width] duration-500"
								style={{
									width: `${Math.round(meter.pressure * 100)}%`,
									background: pressureColor(meter.pressure, meter.canAutoSwap),
								}}
							/>
						</div>
						<span className="truncate text-[11px] text-text-tertiary">
							{meter.activeEmail ?? `${meter.accountCount} account(s)`}
						</span>
					</div>
				))}
				{semantics.latestSwap ? (
					<span
						data-testid="office-shift-label"
						className="border-l border-border pl-3 text-[11px] text-text-tertiary"
					>
						Shift: {semantics.latestSwap.fromEmail ?? "?"} → {semantics.latestSwap.toEmail ?? "?"}
					</span>
				) : null}
				{semantics.memoryVault.enabled ? (
					<span
						data-testid="office-vault-label"
						className="border-l border-border pl-3 text-[11px] text-text-tertiary"
					>
						Vault · {semantics.memoryVault.lessonsActive ?? 0} lessons
					</span>
				) : null}
				{semantics.nightShift ? (
					<span
						data-testid="office-night-shift-label"
						className="border-l border-border pl-3 text-[11px] text-text-tertiary"
					>
						Night shift
					</span>
				) : null}
		</div>
	);
}
