import { GitPullRequest, LogIn, RefreshCw, Search } from "lucide-react";
import { type ReactElement, useCallback, useEffect, useMemo, useState } from "react";

import { showAppToast } from "@/components/app-toaster";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Spinner } from "@/components/ui/spinner";
import type { ReviewTarget } from "@/review/review-target";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import type {
	RuntimeGitlabConnection,
	RuntimeGitlabMergeRequestSummary,
	RuntimeGitlabProject,
} from "@/runtime/types";

type ScopeFilter = "created_by_me" | "assigned_to_me" | "all";
type StateFilter = "opened" | "merged" | "all";

/** How often the connect flow is polled while the browser tab is open. */
const CONNECT_POLL_INTERVAL_MS = 1500;

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
	const [connection, setConnection] = useState<RuntimeGitlabConnection | null>(null);
	const [connectFlowId, setConnectFlowId] = useState<string | null>(null);
	const [connectAuthorizeUrl, setConnectAuthorizeUrl] = useState<string | null>(null);
	const [isConnecting, setIsConnecting] = useState(false);
	const [projects, setProjects] = useState<RuntimeGitlabProject[]>([]);
	const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
	const [mergeRequests, setMergeRequests] = useState<RuntimeGitlabMergeRequestSummary[]>([]);
	const [scope, setScope] = useState<ScopeFilter>("created_by_me");
	const [stateFilter, setStateFilter] = useState<StateFilter>("opened");
	const [search, setSearch] = useState("");
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const loadConnection = useCallback(async () => {
		try {
			const client = getRuntimeTrpcClient(workspaceId);
			setConnection(await client.gitlab.status.query());
		} catch (loadError) {
			setError(loadError instanceof Error ? loadError.message : String(loadError));
		}
	}, [workspaceId]);

	useEffect(() => {
		void loadConnection();
	}, [loadConnection]);

	// Poll only while a flow is outstanding. The browser round-trip finishes out of
	// band, so there is nothing else to tell this screen the token has landed.
	useEffect(() => {
		if (!connectFlowId) {
			return;
		}
		let cancelled = false;
		const timer = setInterval(async () => {
			try {
				const client = getRuntimeTrpcClient(workspaceId);
				const status = await client.gitlab.connectStatus.query({ flowId: connectFlowId });
				if (cancelled || status.state === "pending") {
					return;
				}
				setConnectFlowId(null);
				setIsConnecting(false);
				setConnectAuthorizeUrl(null);
				if (status.state === "connected") {
					setConnection(status.connection);
					showAppToast({
						intent: "success",
						message: `Connected to GitLab as ${status.connection?.username ?? "your account"}.`,
					});
				} else {
					setError(status.error ?? "GitLab authorization failed.");
				}
			} catch {
				// A transient poll failure is not worth surfacing; the next tick retries.
			}
		}, CONNECT_POLL_INTERVAL_MS);
		return () => {
			cancelled = true;
			clearInterval(timer);
		};
	}, [connectFlowId, workspaceId]);

	const connect = useCallback(async () => {
		setIsConnecting(true);
		setError(null);
		try {
			const client = getRuntimeTrpcClient(workspaceId);
			const response = await client.gitlab.connect.mutate({});
			if (!response.ok || !response.flowId) {
				setIsConnecting(false);
				setError(response.error ?? "Could not start the GitLab authorization.");
				return;
			}
			setConnectFlowId(response.flowId);
			setConnectAuthorizeUrl(response.authorizeUrl ?? null);
		} catch (connectError) {
			setIsConnecting(false);
			setError(connectError instanceof Error ? connectError.message : String(connectError));
		}
	}, [workspaceId]);

	const isConnected = connection?.connected === true;

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

	const loadMergeRequests = useCallback(async () => {
		if (!isConnected) {
			return;
		}
		setIsLoading(true);
		setError(null);
		try {
			const client = getRuntimeTrpcClient(workspaceId);
			const response = await client.gitlab.listMergeRequests.query({
				...(selectedProjectId !== null ? { projectId: selectedProjectId } : {}),
				state: stateFilter,
				scope,
				limit: 50,
			});
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
	}, [isConnected, scope, selectedProjectId, stateFilter, workspaceId]);

	useEffect(() => {
		void loadMergeRequests();
	}, [loadMergeRequests]);

	const visible = useMemo(() => {
		const needle = search.trim().toLowerCase();
		if (needle.length === 0) {
			return mergeRequests;
		}
		return mergeRequests.filter(
			(mergeRequest) =>
				mergeRequest.title.toLowerCase().includes(needle) ||
				String(mergeRequest.iid).includes(needle) ||
				mergeRequest.sourceBranch.toLowerCase().includes(needle),
		);
	}, [mergeRequests, search]);

	if (!isConnected) {
		return (
			<div className="flex min-h-0 flex-1 items-center justify-center bg-surface-0 p-6">
				<div className="max-w-md space-y-3 text-center">
					<GitPullRequest size={28} className="mx-auto text-text-tertiary" />
					<h2 className="text-sm font-semibold text-text-primary">Connect GitLab to review merge requests</h2>
					<p className="text-xs text-text-secondary">
						Authorization opens in your browser and uses the GitLab account you already sign in with. One
						account serves every project here.
					</p>
					{connection?.reauthRequired ? (
						<p className="text-xs text-status-orange">
							The stored token for {connection.username} was rejected. Authorize again to continue.
						</p>
					) : null}
					{error ? <p className="text-xs text-status-red">{error}</p> : null}
					<Button
						variant="primary"
						icon={isConnecting ? <Spinner size={13} /> : <LogIn size={13} />}
						disabled={isConnecting}
						onClick={() => void connect()}
					>
						{isConnecting ? "Waiting for your browser…" : "Connect GitLab"}
					</Button>
					{isConnecting && connectAuthorizeUrl ? (
						<p className="text-xs text-text-tertiary">
							Browser did not open?{" "}
							<a
								href={connectAuthorizeUrl}
								target="_blank"
								rel="noopener noreferrer"
								className="text-accent underline"
							>
								Open authorization page
							</a>
						</p>
					) : null}
				</div>
			</div>
		);
	}

	return (
		<div className="flex min-h-0 flex-1 flex-col bg-surface-0" data-testid="review-mr-list">
			<div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-surface-1 px-3 py-2 text-xs">
				<select
					value={selectedProjectId ?? ""}
					aria-label="Project"
					onChange={(event) => setSelectedProjectId(event.target.value === "" ? null : Number(event.target.value))}
					className="max-w-64 rounded border border-border bg-surface-2 px-2 py-1 text-xs text-text-primary"
				>
					<option value="">All my merge requests</option>
					{projects.map((project) => (
						<option key={project.id} value={project.id}>
							{project.pathWithNamespace}
						</option>
					))}
				</select>

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
					onClick={() => void loadMergeRequests()}
				>
					Refresh
				</Button>
				<span className="text-[10px] text-text-tertiary">{connection?.username}</span>
			</div>

			<div className="min-h-0 flex-1 overflow-y-auto p-2">
				{error ? <p className="px-1 py-2 text-xs text-status-red">{error}</p> : null}
				{!isLoading && visible.length === 0 && !error ? (
					<p className="px-1 py-3 text-xs text-text-tertiary">No merge requests match those filters.</p>
				) : null}

				{visible.map((mergeRequest) => (
					<div
						key={`${mergeRequest.projectId}-${mergeRequest.iid}`}
						role="button"
						tabIndex={0}
						className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 hover:bg-surface-2"
						onClick={() =>
							onOpenMergeRequest({
								host: connection?.host ?? "",
								projectId: mergeRequest.projectId,
								iid: mergeRequest.iid,
								title: mergeRequest.title,
								projectKey,
							})
						}
						onKeyDown={(event) => {
							if (event.key === "Enter") {
								onOpenMergeRequest({
									host: connection?.host ?? "",
									projectId: mergeRequest.projectId,
									iid: mergeRequest.iid,
									title: mergeRequest.title,
									projectKey,
								});
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
							</div>
						</div>
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
							<span className="shrink-0 text-[10px] text-text-tertiary">
								{mergeRequest.userNotesCount} notes
							</span>
						) : null}
					</div>
				))}
			</div>
		</div>
	);
}
