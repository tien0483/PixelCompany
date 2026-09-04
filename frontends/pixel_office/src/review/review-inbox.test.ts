import { describe, expect, it } from "vitest";

import {
	buildReviewInboxQuery,
	describeApprovalState,
	describeReviewers,
	describeReviewedState,
	filterMergeRequestsForTab,
	splitByReviewerRequested,
} from "@/review/review-inbox";
import type { RuntimeGitlabMergeRequestSummary, RuntimeReviewAllMark } from "@/runtime/types";

function mergeRequest(
	iid: number,
	reviewers: string[],
	approval: Partial<
		Pick<
			RuntimeGitlabMergeRequestSummary,
			"approvedByMe" | "approvedByCount" | "approvalsRequired" | "approvalsLeft"
		>
	> = {},
): RuntimeGitlabMergeRequestSummary {
	return {
		projectId: 1,
		iid,
		title: `MR ${iid}`,
		description: "",
		state: "opened",
		draft: false,
		authorUsername: "me",
		reviewers,
		sourceBranch: `feature/${iid}`,
		targetBranch: "master",
		webUrl: "",
		updatedAt: null,
		pipelineStatus: null,
		changesCount: null,
		userNotesCount: null,
		approvedByMe: null,
		approvedByCount: null,
		approvalsRequired: null,
		approvalsLeft: null,
		...approval,
	};
}

function withNotes(
	summary: RuntimeGitlabMergeRequestSummary,
	userNotesCount: number,
): RuntimeGitlabMergeRequestSummary {
	return { ...summary, userNotesCount };
}

describe("describeReviewedState", () => {
	const mark = (notesCount: number | null): RuntimeReviewAllMark => ({
		at: "2026-09-01T10:00:00.000Z",
		headSha: "abc",
		fileCount: 3,
		notesCount,
	});

	it("says nothing about a merge request whose files were never all reviewed", () => {
		expect(describeReviewedState(withNotes(mergeRequest(1, []), 4), null)).toBeNull();
	});

	it("reports a finished review while the note count has not moved", () => {
		expect(describeReviewedState(withNotes(mergeRequest(1, []), 4), mark(4))).toEqual({
			label: "✓ Reviewed",
			tone: "reviewed",
		});
	});

	it("downgrades to stale once a note has been added since", () => {
		expect(describeReviewedState(withNotes(mergeRequest(1, []), 5), mark(4))).toEqual({
			label: "✓ new comments",
			tone: "stale",
		});
	});

	it("stays green when either note count is unknown, rather than guessing stale", () => {
		expect(describeReviewedState(withNotes(mergeRequest(1, []), 9), mark(null))?.tone).toBe("reviewed");
		expect(describeReviewedState(mergeRequest(1, []), mark(0))?.tone).toBe("reviewed");
	});
});

describe("buildReviewInboxQuery", () => {
	it("filters the review-request inbox by reviewer id and leaves the scope to the client", () => {
		expect(buildReviewInboxQuery({ tab: "requested", userId: 7, limit: 20 })).toEqual({
			state: "opened",
			limit: 20,
			reviewerId: 7,
			withApprovals: true,
		});
	});

	it("returns null instead of an unscoped query while the user id is unknown", () => {
		expect(buildReviewInboxQuery({ tab: "requested", userId: null, limit: 20 })).toBeNull();
		expect(buildReviewInboxQuery({ tab: "approvedByMe", userId: null, limit: 20 })).toBeNull();
	});

	it("fetches the same reviewer inbox for `requested` and `approvedByMe`", () => {
		expect(buildReviewInboxQuery({ tab: "approvedByMe", userId: 7, limit: 20 })).toEqual(
			buildReviewInboxQuery({ tab: "requested", userId: 7, limit: 20 }),
		);
	});

	it("pins `mine` to created_by_me regardless of the browse scope", () => {
		expect(buildReviewInboxQuery({ tab: "mine", userId: 7, scope: "all", limit: 20 })).toEqual({
			state: "opened",
			limit: 20,
			scope: "created_by_me",
			withApprovals: true,
		});
	});

	it("carries the project and state filters into a browse query, without the per-row approval cost", () => {
		expect(
			buildReviewInboxQuery({ tab: "browse", userId: 7, projectId: 42, state: "merged", scope: "all", limit: 50 }),
		).toEqual({ projectId: 42, state: "merged", limit: 50, scope: "all" });
	});
});

describe("filterMergeRequestsForTab", () => {
	const page = [
		mergeRequest(1, ["me"], { approvedByMe: false, approvedByCount: 0 }),
		mergeRequest(2, ["me"], { approvedByMe: true, approvedByCount: 1 }),
		mergeRequest(3, ["me"], { approvedByMe: false, approvedByCount: 2 }),
		// Approval state was never looked up.
		mergeRequest(4, ["me"]),
	];

	it("moves what I approved out of the review-request queue", () => {
		expect(filterMergeRequestsForTab("requested", page).map((item) => item.iid)).toEqual([1, 3, 4]);
		expect(filterMergeRequestsForTab("approvedByMe", page).map((item) => item.iid)).toEqual([2]);
	});

	it("treats anyone's approval as approved for my own merge requests", () => {
		expect(filterMergeRequestsForTab("mineApproved", page).map((item) => item.iid)).toEqual([2, 3]);
	});

	it("leaves the unfiltered tabs alone", () => {
		expect(filterMergeRequestsForTab("mine", page)).toHaveLength(4);
		expect(filterMergeRequestsForTab("browse", page)).toHaveLength(4);
	});

	it("keeps unknown approval state in the queue rather than hiding it", () => {
		const unknown = [mergeRequest(9, ["me"])];
		expect(filterMergeRequestsForTab("requested", unknown)).toHaveLength(1);
		expect(filterMergeRequestsForTab("approvedByMe", unknown)).toHaveLength(0);
		expect(filterMergeRequestsForTab("mineApproved", unknown)).toHaveLength(0);
	});
});

describe("describeApprovalState", () => {
	it("names my own approval before anyone else's", () => {
		expect(describeApprovalState(mergeRequest(1, [], { approvedByMe: true, approvedByCount: 2 }))).toEqual({
			label: "Approved by you",
			tone: "approved",
		});
	});

	it("counts other approvals", () => {
		expect(describeApprovalState(mergeRequest(1, [], { approvedByMe: false, approvedByCount: 1 }))?.label).toBe(
			"Approved",
		);
		expect(describeApprovalState(mergeRequest(1, [], { approvedByMe: false, approvedByCount: 3 }))?.label).toBe(
			"Approved ×3",
		);
	});

	it("says nothing when approvals were not looked up", () => {
		expect(describeApprovalState(mergeRequest(1, []))).toBeNull();
	});

	it("stays silent on a project with no approval rules, and counts down on one that has them", () => {
		expect(
			describeApprovalState(mergeRequest(1, [], { approvedByMe: false, approvedByCount: 0, approvalsRequired: 0 })),
		).toBeNull();
		expect(
			describeApprovalState(
				mergeRequest(1, [], {
					approvedByMe: false,
					approvedByCount: 0,
					approvalsRequired: 2,
					approvalsLeft: 2,
				}),
			),
		).toEqual({ label: "2 to approve", tone: "pending" });
	});
});

describe("splitByReviewerRequested", () => {
	it("separates merge requests nobody was asked to review from real review work", () => {
		const split = splitByReviewerRequested([
			mergeRequest(1, ["dev_alex"]),
			mergeRequest(2, []),
			mergeRequest(3, ["dev_bo", "dev_cy"]),
		]);
		expect(split.awaitingReview.map((item) => item.iid)).toEqual([1, 3]);
		expect(split.noReviewer.map((item) => item.iid)).toEqual([2]);
	});
});

describe("describeReviewers", () => {
	it("renders the reviewer handles, or null when there are none", () => {
		expect(describeReviewers(mergeRequest(1, ["dev_alex", "dev_bo"]))).toBe("@dev_alex, @dev_bo");
		expect(describeReviewers(mergeRequest(2, []))).toBeNull();
	});
});
