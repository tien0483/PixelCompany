import { useCallback, useEffect, useState } from "react";

const AUTO_STORAGE_VALUE = "auto";

/**
 * A surface's Claude seat choice: a Manager account id, an explicit `"auto"`, or
 * `undefined` for "never chosen".
 *
 * The three-way distinction is load-bearing. `undefined` lets the caller default a
 * fresh surface onto the Manager's active Claude seat — an *explicit* pin, so a run
 * never silently bills whichever seat jacked happened to swap to. `"auto"` is that
 * default declined, and it has to persist: storing "nothing" for an explicit Auto
 * choice would re-apply the default on the next reload.
 */
export type SeatChoice = number | typeof AUTO_STORAGE_VALUE | undefined;

/**
 * A seat choice remembered in localStorage under `storageKey`.
 *
 * Kept out of the surface's own server-side document on purpose: which seat a person
 * spends is a machine preference that should outlive the merge request or the plan
 * they happened to have open when they set it.
 */
export function useSeatChoice(storageKey: string): {
	seatChoice: SeatChoice;
	setSeatChoice: (choice: SeatChoice) => void;
} {
	const [seatChoice, setStoredChoice] = useState<SeatChoice>(undefined);

	useEffect(() => {
		try {
			const raw = window.localStorage.getItem(storageKey);
			if (raw === AUTO_STORAGE_VALUE) {
				setStoredChoice(AUTO_STORAGE_VALUE);
				return;
			}
			const parsed = raw === null ? Number.NaN : Number(raw);
			setStoredChoice(Number.isInteger(parsed) && parsed > 0 ? parsed : undefined);
		} catch {
			// Private-mode or a disabled store: fall back to the unchosen state, which
			// the caller resolves to the active seat.
			setStoredChoice(undefined);
		}
	}, [storageKey]);

	const setSeatChoice = useCallback(
		(choice: SeatChoice) => {
			setStoredChoice(choice);
			try {
				if (choice === undefined) {
					window.localStorage.removeItem(storageKey);
				} else {
					window.localStorage.setItem(storageKey, String(choice));
				}
			} catch {
				// The in-memory choice still applies to this session.
			}
		},
		[storageKey],
	);

	return { seatChoice, setSeatChoice };
}
