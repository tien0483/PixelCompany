import type { ReactElement } from "react";
import { useEffect, useState } from "react";

import { NativeSelect } from "@/components/ui/native-select";
import { fetchClineCustomProviders } from "@/runtime/runtime-config-query";
import type { RuntimeClineCustomProvider } from "@/runtime/types";

/**
 * Lets a task start on a Manager "API Key" seat (a Cline custom provider) without
 * exposing Cline in the normal, gated agent picker — see agent-catalog.ts's
 * RUNTIME_LAUNCH_SUPPORTED_AGENT_IDS. Selecting a seat here sets agentId/clineSettings
 * directly, the same fields the (hidden) Cline picker would set.
 */
export function ApiSeatQuickPick({
	active,
	workspaceId,
	onSelect,
}: {
	active: boolean;
	workspaceId: string | null;
	onSelect: (seat: RuntimeClineCustomProvider) => void;
}): ReactElement | null {
	const [seats, setSeats] = useState<RuntimeClineCustomProvider[]>([]);

	useEffect(() => {
		if (!active) {
			return;
		}
		let cancelled = false;
		void fetchClineCustomProviders(workspaceId)
			.then((providers) => {
				if (!cancelled) {
					setSeats(providers);
				}
			})
			.catch(() => {
				if (!cancelled) {
					setSeats([]);
				}
			});
		return () => {
			cancelled = true;
		};
	}, [active, workspaceId]);

	if (seats.length === 0) {
		return null;
	}

	return (
		<div className="w-full sm:w-1/2 min-w-0">
			<span className="text-[11px] text-text-secondary block mb-1">Run via API seat (Cline)</span>
			<NativeSelect
				size="sm"
				fill
				data-testid="task-api-seat-picker"
				value=""
				onChange={(event) => {
					const providerId = event.currentTarget.value;
					const seat = seats.find((entry) => entry.providerId === providerId);
					if (seat) {
						onSelect(seat);
					}
				}}
			>
				<option value="">Choose a seat…</option>
				{seats.map((seat) => (
					<option key={seat.providerId} value={seat.providerId}>
						{seat.name}
					</option>
				))}
			</NativeSelect>
		</div>
	);
}
