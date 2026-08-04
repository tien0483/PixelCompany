import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { RuntimeBoardData } from "../../src/core/api-contract";
import { addTaskDependency, addTaskToColumn, moveTaskToColumn } from "../../src/core/task-board-mutations";
import { createWorkspaceMetadataMonitor } from "../../src/server/workspace-metadata-monitor";
import { ensureTaskWorktreeIfDoesntExist } from "../../src/workspace/task-worktree";
import { createGitTestEnv } from "../utilities/git-env";
import { createTempDir } from "../utilities/temp-dir";

function runGit(cwd: string, args: string[]): string {
	const result = spawnSync("git", args, {
		cwd,
		encoding: "utf8",
		env: createGitTestEnv(),
	});
	if (result.status !== 0) {
		throw new Error(
			[`git ${args.join(" ")} failed in ${cwd}`, result.stdout.trim(), result.stderr.trim()]
				.filter((part) => part.length > 0)
				.join("\n"),
		);
	}
	return result.stdout.trim();
}

async function withTemporaryHome<T>(run: () => Promise<T>): Promise<T> {
	const { path: tempHome, cleanup } = createTempDir("kanban-home-");
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

function emptyBoard(): RuntimeBoardData {
	return {
		columns: [
			{ id: "backlog", title: "Backlog", cards: [] },
			{ id: "in_progress", title: "In Progress", cards: [] },
			{ id: "review", title: "Review", cards: [] },
			{ id: "trash", title: "Done", cards: [] },
		],
		dependencies: [],
	};
}

describe.sequential("workspace-metadata-monitor integration", () => {
	it("reports a chain follower's metadata from the root's shared worktree, keyed by the follower's own taskId", async () => {
		await withTemporaryHome(async () => {
			const { path: sandboxRoot, cleanup } = createTempDir("kanban-metadata-monitor-chain-");
			try {
				const repoPath = join(sandboxRoot, "repo");
				mkdirSync(repoPath, { recursive: true });

				runGit(repoPath, ["init"]);
				runGit(repoPath, ["config", "user.name", "Kanban Test"]);
				runGit(repoPath, ["config", "user.email", "kanban-test@example.com"]);
				writeFileSync(join(repoPath, "README.md"), "hello\n", "utf8");
				runGit(repoPath, ["add", "README.md"]);
				runGit(repoPath, ["commit", "-m", "init"]);

				// Build a board where "root-task" is a chain root and "follower-task" is its
				// follower, both already running (queued in In Progress) — mirrors the real
				// "run chain" flow, which moves every member into In Progress up front.
				const withRoot = addTaskToColumn(
					emptyBoard(),
					"backlog",
					{ prompt: "Chain root", baseRef: "HEAD" },
					() => "root-task",
				);
				const withFollower = addTaskToColumn(
					withRoot.board,
					"backlog",
					{ prompt: "Chain follower", baseRef: "HEAD" },
					() => "follower-task",
				);
				const linked = addTaskDependency(withFollower.board, "root-task", "follower-task");
				expect(linked.added).toBe(true);
				expect(linked.dependency?.chain).toBe(true);
				let board = moveTaskToColumn(linked.board, "root-task", "in_progress").board;
				board = moveTaskToColumn(board, "follower-task", "in_progress").board;

				// The chain root's worktree already exists on disk (as it would after the root's
				// session started) — the follower's own id has never had a worktree created.
				const rootWorktree = await ensureTaskWorktreeIfDoesntExist({
					cwd: repoPath,
					taskId: "root-task",
					baseRef: "HEAD",
				});
				expect(rootWorktree.ok).toBe(true);
				if (!rootWorktree.ok || !rootWorktree.path) {
					throw new Error("Root task worktree was not created");
				}

				const monitor = createWorkspaceMetadataMonitor({ onMetadataUpdated: () => {} });
				try {
					const snapshot = await monitor.connectWorkspace({
						workspaceId: "ws-chain-metadata",
						workspacePath: repoPath,
						board,
					});

					const followerMetadata = snapshot.taskWorkspaces.find((task) => task.taskId === "follower-task");
					expect(followerMetadata).toBeDefined();
					// Reported id stays the follower's own id...
					expect(followerMetadata?.taskId).toBe("follower-task");
					// ...but path/existence/branch come from the chain root's real worktree, not a
					// (nonexistent) "follower-task" worktree.
					expect(followerMetadata?.path).toBe(rootWorktree.path);
					expect(followerMetadata?.exists).toBe(true);

					const rootMetadata = snapshot.taskWorkspaces.find((task) => task.taskId === "root-task");
					expect(rootMetadata).toBeDefined();
					expect(rootMetadata?.path).toBe(rootWorktree.path);
					expect(rootMetadata?.exists).toBe(true);
				} finally {
					monitor.close();
				}
			} finally {
				cleanup();
			}
		});
	});

	it("reports a standalone (non-chain) task's own worktree as missing until it is created", async () => {
		await withTemporaryHome(async () => {
			const { path: sandboxRoot, cleanup } = createTempDir("kanban-metadata-monitor-standalone-");
			try {
				const repoPath = join(sandboxRoot, "repo");
				mkdirSync(repoPath, { recursive: true });

				runGit(repoPath, ["init"]);
				runGit(repoPath, ["config", "user.name", "Kanban Test"]);
				runGit(repoPath, ["config", "user.email", "kanban-test@example.com"]);
				writeFileSync(join(repoPath, "README.md"), "hello\n", "utf8");
				runGit(repoPath, ["add", "README.md"]);
				runGit(repoPath, ["commit", "-m", "init"]);

				const withTask = addTaskToColumn(
					emptyBoard(),
					"backlog",
					{ prompt: "Standalone task", baseRef: "HEAD" },
					() => "standalone-task",
				);
				const board = moveTaskToColumn(withTask.board, "standalone-task", "in_progress").board;

				const monitor = createWorkspaceMetadataMonitor({ onMetadataUpdated: () => {} });
				try {
					const snapshot = await monitor.connectWorkspace({
						workspaceId: "ws-standalone-metadata",
						workspacePath: repoPath,
						board,
					});

					const metadata = snapshot.taskWorkspaces.find((task) => task.taskId === "standalone-task");
					expect(metadata).toBeDefined();
					expect(metadata?.exists).toBe(false);
				} finally {
					monitor.close();
				}
			} finally {
				cleanup();
			}
		});
	});
});
