import type { RuntimeGitlabMergeRequestListRequest, RuntimeGitlabMergeRequestSummary } from "@/runtime/types";

/**
 * Which pile of merge requests a Review surface is showing.
 *
 * Both the sidebar panel and the full-screen list offer the same three, so the
 * tab identity, its query and its grouping live here rather than being spelled
 * out twice with two different ideas of what "mine" means.
 *
 * - `requested` — someone asked *me* to review. GitLab's `reviewer_id`, which is
 *   a different field from `scope: "assigned_to_me"` (that one is the assignee).
 * - `mine` — merge requests I opened, split by whether I remembered to ask for a
 *   reviewer.
 * - `browse` — the unfiltered picker, for everything the first two exclude.
 */
export type ReviewInboxTab = "requested" | "mine" | "browse";

export const REVIEW_INBOX_TABS: ReadonlyArray<{ id: ReviewInboxTab; label: string }> = [
	{ id: "requested", label: "Review requests" },
	{ id: "mine", label: "My merge requests" },
	{ id: "browse", label: "Browse" },
];

export interface ReviewInboxQueryInput {
	tab: ReviewInboxTab;
	/** GitLab user id from the connection; null until the status call has answered. */
	userId: number | null;
	projectId?: number | null;
	state?: RuntimeGitlabMergeRequestListRequest["state"];
	/** Only consulted on `browse`; the other tabs imply their own scope. */
	scope?: RuntimeGitlabMergeRequestListRequest["scope"];
	limit: number;
}

/**
 * The list query for a tab, or null when it cannot be built yet.
 *
 * `requested` needs the signed-in user's id, and that arrives one round-trip
 * after the panel mounts. Returning null instead of falling back to an unscoped
 * query keeps the surface from flashing *everyone's* merge requests under a
 * "Review requests" heading.
 */
export function buildReviewInboxQuery(input: ReviewInboxQueryInput): RuntimeGitlabMergeRequestListRequest | null {
	const projectId = input.projectId ?? undefined;
	const base = {
		...(projectId !== undefined ? { projectId } : {}),
		state: input.state ?? "opened",
		limit: input.limit,
	} satisfies RuntimeGitlabMergeRequestListRequest;

	switch (input.tab) {
		case "requested":
			if (input.userId === null) {
				return null;
			}
			return { ...base, reviewerId: input.userId };
		case "mine":
			return { ...base, scope: "created_by_me" };
		case "browse":
			return { ...base, scope: input.scope ?? "created_by_me" };
	}
}

export interface MergeRequestReviewSplit {
	/** A reviewer was requested, so this is waiting on a human. */
	awaitingReview: RuntimeGitlabMergeRequestSummary[];
	/** Nobody was asked yet. */
	noReviewer: RuntimeGitlabMergeRequestSummary[];
}

/**
 * Splits my merge requests by whether a reviewer was ever requested.
 *
 * A merge request with no reviewer is usually not review work at all — it was
 * opened to read the diff against master or to make a pipeline run, and listing
 * it beside real review work is what buries the real work. They are separated
 * rather than dropped: forgetting to add a reviewer is a real mistake, and
 * hiding those outright would make it unfixable from this screen.
 */
export function splitByReviewerRequested(
	mergeRequests: readonly RuntimeGitlabMergeRequestSummary[],
): MergeRequestReviewSplit {
	const awaitingReview: RuntimeGitlabMergeRequestSummary[] = [];
	const noReviewer: RuntimeGitlabMergeRequestSummary[] = [];
	for (const mergeRequest of mergeRequests) {
		if (mergeRequest.reviewers.length > 0) {
			awaitingReview.push(mergeRequest);
		} else {
			noReviewer.push(mergeRequest);
		}
	}
	return { awaitingReview, noReviewer };
}

/** `@alice, @bob`, or null when nobody was asked — for a one-line list subtitle. */
export function describeReviewers(mergeRequest: RuntimeGitlabMergeRequestSummary): string | null {
	if (mergeRequest.reviewers.length === 0) {
		return null;
	}
	return mergeRequest.reviewers.map((username) => `@${username}`).join(", ");
}
