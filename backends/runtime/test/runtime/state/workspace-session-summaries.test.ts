import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { RuntimeBoardData, RuntimeTaskSessionSummary } from "../../../src/core/api-contract";
import {
	getWorkspaceDirectoryPath,
	loadWorkspaceContext,
	loadWorkspaceState,
	saveWorkspaceSessionSummaries,
	saveWorkspaceState,
} from "../../../src/state/workspace-state";
import { createGitTestEnv } from "../../utilities/git-env";
import { createTempDir } from "../../utilities/temp-dir";

function createBoard(title: string): RuntimeBoardData {
	return {
		columns: [
			{
				id: "backlog",
				title: "Backlog",
				cards: [
					{
						id: "task-1",
						title,
						prompt: title,
						startInPlanMode: false,
						baseRef: "main",
						createdAt: Date.now(),
						updatedAt: Date.now(),
					},
				],
			},
			{ id: "in_progress", title: "In Progress", cards: [] },
			{ id: "review", title: "Review", cards: [] },
			{ id: "trash", title: "Done", cards: [] },
		],
		dependencies: [],
	};
}

function createSessionSummary(taskId: string, overrides: Partial<RuntimeTaskSessionSummary> = {}): RuntimeTaskSessionSummary {
	return {
		taskId,
		state: "idle",
		agentId: null,
		workspacePath: null,
		pid: null,
		startedAt: null,
		activeRunMs: 0,
		runningSince: null,
		pausedAt: null,
		pauseReason: null,
		updatedAt: Date.now(),
		lastOutputAt: null,
		reviewReason: null,
		exitCode: null,
		lastHookAt: null,
		latestHookActivity: null,
		...overrides,
	};
}

async function withTemporaryHome<T>(run: () => Promise<T>): Promise<T> {
	const { path: tempHome, cleanup } = createTempDir("kanban-home-session-summaries-");
	const previousHome = process.env.HOME;
	const previousUserProfile = process.env.USERPROFILE;
	process.env.HOME = tempHome;
	process.env.USERPROFILE = tempHome;
	try {
		return await run();
	} finally {
		if (previousHome === undefined) {
			delete process.env.HOME;
		} else {
			process.env.HOME = previousHome;
		}
		if (previousUserProfile === undefined) {
			delete process.env.USERPROFILE;
		} else {
			process.env.USERPROFILE = previousUserProfile;
		}
		cleanup();
	}
}

function initGitRepository(path: string): void {
	const init = spawnSync("git", ["init"], {
		cwd: path,
		stdio: "ignore",
		env: createGitTestEnv(),
	});
	if (init.status !== 0) {
		throw new Error(`Failed to initialize git repository at ${path}`);
	}
}

describe.sequential("saveWorkspaceSessionSummaries", () => {
	it("merges summaries into sessions.json by taskId, preserving unrelated entries", async () => {
		await withTemporaryHome(async () => {
			const { path: sandboxRoot, cleanup } = createTempDir("kanban-session-summaries-merge-");
			try {
				const workspacePath = join(sandboxRoot, "project-a");
				mkdirSync(workspacePath, { recursive: true });
				initGitRepository(workspacePath);

				const context = await loadWorkspaceContext(workspacePath);

				await saveWorkspaceSessionSummaries(context.workspaceId, [
					createSessionSummary("task-1", { state: "running", pid: 111 }),
					createSessionSummary("task-2", { state: "idle" }),
				]);

				const afterFirstWrite = await loadWorkspaceState(workspacePath);
				expect(Object.keys(afterFirstWrite.sessions).sort()).toEqual(["task-1", "task-2"]);
				expect(afterFirstWrite.sessions["task-1"]?.state).toBe("running");
				expect(afterFirstWrite.sessions["task-1"]?.pid).toBe(111);

				// Overwrite task-1, leave task-2 untouched, add task-3.
				await saveWorkspaceSessionSummaries(context.workspaceId, [
					createSessionSummary("task-1", { state: "awaiting_review", pid: null }),
					createSessionSummary("task-3", { state: "idle" }),
				]);

				const afterSecondWrite = await loadWorkspaceState(workspacePath);
				expect(Object.keys(afterSecondWrite.sessions).sort()).toEqual(["task-1", "task-2", "task-3"]);
				expect(afterSecondWrite.sessions["task-1"]?.state).toBe("awaiting_review");
				expect(afterSecondWrite.sessions["task-1"]?.pid).toBeNull();
				expect(afterSecondWrite.sessions["task-2"]?.state).toBe("idle");
				expect(afterSecondWrite.sessions["task-3"]?.state).toBe("idle");
			} finally {
				cleanup();
			}
		});
	});

	it("anti-regression: never touches meta.json or bumps revision, so a later client save with the pre-write expectedRevision still succeeds", async () => {
		await withTemporaryHome(async () => {
			const { path: sandboxRoot, cleanup } = createTempDir("kanban-session-summaries-no-conflict-");
			try {
				const workspacePath = join(sandboxRoot, "project-b");
				mkdirSync(workspacePath, { recursive: true });
				initGitRepository(workspacePath);

				const context = await loadWorkspaceContext(workspacePath);

				// Establish a baseline revision via a normal client save.
				const initial = await loadWorkspaceState(workspacePath);
				const baseline = await saveWorkspaceState(workspacePath, {
					board: createBoard("Task One"),
					sessions: {},
					expectedRevision: initial.revision,
				});
				expect(baseline.revision).toBe(1);

				const metaPath = join(getWorkspaceDirectoryPath(context.workspaceId), "meta.json");
				const metaBefore = readFileSync(metaPath, "utf8");

				// Fire a conflict-storm's worth of session-summary writes (pause/resume/exit churn).
				for (let index = 0; index < 25; index += 1) {
					await saveWorkspaceSessionSummaries(context.workspaceId, [
						createSessionSummary("task-1", { state: "running", pid: 1000 + index, activeRunMs: index }),
					]);
				}

				const metaAfter = readFileSync(metaPath, "utf8");
				// Byte-for-byte: session-summary writes must not touch meta.json at all.
				expect(metaAfter).toBe(metaBefore);
				expect(JSON.parse(metaAfter).revision).toBe(JSON.parse(metaBefore).revision);

				const stateAfterChurn = await loadWorkspaceState(workspacePath);
				expect(stateAfterChurn.revision).toBe(baseline.revision);
				expect(stateAfterChurn.sessions["task-1"]?.state).toBe("running");
				expect(stateAfterChurn.sessions["task-1"]?.pid).toBe(1024);

				// The load-bearing assertion: a client that only ever saw `baseline.revision`
				// (never having observed any of the server-side session-summary churn) can
				// still save successfully using that same expectedRevision — proving the
				// churn never bumped revision out from under it.
				const clientSave = await saveWorkspaceState(workspacePath, {
					board: createBoard("Task One Updated"),
					sessions: stateAfterChurn.sessions,
					expectedRevision: baseline.revision,
				});
				expect(clientSave.revision).toBe(baseline.revision + 1);
				expect(clientSave.sessions["task-1"]?.state).toBe("running");
			} finally {
				cleanup();
			}
		});
	});
});
