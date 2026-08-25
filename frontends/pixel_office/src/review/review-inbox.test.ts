import { describe, expect, it } from "vitest";

import { buildReviewInboxQuery, describeReviewers, splitByReviewerRequested } from "@/review/review-inbox";
import type { RuntimeGitlabMergeRequestSummary } from "@/runtime/types";

function mergeRequest(iid: number, reviewers: string[]): RuntimeGitlabMergeRequestSummary {
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
	};
}

describe("buildReviewInboxQuery", () => {
	it("filters the review-request inbox by reviewer id and leaves the scope to the client", () => {
		expect(buildReviewInboxQuery({ tab: "requested", userId: 7, limit: 20 })).toEqual({
			state: "opened",
			limit: 20,
			reviewerId: 7,
		});
	});

	it("returns null instead of an unscoped query while the user id is unknown", () => {
		expect(buildReviewInboxQuery({ tab: "requested", userId: null, limit: 20 })).toBeNull();
	});

	it("pins `mine` to created_by_me regardless of the browse scope", () => {
		expect(buildReviewInboxQuery({ tab: "mine", userId: 7, scope: "all", limit: 20 })).toEqual({
			state: "opened",
			limit: 20,
			scope: "created_by_me",
		});
	});

	it("carries the project and state filters into a browse query", () => {
		expect(
			buildReviewInboxQuery({ tab: "browse", userId: 7, projectId: 42, state: "merged", scope: "all", limit: 50 }),
		).toEqual({ projectId: 42, state: "merged", limit: 50, scope: "all" });
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
