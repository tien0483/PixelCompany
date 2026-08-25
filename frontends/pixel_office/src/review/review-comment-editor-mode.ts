/**
 * Whether the review comment composer opens rich or plain.
 *
 * Persisted rather than per-composer state: a reviewer who prefers writing raw
 * markdown would otherwise have to click "Switch to plain text editing" once per
 * note, and a review pass is dozens of notes.
 */
import { LocalStorageKey, readLocalStorageItem, writeLocalStorageItem } from "@/storage/local-storage-store";

export type ReviewCommentEditorMode = "rich" | "plain";

export const DEFAULT_REVIEW_COMMENT_EDITOR_MODE: ReviewCommentEditorMode = "rich";

export function normalizeReviewCommentEditorMode(
	value: string | null | undefined,
): ReviewCommentEditorMode {
	return value?.trim() === "plain" ? "plain" : DEFAULT_REVIEW_COMMENT_EDITOR_MODE;
}

export function readStoredReviewCommentEditorMode(): ReviewCommentEditorMode {
	return normalizeReviewCommentEditorMode(readLocalStorageItem(LocalStorageKey.ReviewCommentEditorMode));
}

export function writeStoredReviewCommentEditorMode(mode: ReviewCommentEditorMode): void {
	writeLocalStorageItem(LocalStorageKey.ReviewCommentEditorMode, mode);
}
