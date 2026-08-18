import { ArrowLeft, ExternalLink, Send, Sparkles } from "lucide-react";
import { type ReactElement, useCallback, useEffect, useMemo, useState } from "react";

import { showAppToast } from "@/components/app-toaster";
import { ReviewClaudePanel } from "@/components/review/review-claude-panel";
import { ReviewDiffPane, type ReviewCommentDraftInput } from "@/components/review/review-diff-pane";
import { ReviewFilesPanel } from "@/components/review/review-files-panel";
import { ReviewRulesPanel } from "@/components/review/review-rules-panel";
import {
	ReviewSubmitDialog,
	type ReviewSubmitOutcome,
} from "@/components/review/review-submit-dialog";
import { ReviewThreadsPanel } from "@/components/review/review-threads-panel";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Spinner } from "@/components/ui/spinner";
import { useHtmlAgentStream } from "@/html/use-html-agent-stream";
import {
	countReviewProgress,
	type ReviewDiffMode,
	type ReviewTarget,
	selectPendingFindings,
	sumDiffStats,
} from "@/review/review-target";
import { useReviewSession } from "@/review/use-review-session";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import type {
	RuntimeReviewAuditRequest,
	RuntimeReviewChatRequest,
	RuntimeReviewFinding,
	RuntimeReviewRulesExtractRequest,
} from "@/runtime/types";

type LeftTab = "files" | "threads" | "rules";

/**
 * Parses the audit stream's JSON array into findings, tagging each with a stable id
 * so accept/dismiss survives a reload. Lenient about a code fence and trailing
 * prose for the same reason the runtime parsers are: one stray sentence should not
 * throw away a whole review pass.
 */
function parseFindingsFromStream(text: string): RuntimeReviewFinding[] {
	const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
	for (const body of [fenced?.[1], text]) {
		if (typeof body !== "string") {
			continue;
		}
		const start = body.indexOf("[");
		const end = body.lastIndexOf("]");
		if (start < 0 || end <= start) {
			continue;
		}
		try {
			const parsed: unknown = JSON.parse(body.slice(start, end + 1));
			if (!Array.isArray(parsed)) {
				continue;
			}
			const findings: RuntimeReviewFinding[] = [];
			parsed.forEach((item, index) => {
				if (typeof item !== "object" || item === null || Array.isArray(item)) {
					return;
				}
				const record = item as Record<string, unknown>;
				const newPath = typeof record.newPath === "string" ? record.newPath : null;
				const message = typeof record.message === "string" ? record.message : null;
				if (!newPath || !message) {
					return;
				}
				const severityRaw = typeof record.severity === "string" ? record.severity.toUpperCase() : "MEDIUM";
				findings.push({
					// Derived from position and content, not the array index alone, so a
					// re-run that finds the same problem reuses the id the reviewer already
					// dismissed instead of resurrecting it.
					id: `finding-${newPath}-${String(record.newLine ?? "x")}-${index}`,
					newPath,
					newLine: typeof record.newLine === "number" && Number.isFinite(record.newLine) ? record.newLine : null,
					ruleId: typeof record.ruleId === "string" && record.ruleId.length > 0 ? record.ruleId : null,
					severity:
						severityRaw === "CRITICAL" || severityRaw === "HIGH" || severityRaw === "LOW" ? severityRaw : "MEDIUM",
					message,
				});
			});
			return findings;
		} catch {
			// Try the next body shape.
		}
	}
	return [];
}

export function ReviewWorkspaceView({
	target,
	workspaceId,
	managerAccountId,
	localRepoPath,
	onClose,
}: {
	target: ReviewTarget;
	workspaceId: string | null;
	/** Claude seat the review agents bill, when the caller pins one. */
	managerAccountId?: number;
	/** Local checkout path — passed as cwd to review chat so slash commands can read the repo. */
	localRepoPath?: string;
	onClose: () => void;
}): ReactElement {
	const session = useReviewSession(target, workspaceId);
	const [leftTab, setLeftTab] = useState<LeftTab>("files");
	const [diffMode, setDiffMode] = useState<ReviewDiffMode>("split");
	const [pendingCitations, setPendingCitations] = useState<string[]>([]);
	const [isComposerOpen, setIsComposerOpen] = useState(false);
	const [isSubmitOpen, setIsSubmitOpen] = useState(false);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [submitError, setSubmitError] = useState<string | null>(null);

	const chat = useHtmlAgentStream<RuntimeReviewChatRequest>("/api/review/chat");
	const audit = useHtmlAgentStream<RuntimeReviewAuditRequest>("/api/review/audit");
	const rulesExtract = useHtmlAgentStream<RuntimeReviewRulesExtractRequest>("/api/review/rules-extract");

	const draftComments = session.session?.draftComments ?? [];
	const reviewedPaths = session.session?.reviewedPaths ?? [];

	const progress = useMemo(
		() => countReviewProgress({ files: session.files, reviewedPaths }),
		[reviewedPaths, session.files],
	);
	const stats = useMemo(() => sumDiffStats(session.files), [session.files]);

	const pendingFindings = useMemo(
		() =>
			selectPendingFindings({
				findings: session.session?.findings ?? [],
				dismissedFindingIds: session.session?.dismissedFindingIds ?? [],
				draftComments,
			}),
		[draftComments, session.session?.dismissedFindingIds, session.session?.findings],
	);

	const draftCountByPath = useMemo(() => {
		const counts = new Map<string, number>();
		for (const draft of draftComments) {
			counts.set(draft.newPath, (counts.get(draft.newPath) ?? 0) + 1);
		}
		return counts;
	}, [draftComments]);

	const activeDraftComments = useMemo(
		() => draftComments.filter((draft) => draft.newPath === session.activePath),
		[draftComments, session.activePath],
	);

	// Audit findings land in the session only once, when the stream finishes. Parsing
	// mid-stream would repeatedly rewrite the triage queue from half a JSON array.
	// Depends on the primitives plus the stable callbacks, not on the hook objects:
	// those get a fresh identity every render, which would re-run this each time.
	const auditStatus = audit.status;
	const auditText = audit.text;
	const auditReset = audit.reset;
	const setFindings = session.setFindings;
	useEffect(() => {
		if (auditStatus !== "done" || auditText.length === 0) {
			return;
		}
		const findings = parseFindingsFromStream(auditText);
		setFindings(findings);
		showAppToast({
			intent: "success",
			message:
				findings.length === 0
					? "Claude found nothing to flag against the rules."
					: `Claude flagged ${findings.length} item${findings.length === 1 ? "" : "s"} to triage.`,
		});
		auditReset();
	}, [auditReset, auditStatus, auditText, setFindings]);

	const rulesExtractStatus = rulesExtract.status;
	const rulesExtractReset = rulesExtract.reset;
	const refreshSession = session.refresh;
	useEffect(() => {
		if (rulesExtractStatus !== "done") {
			return;
		}
		// The runtime writes the bundle itself; this only has to reload it.
		void refreshSession();
		rulesExtractReset();
	}, [refreshSession, rulesExtractReset, rulesExtractStatus]);

	const citeRule = useCallback((ruleId: string) => {
		setPendingCitations((current) => (current.includes(ruleId) ? current : [...current, ruleId]));
	}, []);

	const removeCitation = useCallback((ruleId: string) => {
		setPendingCitations((current) => current.filter((id) => id !== ruleId));
	}, []);

	const addDraft = useCallback(
		(draft: ReviewCommentDraftInput) => {
			session.addDraftComment({ ...draft, aiFindingId: null });
		},
		[session],
	);

	const runAudit = useCallback(() => {
		if (session.files.length === 0 || !session.mergeRequest) {
			return;
		}
		// Only files with a text patch: a binary or truncated file has nothing to audit
		// and would spend prompt budget on a placeholder.
		const files = session.files
			.filter((file) => file.diff.length > 0 && !file.binary && !file.tooLarge)
			.map((file) => ({ newPath: file.newPath, diff: file.diff }));
		if (files.length === 0) {
			showAppToast({ intent: "danger", message: "No text diffs in this merge request to audit." });
			return;
		}
		void audit.run({
			host: target.host,
			projectId: target.projectId,
			iid: target.iid,
			title: session.mergeRequest.title,
			sourceBranch: session.mergeRequest.sourceBranch,
			targetBranch: session.mergeRequest.targetBranch,
			files,
			projectKey: target.projectKey,
			managerAccountId,
		});
	}, [audit, managerAccountId, session.files, session.mergeRequest, target]);

	const sendChat = useCallback(
		(prompt: string) => {
			void chat.run({
				prompt,
				host: target.host,
				projectId: target.projectId,
				iid: target.iid,
				changedPaths: session.files.map((file) => file.newPath),
				...(session.activeFile ? { activeDiff: session.activeFile.diff } : {}),
				projectKey: target.projectKey,
				managerAccountId,
				cwd: localRepoPath || undefined,
			});
		},
		[chat, localRepoPath, managerAccountId, session.activeFile, session.files, target],
	);

	const extractRules = useCallback(async () => {
		try {
			const client = getRuntimeTrpcClient(workspaceId);
			const config = await client.review.getRulesConfig.query({ projectKey: target.projectKey });
			const sourceRoots = config.config?.sourceRoots ?? [];
			if (sourceRoots.length === 0) {
				// Extraction with no configured roots would send the agent hunting the
				// filesystem; say what is missing instead.
				showAppToast({
					intent: "danger",
					message:
						"No rule sources configured for this project. Set the guideline paths in Review settings first.",
				});
				return;
			}
			void rulesExtract.run({ projectKey: target.projectKey, sourceRoots, managerAccountId });
		} catch (error) {
			showAppToast({ intent: "danger", message: error instanceof Error ? error.message : String(error) });
		}
	}, [managerAccountId, rulesExtract, target.projectKey, workspaceId]);

	const fetchFullFile = useCallback(async (): Promise<string | null> => {
		if (!session.activeFile || !session.mergeRequest) {
			return null;
		}
		try {
			const client = getRuntimeTrpcClient(workspaceId);
			const headSha =
				session.mergeRequest.diffRefs?.headSha ?? session.mergeRequest.sourceBranch;
			const result = await client.gitlab.getRawFile.query({
				projectId: target.projectId,
				ref: headSha,
				path: session.activeFile.newPath,
			});
			return result.ok ? (result.content ?? null) : null;
		} catch {
			return null;
		}
	}, [session.activeFile, session.mergeRequest, target.projectId, workspaceId]);

	const replyToThread = useCallback(
		async (discussionId: string, body: string) => {
			const client = getRuntimeTrpcClient(workspaceId);
			const response = await client.gitlab.createNote.mutate({
				projectId: target.projectId,
				iid: target.iid,
				body,
				discussionId,
			});
			if (!response.ok) {
				showAppToast({ intent: "danger", message: response.error ?? "Could not post the reply." });
				return;
			}
			await session.refreshDiscussions();
		},
		[session, target.iid, target.projectId, workspaceId],
	);

	const toggleThreadResolved = useCallback(
		async (discussionId: string, resolved: boolean) => {
			const client = getRuntimeTrpcClient(workspaceId);
			const response = await client.gitlab.resolveDiscussion.mutate({
				projectId: target.projectId,
				iid: target.iid,
				discussionId,
				resolved,
			});
			if (!response.ok) {
				showAppToast({ intent: "danger", message: response.error ?? "Could not update the thread." });
				return;
			}
			await session.refreshDiscussions();
		},
		[session, target.iid, target.projectId, workspaceId],
	);

	/**
	 * Publishes the drafts, then the summary, then the verdict — in that order and
	 * one note at a time.
	 *
	 * Sequential rather than parallel so a mid-way failure leaves a comprehensible
	 * state: everything before the failure is published, the failing note and those
	 * after it are still drafts, and only the published ones are dropped locally. A
	 * parallel publish that half-failed would leave the reviewer unable to tell which
	 * notes to retype.
	 */
	const submitReview = useCallback(
		async (outcome: ReviewSubmitOutcome) => {
			if (!session.diffRefs) {
				setSubmitError("This merge request has no diff refs, so inline notes cannot be positioned.");
				return;
			}
			setIsSubmitting(true);
			setSubmitError(null);
			const client = getRuntimeTrpcClient(workspaceId);
			const published: string[] = [];

			try {
				for (const draft of draftComments) {
					const body =
						draft.ruleIds.length > 0 ? `${draft.text}\n\n_Rules: ${draft.ruleIds.join(", ")}_` : draft.text;
					const response = await client.gitlab.createDiffDiscussion.mutate({
						projectId: target.projectId,
						iid: target.iid,
						body,
						diffRefs: session.diffRefs,
						position: {
							oldPath: draft.oldPath,
							newPath: draft.newPath,
							oldLine: draft.oldLine,
							newLine: draft.newLine,
						},
					});
					if (!response.ok) {
						setSubmitError(
							`Published ${published.length} of ${draftComments.length} notes. ${draft.newPath}:${
								draft.newLine ?? draft.oldLine
							} failed: ${response.error ?? "unknown error"}`,
						);
						return;
					}
					published.push(draft.id);
				}

				if (outcome.summary.length > 0) {
					const response = await client.gitlab.createNote.mutate({
						projectId: target.projectId,
						iid: target.iid,
						body: outcome.summary,
					});
					if (!response.ok) {
						setSubmitError(`Inline notes published, but the summary failed: ${response.error ?? "unknown error"}`);
						return;
					}
				}

				if (outcome.action !== "comment") {
					const response = await client.gitlab.setApproval.mutate({
						projectId: target.projectId,
						iid: target.iid,
						approved: outcome.action === "approve",
					});
					if (!response.ok) {
						setSubmitError(`Notes published, but the verdict failed: ${response.error ?? "unknown error"}`);
						return;
					}
				}

				setIsSubmitOpen(false);
				showAppToast({
					intent: "success",
					message:
						published.length > 0
							? `Published ${published.length} note${published.length === 1 ? "" : "s"} to GitLab.`
							: "Review submitted.",
				});
			} finally {
				// Drop exactly what landed, keep the rest as drafts. Runs even on the early
				// returns above, which is the whole point of doing it here.
				if (published.length > 0) {
					for (const id of published) {
						session.removeDraftComment(id);
					}
				}
				session.markPassComplete();
				setIsSubmitting(false);
				await session.refreshDiscussions();
			}
		},
		[draftComments, session, target.iid, target.projectId, workspaceId],
	);

	const mergeRequest = session.mergeRequest;

	return (
		<div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-surface-0">
			<header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border bg-surface-1 px-3">
				<div className="flex min-w-0 items-center gap-2">
					<Button variant="ghost" size="sm" icon={<ArrowLeft size={14} />} onClick={onClose}>
						Back
					</Button>
					<span className="shrink-0 rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[11px] text-text-secondary">
						!{target.iid}
					</span>
					<div className="min-w-0">
						<div className="truncate text-sm font-semibold text-text-primary">
							{mergeRequest?.title ?? target.title}
						</div>
						<div className="truncate text-[10px] text-text-tertiary">
							{mergeRequest
								? `${mergeRequest.sourceBranch} → ${mergeRequest.targetBranch}`
								: "Loading merge request…"}
							{mergeRequest?.authorUsername ? ` · @${mergeRequest.authorUsername}` : ""}
							{mergeRequest?.pipelineStatus ? ` · pipeline ${mergeRequest.pipelineStatus}` : ""}
						</div>
					</div>
					{mergeRequest?.webUrl ? (
						<a
							href={mergeRequest.webUrl}
							target="_blank"
							rel="noreferrer"
							title="Open in GitLab"
							className="shrink-0 text-text-tertiary hover:text-text-primary"
						>
							<ExternalLink size={13} />
						</a>
					) : null}
				</div>

				<div className="flex shrink-0 items-center gap-3 text-xs">
					<span className="font-mono text-[11px]">
						<span className="text-status-green">+{stats.additions}</span>{" "}
						<span className="text-status-red">-{stats.deletions}</span>
						<span className="text-text-tertiary"> in {progress.total}</span>
					</span>
					<span className="text-text-tertiary">
						{progress.reviewed}/{progress.total} reviewed
					</span>
					<Button
						variant="default"
						size="sm"
						icon={audit.status === "running" ? <Spinner size={12} /> : <Sparkles size={12} />}
						disabled={audit.status === "running" || session.files.length === 0}
						onClick={runAudit}
					>
						{audit.status === "running" ? "Reviewing…" : "Run Claude review"}
					</Button>
					<Button
						variant="primary"
						size="sm"
						icon={<Send size={12} />}
						onClick={() => {
							setSubmitError(null);
							setIsSubmitOpen(true);
						}}
					>
						Submit review ({draftComments.length})
					</Button>
				</div>
			</header>

			{session.diffsTruncated ? (
				<div className="shrink-0 border-b border-border bg-surface-1 px-3 py-1.5 text-[11px] text-status-orange">
					This merge request is larger than the diff page cap, so some files are not listed.
				</div>
			) : null}

			<div className="flex min-h-0 flex-1 overflow-hidden">
				<aside className="flex w-80 shrink-0 flex-col border-r border-border bg-surface-1">
					<div className="flex shrink-0 border-b border-border text-[11px]">
						<LeftTabButton
							label={`Files (${session.files.length})`}
							active={leftTab === "files"}
							onSelect={() => setLeftTab("files")}
						/>
						<LeftTabButton
							label={`Threads (${session.discussions.length})`}
							active={leftTab === "threads"}
							onSelect={() => setLeftTab("threads")}
						/>
						<LeftTabButton
							label={`Rules (${session.rules.length})`}
							active={leftTab === "rules"}
							onSelect={() => setLeftTab("rules")}
						/>
					</div>

					{leftTab === "files" ? (
						<ReviewFilesPanel
							files={session.files}
							activePath={session.activePath}
							reviewedPaths={reviewedPaths}
							draftCountByPath={draftCountByPath}
							onSelectPath={session.setActivePath}
							onToggleReviewed={session.toggleFileReviewed}
						/>
					) : leftTab === "threads" ? (
						<ReviewThreadsPanel
							discussions={session.discussions}
							onReply={replyToThread}
							onToggleResolved={toggleThreadResolved}
							onJumpToThread={(path) => {
								if (path.length > 0) {
									session.setActivePath(path);
								}
							}}
						/>
					) : (
						<ReviewRulesPanel
							rules={session.rules}
							generatedAt={session.rulesGeneratedAt}
							isExtracting={rulesExtract.status === "running"}
							canCite={isComposerOpen}
							onCite={citeRule}
							onRefresh={() => void extractRules()}
						/>
					)}
				</aside>

				{session.isLoading ? (
					<div className="flex min-h-0 flex-1 items-center justify-center">
						<Spinner size={20} />
					</div>
				) : session.loadError ? (
					<div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-6">
						<p className="max-w-md text-center text-xs text-status-red">{session.loadError}</p>
						<Button variant="default" size="sm" onClick={() => void session.refresh()}>
							Try again
						</Button>
					</div>
				) : (
					<ReviewDiffPane
						file={session.activeFile}
						mode={diffMode}
						isReviewed={session.activePath !== null && reviewedPaths.includes(session.activePath)}
						draftComments={activeDraftComments}
						discussions={session.discussions}
						pendingCitations={pendingCitations}
						deltaBanner={session.newCommitsSinceLastReview}
						onModeChange={setDiffMode}
						onToggleReviewed={() => {
							if (session.activePath) {
								session.toggleFileReviewed(session.activePath);
							}
						}}
						onAddDraft={addDraft}
						onRemoveDraft={session.removeDraftComment}
						onComposerOpenChange={setIsComposerOpen}
						onClearCitations={() => setPendingCitations([])}
						onRemoveCitation={removeCitation}
						onFetchFullFile={fetchFullFile}
					/>
				)}

				<aside className="flex w-96 shrink-0 flex-col border-l border-border">
					<ReviewClaudePanel
						chatText={chat.text}
						chatStatus={chat.status}
						chatError={chat.error}
						pendingFindings={pendingFindings}
						draftComments={draftComments}
						isAuditing={audit.status === "running"}
						onSend={sendChat}
						onCancel={chat.cancel}
						onAcceptFinding={session.acceptFinding}
						onDismissFinding={session.dismissFinding}
						onRemoveDraft={session.removeDraftComment}
						onJumpToDraft={(draft) => session.setActivePath(draft.newPath)}
					/>
				</aside>
			</div>

			<ReviewSubmitDialog
				open={isSubmitOpen}
				draftComments={draftComments}
				isSubmitting={isSubmitting}
				submitError={submitError}
				unreviewedCount={progress.total - progress.reviewed}
				onOpenChange={setIsSubmitOpen}
				onSubmit={(outcome) => void submitReview(outcome)}
			/>
		</div>
	);
}

function LeftTabButton({
	label,
	active,
	onSelect,
}: {
	label: string;
	active: boolean;
	onSelect: () => void;
}): ReactElement {
	return (
		<button
			type="button"
			onClick={onSelect}
			className={cn(
				"flex-1 cursor-pointer border-b-2 px-2 py-2",
				active
					? "border-accent bg-surface-0/40 text-text-primary"
					: "border-transparent text-text-secondary hover:text-text-primary",
			)}
		>
			{label}
		</button>
	);
}
