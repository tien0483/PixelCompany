export type ReviewCommitExistingMode = "onto-branch" | "cherry-pick-from-task";

export type ReviewCommitResolvedPath =
	| {
			kind: "new-branch";
			officialBranch: string;
			promptTaskBranch: string;
			pushBranch: string;
			needsCherryPick: false;
	  }
	| {
			kind: "onto-existing";
			officialBranch: string;
			promptTaskBranch: string;
			pushBranch: string;
			needsCherryPick: false;
	  }
	| {
			kind: "cherry-pick";
			officialBranch: string;
			promptTaskBranch: string;
			pushBranch: string;
			needsCherryPick: true;
	  };

export function normalizeOfficialBranchName(value: string): string {
	return value.trim();
}

export function branchExistsInRefNames(officialBranch: string, refNames: readonly string[]): boolean {
	const normalized = normalizeOfficialBranchName(officialBranch);
	if (normalized.length === 0) {
		return false;
	}
	return refNames.some((name) => name === normalized);
}

export function resolveReviewCommitPath(input: {
	officialBranch: string;
	derivedTaskBranch: string;
	refNames: readonly string[];
	existingMode: ReviewCommitExistingMode | null;
}): ReviewCommitResolvedPath | { error: string } {
	const officialBranch = normalizeOfficialBranchName(input.officialBranch);
	if (officialBranch.length === 0) {
		return { error: "Branch name is required." };
	}

	const exists = branchExistsInRefNames(officialBranch, input.refNames);
	if (!exists) {
		return {
			kind: "new-branch",
			officialBranch,
			promptTaskBranch: officialBranch,
			pushBranch: officialBranch,
			needsCherryPick: false,
		};
	}

	if (input.existingMode === null) {
		return { error: "Choose how to use the existing branch." };
	}

	if (input.existingMode === "onto-branch") {
		return {
			kind: "onto-existing",
			officialBranch,
			promptTaskBranch: officialBranch,
			pushBranch: officialBranch,
			needsCherryPick: false,
		};
	}

	return {
		kind: "cherry-pick",
		officialBranch,
		promptTaskBranch: input.derivedTaskBranch,
		pushBranch: officialBranch,
		needsCherryPick: true,
	};
}
