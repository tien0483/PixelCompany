import type { ReactElement } from "react";

import type { RuntimeJackedState } from "@/runtime/types";

/** Below this, usage is not worth showing on the floor at all. */
const DIM_START_PRESSURE = 0.5;
/** Darkest the office ever gets, so the canvas stays readable at 100% usage. */
const MAX_DIM_ALPHA = 0.25;

/**
 * Turns claude-jacked's usage pressure into ambient light.
 *
 * A rate limit is the office running out of daylight: nothing changes until the fleet is
 * half consumed, then the room darkens and warms toward closing time. Rendered as an
 * overlay rather than by tinting sprites so the pixel art keeps its exact palette.
 */
export function OfficeAtmosphere({ jacked }: { jacked: RuntimeJackedState }): ReactElement | null {
	if (jacked === null || jacked.pressure <= DIM_START_PRESSURE) {
		return null;
	}
	const intensity = (jacked.pressure - DIM_START_PRESSURE) / (1 - DIM_START_PRESSURE);
	const alpha = Math.min(MAX_DIM_ALPHA, intensity * MAX_DIM_ALPHA);
	return (
		<div
			aria-hidden
			data-testid="office-atmosphere"
			className="pointer-events-none absolute inset-0"
			style={{ background: `rgba(24, 14, 6, ${alpha.toFixed(3)})` }}
		/>
	);
}
