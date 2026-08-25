import type { ReviewNavDirection } from "@/review/review-target";

/**
 * Keyboard file navigation for the review workspace.
 *
 * Moving between files used to be inferred from the scroll position — a dwell at the
 * bottom, or a wheel push past either edge — which fired during ordinary reading and
 * made a short diff (a container that is at its top and its bottom at once) jump away
 * on the first flick. Navigation is explicit now: these keys, or the header buttons.
 *
 * Kept DOM-free so the mapping is testable without a keyboard event.
 */

/** Whether the event came from somewhere the keys are literal text, not a command. */
export function isTypingTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) {
		return false;
	}
	if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
		return true;
	}
	// `isContentEditable` is the browser's own answer and covers descendants of an editable
	// host, but jsdom leaves it undefined — hence the attribute walk beside it, which is what
	// the rich comment editor's ProseMirror host carries anyway.
	return (
		target.isContentEditable === true ||
		target.closest("[contenteditable]:not([contenteditable='false'])") !== null
	);
}

/**
 * The direction a keystroke asks for, or null when it asks for nothing.
 *
 * `]`/`[` are the bracket pair GitLab uses. `J`/`K` are the capitals, so they only
 * arrive with Shift held and plain `j`/`k` stay free for anything else. A held
 * Ctrl/Meta/Alt means the keystroke belongs to the browser or the OS.
 */
export function resolveNavKey(input: {
	key: string;
	ctrlKey: boolean;
	metaKey: boolean;
	altKey: boolean;
	isTypingTarget: boolean;
}): ReviewNavDirection | null {
	if (input.isTypingTarget || input.ctrlKey || input.metaKey || input.altKey) {
		return null;
	}
	if (input.key === "]" || input.key === "J") {
		return "next";
	}
	if (input.key === "[" || input.key === "K") {
		return "previous";
	}
	return null;
}
