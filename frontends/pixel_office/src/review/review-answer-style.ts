/**
 * Whether the chat compresses its answers.
 *
 * On by default. The panel's default persona says "answer at the length the question
 * deserves" and nothing about form, which in practice produced paragraphs of prose
 * that weighed both sides and narrated the assistant revising its own earlier draft —
 * with the verdict several paragraphs down. Terse moves the verdict to the first line
 * and drops the narration; it is a switch rather than a fixed rule because the long
 * form is the better one to hand to someone else.
 *
 * Local, like the model picker and the comment-polish switch beside it: it shapes how
 * this reviewer reads, not anything about the merge request.
 */
import { LocalStorageKey, readLocalStorageItem, writeLocalStorageItem } from "@/storage/local-storage-store";

export const DEFAULT_REVIEW_TERSE_ANSWERS = true;

export function readStoredTerseAnswers(): boolean {
	const stored = readLocalStorageItem(LocalStorageKey.ReviewTerseAnswers);
	// Only an explicit "0" turns it off, so an absent or corrupt value keeps the
	// default rather than silently reverting to the long form.
	return stored === null || stored === undefined ? DEFAULT_REVIEW_TERSE_ANSWERS : stored !== "0";
}

export function writeStoredTerseAnswers(enabled: boolean): void {
	writeLocalStorageItem(LocalStorageKey.ReviewTerseAnswers, enabled ? "1" : "0");
}
