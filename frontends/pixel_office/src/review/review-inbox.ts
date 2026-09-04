import type {
	RuntimeGitlabMergeRequestListRequest,
	RuntimeGitlabMergeRequestSummary,
	RuntimeReviewAllMark,
	RuntimeReviewSessionMark,
} from "@/runtime/types";

/**
 * Which pile of merge requests a Review surface is showing.
 *
 * Both the sidebar panel and the full-screen list share this list, so the tab
 * identity, its query and its grouping live here rather than being spelled out
 * twice with two different ideas of what "mine" means.
 *
 * - `requested` — someone asked *me* to review and I have not approved yet.
 *   GitLab's `reviewer_id`, which is a different field from
 *   `scope: "assigned_to_me"` (that one is the assignee).
 * - `approvedByMe` — the same inbox after I signed off. Split out because
 *   GitLab leaves an approved merge request sitting in the reviewer inbox
 *   looking exactly like an untouched one, which is how you end up re-reviewing
 *   your own approval.
 * - `mine` — merge requests I opened, split by whether I remembered to ask for a
 *   reviewer.
 * - `mineApproved` — mine, after a reviewer approved: the merge queue.
 * - `browse` — the unfiltered picker, for everything the others exclude.
 */
export type ReviewInboxTab = "requested" | "approvedByMe" | "mine" | "mineApproved" | "browse";

export const REVIEW_INBOX_TABS: ReadonlyArray<{ id: ReviewInboxTab; label: string }> = [
	{ id: "requested", label: "Review requests" },
	{ id: "approvedByMe", label: "Approved by me" },
	{ id: "mine", label: "My merge requests" },
	{ id: "mineApproved", label: "Mine · approved" },
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
		case "approvedByMe":
			if (input.userId === null) {
				return null;
			}
			// Both tabs fetch the same reviewer inbox and are told apart client-side by
			// `filterMergeRequestsForTab`: GitLab's server-side `approved_by_ids` filter
			// is Premium-only, so splitting the pile here would break on a Free instance.
			return { ...base, reviewerId: input.userId, withApprovals: true };
		case "mine":
		case "mineApproved":
			return { ...base, scope: "created_by_me", withApprovals: true };
		case "browse":
			// No approvals: browse can span every project the user is a member of, and
			// approval state costs one request per row.
			return { ...base, scope: input.scope ?? "created_by_me" };
	}
}

/**
 * Narrows a fetched page to the rows the tab is actually about.
 *
 * The approval tabs cannot be expressed as a GitLab query on a Free instance, so
 * the split happens on the rows the query did return. Consequence worth knowing:
 * these tabs only see as far as one page — a merge request approved 80 entries
 * deep is not in the page, so it is not in the tab either.
 *
 * Unknown approval state (null — the lookup was skipped or the call failed) keeps
 * a row in `requested` and out of the approved tabs. Erring that way shows a
 * review one extra time; the other direction hides it entirely.
 */
export function filterMergeRequestsForTab(
	tab: ReviewInboxTab,
	mergeRequests: readonly RuntimeGitlabMergeRequestSummary[],
): RuntimeGitlabMergeRequestSummary[] {
	switch (tab) {
		case "requested":
			return mergeRequests.filter((mergeRequest) => mergeRequest.approvedByMe !== true);
		case "approvedByMe":
			return mergeRequests.filter((mergeRequest) => mergeRequest.approvedByMe === true);
		case "mineApproved":
			return mergeRequests.filter((mergeRequest) => hasAnyApproval(mergeRequest));
		case "mine":
		case "browse":
			return [...mergeRequests];
	}
}

/**
 * Did anyone approve this?
 *
 * Deliberately counts approvers rather than trusting `approvalsLeft === 0`: an
 * instance with no approval rules configured reports zero approvals left for
 * every merge request, including ones nobody has opened.
 */
export function hasAnyApproval(mergeRequest: RuntimeGitlabMergeRequestSummary): boolean {
	return (mergeRequest.approvedByCount ?? 0) > 0;
}

/** Short badge text for a list row, or null when approval state is unknown. */
export function describeApprovalState(mergeRequest: RuntimeGitlabMergeRequestSummary): {
	label: string;
	tone: "approved" | "pending";
} | null {
	if (mergeRequest.approvedByMe === true) {
		return { label: "Approved by you", tone: "approved" };
	}
	if (mergeRequest.approvedByCount === null) {
		return null;
	}
	if (mergeRequest.approvedByCount > 0) {
		return {
			label: mergeRequest.approvedByCount === 1 ? "Approved" : `Approved ×${mergeRequest.approvedByCount}`,
			tone: "approved",
		};
	}
	// Only worth saying when the project actually gates on approvals; otherwise
	// "0 approvals" is the normal state of every merge request ever opened.
	if ((mergeRequest.approvalsRequired ?? 0) > 0) {
		return { label: `${mergeRequest.approvalsLeft ?? mergeRequest.approvalsRequired} to approve`, tone: "pending" };
	}
	return null;
}

/** Review sessions are stored per merge request, so both ids are needed to match a row. */
export type ReviewedMarks = Map<string, RuntimeReviewAllMark>;

/** The key both list surfaces use to find a row's session — one definition, so they agree. */
export function reviewMarkKey(projectId: number, iid: number): string {
	return `${projectId}-${iid}`;
}

/**
 * Session projections from `review.listSessionMarks`, indexed for a list row.
 *
 * Rows without an MR-level mark are dropped rather than stored as null, so a lookup
 * miss and an unmarked merge request are the same thing to every caller.
 */
export function indexReviewedMarks(marks: readonly RuntimeReviewSessionMark[]): ReviewedMarks {
	const indexed: ReviewedMarks = new Map();
	for (const mark of marks) {
		if (mark.reviewedAllMark !== null) {
			indexed.set(reviewMarkKey(mark.projectId, mark.iid), mark.reviewedAllMark);
		}
	}
	return indexed;
}

/**
 * Whether the reviewer already finished this merge request, for a list row.
 *
 * The mark is only stamped once every changed file was ticked, so its presence is
 * the "you already did this one" signal the list previously could not give — and
 * comparing the note count it captured against the summary's current one is what
 * downgrades that to "…but someone has commented since".
 *
 * Deliberately not keyed on `updatedAt`: a label, milestone or assignee edit bumps
 * it, so that would paint healthy rows stale. New *commits* are caught inside the
 * review by the delta banner, which is the only place the head SHA is known — a
 * list summary carries none.
 */
export function describeReviewedState(
	mergeRequest: RuntimeGitlabMergeRequestSummary,
	mark: RuntimeReviewAllMark | null,
): { label: string; tone: "reviewed" | "stale" } | null {
	if (mark === null) {
		return null;
	}
	// A null count on either side means "cannot tell", and a badge that guesses stale
	// is worse than one that stays quiet.
	if (
		mark.notesCount !== null &&
		mergeRequest.userNotesCount !== null &&
		mergeRequest.userNotesCount > mark.notesCount
	) {
		return { label: "✓ new comments", tone: "stale" };
	}
	return { label: "✓ Reviewed", tone: "reviewed" };
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
