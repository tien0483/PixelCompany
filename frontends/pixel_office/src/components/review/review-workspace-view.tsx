import { ArrowLeft, ExternalLink, Network, Send, Sparkles, X } from "lucide-react";
import { type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { showAppToast } from "@/components/app-toaster";
import { ClaudeUsageChip } from "@/components/claude-usage-chip";
import { ReviewAnnotationsPanel } from "@/components/review/review-annotations-panel";
import { isMergeRequestScopedPrompt, isReviewCommandPrompt } from "@/components/review/review-chat-composer";
import { ReviewClaudePanel } from "@/components/review/review-claude-panel";
import { ReviewDescriptionPanel } from "@/components/review/review-description-panel";
import { ReviewDiffPane, type ReviewCommentDraftInput } from "@/components/review/review-diff-pane";
import { ReviewFilesPanel } from "@/components/review/review-files-panel";
import { ReviewImpactPanel } from "@/components/review/review-impact-panel";
import { ReviewRulesPanel } from "@/components/review/review-rules-panel";
import { ReviewRunDot, type ReviewRunState } from "@/components/review/review-run-dot";
import { SeatPicker } from "@/manager/seat-picker";
import {
	ReviewSubmitDialog,
	type ReviewSubmitOutcome,
} from "@/components/review/review-submit-dialog";
import { ReviewThreadsPanel } from "@/components/review/review-threads-panel";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Spinner } from "@/components/ui/spinner";
import { runAgentTextRequest } from "@/html/agent-sse";
import { useHtmlAgentStream } from "@/html/use-html-agent-stream";
import { autoFallbackAccount } from "@/manager/task-account-picker";
import {
	type ReviewAgentModelId,
	readStoredReviewAgentModel,
	writeStoredReviewAgentModel,
} from "@/review/review-agent-model";
import { parseFindingsFromStream, parseVerdictsFromStream } from "@/review/review-findings-parse";
import { isTypingTarget, resolveNavKey } from "@/review/review-nav-keys";
import { buildTagPalette, type ReviewTag } from "@/review/review-tags";
import {
	countReviewProgress,
	formatSelectionLabel,
	type ReviewDiffMode,
	type ReviewLineFocus,
	type ReviewLineSelection,
	type ReviewTarget,
	type ReviewNavDirection,
	type ReviewVisibleRange,
	selectAdjacentUnreviewedPath,
	selectPendingFindings,
	selectTriagedFindingIds,
	sumDiffStats,
} from "@/review/review-target";
import { readStoredPolishComments, writeStoredPolishComments } from "@/review/review-comment-polish";
import type { FullFileFetchResult } from "@/review/use-full-file-content";
import { useReviewChat } from "@/review/use-review-chat";
import { useReviewGraphImpact } from "@/review/use-review-graph-impact";
import { useReviewProjectCommands } from "@/review/use-review-project-commands";
import { useReviewRulesConfig } from "@/review/use-review-rules-config";
import { useReviewSeat } from "@/review/use-review-seat";
import { useReviewSession } from "@/review/use-review-session";
import { useBooleanLocalStorageValue } from "@/utils/react-use";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import type {
	RuntimeManagerAccount,
	RuntimeReviewAnnotation,
	RuntimeReviewAuditRequest,
	RuntimeReviewChatMessage,
	RuntimeReviewDraftComment,
	RuntimeReviewGraphRebuildRequest,
	RuntimeReviewRulesExtractRequest,
	RuntimeReviewSuggestCommentRequest,
} from "@/runtime/types";

type LeftTab = "files" | "impact" | "threads" | "rules" | "annotations";

/** Follows `pixtiel.review.seat.<host>` — same scope, same convention. */
const REVIEW_DESCRIPTION_OPEN_KEY_PREFIX = "pixtiel.review.description.";

/**
 * What the dot on "Run Claude review" means. Spelled out rather than left to colour:
 * this is the panel's widest-scope pass, and the difference between "already paid
 * for" and "paid for, three commits ago" is the whole reason the indicator exists.
 */
const AUDIT_RUN_LABELS: Record<ReviewRunState, string> = {
	unrun: "Not run for this merge request yet",
	done: "Already run against the current head",
	stale: "Ran against an earlier head — new commits have landed since",
};

export function ReviewWorkspaceView({
	target,
	workspaceId,
	managerAccounts = [],
	managerActiveAccountId = null,
	localRepoPath,
	onClose,
}: {
	target: ReviewTarget;
	workspaceId: string | null;
	/** Manager seats offered in the header picker. Empty in the standalone app. */
	managerAccounts?: RuntimeManagerAccount[];
	managerActiveAccountId?: number | null;
	/** Local checkout path — passed as cwd to review chat so slash commands can read the repo. */
	localRepoPath?: string;
	onClose: () => void;
}): ReactElement {
	const session = useReviewSession(target, workspaceId);
	const rulesConfig = useReviewRulesConfig(target.projectKey, workspaceId);
	const { seatChoice, setSeatChoice } = useReviewSeat(target.host);
	// Per host, like the seat: whether a reviewer wants the body in view is a habit,
	// not a property of one merge request. Absent a stored choice it follows the MR —
	// open when there is something to read, collapsed when there is not.
	const [isDescriptionOpen, setIsDescriptionOpen] = useBooleanLocalStorageValue(
		`${REVIEW_DESCRIPTION_OPEN_KEY_PREFIX}${target.host}`,
		(session.mergeRequest?.description ?? "").trim().length > 0,
	);
	const [leftTab, setLeftTab] = useState<LeftTab>("files");
	const [diffMode, setDiffMode] = useState<ReviewDiffMode>("split");
	const [pendingCitations, setPendingCitations] = useState<string[]>([]);
	const [isComposerOpen, setIsComposerOpen] = useState(false);
	const [isSubmitOpen, setIsSubmitOpen] = useState(false);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [submitError, setSubmitError] = useState<string | null>(null);
	// Seeded from storage rather than defaulted-then-synced: a first render on the
	// wrong model would let a fast reviewer fire an Opus audit before the effect ran.
	const [agentModel, setAgentModel] = useState<ReviewAgentModelId>(() => readStoredReviewAgentModel());
	/**
	 * The last audit/extraction failure, kept after the stream resets. A toast alone
	 * is not enough here: the common failure ("no rules extracted yet") is an
	 * instruction the reviewer has to act on in another panel, and it must still be
	 * on screen when they get there.
	 */
	const [agentError, setAgentError] = useState<string | null>(null);
	/** Lines the reviewer has focused in the diff — what the chat can "see". */
	const [selection, setSelection] = useState<ReviewLineSelection | null>(null);
	const [draggedTag, setDraggedTag] = useState<ReviewTag | null>(null);
	const [visibleRange, setVisibleRange] = useState<ReviewVisibleRange | null>(null);
	/** The line the last jump asked the diff pane to scroll to. */
	const [lineFocus, setLineFocus] = useState<ReviewLineFocus | null>(null);
	const [polishComments, setPolishComments] = useState<boolean>(() => readStoredPolishComments());

	const audit = useHtmlAgentStream<RuntimeReviewAuditRequest>("/api/review/audit");
	const rulesExtract = useHtmlAgentStream<RuntimeReviewRulesExtractRequest>("/api/review/rules-extract");
	/**
	 * The last thing the running rebuild reported doing. The only progress signal
	 * there is: on the wire a whole-repository analysis is minutes of identical
	 * `run_command` steps carrying no detail, so the runtime reads the actual
	 * commands out of the CLI's transcript and forwards them as `progress_line`.
	 */
	const [graphRebuildProgressLine, setGraphRebuildProgressLine] = useState<string | null>(null);
	const handleGraphRebuildMeta = useCallback((key: string, value: unknown) => {
		if (key !== "progress_line" || !value || typeof value !== "object") {
			return;
		}
		const line = (value as { line?: unknown }).line;
		if (typeof line === "string" && line.length > 0) {
			setGraphRebuildProgressLine(line);
		}
	}, []);
	/**
	 * The knowledge-graph rebuild. Streamed like the other one-shots, but it is the
	 * only one that does not spend the reviewer's Claude seat: a whole-repository
	 * analysis runs on the Antigravity quota pool instead.
	 */
	const graphRebuild = useHtmlAgentStream<RuntimeReviewGraphRebuildRequest>(
		"/api/review/graph-rebuild",
		handleGraphRebuildMeta,
	);

	const claudeAccounts = useMemo(
		() => managerAccounts.filter((account) => account.provider === "claude"),
		[managerAccounts],
	);

	/**
	 * A rebuild needs an Antigravity seat to exist, but it does not get pinned the way
	 * a Claude seat does: those credentials are machine-wide in `~/.gemini` and Manager
	 * rotates which is active. The pin is passed anyway so an over-cap seat refuses the
	 * run rather than silently spending it.
	 */
	const antigravityAccounts = useMemo(
		() => managerAccounts.filter((account) => account.provider === "antigravity" && account.isActive !== false),
		[managerAccounts],
	);

	/**
	 * What the change touches, according to the project's knowledge graph.
	 *
	 * Costs no tokens — the walk happens in the runtime — so it is fetched whether or
	 * not the reviewer runs an agent. It is also the surface that makes a missing or
	 * stale graph visible: the audit and chat passes are handed the same walk as
	 * prose, so without somewhere to look at it, a graph problem would only ever show
	 * up as prompts that quietly got worse.
	 */
	/**
	 * The checkout's own slash commands, offered as chips next to the stack skills.
	 * Tied to `localRepoPath` because that path is the chat agent's cwd — a command
	 * from any other project is one the run could not expand.
	 */
	const projectCommands = useReviewProjectCommands({
		projectPath: localRepoPath || undefined,
		workspaceId,
	});

	const graph = useReviewGraphImpact({
		projectPath: localRepoPath || undefined,
		changedPaths: session.files.map((file) => file.newPath),
		baseBranch: session.mergeRequest?.targetBranch,
		workspaceId,
	});

	const openGraphDashboard = useCallback(() => {
		if (!localRepoPath) {
			showAppToast({ intent: "danger", message: "No local checkout is selected for this project." });
			return;
		}
		void (async () => {
			try {
				const client = getRuntimeTrpcClient(workspaceId);
				const response = await client.review.openGraphDashboard.mutate({ projectPath: localRepoPath });
				if (!response.ok || !response.url) {
					const message = response.error ?? "The graph dashboard could not be started.";
					setAgentError(message);
					showAppToast({ intent: "danger", message });
					return;
				}
				// A new tab rather than an embedded frame: the dashboard is a full graph
				// explorer, and the review workspace already has three columns.
				window.open(response.url, "_blank", "noopener,noreferrer");
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				setAgentError(message);
				showAppToast({ intent: "danger", message });
			}
		})();
	}, [localRepoPath, workspaceId]);

	const rebuildGraph = useCallback(() => {
		if (!localRepoPath) {
			showAppToast({ intent: "danger", message: "No local checkout is selected for this project." });
			return;
		}
		setAgentError(null);
		setGraphRebuildProgressLine(null);
		showAppToast({
			intent: "success",
			message: "Rebuilding the knowledge graph on the Antigravity seat. This analyzes the whole repository.",
		});
		void graphRebuild.run({
			projectPath: localRepoPath,
			// No model: agy's own default. Pinning one here would hard-code an id from
			// `agy models`, which carries its effort suffix and changes between releases.
			managerAccountId: antigravityAccounts[0]?.id,
		});
	}, [antigravityAccounts, graphRebuild, localRepoPath]);

	/**
	 * The seat every review run pins. A reviewer who has never chosen gets the
	 * Manager's active Claude seat as an *explicit* pin rather than Auto: an explicit
	 * pin refuses a disabled, re-auth-needed or over-cap seat outright, while the
	 * unpinned path may silently redirect onto a different seat — and a review pass is
	 * expensive enough that it should not move seats without saying so.
	 *
	 * `autoFallbackAccount` is the same resolver the picker labels its Auto option
	 * with, so the header and the run cannot disagree. Undefined — an explicit Auto,
	 * or a Manager snapshot that has not arrived — sends no id and keeps today's
	 * unpinned behaviour, which is also the only possible one in the standalone app.
	 */
	const effectiveAccountId = useMemo(() => {
		if (seatChoice === "auto") {
			return undefined;
		}
		if (seatChoice !== undefined) {
			return seatChoice;
		}
		return autoFallbackAccount(claudeAccounts, managerActiveAccountId, "claude")?.id;
	}, [claudeAccounts, managerActiveAccountId, seatChoice]);

	const draftComments = session.session?.draftComments ?? [];
	const reviewedPaths = session.session?.reviewedPaths ?? [];

	/**
	 * The transcript persists alongside the drafts, so reopening a review resumes the
	 * conversation rather than starting a stranger. Memoized on the stored values so a
	 * session refetch that changed nothing does not re-hydrate the chat hook.
	 */
	const storedChatMessages = session.session?.chatMessages;
	const storedChatSessionId = session.session?.chatSessionId ?? null;
	const initialChatMessages = useMemo<RuntimeReviewChatMessage[]>(
		() => storedChatMessages ?? [],
		[storedChatMessages],
	);
	const persistChat = useCallback(
		(update: { messages: RuntimeReviewChatMessage[]; sessionId: string | null }) => {
			session.setChat(update);
		},
		[session],
	);
	const chat = useReviewChat({
		initialMessages: initialChatMessages,
		initialSessionId: storedChatSessionId,
		onPersist: persistChat,
	});

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

	// Chat suggestions live inside immutable transcript messages, so triage cannot be
	// applied by removing them — the panel filters on this set instead.
	const triagedFindingIds = useMemo(
		() =>
			selectTriagedFindingIds({
				dismissedFindingIds: session.session?.dismissedFindingIds ?? [],
				draftComments,
			}),
		[draftComments, session.session?.dismissedFindingIds],
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

	const annotations = session.session?.annotations ?? [];
	const currentHeadSha = session.versions[0]?.headSha ?? session.diffRefs?.headSha ?? null;
	const staleAnnotationIds = useMemo(
		() =>
			new Set(
				annotations
					.filter((a) => a.headSha !== null && currentHeadSha !== null && a.headSha !== currentHeadSha)
					.map((a) => a.id),
			),
		[annotations, currentHeadSha],
	);
	const tagPalette = useMemo(() => buildTagPalette(session.rules), [session.rules]);
	const jumpToAnnotation = useCallback(
		(annotation: RuntimeReviewAnnotation) => {
			session.setActivePath(annotation.newPath);
			setLineFocus((current) => ({
				path: annotation.newPath,
				oldLine: annotation.oldLine,
				newLine: annotation.newLine,
				nonce: (current?.nonce ?? 0) + 1,
			}));
		},
		[session],
	);
	const tagAnnotationsGroup = useMemo(
		() => ({
			annotations,
			tags: tagPalette,
			draggedTag,
			currentHeadSha,
			onDragStart: setDraggedTag,
			onDragEnd: () => setDraggedTag(null),
			onAdd: session.addAnnotation,
			onRemove: session.removeAnnotation,
		}),
		[annotations, currentHeadSha, draggedTag, session.addAnnotation, session.removeAnnotation, tagPalette],
	);

	// Audit findings land in the session only once, when the stream finishes. Parsing
	// mid-stream would repeatedly rewrite the triage queue from half a JSON array.
	// Depends on the primitives plus the stable callbacks, not on the hook objects:
	// those get a fresh identity every render, which would re-run this each time.
	const auditStatus = audit.status;
	const auditText = audit.text;
	const auditReset = audit.reset;
	const setFindings = session.setFindings;
	const applyAnnotationVerdicts = session.applyAnnotationVerdicts;
	const markPassRun = session.markPassRun;
	useEffect(() => {
		if (auditStatus !== "done" || auditText.length === 0) {
			return;
		}
		const findings = parseFindingsFromStream(auditText);
		setFindings(findings);
		const verdicts = parseVerdictsFromStream(auditText);
		if (verdicts.length > 0) {
			applyAnnotationVerdicts(verdicts);
		}
		// Recorded even when nothing was flagged: "ran and found nothing" is the answer
		// the reviewer paid for, and an empty findings list must not read as "not run".
		markPassRun("audit");
		showAppToast({
			intent: "success",
			message:
				findings.length === 0
					? "Claude found nothing to flag against the rules."
					: `Claude flagged ${findings.length} item${findings.length === 1 ? "" : "s"} to triage.${
							verdicts.length > 0 ? ` Verdicts on ${verdicts.length} annotation${verdicts.length === 1 ? "" : "s"}.` : ""
						}`,
		});
		auditReset();
	}, [applyAnnotationVerdicts, auditReset, auditStatus, auditText, markPassRun, setFindings]);

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

	// Both one-shot streams fail the same way — an HTTP status the fetch never got
	// past, or an `error` frame mid-run — and neither used to be rendered anywhere,
	// so a rejected audit looked exactly like a button that does nothing.
	const auditError = audit.error;
	const rulesExtractError = rulesExtract.error;
	useEffect(() => {
		if (auditStatus !== "error" || !auditError) {
			return;
		}
		setAgentError(auditError);
		showAppToast({ intent: "danger", message: auditError });
		auditReset();
	}, [auditError, auditReset, auditStatus]);
	useEffect(() => {
		if (rulesExtractStatus !== "error" || !rulesExtractError) {
			return;
		}
		setAgentError(rulesExtractError);
		showAppToast({ intent: "danger", message: rulesExtractError });
		rulesExtractReset();
	}, [rulesExtractError, rulesExtractReset, rulesExtractStatus]);
	// Chat gets the same banner and toast, but no `reset()`: `useReviewChat` owns the
	// stream's lifecycle now — it freezes each finished answer into the transcript and
	// resets there, so resetting here would race it and drop the answer.
	const chatStatus = chat.status;
	const chatError = chat.error;
	useEffect(() => {
		if (chatStatus !== "error" || !chatError) {
			return;
		}
		setAgentError(chatError);
		showAppToast({ intent: "danger", message: chatError });
	}, [chatError, chatStatus]);

	// A finished rebuild has to invalidate the impact query, or the panel keeps
	// showing the stale walk that prompted the rebuild in the first place. The graph
	// index itself is cached on mtime server-side, so the refetch picks up the new
	// file without any explicit cache busting.
	const graphRebuildStatus = graphRebuild.status;
	const graphRebuildReset = graphRebuild.reset;
	const graphRebuildError = graphRebuild.error;
	const refreshGraph = graph.refresh;
	useEffect(() => {
		if (graphRebuildStatus !== "done") {
			return;
		}
		refreshGraph();
		showAppToast({ intent: "success", message: "Knowledge graph rebuilt." });
		graphRebuildReset();
	}, [graphRebuildReset, graphRebuildStatus, refreshGraph]);
	useEffect(() => {
		if (graphRebuildStatus !== "error" || !graphRebuildError) {
			return;
		}
		setAgentError(graphRebuildError);
		showAppToast({ intent: "danger", message: graphRebuildError });
		graphRebuildReset();
	}, [graphRebuildError, graphRebuildReset, graphRebuildStatus]);

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

	/**
	 * Opens the file a draft comment hangs off *at the line it hangs off*. Switching the
	 * file alone lands the reviewer at the top of it, which for anything but a one-hunk
	 * diff is nowhere near the note they clicked.
	 *
	 * The nonce increments rather than the focus being cleared and re-set, so clicking the
	 * same draft twice — the reviewer having scrolled away in between — scrolls back.
	 */
	const jumpToDraft = useCallback(
		(draft: RuntimeReviewDraftComment) => {
			session.setActivePath(draft.newPath);
			setLineFocus((current) => ({
				path: draft.newPath,
				oldLine: draft.oldLine,
				newLine: draft.newLine,
				nonce: (current?.nonce ?? 0) + 1,
			}));
		},
		[session],
	);

	/**
	 * Moves to the adjacent file that still needs reading. Deliberately does not mark the
	 * file being left reviewed — "reviewed" is a claim about having checked it, and asking
	 * for the next file is not that claim.
	 */
	const navigateUnreviewed = useCallback(
		(direction: ReviewNavDirection) => {
			const target = selectAdjacentUnreviewedPath({
				files: session.files,
				reviewedPaths,
				activePath: session.activePath,
				direction,
			});
			if (!target) {
				return;
			}
			session.setActivePath(target);
			showAppToast({
				intent: "success",
				message: `${direction === "next" ? "Next" : "Previous"} unreviewed file: ${target}`,
			});
		},
		[reviewedPaths, session],
	);

	/** Drives the header buttons' disabled state — the same walk the navigation itself does. */
	const navTargets = useMemo(
		() => ({
			previous:
				selectAdjacentUnreviewedPath({
					files: session.files,
					reviewedPaths,
					activePath: session.activePath,
					direction: "previous",
				}) !== null,
			next:
				selectAdjacentUnreviewedPath({
					files: session.files,
					reviewedPaths,
					activePath: session.activePath,
					direction: "next",
				}) !== null,
		}),
		[reviewedPaths, session.activePath, session.files],
	);

	// Window-level so the shortcut works from whichever of the three columns has focus.
	// The typing-target guard is what keeps `]` a literal character inside the comment
	// composer, the chat box and the rules search.
	const navigateRef = useRef(navigateUnreviewed);
	navigateRef.current = navigateUnreviewed;
	// The submit dialog covers the diff, so a keystroke there is not about file order.
	const isSubmitOpenRef = useRef(isSubmitOpen);
	isSubmitOpenRef.current = isSubmitOpen;
	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (isSubmitOpenRef.current) {
				return;
			}
			const direction = resolveNavKey({
				key: event.key,
				ctrlKey: event.ctrlKey,
				metaKey: event.metaKey,
				altKey: event.altKey,
				isTypingTarget: isTypingTarget(event.target),
			});
			if (!direction) {
				return;
			}
			event.preventDefault();
			navigateRef.current(direction);
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, []);

	// Stable identity so the diff pane's `closeComposer` memoization holds — it is a
	// dependency of effects there, and a fresh arrow per render defeats them.
	const clearCitations = useCallback(() => setPendingCitations([]), []);


	const runAudit = useCallback(() => {
		if (session.files.length === 0 || !session.mergeRequest) {
			return;
		}
		setAgentError(null);
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
			model: agentModel,
			managerAccountId: effectiveAccountId,
			...(annotations.length > 0 ? { annotations } : {}),
		});
	}, [agentModel, annotations, audit, effectiveAccountId, session.files, session.mergeRequest, target]);

	const sendChat = useCallback(
		(prompt: string, options?: { expectSuggestions?: boolean }) => {
			setAgentError(null);
			// An inline prompt button states its own answer shape; a typed prompt is judged
			// by its leading slash. Neither can turn the block off once the other asked for
			// it, because both reasons for wanting it are still true.
			const expectSuggestions =
				(options?.expectSuggestions ?? false) || isReviewCommandPrompt(prompt, projectCommands);
			chat.send({
				prompt,
				contextLabel: selection ? formatSelectionLabel(selection) : null,
				request: {
					host: target.host,
					projectId: target.projectId,
					iid: target.iid,
					changedPaths: session.files.map((file) => file.newPath),
					// The whole file only when the reviewer has not pointed at anything. A
					// selection is the more precise answer to "what are they looking at", and
					// the runtime drops the file diff when it gets one.
					...(session.activeFile ? { activeDiff: session.activeFile.diff } : {}),
					// Every patch, and only for the passes that read every patch: this is the
					// most expensive field on the request, and the runtime budgets it to 60 000
					// characters and reports whatever did not fit. Binary and over-size files
					// are dropped for the same reason the audit drops them — a placeholder
					// spends prompt budget and cannot be reviewed.
					...(isMergeRequestScopedPrompt(prompt)
						? {
								allDiffs: session.files
									.filter((file) => file.diff.length > 0 && !file.binary && !file.tooLarge)
									.map((file) => ({ newPath: file.newPath, diff: file.diff })),
							}
						: {}),
					...(annotations.length > 0
						? {
								annotations: isMergeRequestScopedPrompt(prompt)
									? annotations
									: annotations.filter((a) => a.newPath === session.activePath),
							}
						: {}),
					...(selection ? { screen: selection } : {}),
					...(visibleRange && !selection ? { visible: visibleRange } : {}),
					...(expectSuggestions ? { expectSuggestions: true } : {}),
					projectKey: target.projectKey,
					model: agentModel,
					managerAccountId: effectiveAccountId,
					cwd: localRepoPath || undefined,
				},
			});
		},
		[
			agentModel,
			annotations,
			chat,
			effectiveAccountId,
			localRepoPath,
			projectCommands,
			selection,
			session.activeFile,
			session.activePath,
			session.files,
			target,
			visibleRange,
		],
	);

	/**
	 * The comment-rewrite pass, awaited rather than watched.
	 *
	 * `useHtmlAgentStream` is the wrong shape here: this runs inside a click handler
	 * that has to know whether it got usable text before it decides what to put in the
	 * draft, and a hook exposing live state cannot be awaited.
	 */
	const runSuggestCommentPass = useCallback(
		(request: RuntimeReviewSuggestCommentRequest): Promise<string> =>
			runAgentTextRequest("/api/review/suggest-comment", request),
		[],
	);

	/**
	 * Turns something the assistant said into a draft comment on the reviewer's
	 * selected line.
	 *
	 * This is the whole point of the panel being an assistant: it produces text, the
	 * reviewer decides what of it is a review comment. Nothing here talks to GitLab —
	 * the draft joins the queue that `submitReview` publishes, so a requested change
	 * still goes out under the reviewer's own *Request changes* verdict.
	 */
	const requestChange = useCallback(
		async (rawText: string) => {
			const anchorLine = selection?.endLine ?? null;
			if (!selection || anchorLine === null) {
				// A draft with no line cannot be positioned as a diff note, so it would be
				// unpublishable — refusing up front beats a draft that fails at submit.
				showAppToast({
					intent: "danger",
					message: "Select a line in the diff first — a comment needs a line to attach to.",
				});
				return;
			}
			const file = session.files.find((candidate) => candidate.newPath === selection.path);
			const isOldSide = selection.side === "old";

			const addDraftWith = (text: string): void => {
				session.addDraftComment({
					newPath: selection.path,
					oldPath: file?.oldPath ?? selection.path,
					oldLine: isOldSide ? anchorLine : null,
					newLine: isOldSide ? null : anchorLine,
					text,
					ruleIds: [],
					aiFindingId: null,
				});
				showAppToast({
					intent: "success",
					message: `Draft comment on ${selection.path}:${anchorLine}. Publish it with Submit review → Request changes.`,
				});
			};

			if (!polishComments) {
				addDraftWith(rawText);
				return;
			}

			// The rewrite is a convenience, never a gate: if it fails the reviewer still
			// gets their comment, with a note about why the wording is raw.
			try {
				const polished = await runSuggestCommentPass({
					rawText,
					newPath: selection.path,
					line: anchorLine,
					diffExcerpt: selection.text,
					projectKey: target.projectKey,
					model: agentModel,
					managerAccountId: effectiveAccountId,
					cwd: localRepoPath || undefined,
				});
				addDraftWith(polished);
			} catch (error) {
				addDraftWith(rawText);
				showAppToast({
					intent: "danger",
					message: `Could not polish the comment, so the draft holds the original text: ${
						error instanceof Error ? error.message : String(error)
					}`,
				});
			}
		},
		[
			agentModel,
			effectiveAccountId,
			localRepoPath,
			polishComments,
			runSuggestCommentPass,
			selection,
			session,
			target.projectKey,
		],
	);

	const changePolishComments = useCallback((next: boolean) => {
		setPolishComments(next);
		writeStoredPolishComments(next);
	}, []);

	const changeAgentModel = useCallback((model: ReviewAgentModelId) => {
		setAgentModel(model);
		writeStoredReviewAgentModel(model);
	}, []);

	const extractRules = useCallback(() => {
		// The Rules panel disables its own button while this is empty, so reaching here
		// with no roots would mean the panel and this callback disagree.
		if (rulesConfig.sourceRoots.length === 0) {
			return;
		}
		setAgentError(null);
		void rulesExtract.run({
			projectKey: target.projectKey,
			sourceRoots: rulesConfig.sourceRoots,
			model: agentModel,
			managerAccountId: effectiveAccountId,
		});
	}, [agentModel, effectiveAccountId, rulesConfig.sourceRoots, rulesExtract, target.projectKey]);

	/**
	 * The active file's post-image, at the revision the diff's new side belongs to.
	 *
	 * The failure reason is carried rather than collapsed to null: GitLab distinguishes
	 * a path that does not exist at that ref from a rejected token from an unreachable
	 * host, `describeGitlabFailure` has already put that in words, and "Could not load
	 * file content." for all three tells the reviewer nothing they can act on.
	 */
	const fetchFullFile = useCallback(async (): Promise<FullFileFetchResult> => {
		if (!session.activeFile || !session.mergeRequest) {
			return { content: null, error: "No file is open." };
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
			return result.ok
				? { content: result.content ?? null, error: null }
				: { content: null, error: result.error ?? null };
		} catch (cause) {
			return { content: null, error: cause instanceof Error ? cause.message : String(cause) };
		}
	}, [session.activeFile, session.mergeRequest, target.projectId, workspaceId]);

	/**
	 * A new top-level thread. Same mutation as a reply, minus `discussionId` — that
	 * omission is the whole difference between starting a thread and answering one —
	 * and minus a diff position, so it lands as a plain merge-request comment.
	 *
	 * Throws on failure rather than swallowing: the panel keeps the reviewer's text in
	 * the box when this rejects, so a refused comment does not have to be retyped.
	 */
	const createThread = useCallback(
		async (body: string) => {
			const client = getRuntimeTrpcClient(workspaceId);
			const response = await client.gitlab.createNote.mutate({
				projectId: target.projectId,
				iid: target.iid,
				body,
			});
			if (!response.ok) {
				const message = response.error ?? "Could not post the comment.";
				showAppToast({ intent: "danger", message });
				throw new Error(message);
			}
			await session.refreshDiscussions();
		},
		[session, target.iid, target.projectId, workspaceId],
	);

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
							// Absent on a single-line note, and on every draft saved before ranges
							// existed — the runtime omits `line_range` in that case.
							...(draft.lineRange ? { lineRange: draft.lineRange } : {}),
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
	const auditRunState = session.passRunState("audit");

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
					<ClaudeUsageChip testId="review-claude-usage-chip" />
					<span className="font-mono text-[11px]">
						<span className="text-status-green">+{stats.additions}</span>{" "}
						<span className="text-status-red">-{stats.deletions}</span>
						<span className="text-text-tertiary"> in {progress.total}</span>
					</span>
					<span className="text-text-tertiary">
						{progress.reviewed}/{progress.total} reviewed
					</span>
					{/*
					 * Says what the agents can see. A review whose prompts silently lost their
					 * blast radius — no graph, or one built before half the branch existed —
					 * looks exactly like one that has it, which is why this is in the header
					 * rather than only inside the Impact tab.
					 */}
					{localRepoPath ? (
						<button
							type="button"
							data-testid="review-graph-chip"
							title={
								graph.impact?.hasGraph
									? `${graph.impact.dataDir ?? "knowledge graph"} — ${
											graph.impact.freshness?.isStale
												? `${graph.impact.freshness.changedSinceGraphCount} file(s) changed since it was built`
												: "up to date with HEAD"
										}. Opens the dashboard.`
									: "This project has no knowledge graph, so the review agents only see the diff."
							}
							className={cn(
								"flex shrink-0 cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-[11px]",
								graph.impact?.hasGraph
									? graph.impact.freshness?.isStale
										? "bg-status-orange/15 text-status-orange"
										: "bg-surface-3 text-text-secondary hover:text-text-primary"
									: "bg-surface-3 text-text-tertiary hover:text-text-secondary",
							)}
							onClick={() => {
								if (graph.impact?.hasGraph) {
									openGraphDashboard();
									return;
								}
								// Nothing to open, so send them where the build button is.
								setLeftTab("impact");
							}}
						>
							<Network size={11} />
							{graph.impact?.hasGraph
								? graph.impact.freshness?.isStale
									? "Graph stale"
									: "Graph"
								: "No graph"}
						</button>
					) : null}
					<SeatPicker
						claudeAccounts={claudeAccounts}
						activeAccountId={managerActiveAccountId}
						value={effectiveAccountId}
						// Switching seats mid-run would not move the running agent, and the next
						// run would silently disagree with what the header shows.
						disabled={audit.status === "running" || chat.status === "running" || rulesExtract.status === "running"}
						onChange={setSeatChoice}
					/>
					{/* The widest-scope pass in the panel: every patch against the whole rules
					    bundle. The dot is here because nothing else said whether it had already
					    been paid for, and it goes amber once new commits land on the branch. */}
					<Button
						variant="default"
						size="sm"
						icon={audit.status === "running" ? <Spinner size={12} /> : <Sparkles size={12} />}
						disabled={audit.status === "running" || session.files.length === 0}
						onClick={runAudit}
					>
						<span className="flex items-center gap-1.5">
							<ReviewRunDot state={auditRunState} label={AUDIT_RUN_LABELS[auditRunState]} />
							{audit.status === "running" ? "Reviewing…" : "Run Claude review"}
						</span>
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

			{mergeRequest ? (
				<ReviewDescriptionPanel
					description={mergeRequest.description}
					isOpen={isDescriptionOpen}
					onToggle={() => setIsDescriptionOpen((open) => !open)}
					onSave={session.saveDescription}
				/>
			) : null}

			{session.diffsTruncated ? (
				<div className="shrink-0 border-b border-border bg-surface-1 px-3 py-1.5 text-[11px] text-status-orange">
					This merge request is larger than the diff page cap, so some files are not listed.
				</div>
			) : null}

			{agentError ? (
				<div className="flex shrink-0 items-start justify-between gap-3 border-b border-border bg-surface-1 px-3 py-1.5 text-[11px] text-status-red">
					<span>{agentError}</span>
					<button
						type="button"
						aria-label="Dismiss error"
						className="shrink-0 cursor-pointer text-text-tertiary hover:text-text-primary"
						onClick={() => setAgentError(null)}
					>
						<X size={12} />
					</button>
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
							label={
								graph.impact?.hasGraph
									? `Impact (${graph.impact.affected?.length ?? 0})`
									: "Impact"
							}
							active={leftTab === "impact"}
							// The dot is the only place a stale graph is visible without opening the
							// tab, and a stale graph silently degrades every agent prompt.
							showAlert={graph.impact?.freshness?.isStale === true}
							onSelect={() => setLeftTab("impact")}
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
						<LeftTabButton
							label={`Annotations (${annotations.length})`}
							active={leftTab === "annotations"}
							onSelect={() => setLeftTab("annotations")}
						/>
					</div>

					{leftTab === "impact" ? (
						<ReviewImpactPanel
							impact={graph.impact}
							isLoading={graph.isLoading}
							projectPath={localRepoPath || undefined}
							isRebuilding={graphRebuild.status === "running"}
							canRebuild={antigravityAccounts.length > 0}
							rebuildProgressLine={graphRebuildProgressLine}
							onRefresh={graph.refresh}
							onRebuildGraph={rebuildGraph}
							onOpenDashboard={openGraphDashboard}
							onSelectPath={session.setActivePath}
						/>
					) : leftTab === "files" ? (
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
							onCreateThread={createThread}
							onReply={replyToThread}
							onToggleResolved={toggleThreadResolved}
							onJumpToThread={(path) => {
								if (path.length > 0) {
									session.setActivePath(path);
								}
							}}
						/>
					) : leftTab === "annotations" ? (
						<ReviewAnnotationsPanel
							annotations={annotations}
							staleAnnotationIds={staleAnnotationIds}
							onJumpToAnnotation={jumpToAnnotation}
							onRemoveAnnotation={session.removeAnnotation}
						/>
					) : (
						<ReviewRulesPanel
							rules={session.rules}
							generatedAt={session.rulesGeneratedAt}
							isExtracting={rulesExtract.status === "running"}
							canCite={isComposerOpen}
							sourceRoots={rulesConfig.sourceRoots}
							isSavingSourceRoots={rulesConfig.isSaving}
							suggestedSourceRoot={localRepoPath}
							onCite={citeRule}
							onRefresh={extractRules}
							onSaveSourceRoots={(roots) => void rulesConfig.save(roots)}
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
						tagAnnotations={tagAnnotationsGroup}
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
						onClearCitations={clearCitations}
						onRemoveCitation={removeCitation}
						onFetchFullFile={fetchFullFile}
						selection={selection}
						onSelectionChange={setSelection}
						onVisibleRangeChange={setVisibleRange}
						lineFocus={lineFocus}
						onNavigate={navigateUnreviewed}
						navTargets={navTargets}
					/>
				)}

				<aside className="flex w-96 shrink-0 flex-col border-l border-border">
					<ReviewClaudePanel
						messages={chat.messages}
						streamingText={chat.streamingText}
						chatStatus={chat.status}
						chatError={chat.error}
						chatLog={chat.log}
						chatNotices={chat.notices}
						contextLabel={selection ? formatSelectionLabel(selection) : null}
						canRequestChange={selection !== null}
						projectCommands={projectCommands}
						polishComments={polishComments}
						pendingFindings={pendingFindings}
						triagedFindingIds={triagedFindingIds}
						draftComments={draftComments}
						isAuditing={audit.status === "running"}
						model={agentModel}
						onModelChange={changeAgentModel}
						onSend={sendChat}
						onCancel={chat.cancel}
						onClearChat={chat.clear}
						onClearContext={() => setSelection(null)}
						onTogglePolish={changePolishComments}
						onRequestChange={(text) => void requestChange(text)}
						onAcceptFinding={session.acceptFinding}
						onDismissFinding={session.dismissFinding}
						onRemoveDraft={session.removeDraftComment}
						onJumpToDraft={jumpToDraft}
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
	showAlert = false,
	onSelect,
}: {
	label: string;
	active: boolean;
	/** Draws an attention dot next to the label. */
	showAlert?: boolean;
	onSelect: () => void;
}): ReactElement {
	return (
		<button
			type="button"
			onClick={onSelect}
			className={cn(
				"flex flex-1 cursor-pointer items-center justify-center gap-1 border-b-2 px-2 py-2",
				active
					? "border-accent bg-surface-0/40 text-text-primary"
					: "border-transparent text-text-secondary hover:text-text-primary",
			)}
		>
			{label}
			{showAlert ? (
				<span
					aria-label="Needs attention"
					className="inline-block size-1.5 shrink-0 rounded-full bg-status-orange"
				/>
			) : null}
		</button>
	);
}
