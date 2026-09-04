import { Check, CheckCheck, GitPullRequest, RefreshCw } from "lucide-react";
import { type ReactElement, useCallback, useEffect, useMemo, useState } from "react";

import { showAppToast } from "@/components/app-toaster";
import { GitlabConnectForm } from "@/components/review/gitlab-connect-form";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Spinner } from "@/components/ui/spinner";
import {
	buildReviewInboxQuery,
	describeApprovalState,
	describeReviewedState,
	describeReviewers,
	indexReviewedMarks,
	type ReviewedMarks,
	reviewMarkKey,
	splitByReviewerRequested,
} from "@/review/review-inbox";
import type { ReviewTarget } from "@/review/review-target";
import { useGitlabConnect } from "@/review/use-gitlab-connect";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import type {
	RuntimeGitlabMergeRequestSummary,
	RuntimeReviewAllMark,
	RuntimeReviewSession,
} from "@/runtime/types";

/** Enough to see at a glance without turning the sidebar into a second full list. */
const SIDEBAR_LIST_LIMIT = 20;

/** The full-screen list's `browse` tab has no place in a sidebar this narrow. */
type SidebarReviewTab = "requested" | "mine";

export function HomeSidebarReviewTab({
	active,
	onSelect,
}: {
	active: boolean;
	onSelect: () => void;
}): ReactElement {
	return (
		<button
			type="button"
			data-testid="sidebar-review-tab"
			onClick={onSelect}
			className={cn(
				"cursor-pointer rounded-sm px-1.5 py-1 text-[11px] font-medium",
				active
					? "bg-surface-4 text-text-primary border border-border"
					: "text-text-secondary hover:text-text-primary border border-transparent",
			)}
		>
			Review
		</button>
	);
}

/**
 * Two inboxes plus any review with unpublished drafts.
 *
 * Drafts are listed first, above the subtabs, and read from local state rather
 * than GitLab: unfinished work should be findable when the network is down, it
 * belongs to neither inbox, and it is the thing most likely to be forgotten.
 *
 * Both inboxes are fetched on every refresh even though only one is rendered —
 * the counts on the subtab labels are the point. A merge request someone asked
 * you to review is invisible otherwise, which is what made this panel's old
 * single "your open merge requests" list misleading.
 */
export function HomeSidebarReviewPanel({
	workspaceId = null,
	projectKey,
	onOpenMergeRequest,
}: {
	workspaceId?: string | null;
	projectKey: string;
	onOpenMergeRequest: (target: ReviewTarget) => void;
}): ReactElement {
	const connect = useGitlabConnect(workspaceId);
	const { connection, isConnected } = connect;
	const [reviewRequests, setReviewRequests] = useState<RuntimeGitlabMergeRequestSummary[]>([]);
	const [myMergeRequests, setMyMergeRequests] = useState<RuntimeGitlabMergeRequestSummary[]>([]);
	const [draftSessions, setDraftSessions] = useState<RuntimeReviewSession[]>([]);
	const [reviewedMarks, setReviewedMarks] = useState<ReviewedMarks>(() => new Map());
	const [tab, setTab] = useState<SidebarReviewTab>("requested");
	const [isLoading, setIsLoading] = useState(true);

	const host = connection?.host ?? "";
	const userId = connection?.userId ?? null;

	const refresh = useCallback(async () => {
		setIsLoading(true);
		try {
			if (!isConnected || host.length === 0) {
				setReviewRequests([]);
				setMyMergeRequests([]);
				setDraftSessions([]);
				setReviewedMarks(new Map());
				return;
			}
			const client = getRuntimeTrpcClient(workspaceId);
			const requestedQuery = buildReviewInboxQuery({ tab: "requested", userId, limit: SIDEBAR_LIST_LIMIT });
			const mineQuery = buildReviewInboxQuery({ tab: "mine", userId, limit: SIDEBAR_LIST_LIMIT });
			const [requested, mine, sessions, marks] = await Promise.all([
				// Null only when the connection has not reported a user id, which cannot
				// happen behind `isConnected` — but the inbox stays empty rather than
				// silently widening to everyone's merge requests if it ever does.
				requestedQuery ? client.gitlab.listMergeRequests.query(requestedQuery) : null,
				mineQuery ? client.gitlab.listMergeRequests.query(mineQuery) : null,
				client.review.listSessionsWithDrafts.query({ host }),
				// Local review progress, caught on its own: a missing reviewed check is a
				// cosmetic loss, and the shared catch below would blank all three lists and
				// raise a toast for it.
				client.review.listSessionMarks.query({ host }).catch(() => null),
			]);
			setReviewRequests(requested?.ok ? requested.mergeRequests : []);
			setMyMergeRequests(mine?.ok ? mine.mergeRequests : []);
			setDraftSessions(sessions);
			setReviewedMarks(marks?.ok ? indexReviewedMarks(marks.marks) : new Map());
			const failure = [requested, mine].find((response) => response && !response.ok);
			if (failure?.error) {
				showAppToast({ intent: "danger", message: failure.error });
			}
		} catch (error) {
			showAppToast({ intent: "danger", message: error instanceof Error ? error.message : String(error) });
		} finally {
			setIsLoading(false);
		}
	}, [host, isConnected, userId, workspaceId]);

	// Re-runs whenever the connection changes, which is what makes a fresh token
	// populate the list without a manual Refresh.
	useEffect(() => {
		void refresh();
	}, [refresh]);

	const split = useMemo(() => splitByReviewerRequested(myMergeRequests), [myMergeRequests]);

	const openSummary = useCallback(
		(mergeRequest: RuntimeGitlabMergeRequestSummary) => {
			onOpenMergeRequest({
				host,
				projectId: mergeRequest.projectId,
				iid: mergeRequest.iid,
				title: mergeRequest.title,
				projectKey,
			});
		},
		[host, onOpenMergeRequest, projectKey],
	);

	// A null connection means the status call has not answered yet. Rendering the
	// connect form in that window flashes "not connected" at someone who is.
	const isPending = isLoading || connection === null;
	const isEmpty = reviewRequests.length === 0 && myMergeRequests.length === 0 && draftSessions.length === 0;

	return (
		<div className="flex min-h-0 flex-1 flex-col overflow-hidden" data-testid="sidebar-review-panel">
			<div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-1">
				{isPending ? (
					<div className="flex items-center justify-center py-6">
						<Spinner size={16} />
					</div>
				) : null}

				{!isPending && !isConnected ? (
					<div className="py-3">
						<GitlabConnectForm controller={connect} size="sm" />
					</div>
				) : null}

				{draftSessions.length > 0 ? (
					<div className="mb-2">
						<SidebarSectionLabel label="Unpublished drafts" />
						{draftSessions.map((session) => (
							<button
								key={`${session.projectId}-${session.iid}`}
								type="button"
								className="flex w-full cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-text-secondary hover:bg-surface-3 hover:text-text-primary"
								onClick={() =>
									onOpenMergeRequest({
										host: session.host,
										projectId: session.projectId,
										iid: session.iid,
										title: `!${session.iid}`,
										projectKey,
									})
								}
							>
								<GitPullRequest size={13} className="shrink-0 text-status-orange" />
								<span className="min-w-0 flex-1">
									<span className="block truncate text-sm">!{session.iid}</span>
									<span className="block text-[10px] text-text-tertiary">
										{session.draftComments.length} draft
										{session.draftComments.length === 1 ? "" : "s"}
									</span>
								</span>
							</button>
						))}
					</div>
				) : null}

				{!isPending && isConnected ? (
					<>
						<div className="mb-1 flex items-center gap-1 border-b border-border">
							<SidebarSubTab
								label="Requests"
								count={reviewRequests.length}
								active={tab === "requested"}
								testId="sidebar-review-subtab-requested"
								onSelect={() => setTab("requested")}
							/>
							<SidebarSubTab
								label="Mine"
								count={myMergeRequests.length}
								active={tab === "mine"}
								testId="sidebar-review-subtab-mine"
								onSelect={() => setTab("mine")}
							/>
						</div>

						{tab === "requested" ? (
							reviewRequests.length > 0 ? (
								reviewRequests.map((mergeRequest) => (
									<SidebarMergeRequestRow
										key={reviewMarkKey(mergeRequest.projectId, mergeRequest.iid)}
										mergeRequest={mergeRequest}
										subtitle={
											mergeRequest.authorUsername
												? `!${mergeRequest.iid} · @${mergeRequest.authorUsername}`
												: `!${mergeRequest.iid}`
										}
										reviewedMark={reviewedMarks.get(reviewMarkKey(mergeRequest.projectId, mergeRequest.iid)) ?? null}
										onOpen={openSummary}
									/>
								))
							) : (
								<p className="px-1 py-3 text-[12px] text-text-tertiary">
									Nobody has requested your review.
								</p>
							)
						) : (
							<>
								<SidebarMergeRequestGroup
									label={`Reviewer requested (${split.awaitingReview.length})`}
									mergeRequests={split.awaitingReview}
									reviewedMarks={reviewedMarks}
									onOpen={openSummary}
								/>
								{/* Labelled by what these usually are: merge requests opened to read
								    a diff against master or to run a pipeline, never sent to anyone. */}
								<SidebarMergeRequestGroup
									label={`No reviewer · diff or pipeline (${split.noReviewer.length})`}
									mergeRequests={split.noReviewer}
									reviewedMarks={reviewedMarks}
									onOpen={openSummary}
								/>
								{myMergeRequests.length === 0 ? (
									<p className="px-1 py-3 text-[12px] text-text-tertiary">
										You have no open merge requests.
									</p>
								) : null}
							</>
						)}
					</>
				) : null}

				{!isPending && isConnected && isEmpty ? (
					<p className="px-1 py-3 text-[12px] text-text-tertiary">
						Open the Review tab to browse everyone's merge requests.
					</p>
				) : null}
			</div>

			{isConnected && connection ? (
				<div className="flex items-center justify-between gap-2 px-3 pb-3 pt-1">
					<span className="truncate text-[10px] text-text-tertiary">{connection.username}</span>
					<Button
						variant="default"
						size="sm"
						icon={isLoading ? <Spinner size={12} /> : <RefreshCw size={12} />}
						disabled={isLoading}
						onClick={() => void refresh()}
					>
						Refresh
					</Button>
				</div>
			) : null}
		</div>
	);
}

function SidebarSectionLabel({ label }: { label: string }): ReactElement {
	return (
		<div className="px-1 py-1 text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">{label}</div>
	);
}

function SidebarSubTab({
	label,
	count,
	active,
	testId,
	onSelect,
}: {
	label: string;
	count: number;
	active: boolean;
	testId: string;
	onSelect: () => void;
}): ReactElement {
	return (
		<button
			type="button"
			data-testid={testId}
			aria-pressed={active}
			onClick={onSelect}
			className={cn(
				"cursor-pointer border-b-2 px-2 pb-1 pt-0.5 text-[11px] font-medium",
				active
					? "border-accent text-text-primary"
					: "border-transparent text-text-secondary hover:text-text-primary",
			)}
		>
			{label}
			<span className="ml-1 text-text-tertiary">{count}</span>
		</button>
	);
}

function SidebarMergeRequestGroup({
	label,
	mergeRequests,
	reviewedMarks,
	onOpen,
}: {
	label: string;
	mergeRequests: RuntimeGitlabMergeRequestSummary[];
	reviewedMarks: ReviewedMarks;
	onOpen: (mergeRequest: RuntimeGitlabMergeRequestSummary) => void;
}): ReactElement | null {
	if (mergeRequests.length === 0) {
		return null;
	}
	return (
		<div className="mb-2">
			<SidebarSectionLabel label={label} />
			{mergeRequests.map((mergeRequest) => (
				<SidebarMergeRequestRow
					key={reviewMarkKey(mergeRequest.projectId, mergeRequest.iid)}
					mergeRequest={mergeRequest}
					subtitle={`!${mergeRequest.iid} · ${mergeRequest.sourceBranch} → ${mergeRequest.targetBranch}${
						describeReviewers(mergeRequest) ? ` · ${describeReviewers(mergeRequest)}` : ""
					}`}
					reviewedMark={reviewedMarks.get(reviewMarkKey(mergeRequest.projectId, mergeRequest.iid)) ?? null}
					onOpen={onOpen}
				/>
			))}
		</div>
	);
}

function SidebarMergeRequestRow({
	mergeRequest,
	subtitle,
	reviewedMark,
	onOpen,
}: {
	mergeRequest: RuntimeGitlabMergeRequestSummary;
	subtitle: string;
	reviewedMark: RuntimeReviewAllMark | null;
	onOpen: (mergeRequest: RuntimeGitlabMergeRequestSummary) => void;
}): ReactElement {
	const approval = describeApprovalState(mergeRequest);
	const reviewed = describeReviewedState(mergeRequest, reviewedMark);
	return (
		<button
			type="button"
			className="flex w-full cursor-pointer items-start gap-1.5 rounded-md px-2 py-1.5 text-left text-text-secondary hover:bg-surface-3 hover:text-text-primary"
			onClick={() => onOpen(mergeRequest)}
		>
			<GitPullRequest size={13} className="mt-0.5 shrink-0" />
			<span className="min-w-0 flex-1">
				<span className="block truncate text-sm">{mergeRequest.title}</span>
				<span className="block truncate text-[10px] text-text-tertiary">{subtitle}</span>
			</span>
			{/* Two different facts, so two different glyphs: the double check is *my* local
			    mark ("I finished reading this one"), the single one below is GitLab's
			    approval. A row can legitimately carry both. */}
			{reviewed ? (
				<span
					data-testid="sidebar-review-reviewed-check"
					aria-label={reviewed.label}
					title={
						reviewed.tone === "stale"
							? "You marked this merge request reviewed, but comments have been added since."
							: `You marked this merge request reviewed on ${new Date(reviewedMark?.at ?? "").toLocaleString()}.`
					}
					className={cn("mt-0.5 shrink-0", reviewed.tone === "reviewed" ? "text-status-green" : "text-status-orange")}
				>
					<CheckCheck size={12} />
				</span>
			) : null}
			{/* Approved rows stay in the list rather than moving to a subtab this narrow
			    can't fit — the marker is what stops a signed-off review from reading as
			    still-waiting work. */}
			{approval?.tone === "approved" ? (
				<Check size={12} className="mt-0.5 shrink-0 text-status-green" aria-label={approval.label} />
			) : null}
		</button>
	);
}
