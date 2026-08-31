import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	type UseGitActionsResult,
	useGitActions,
} from "@/hooks/use-git-actions";
import type {
	RuntimeConfigResponse,
	RuntimeTaskWorkspaceInfoResponse,
} from "@/runtime/types";
import {
	clearTaskWorkspaceInfo,
	clearTaskWorkspaceSnapshot,
} from "@/stores/workspace-metadata-store";
import type { BoardData } from "@/types";

const showAppToastMock = vi.hoisted(() => vi.fn());
const useGitHistoryDataMock = vi.hoisted(() => vi.fn());
const workspaceMutateMocks = vi.hoisted(() => ({
	revertGitFile: vi.fn(),
	revertGitHunk: vi.fn(),
	commitWorkspaceChanges: vi.fn(),
	createPullRequest: vi.fn(),
	mergeTaskBranch: vi.fn(),
}));

vi.mock("@/components/app-toaster", () => ({
	showAppToast: showAppToastMock,
}));

vi.mock("@/components/git-history/use-git-history-data", () => ({
	useGitHistoryData: useGitHistoryDataMock,
}));

vi.mock("@/runtime/trpc-client", () => ({
	getRuntimeTrpcClient: () => ({
		workspace: {
			revertGitFile: { mutate: workspaceMutateMocks.revertGitFile },
			revertGitHunk: { mutate: workspaceMutateMocks.revertGitHunk },
			commitWorkspaceChanges: {
				mutate: workspaceMutateMocks.commitWorkspaceChanges,
			},
			createPullRequest: { mutate: workspaceMutateMocks.createPullRequest },
			mergeTaskBranch: { mutate: workspaceMutateMocks.mergeTaskBranch },
		},
	}),
}));

interface HookSnapshot {
	handleAgentCommitTask: UseGitActionsResult["handleAgentCommitTask"];
	handleMergeTaskBranch: UseGitActionsResult["handleMergeTaskBranch"];
	revertTaskFile: UseGitActionsResult["revertTaskFile"];
	revertTaskHunk: UseGitActionsResult["revertTaskHunk"];
	commitHomeChanges: UseGitActionsResult["commitHomeChanges"];
	createHomePullRequest: UseGitActionsResult["createHomePullRequest"];
}

function createGitHistoryResult(): UseGitActionsResult["gitHistory"] {
	return {
		viewMode: "commit",
		refs: [],
		activeRef: null,
		refsErrorMessage: null,
		isRefsLoading: false,
		workingCopyFileCount: 0,
		hasWorkingCopy: false,
		commits: [],
		totalCommitCount: 0,
		totalCommitCountIsExact: true,
		refsTruncated: false,
		diffTruncated: false,
		diffTotalFileCount: null,
		selectedCommitHash: null,
		selectedCommit: null,
		isLogLoading: false,
		isLoadingMoreCommits: false,
		logErrorMessage: null,
		diffSource: null,
		isDiffLoading: false,
		diffErrorMessage: null,
		selectedDiffPath: null,
		selectWorkingCopy: () => {},
		selectRef: () => {},
		selectCommit: () => {},
		selectDiffPath: () => {},
		loadMoreCommits: () => {},
		refresh: () => {},
	};
}

function createBoard(): BoardData {
	return {
		columns: [
			{
				id: "review",
				title: "Review",
				cards: [
					{
						id: "task-1",
						title: "Ship it",
						prompt: "Ship it",
						startInPlanMode: false,
						autoReviewEnabled: false,
						autoReviewMode: "commit",
						baseRef: "main",
						createdAt: 1,
						updatedAt: 1,
					},
				],
			},
		],
		dependencies: [],
	};
}

function createRuntimeConfig(
	selectedAgentId: RuntimeConfigResponse["selectedAgentId"],
): RuntimeConfigResponse {
	return {
		selectedAgentId,
		selectedShortcutLabel: null,
		defaultSubagentSeatProviderId: null,
		defaultSubagentSeatModelId: null,
		agentAutonomousModeEnabled: true,
		effectiveCommand: null,
		globalConfigPath: "/tmp/global-config.json",
		projectConfigPath: "/tmp/project-config.json",
		readyForReviewNotificationsEnabled: true,
		detectedCommands: [],
		agents: [
			{
				id: selectedAgentId,
				label: selectedAgentId,
				binary: selectedAgentId,
				command: selectedAgentId,
				defaultArgs: [],
				installed: true,
				configured: true,
			},
		],
		shortcuts: [],
		clineProviderSettings: {
			providerId: "anthropic",
			modelId: "claude-sonnet-4",
			baseUrl: null,
			apiKeyConfigured: true,
			oauthProvider: null,
			oauthAccessTokenConfigured: false,
			oauthRefreshTokenConfigured: false,
			oauthAccountId: null,
			oauthExpiresAt: null,
		},
		commitPromptTemplate: "commit",
		openPrPromptTemplate: "pr",
		commitPromptTemplateDefault: "commit",
		openPrPromptTemplateDefault: "pr",
		agentDisplayName: "",
		seamCommentTagTemplate: "seam",
		seamCommentTagTemplateDefault: "seam",
		commitTrailerMode: "omit",
		commitTrailerTemplate: "Co-Authored-By: Claude <noreply@anthropic.com>",
		commitTrailerTemplateDefault:
			"Co-Authored-By: Claude <noreply@anthropic.com>",
	};
}

function createWorkspaceInfo(): RuntimeTaskWorkspaceInfoResponse {
	return {
		taskId: "task-1",
		path: "/tmp/task-1",
		exists: true,
		baseRef: "main",
		branch: "task-1",
		isDetached: false,
		headCommit: "abc1234",
	};
}

function HookHarness({
	onSnapshot,
	sendTaskSessionInput,
	sendTaskChatMessage,
	board,
	fetchTaskWorkspaceInfo,
}: {
	onSnapshot: (snapshot: HookSnapshot) => void;
	sendTaskSessionInput: Parameters<
		typeof useGitActions
	>[0]["sendTaskSessionInput"];
	sendTaskChatMessage: Parameters<
		typeof useGitActions
	>[0]["sendTaskChatMessage"];
	board?: BoardData;
	fetchTaskWorkspaceInfo?: Parameters<
		typeof useGitActions
	>[0]["fetchTaskWorkspaceInfo"];
}): null {
	const gitActions = useGitActions({
		currentProjectId: "project-1",
		board: board ?? createBoard(),
		selectedCard: null,
		runtimeProjectConfig: createRuntimeConfig("cline"),
		sendTaskSessionInput,
		sendTaskChatMessage,
		fetchTaskWorkspaceInfo:
			fetchTaskWorkspaceInfo ?? (async () => createWorkspaceInfo()),
		isGitHistoryOpen: false,
		refreshWorkspaceState: async () => {},
	});

	useEffect(() => {
		onSnapshot({
			handleAgentCommitTask: gitActions.handleAgentCommitTask,
			handleMergeTaskBranch: gitActions.handleMergeTaskBranch,
			revertTaskFile: gitActions.revertTaskFile,
			revertTaskHunk: gitActions.revertTaskHunk,
			commitHomeChanges: gitActions.commitHomeChanges,
			createHomePullRequest: gitActions.createHomePullRequest,
		});
	}, [
		gitActions.handleAgentCommitTask,
		gitActions.handleMergeTaskBranch,
		gitActions.revertTaskFile,
		gitActions.revertTaskHunk,
		gitActions.commitHomeChanges,
		gitActions.createHomePullRequest,
		onSnapshot,
	]);

	return null;
}

describe("useGitActions", () => {
	let container: HTMLDivElement;
	let root: Root;
	let previousActEnvironment: boolean | undefined;

	beforeEach(() => {
		showAppToastMock.mockReset();
		useGitHistoryDataMock.mockReset();
		for (const fn of Object.values(workspaceMutateMocks)) {
			fn.mockReset();
		}
		useGitHistoryDataMock.mockReturnValue(createGitHistoryResult());
		clearTaskWorkspaceInfo("task-1");
		clearTaskWorkspaceSnapshot("task-1");
		previousActEnvironment = (
			globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
		).IS_REACT_ACT_ENVIRONMENT;
		(
			globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
		).IS_REACT_ACT_ENVIRONMENT = true;
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		container.remove();
		clearTaskWorkspaceInfo("task-1");
		clearTaskWorkspaceSnapshot("task-1");
		if (previousActEnvironment === undefined) {
			delete (
				globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
			).IS_REACT_ACT_ENVIRONMENT;
		} else {
			(
				globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
			).IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
		}
	});

	it("sends commit prompts through the native cline chat API", async () => {
		const sendTaskSessionInput = vi.fn(async () => ({ ok: true }));
		const sendTaskChatMessage = vi.fn(async () => ({ ok: true }));
		let latestSnapshot: HookSnapshot | null = null;

		await act(async () => {
			root.render(
				<HookHarness
					sendTaskSessionInput={sendTaskSessionInput}
					sendTaskChatMessage={sendTaskChatMessage}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
			await Promise.resolve();
		});

		if (latestSnapshot === null) {
			throw new Error("Expected a hook snapshot.");
		}

		await act(async () => {
			latestSnapshot?.handleAgentCommitTask("task-1");
			await Promise.resolve();
			await Promise.resolve();
			await Promise.resolve();
		});

		expect(sendTaskChatMessage).toHaveBeenCalledWith(
			"task-1",
			expect.any(String),
			{ mode: "act" },
		);
		expect(sendTaskSessionInput).not.toHaveBeenCalled();
		expect(showAppToastMock).not.toHaveBeenCalled();
	});

	it("sends commit prompts through the terminal when the task card uses a non-cline agent", async () => {
		const sendTaskSessionInput = vi.fn(async () => ({ ok: true }));
		const sendTaskChatMessage = vi.fn(async () => ({ ok: true }));
		let latestSnapshot: HookSnapshot | null = null;
		const board = createBoard();
		board.columns[0].cards[0] = {
			...board.columns[0].cards[0],
			agentId: "cursor",
		};

		await act(async () => {
			root.render(
				<HookHarness
					board={board}
					sendTaskSessionInput={sendTaskSessionInput}
					sendTaskChatMessage={sendTaskChatMessage}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
			await Promise.resolve();
		});

		if (latestSnapshot === null) {
			throw new Error("Expected a hook snapshot.");
		}

		await act(async () => {
			latestSnapshot?.handleAgentCommitTask("task-1");
			await Promise.resolve();
			await Promise.resolve();
			await Promise.resolve();
		});

		expect(sendTaskSessionInput).toHaveBeenCalled();
		expect(sendTaskChatMessage).not.toHaveBeenCalled();
		expect(showAppToastMock).not.toHaveBeenCalled();
	});

	async function mountHook(options?: {
		board?: BoardData;
		fetchTaskWorkspaceInfo?: Parameters<
			typeof useGitActions
		>[0]["fetchTaskWorkspaceInfo"];
	}): Promise<HookSnapshot> {
		let snapshot: HookSnapshot | null = null;
		await act(async () => {
			root.render(
				<HookHarness
					sendTaskSessionInput={vi.fn(async () => ({ ok: true }))}
					sendTaskChatMessage={vi.fn(async () => ({ ok: true }))}
					board={options?.board}
					fetchTaskWorkspaceInfo={options?.fetchTaskWorkspaceInfo}
					onSnapshot={(next) => {
						snapshot = next;
					}}
				/>,
			);
			await Promise.resolve();
		});
		if (snapshot === null) {
			throw new Error("Expected a hook snapshot.");
		}
		return snapshot;
	}

	it("reverts a task file with the task scope and toasts success", async () => {
		workspaceMutateMocks.revertGitFile.mockResolvedValue({ ok: true });
		const snapshot = await mountHook();

		await act(async () => {
			await snapshot.revertTaskFile("task-1", "main", "src/a.ts");
		});

		expect(workspaceMutateMocks.revertGitFile).toHaveBeenCalledWith({
			path: "src/a.ts",
			taskInfo: { taskId: "task-1", baseRef: "main" },
		});
		expect(showAppToastMock).toHaveBeenCalledWith(
			expect.objectContaining({ intent: "success" }),
		);
	});

	it("shows a danger toast when a file revert is refused", async () => {
		workspaceMutateMocks.revertGitFile.mockResolvedValue({
			ok: false,
			error: "locked",
		});
		const snapshot = await mountHook();

		await act(async () => {
			await snapshot.revertTaskFile("task-1", "main", "src/a.ts");
		});

		expect(showAppToastMock).toHaveBeenCalledWith(
			expect.objectContaining({ intent: "danger", message: "locked" }),
		);
	});

	it("forwards the hunk index when reverting a hunk", async () => {
		workspaceMutateMocks.revertGitHunk.mockResolvedValue({ ok: true });
		const snapshot = await mountHook();

		await act(async () => {
			await snapshot.revertTaskHunk("task-1", "main", "src/a.ts", 3);
		});

		expect(workspaceMutateMocks.revertGitHunk).toHaveBeenCalledWith({
			path: "src/a.ts",
			hunkIndex: 3,
			taskInfo: { taskId: "task-1", baseRef: "main" },
		});
	});

	it("merges a task with the base ref the runtime reports, keyed on its own task id", async () => {
		workspaceMutateMocks.mergeTaskBranch.mockResolvedValue({
			ok: true,
			branch: "task-1",
			baseRef: "release",
			summary: { changedFiles: 0 },
		});
		const fetchTaskWorkspaceInfo = vi.fn(async () => ({
			...createWorkspaceInfo(),
			baseRef: "release",
			baseRefLocked: true,
		}));
		const snapshot = await mountHook({ fetchTaskWorkspaceInfo });

		await act(async () => {
			snapshot.handleMergeTaskBranch("task-1");
			await Promise.resolve();
		});

		expect(fetchTaskWorkspaceInfo).toHaveBeenCalledWith(
			expect.objectContaining({ id: "task-1" }),
			{ worktreeTaskId: "task-1" },
		);
		expect(workspaceMutateMocks.mergeTaskBranch).toHaveBeenCalledWith({
			taskId: "task-1",
			baseRef: "release",
			worktreeTaskId: "task-1",
		});
	});

	it("merges a chain follower through its chain root's worktree", async () => {
		workspaceMutateMocks.mergeTaskBranch.mockResolvedValue({
			ok: true,
			branch: "kanban/task-root",
			baseRef: "release",
			summary: { changedFiles: 0 },
		});
		const board = createBoard();
		const followerCard = {
			...createBoard().columns[0]!.cards[0]!,
			id: "task-follower",
			title: "Follow up",
			prompt: "Follow up",
		};
		const chainBoard: BoardData = {
			columns: [
				{
					...board.columns[0]!,
					cards: [
						{ ...board.columns[0]!.cards[0]!, id: "task-root" },
						followerCard,
					],
				},
			],
			dependencies: [
				{
					id: "dep-1",
					fromTaskId: "task-follower",
					toTaskId: "task-root",
					chain: true,
					createdAt: 1,
				},
			],
		};
		const fetchTaskWorkspaceInfo = vi.fn(async () => ({
			...createWorkspaceInfo(),
			taskId: "task-follower",
			baseRef: "release",
			baseRefLocked: true,
		}));
		const snapshot = await mountHook({
			board: chainBoard,
			fetchTaskWorkspaceInfo,
		});

		await act(async () => {
			snapshot.handleMergeTaskBranch("task-follower");
			await Promise.resolve();
		});

		expect(fetchTaskWorkspaceInfo).toHaveBeenCalledWith(
			expect.objectContaining({ id: "task-follower" }),
			{ worktreeTaskId: "task-root" },
		);
		expect(workspaceMutateMocks.mergeTaskBranch).toHaveBeenCalledWith({
			taskId: "task-follower",
			baseRef: "release",
			worktreeTaskId: "task-root",
		});
	});

	it("returns true from commitHomeChanges on success", async () => {
		workspaceMutateMocks.commitWorkspaceChanges.mockResolvedValue({
			ok: true,
			summary: { changedFiles: 0 },
		});
		const snapshot = await mountHook();

		let result = false;
		await act(async () => {
			result = await snapshot.commitHomeChanges("my commit");
		});

		expect(workspaceMutateMocks.commitWorkspaceChanges).toHaveBeenCalledWith({
			message: "my commit",
		});
		expect(result).toBe(true);
	});

	it("returns the PR url from createHomePullRequest on success", async () => {
		workspaceMutateMocks.createPullRequest.mockResolvedValue({
			ok: true,
			url: "https://pr/1",
		});
		const snapshot = await mountHook();

		let result: { ok: boolean; url: string | null } = { ok: false, url: null };
		await act(async () => {
			result = await snapshot.createHomePullRequest("T", "B", "main");
		});

		expect(workspaceMutateMocks.createPullRequest).toHaveBeenCalledWith({
			title: "T",
			body: "B",
			base: "main",
		});
		expect(result).toEqual({ ok: true, url: "https://pr/1" });
	});
});
