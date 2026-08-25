/**
 * Whether a requested change is rewritten into review-comment wording before it
 * becomes a draft.
 *
 * On by default: what the assistant says in conversation ("this could overflow if
 * count is negative") reads oddly as a note on a line, and the rewrite is what turns
 * it into one. It costs an extra turn, though, so a reviewer working through a long
 * merge request can switch it off and get the raw text — the same reason the model
 * picker exists next to it.
 */
import { LocalStorageKey, readLocalStorageItem, writeLocalStorageItem } from "@/storage/local-storage-store";

export const DEFAULT_REVIEW_POLISH_COMMENTS = true;

export function readStoredPolishComments(): boolean {
	const stored = readLocalStorageItem(LocalStorageKey.ReviewPolishComments);
	// Only an explicit "0" turns it off, so an absent or corrupt value keeps the
	// default rather than silently disabling the rewrite.
	return stored === null || stored === undefined ? DEFAULT_REVIEW_POLISH_COMMENTS : stored !== "0";
}

export function writeStoredPolishComments(enabled: boolean): void {
	writeLocalStorageItem(LocalStorageKey.ReviewPolishComments, enabled ? "1" : "0");
}
