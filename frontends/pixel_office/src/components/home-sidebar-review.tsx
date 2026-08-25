import { GitPullRequest, RefreshCw } from "lucide-react";
import { type ReactElement, useCallback, useEffect, useState } from "react";

import { showAppToast } from "@/components/app-toaster";
import { GitlabConnectForm } from "@/components/review/gitlab-connect-form";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Spinner } from "@/components/ui/spinner";
import type { ReviewTarget } from "@/review/review-target";
import { useGitlabConnect } from "@/review/use-gitlab-connect";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import type { RuntimeGitlabMergeRequestSummary, RuntimeReviewSession } from "@/runtime/types";

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
 * Open merge requests, plus any review with unpublished drafts.
 *
 * Drafts are listed first and read from local state, not GitLab: unfinished work
 * should be findable even when the network is down, and it is the thing most likely
 * to be forgotten.
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
	const [mergeRequests, setMergeRequests] = useState<RuntimeGitlabMergeRequestSummary[]>([]);
	const [draftSessions, setDraftSessions] = useState<RuntimeReviewSession[]>([]);
	const [isLoading, setIsLoading] = useState(true);

	const host = connection?.host ?? "";

	const refresh = useCallback(async () => {
		setIsLoading(true);
		try {
			if (!isConnected || host.length === 0) {
				setMergeRequests([]);
				setDraftSessions([]);
				return;
			}
			const client = getRuntimeTrpcClient(workspaceId);
			const [list, sessions] = await Promise.all([
				client.gitlab.listMergeRequests.query({ state: "opened", scope: "created_by_me", limit: 20 }),
				client.review.listSessionsWithDrafts.query({ host }),
			]);
			setMergeRequests(list.ok ? list.mergeRequests : []);
			setDraftSessions(sessions);
			if (!list.ok && list.error) {
				showAppToast({ intent: "danger", message: list.error });
			}
		} catch (error) {
			showAppToast({ intent: "danger", message: error instanceof Error ? error.message : String(error) });
		} finally {
			setIsLoading(false);
		}
	}, [host, isConnected, workspaceId]);

	// Re-runs whenever the connection changes, which is what makes a fresh token
	// populate the list without a manual Refresh.
	useEffect(() => {
		void refresh();
	}, [refresh]);

	// A null connection means the status call has not answered yet. Rendering the
	// connect form in that window flashes "not connected" at someone who is.
	const isPending = isLoading || connection === null;

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
						<div className="px-1 py-1 text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">
							Unpublished drafts
						</div>
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

				{mergeRequests.length > 0 ? (
					<div className="px-1 py-1 text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">
						Your open merge requests
					</div>
				) : null}

				{mergeRequests.map((mergeRequest) => (
					<button
						key={`${mergeRequest.projectId}-${mergeRequest.iid}`}
						type="button"
						className="flex w-full cursor-pointer items-start gap-1.5 rounded-md px-2 py-1.5 text-left text-text-secondary hover:bg-surface-3 hover:text-text-primary"
						onClick={() =>
							onOpenMergeRequest({
								host,
								projectId: mergeRequest.projectId,
								iid: mergeRequest.iid,
								title: mergeRequest.title,
								projectKey,
							})
						}
					>
						<GitPullRequest size={13} className="mt-0.5 shrink-0" />
						<span className="min-w-0 flex-1">
							<span className="block truncate text-sm">{mergeRequest.title}</span>
							<span className="block truncate text-[10px] text-text-tertiary">
								!{mergeRequest.iid} · {mergeRequest.sourceBranch} → {mergeRequest.targetBranch}
							</span>
						</span>
					</button>
				))}

				{!isPending && isConnected && mergeRequests.length === 0 && draftSessions.length === 0 ? (
					<p className="px-1 py-3 text-[12px] text-text-tertiary">
						No open merge requests of yours. Open the Review tab to browse everyone's.
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
