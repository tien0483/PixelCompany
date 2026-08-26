import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { showAppToast } from "@/components/app-toaster";
import type { ReviewRunState } from "@/components/review/review-run-dot";
import type { ReviewTarget } from "@/review/review-target";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import type {
	RuntimeGitlabDiffFile,
	RuntimeGitlabDiffRefs,
	RuntimeGitlabDiscussion,
	RuntimeGitlabMergeRequestDetail,
	RuntimeGitlabMergeRequestVersion,
	RuntimeReviewChatMessage,
	RuntimeReviewCompletedPass,
	RuntimeReviewDraftComment,
	RuntimeReviewFinding,
	RuntimeReviewRule,
	RuntimeReviewSession,
} from "@/runtime/types";

/** Debounce for session autosave. Long enough to coalesce typing, short enough that a crash costs one sentence. */
const SESSION_SAVE_DEBOUNCE_MS = 600;

export interface ReviewSessionState {
	isLoading: boolean;
	loadError: string | null;
	mergeRequest: RuntimeGitlabMergeRequestDetail | null;
	files: RuntimeGitlabDiffFile[];
	diffRefs: RuntimeGitlabDiffRefs | null;
	diffsTruncated: boolean;
	discussions: RuntimeGitlabDiscussion[];
	versions: RuntimeGitlabMergeRequestVersion[];
	rules: RuntimeReviewRule[];
	rulesGeneratedAt: string | null;
	session: RuntimeReviewSession | null;
}

export interface ReviewSessionApi extends ReviewSessionState {
	activePath: string | null;
	setActivePath: (path: string) => void;
	activeFile: RuntimeGitlabDiffFile | null;
	/** Commits pushed since the reviewer last finished a pass, or null when nothing is stale. */
	newCommitsSinceLastReview: { previousHeadSha: string; currentHeadSha: string } | null;
	refresh: () => Promise<void>;
	refreshDiscussions: () => Promise<void>;
	toggleFileReviewed: (path: string) => void;
	addDraftComment: (
		draft: Omit<RuntimeReviewDraftComment, "id" | "createdAt" | "author">,
	) => void;
	removeDraftComment: (id: string) => void;
	clearDraftComments: () => void;
	setFindings: (findings: RuntimeReviewFinding[]) => void;
	/** Persists the chat transcript and the CLI session it resumes into. */
	setChat: (update: { messages: RuntimeReviewChatMessage[]; sessionId: string | null }) => void;
	dismissFinding: (id: string) => void;
	acceptFinding: (finding: RuntimeReviewFinding) => void;
	markPassComplete: () => void;
	/**
	 * Records that a whole-merge-request pass ran, against the head it saw. Only for
	 * the passes whose run state cannot be read off something cheaper — the chat
	 * buttons are answered by their own message in the transcript.
	 */
	markPassRun: (pass: RuntimeReviewCompletedPass["pass"]) => void;
	/** What the run indicator on such a pass should show. */
	passRunState: (pass: RuntimeReviewCompletedPass["pass"]) => ReviewRunState;
}

function nextDraftId(): string {
	// Not cryptographic — this only has to be unique within one reviewer's session.
	return `draft-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Owns everything a review needs: the GitLab reads, the rules bundle, and the
 * locally persisted session that holds the reviewer's drafts.
 *
 * The session is the only mutable part, and it is edited optimistically then
 * autosaved. A reviewer who types four comments and reloads must find four
 * comments, so the debounce exists to coalesce keystrokes, not to defer the save
 * until something else happens.
 */
export function useReviewSession(target: ReviewTarget, workspaceId: string | null): ReviewSessionApi {
	const [state, setState] = useState<ReviewSessionState>({
		isLoading: true,
		loadError: null,
		mergeRequest: null,
		files: [],
		diffRefs: null,
		diffsTruncated: false,
		discussions: [],
		versions: [],
		rules: [],
		rulesGeneratedAt: null,
		session: null,
	});
	const [activePath, setActivePathState] = useState<string | null>(null);

	const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const pendingSessionRef = useRef<RuntimeReviewSession | null>(null);

	const flushSession = useCallback(async () => {
		const pending = pendingSessionRef.current;
		if (!pending) {
			return;
		}
		pendingSessionRef.current = null;
		try {
			const client = getRuntimeTrpcClient(workspaceId);
			const response = await client.review.saveSession.mutate({ session: pending });
			if (!response.ok) {
				showAppToast({ intent: "danger", message: response.error ?? "Could not save review drafts." });
			}
		} catch (error) {
			showAppToast({
				intent: "danger",
				message: error instanceof Error ? error.message : String(error),
			});
		}
	}, [workspaceId]);

	const queueSessionSave = useCallback(
		(session: RuntimeReviewSession) => {
			pendingSessionRef.current = session;
			if (saveTimerRef.current) {
				clearTimeout(saveTimerRef.current);
			}
			saveTimerRef.current = setTimeout(() => {
				saveTimerRef.current = null;
				void flushSession();
			}, SESSION_SAVE_DEBOUNCE_MS);
		},
		[flushSession],
	);

	/** Applies a change to the session and schedules the write in one step. */
	const updateSession = useCallback(
		(mutate: (session: RuntimeReviewSession) => RuntimeReviewSession) => {
			setState((prev) => {
				if (!prev.session) {
					return prev;
				}
				const next = mutate(prev.session);
				queueSessionSave(next);
				return { ...prev, session: next };
			});
		},
		[queueSessionSave],
	);

	const loadDiscussions = useCallback(async (): Promise<RuntimeGitlabDiscussion[]> => {
		const client = getRuntimeTrpcClient(workspaceId);
		const response = await client.gitlab.listDiscussions.query({
			projectId: target.projectId,
			iid: target.iid,
		});
		if (!response.ok) {
			showAppToast({ intent: "danger", message: response.error ?? "Could not load discussions." });
			return [];
		}
		return response.discussions;
	}, [target.iid, target.projectId, workspaceId]);

	const refresh = useCallback(async () => {
		setState((prev) => ({ ...prev, isLoading: true, loadError: null }));
		try {
			const client = getRuntimeTrpcClient(workspaceId);
			const ref = { projectId: target.projectId, iid: target.iid };
			// Issued together: the panels are independent, and serializing five reads
			// would make opening a review feel like five separate loads.
			const [detail, diffs, discussions, versions, session, rules] = await Promise.all([
				client.gitlab.getMergeRequest.query(ref),
				client.gitlab.getDiffs.query(ref),
				client.gitlab.listDiscussions.query(ref),
				client.gitlab.getVersions.query(ref),
				client.review.getSession.query({ host: target.host, ...ref }),
				client.review.getRules.query({ projectKey: target.projectKey }),
			]);

			// Only the diff is load-bearing: without it there is nothing to review, and a
			// blank pane with a toast is worse than an explicit failure. Everything else
			// degrades to empty with its own message.
			if (!diffs.ok) {
				setState((prev) => ({
					...prev,
					isLoading: false,
					loadError: diffs.error ?? "Could not load the merge request diff.",
				}));
				return;
			}

			setState({
				isLoading: false,
				loadError: null,
				mergeRequest: detail.mergeRequest,
				files: diffs.files,
				diffRefs: diffs.diffRefs,
				diffsTruncated: diffs.truncated,
				discussions: discussions.ok ? discussions.discussions : [],
				versions: versions.ok ? versions.versions : [],
				rules: rules.bundle?.rules ?? [],
				rulesGeneratedAt: rules.bundle?.generatedAt ?? null,
				session: session.session,
			});
			setActivePathState((current) => {
				if (current && diffs.files.some((file) => file.newPath === current)) {
					return current;
				}
				return diffs.files[0]?.newPath ?? null;
			});
		} catch (error) {
			setState((prev) => ({
				...prev,
				isLoading: false,
				loadError: error instanceof Error ? error.message : String(error),
			}));
		}
	}, [target.host, target.iid, target.projectId, target.projectKey, workspaceId]);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	// Flush on unmount: the debounce would otherwise drop the last edit when the
	// reviewer closes the pane right after typing.
	useEffect(() => {
		return () => {
			if (saveTimerRef.current) {
				clearTimeout(saveTimerRef.current);
				saveTimerRef.current = null;
			}
			void flushSession();
		};
	}, [flushSession]);

	const refreshDiscussions = useCallback(async () => {
		const discussions = await loadDiscussions();
		setState((prev) => ({ ...prev, discussions }));
	}, [loadDiscussions]);

	const activeFile = useMemo(
		() => state.files.find((file) => file.newPath === activePath) ?? null,
		[activePath, state.files],
	);

	const newCommitsSinceLastReview = useMemo(() => {
		const previousHeadSha = state.session?.lastReviewedHeadSha;
		const currentHeadSha = state.versions[0]?.headSha ?? state.diffRefs?.headSha;
		if (!previousHeadSha || !currentHeadSha || previousHeadSha === currentHeadSha) {
			return null;
		}
		return { previousHeadSha, currentHeadSha };
	}, [state.diffRefs?.headSha, state.session?.lastReviewedHeadSha, state.versions]);

	const toggleFileReviewed = useCallback(
		(path: string) => {
			updateSession((session) => {
				const reviewed = new Set(session.reviewedPaths);
				if (reviewed.has(path)) {
					reviewed.delete(path);
				} else {
					reviewed.add(path);
				}
				return { ...session, reviewedPaths: [...reviewed] };
			});
		},
		[updateSession],
	);

	const addDraftComment = useCallback(
		(draft: Omit<RuntimeReviewDraftComment, "id" | "createdAt" | "author">) => {
			updateSession((session) => ({
				...session,
				draftComments: [
					...session.draftComments,
					{
						...draft,
						id: nextDraftId(),
						createdAt: new Date().toISOString(),
						author: "You (Reviewer)",
					},
				],
			}));
		},
		[updateSession],
	);

	const removeDraftComment = useCallback(
		(id: string) => {
			updateSession((session) => ({
				...session,
				draftComments: session.draftComments.filter((draft) => draft.id !== id),
			}));
		},
		[updateSession],
	);

	const clearDraftComments = useCallback(() => {
		updateSession((session) => ({ ...session, draftComments: [] }));
	}, [updateSession]);

	const setFindings = useCallback(
		(findings: RuntimeReviewFinding[]) => {
			updateSession((session) => ({ ...session, findings }));
		},
		[updateSession],
	);

	const setChat = useCallback(
		(update: { messages: RuntimeReviewChatMessage[]; sessionId: string | null }) => {
			updateSession((session) => ({
				...session,
				chatMessages: update.messages,
				chatSessionId: update.sessionId,
			}));
		},
		[updateSession],
	);

	const dismissFinding = useCallback(
		(id: string) => {
			updateSession((session) => ({
				...session,
				dismissedFindingIds: session.dismissedFindingIds.includes(id)
					? session.dismissedFindingIds
					: [...session.dismissedFindingIds, id],
			}));
		},
		[updateSession],
	);

	const acceptFinding = useCallback(
		(finding: RuntimeReviewFinding) => {
			const file = state.files.find((candidate) => candidate.newPath === finding.newPath);
			updateSession((session) => ({
				...session,
				draftComments: [
					...session.draftComments,
					{
						id: nextDraftId(),
						newPath: finding.newPath,
						// A finding names only the post-image path; the pre-image path comes
						// from the file entry so a note on a renamed file still positions.
						oldPath: file?.oldPath ?? finding.newPath,
						oldLine: null,
						newLine: finding.newLine,
						text: finding.message,
						ruleIds: finding.ruleId ? [finding.ruleId] : [],
						author: "Claude review",
						createdAt: new Date().toISOString(),
						aiFindingId: finding.id,
					},
				],
			}));
		},
		[state.files, updateSession],
	);

	const markPassComplete = useCallback(() => {
		const headSha = state.versions[0]?.headSha ?? state.diffRefs?.headSha ?? null;
		updateSession((session) => ({ ...session, lastReviewedHeadSha: headSha }));
	}, [state.diffRefs?.headSha, state.versions, updateSession]);

	const currentHeadSha = state.versions[0]?.headSha ?? state.diffRefs?.headSha ?? null;

	const markPassRun = useCallback(
		(pass: RuntimeReviewCompletedPass["pass"]) => {
			updateSession((session) => ({
				...session,
				// One row per pass: the reviewer wants to know whether the *latest* run covers
				// what is on screen, and a history of every run would only be re-derived into
				// that same answer.
				completedPasses: [
					...session.completedPasses.filter((entry) => entry.pass !== pass),
					{ pass, headSha: currentHeadSha, at: new Date().toISOString() },
				],
			}));
		},
		[currentHeadSha, updateSession],
	);

	const passRunState = useCallback(
		(pass: RuntimeReviewCompletedPass["pass"]): ReviewRunState => {
			const entry = state.session?.completedPasses.find((candidate) => candidate.pass === pass);
			if (!entry) {
				return "unrun";
			}
			// An unknown head on either side cannot prove staleness, so it does not claim
			// any: a false "stale" costs a re-run, which is the thing being avoided.
			if (entry.headSha && currentHeadSha && entry.headSha !== currentHeadSha) {
				return "stale";
			}
			return "done";
		},
		[currentHeadSha, state.session?.completedPasses],
	);

	return {
		...state,
		activePath,
		setActivePath: setActivePathState,
		activeFile,
		newCommitsSinceLastReview,
		refresh,
		refreshDiscussions,
		toggleFileReviewed,
		addDraftComment,
		removeDraftComment,
		clearDraftComments,
		setFindings,
		setChat,
		dismissFinding,
		acceptFinding,
		markPassComplete,
		markPassRun,
		passRunState,
	};
}
