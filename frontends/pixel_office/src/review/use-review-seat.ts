import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY_PREFIX = "pixeloffice.review.seat.";
const AUTO_STORAGE_VALUE = "auto";

/**
 * The reviewer's seat choice: a Manager account id, an explicit `"auto"`, or
 * `undefined` for "never chosen".
 *
 * The three-way distinction is load-bearing. `undefined` lets the caller default a
 * fresh reviewer onto the Manager's active Claude seat — an explicit pin, so a
 * review pass never silently bills whichever seat jacked happened to swap to.
 * `"auto"` is that default declined, and it has to persist: storing "nothing" for
 * an explicit Auto choice would re-apply the default on the next reload.
 */
export type ReviewSeatChoice = number | typeof AUTO_STORAGE_VALUE | undefined;

/**
 * The Claude seat the review agents bill, remembered per GitLab host.
 *
 * Kept in localStorage rather than in the review session: the session is per merge
 * request and lives on the runtime, while a reviewer's seat choice is a machine
 * preference that should survive opening the next MR.
 */
export function useReviewSeat(host: string): {
	seatChoice: ReviewSeatChoice;
	setSeatChoice: (choice: ReviewSeatChoice) => void;
} {
	const storageKey = `${STORAGE_KEY_PREFIX}${host}`;
	const [seatChoice, setStoredChoice] = useState<ReviewSeatChoice>(undefined);

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
		(choice: ReviewSeatChoice) => {
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
