import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY_PREFIX = "pixeloffice.review.seat.";

/**
 * The Claude seat the review agents bill, remembered per GitLab host.
 *
 * Kept in localStorage rather than in the review session: the session is per merge
 * request and lives on the runtime, while a reviewer's seat choice is a machine
 * preference that should survive opening the next MR. `undefined` means Auto —
 * exactly what the routes already do when no account is named, so the default
 * changes nothing about how a review runs today.
 */
export function useReviewSeat(host: string): {
	managerAccountId: number | undefined;
	setManagerAccountId: (accountId: number | undefined) => void;
} {
	const storageKey = `${STORAGE_KEY_PREFIX}${host}`;
	const [managerAccountId, setStoredAccountId] = useState<number | undefined>(undefined);

	useEffect(() => {
		try {
			const raw = window.localStorage.getItem(storageKey);
			const parsed = raw === null ? Number.NaN : Number(raw);
			setStoredAccountId(Number.isInteger(parsed) && parsed > 0 ? parsed : undefined);
		} catch {
			// Private-mode or a disabled store: Auto is a working default, not an error.
			setStoredAccountId(undefined);
		}
	}, [storageKey]);

	const setManagerAccountId = useCallback(
		(accountId: number | undefined) => {
			setStoredAccountId(accountId);
			try {
				if (accountId === undefined) {
					window.localStorage.removeItem(storageKey);
				} else {
					window.localStorage.setItem(storageKey, String(accountId));
				}
			} catch {
				// The in-memory choice still applies to this session.
			}
		},
		[storageKey],
	);

	return { managerAccountId, setManagerAccountId };
}
