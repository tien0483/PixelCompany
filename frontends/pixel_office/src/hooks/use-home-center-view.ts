import { useCallback, useState } from "react";

/**
 * What occupies the home center pane.
 *
 * `"board"` is the three-pane default (`HomeTriplePane`); every other value replaces
 * it wholesale. Modelled as one enum rather than a boolean per view on purpose: the
 * views are mutually exclusive, and a boolean pile needs one reset call per *pair*,
 * so each new surface added quadratically more places to forget.
 */
export type HomeCenterView = "board" | "docs" | "git" | "learning" | "understand";

export interface UseHomeCenterViewOptions {
	hasNoProjects: boolean;
	/**
	 * The Office right column is a *column*, not a center view, so it lives in
	 * `useOfficeViewState`. Opening any non-board center view hides it, matching what
	 * the Docs toggle already did — the alternative is a column that silently
	 * reappears when the view is closed again.
	 */
	closeOffice: () => void;
}

export interface UseHomeCenterViewResult {
	centerView: HomeCenterView;
	isDocsOpen: boolean;
	isGitHistoryOpen: boolean;
	isLearningOpen: boolean;
	isUnderstandOpen: boolean;
	/** Opens `view`, or returns to the board when it is already the current one. */
	toggleView: (view: Exclude<HomeCenterView, "board">) => void;
	/** Back to the board whatever is open. Used on project switch and when Office opens. */
	resetToBoard: () => void;
	/** Closes git history only — leaves any other view alone. */
	closeGitHistory: () => void;
}

export function useHomeCenterView({
	hasNoProjects,
	closeOffice,
}: UseHomeCenterViewOptions): UseHomeCenterViewResult {
	const [centerView, setCenterView] = useState<HomeCenterView>("board");

	const toggleView = useCallback(
		(view: Exclude<HomeCenterView, "board">) => {
			if (hasNoProjects) {
				return;
			}
			closeOffice();
			setCenterView((current) => (current === view ? "board" : view));
		},
		[closeOffice, hasNoProjects],
	);

	const resetToBoard = useCallback(() => {
		setCenterView("board");
	}, []);

	const closeGitHistory = useCallback(() => {
		setCenterView((current) => (current === "git" ? "board" : current));
	}, []);

	return {
		centerView,
		isDocsOpen: centerView === "docs",
		isGitHistoryOpen: centerView === "git",
		isLearningOpen: centerView === "learning",
		isUnderstandOpen: centerView === "understand",
		toggleView,
		resetToBoard,
		closeGitHistory,
	};
}
