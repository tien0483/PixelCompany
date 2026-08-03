import { describe, expect, it } from "vitest";

import {
	branchExistsInRefNames,
	normalizeOfficialBranchName,
	resolveReviewCommitPath,
} from "@/git-actions/review-commit-branch";

describe("normalizeOfficialBranchName", () => {
	it("trims whitespace", () => {
		expect(normalizeOfficialBranchName("  feature/x  ")).toBe("feature/x");
	});

	it("returns empty for blank input", () => {
		expect(normalizeOfficialBranchName("   ")).toBe("");
	});
});

describe("branchExistsInRefNames", () => {
	it("matches exact short names", () => {
		expect(branchExistsInRefNames("main", ["main", "develop"])).toBe(true);
		expect(branchExistsInRefNames("feat", ["main"])).toBe(false);
	});
});

describe("resolveReviewCommitPath", () => {
	const derived = "kanban/task-1";

	it("rejects empty official branch", () => {
		expect(
			resolveReviewCommitPath({
				officialBranch: "  ",
				derivedTaskBranch: derived,
				refNames: ["main"],
				existingMode: null,
			}),
		).toEqual({ error: "Branch name is required." });
	});

	it("uses new-branch path when name is unknown", () => {
		expect(
			resolveReviewCommitPath({
				officialBranch: "feature/new",
				derivedTaskBranch: derived,
				refNames: ["main"],
				existingMode: null,
			}),
		).toEqual({
			kind: "new-branch",
			officialBranch: "feature/new",
			promptTaskBranch: "feature/new",
			pushBranch: "feature/new",
			needsCherryPick: false,
		});
	});

	it("requires existingMode when branch exists", () => {
		expect(
			resolveReviewCommitPath({
				officialBranch: "main",
				derivedTaskBranch: derived,
				refNames: ["main"],
				existingMode: null,
			}),
		).toEqual({ error: "Choose how to use the existing branch." });
	});

	it("resolves onto-existing", () => {
		expect(
			resolveReviewCommitPath({
				officialBranch: "main",
				derivedTaskBranch: derived,
				refNames: ["main"],
				existingMode: "onto-branch",
			}),
		).toEqual({
			kind: "onto-existing",
			officialBranch: "main",
			promptTaskBranch: "main",
			pushBranch: "main",
			needsCherryPick: false,
		});
	});

	it("resolves cherry-pick from task branch", () => {
		expect(
			resolveReviewCommitPath({
				officialBranch: "main",
				derivedTaskBranch: derived,
				refNames: ["main"],
				existingMode: "cherry-pick-from-task",
			}),
		).toEqual({
			kind: "cherry-pick",
			officialBranch: "main",
			promptTaskBranch: derived,
			pushBranch: "main",
			needsCherryPick: true,
		});
	});
});
