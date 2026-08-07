import { useCallback, useEffect, useState } from "react";

import { fetchClineApiSeats } from "@/runtime/runtime-config-query";
import type { RuntimeClineApiSeat } from "@/runtime/types";

export interface UseClineApiSeatsResult {
	seats: RuntimeClineApiSeat[];
	refresh: () => Promise<void>;
}

/**
 * API-key seats available to the board.
 *
 * These live in the Cline provider store rather than Manager's account table, so
 * they are fetched separately from the Manager snapshot and merged at the UI
 * layer — see TaskAccountPicker and ManagerAccountsView.
 */
export function useClineApiSeats(workspaceId: string | null, active = true): UseClineApiSeatsResult {
	const [seats, setSeats] = useState<RuntimeClineApiSeat[]>([]);

	const refresh = useCallback(async () => {
		try {
			setSeats(await fetchClineApiSeats(workspaceId));
		} catch {
			setSeats([]);
		}
	}, [workspaceId]);

	useEffect(() => {
		if (!active) {
			return;
		}
		let cancelled = false;
		void fetchClineApiSeats(workspaceId)
			.then((next) => {
				if (!cancelled) {
					setSeats(next);
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

	return { seats, refresh };
}
