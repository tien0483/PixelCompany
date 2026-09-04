import { GitPullRequest, RefreshCw, Search } from "lucide-react";
import { type ReactElement, useCallback, useEffect, useMemo, useState } from "react";

import { GitlabConnectForm } from "@/components/review/gitlab-connect-form";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Spinner } from "@/components/ui/spinner";
import {
	buildReviewInboxQuery,
	describeApprovalState,
	describeReviewers,
	describeReviewedState,
	filterMergeRequestsForTab,
	REVIEW_INBOX_TABS,
	type ReviewInboxTab,
	splitByReviewerRequested,
} from "@/review/review-inbox";
import type { ReviewTarget } from "@/review/review-target";
import { useGitlabConnect } from "@/review/use-gitlab-connect";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import type {
	RuntimeGitlabMergeRequestSummary,
	RuntimeGitlabProject,
	RuntimeReviewAllMark,
} from "@/runtime/types";

/** Review sessions are stored per merge request, so both ids are needed to match a row. */
type ReviewedMarks = Map<string, RuntimeReviewAllMark>;

function markKey(projectId: number, iid: number): string {
	return `${projectId}-${iid}`;
}

type ScopeFilter = "created_by_me" | "assigned_to_me" | "all";
type StateFilter = "opened" | "merged" | "all";

const PIPELINE_TONE: Record<string, string> = {
	success: "bg-status-green/20 text-status-green",
	failed: "bg-status-red/20 text-status-red",
	running: "bg-status-blue/20 text-status-blue",
	pending: "bg-status-orange/20 text-status-orange",
	canceled: "bg-surface-4 text-text-secondary",
};

/**
 * Project + merge-request picker. Also the standalone package's entry screen, so it
 * owns the GitLab connection prompt rather than assuming a connected account.
 */
export function ReviewMergeRequestListScreen({
	workspaceId,
	projectKey,
	onOpenMergeRequest,
}: {
	workspaceId: string | null;
	/** Rules bundle key carried onto the target so the reviewer gets the right rules. */
	projectKey: string;
	onOpenMergeRequest: (target: ReviewTarget) => void;
}): ReactElement {
	// Connection state — including both connect paths — lives in the hook so this
	// screen and the sidebar panel cannot drift apart on what "connected" means.
	const connect = useGitlabConnect(workspaceId);
	const { connection, isConnected, error, setError } = connect;
	const [projects, setProjects] = useState<RuntimeGitlabProject[]>([]);
	const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
	const [mergeRequests, setMergeRequests] = useState<RuntimeGitlabMergeRequestSummary[]>([]);
	const [tab, setTab] = useState<ReviewInboxTab>("requested");
	const [scope, setScope] = useState<ScopeFilter>("all");
	const [stateFilter, setStateFilter] = useState<StateFilter>("opened");
	const [search, setSearch] = useState("");
	const [isLoading, setIsLoading] = useState(false);
	const [reviewedMarks, setReviewedMarks] = useState<ReviewedMarks>(() => new Map());

	const userId = connection?.userId ?? null;
	const host = connection?.host ?? null;

	// Local review progress for every session on this instance, in one call. Fetched
	// separately from the merge requests because it is local state, not GitLab's: a
	// GitLab outage must not blank the badges, and a read failure here must not stop
	// the list from rendering.
	const loadReviewedMarks = useCallback(async () => {
		if (host === null || host.length === 0) {
			return;
		}
		try {
			const client = getRuntimeTrpcClient(workspaceId);
			const response = await client.review.listSessionMarks.query({ host });
			if (!response.ok) {
				return;
			}
			setReviewedMarks(
				new Map(
					response.marks
						.filter((mark) => mark.reviewedAllMark !== null)
						.map((mark) => [markKey(mark.projectId, mark.iid), mark.reviewedAllMark as RuntimeReviewAllMark]),
				),
			);
		} catch {
			// A missing badge is a cosmetic loss; surfacing it as a list error is not.
		}
	}, [host, workspaceId]);

	useEffect(() => {
		void loadReviewedMarks();
	}, [loadReviewedMarks]);

	const loadProjects = useCallback(async () => {
		if (!isConnected) {
			return;
		}
		try {
			const client = getRuntimeTrpcClient(workspaceId);
			const response = await client.gitlab.listProjects.query({ membership: true, limit: 100 });
			if (!response.ok) {
				setError(response.error ?? "Could not load projects.");
				return;
			}
			setProjects(response.projects);
		} catch (loadError) {
			setError(loadError instanceof Error ? loadError.message : String(loadError));
		}
	}, [isConnected, workspaceId]);

	useEffect(() => {
		void loadProjects();
	}, [loadProjects]);

	const query = useMemo(
		() =>
			buildReviewInboxQuery({
				tab,
				userId,
				projectId: selectedProjectId,
				state: stateFilter,
				scope,
				limit: 50,
			}),
		[scope, selectedProjectId, stateFilter, tab, userId],
	);

	const loadMergeRequests = useCallback(async () => {
		// A null query means the connection has not reported its user id yet, so the
		// reviewer filter cannot be built; the effect re-runs when it lands.
		if (!isConnected || query === null) {
			return;
		}
		setIsLoading(true);
		setError(null);
		try {
			const client = getRuntimeTrpcClient(workspaceId);
			const response = await client.gitlab.listMergeRequests.query(query);
			if (!response.ok) {
				setError(response.error ?? "Could not load merge requests.");
				setMergeRequests([]);
				return;
			}
			setMergeRequests(response.mergeRequests);
		} catch (loadError) {
			setError(loadError instanceof Error ? loadError.message : String(loadError));
		} finally {
			setIsLoading(false);
		}
	}, [isConnected, query, workspaceId]);

	useEffect(() => {
		void loadMergeRequests();
	}, [loadMergeRequests]);

	const visible = useMemo(() => {
		const forTab = filterMergeRequestsForTab(tab, mergeRequests);
		const needle = search.trim().toLowerCase();
		if (needle.length === 0) {
			return forTab;
		}
		return forTab.filter(
			(mergeRequest) =>
				mergeRequest.title.toLowerCase().includes(needle) ||
				String(mergeRequest.iid).includes(needle) ||
				mergeRequest.sourceBranch.toLowerCase().includes(needle),
		);
	}, [mergeRequests, search, tab]);

	const split = useMemo(() => splitByReviewerRequested(visible), [visible]);

	const openTarget = useCallback(
		(mergeRequest: RuntimeGitlabMergeRequestSummary) => {
			onOpenMergeRequest({
				host: connection?.host ?? "",
				projectId: mergeRequest.projectId,
				iid: mergeRequest.iid,
				title: mergeRequest.title,
				projectKey,
			});
		},
		[connection?.host, onOpenMergeRequest, projectKey],
	);

	if (!isConnected) {
		return (
			<div className="flex min-h-0 flex-1 items-center justify-center bg-surface-0 p-6">
				<div className="max-w-md space-y-3 text-center">
					<GitPullRequest size={28} className="mx-auto text-text-tertiary" />
					<h2 className="text-sm font-semibold text-text-primary">Connect GitLab to review merge requests</h2>
					<GitlabConnectForm controller={connect} />
				</div>
			</div>
		);
	}

	return (
		<div className="flex min-h-0 flex-1 flex-col bg-surface-0" data-testid="review-mr-list">
			<div className="flex shrink-0 items-center gap-1 border-b border-border bg-surface-1 px-3 pt-2 text-xs">
				{REVIEW_INBOX_TABS.map((entry) => (
					<button
						key={entry.id}
						type="button"
						data-testid={`review-mr-tab-${entry.id}`}
						aria-pressed={tab === entry.id}
						onClick={() => setTab(entry.id)}
						className={cn(
							"cursor-pointer border-b-2 px-2 pb-1.5",
							tab === entry.id
								? "border-accent text-text-primary"
								: "border-transparent text-text-secondary hover:text-text-primary",
						)}
					>
						{entry.label}
					</button>
				))}
			</div>

			<div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-surface-1 px-3 py-2 text-xs">
				<select
					value={selectedProjectId ?? ""}
					aria-label="Project"
					onChange={(event) => setSelectedProjectId(event.target.value === "" ? null : Number(event.target.value))}
					className="max-w-64 rounded border border-border bg-surface-2 px-2 py-1 text-xs text-text-primary"
				>
					<option value="">All projects</option>
					{projects.map((project) => (
						<option key={project.id} value={project.id}>
							{project.pathWithNamespace}
						</option>
					))}
				</select>

				{/* The other two tabs pin their own scope — showing a control that cannot
				    change anything would read as a broken filter. */}
				{tab === "browse" ? (
					<select
						value={scope}
						aria-label="Scope"
						onChange={(event) => setScope(event.target.value as ScopeFilter)}
						className="rounded border border-border bg-surface-2 px-2 py-1 text-xs text-text-primary"
					>
						<option value="created_by_me">Created by me</option>
						<option value="assigned_to_me">Assigned to me</option>
						<option value="all">Everyone</option>
					</select>
				) : null}

				<select
					value={stateFilter}
					aria-label="State"
					onChange={(event) => setStateFilter(event.target.value as StateFilter)}
					className="rounded border border-border bg-surface-2 px-2 py-1 text-xs text-text-primary"
				>
					<option value="opened">Open</option>
					<option value="merged">Merged</option>
					<option value="all">All</option>
				</select>

				<div className="relative min-w-40 flex-1">
					<Search size={12} className="absolute left-2 top-1.5 text-text-tertiary" />
					<input
						type="text"
						value={search}
						onChange={(event) => setSearch(event.target.value)}
						placeholder="Filter by title, !iid or branch…"
						aria-label="Filter merge requests"
						className="w-full rounded border border-border bg-surface-2 py-1 pl-7 pr-2 text-xs text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none"
					/>
				</div>

				<Button
					variant="default"
					size="sm"
					icon={isLoading ? <Spinner size={12} /> : <RefreshCw size={12} />}
					disabled={isLoading}
					onClick={() => {
						void loadMergeRequests();
						void loadReviewedMarks();
					}}
				>
					Refresh
				</Button>
				<span className="text-[10px] text-text-tertiary">{connection?.username}</span>
			</div>

			<div className="min-h-0 flex-1 overflow-y-auto p-2">
				{error ? <p className="px-1 py-2 text-xs text-status-red">{error}</p> : null}
				{!isLoading && visible.length === 0 && !error ? (
					<p className="px-1 py-3 text-xs text-text-tertiary">{emptyMessageForTab(tab)}</p>
				) : null}

				{tab === "mine" ? (
					<>
						<MergeRequestGroup
							label={`Reviewer requested (${split.awaitingReview.length})`}
							mergeRequests={split.awaitingReview}
							reviewedMarks={reviewedMarks}
							onOpen={openTarget}
						/>
						{/* Named for what they usually are rather than "no reviewer": these are
						    the merge requests opened to read a diff or run a pipeline, and the
						    whole point of the split is that they stop crowding the list above. */}
						<MergeRequestGroup
							label={`No reviewer yet · diff or pipeline only (${split.noReviewer.length})`}
							mergeRequests={split.noReviewer}
							reviewedMarks={reviewedMarks}
							onOpen={openTarget}
						/>
					</>
				) : (
					visible.map((mergeRequest) => (
						<MergeRequestRow
							key={markKey(mergeRequest.projectId, mergeRequest.iid)}
							mergeRequest={mergeRequest}
							reviewedMark={reviewedMarks.get(markKey(mergeRequest.projectId, mergeRequest.iid)) ?? null}
							onOpen={openTarget}
						/>
					))
				)}
			</div>
		</div>
	);
}

function emptyMessageForTab(tab: ReviewInboxTab): string {
	switch (tab) {
		case "requested":
			return "Nobody is waiting on your review.";
		case "approvedByMe":
			return "You have not approved any of the merge requests on this page.";
		case "mine":
			return "You have no merge requests matching those filters.";
		case "mineApproved":
			return "None of your merge requests have been approved yet.";
		case "browse":
			return "No merge requests match those filters.";
	}
}

function MergeRequestGroup({
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
			<div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">{label}</div>
			{mergeRequests.map((mergeRequest) => (
				<MergeRequestRow
					key={markKey(mergeRequest.projectId, mergeRequest.iid)}
					mergeRequest={mergeRequest}
					reviewedMark={reviewedMarks.get(markKey(mergeRequest.projectId, mergeRequest.iid)) ?? null}
					onOpen={onOpen}
				/>
			))}
		</div>
	);
}

function MergeRequestRow({
	mergeRequest,
	reviewedMark,
	onOpen,
}: {
	mergeRequest: RuntimeGitlabMergeRequestSummary;
	reviewedMark: RuntimeReviewAllMark | null;
	onOpen: (mergeRequest: RuntimeGitlabMergeRequestSummary) => void;
}): ReactElement {
	const reviewers = describeReviewers(mergeRequest);
	const approval = describeApprovalState(mergeRequest);
	const reviewed = describeReviewedState(mergeRequest, reviewedMark);
	return (
		<div
			role="button"
			tabIndex={0}
			className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 hover:bg-surface-2"
			onClick={() => onOpen(mergeRequest)}
			onKeyDown={(event) => {
				if (event.key === "Enter") {
					onOpen(mergeRequest);
				}
			}}
		>
			<span className="shrink-0 rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[11px] text-text-secondary">
				!{mergeRequest.iid}
			</span>
			<div className="min-w-0 flex-1">
				<div className="truncate text-sm text-text-primary">
					{mergeRequest.draft ? <span className="text-text-tertiary">Draft: </span> : null}
					{mergeRequest.title}
				</div>
				<div className="truncate text-[10px] text-text-tertiary">
					{mergeRequest.sourceBranch} → {mergeRequest.targetBranch}
					{mergeRequest.authorUsername ? ` · @${mergeRequest.authorUsername}` : ""}
					{mergeRequest.changesCount ? ` · ${mergeRequest.changesCount} files` : ""}
					{reviewers ? ` · review: ${reviewers}` : ""}
				</div>
			</div>
			{reviewed ? (
				<span
					data-testid="review-mr-reviewed-badge"
					title={
						reviewed.tone === "stale"
							? "You reviewed every file, but comments have been added since."
							: `You marked every file reviewed on ${new Date(reviewedMark?.at ?? "").toLocaleString()}.`
					}
					className={cn(
						"shrink-0 rounded px-1.5 py-0.5 text-[10px]",
						reviewed.tone === "reviewed"
							? "bg-status-green/20 text-status-green"
							: "bg-status-orange/20 text-status-orange",
					)}
				>
					{reviewed.label}
				</span>
			) : null}
			{approval ? (
				<span
					data-testid="review-mr-approval-badge"
					className={cn(
						"shrink-0 rounded px-1.5 py-0.5 text-[10px]",
						approval.tone === "approved"
							? "bg-status-green/20 text-status-green"
							: "bg-surface-4 text-text-secondary",
					)}
				>
					{approval.label}
				</span>
			) : null}
			{mergeRequest.pipelineStatus ? (
				<span
					className={cn(
						"shrink-0 rounded px-1.5 py-0.5 text-[10px]",
						PIPELINE_TONE[mergeRequest.pipelineStatus] ?? "bg-surface-4 text-text-secondary",
					)}
				>
					{mergeRequest.pipelineStatus}
				</span>
			) : null}
			{mergeRequest.userNotesCount ? (
				<span className="shrink-0 text-[10px] text-text-tertiary">{mergeRequest.userNotesCount} notes</span>
			) : null}
		</div>
	);
}
