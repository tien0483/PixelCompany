import type { RuntimeGitWorktreeEntry, RuntimeGitWorktreeInventoryResponse } from "../core/api-contract";
import { runGit } from "./git-utils";

/**
 * Parses `git worktree list --porcelain`. Entries are separated by a blank line;
 * the first entry is always the repository's main worktree. Each entry has a
 * `worktree <path>` line plus optional `HEAD`, `branch`, `detached`, and `bare`
 * attribute lines.
 */
export function parseWorktreePorcelain(output: string): RuntimeGitWorktreeEntry[] {
	const blocks = output.split(/\n\s*\n/);
	const entries: RuntimeGitWorktreeEntry[] = [];

	for (const block of blocks) {
		const lines = block.split("\n").map((line) => line.trim());
		let path: string | null = null;
		let head: string | null = null;
		let branch: string | null = null;
		let isDetached = false;
		let isBare = false;

		for (const line of lines) {
			if (line.startsWith("worktree ")) {
				path = line.slice("worktree ".length);
			} else if (line.startsWith("HEAD ")) {
				head = line.slice("HEAD ".length);
			} else if (line.startsWith("branch ")) {
				branch = line.slice("branch ".length).replace(/^refs\/heads\//, "");
			} else if (line === "detached") {
				isDetached = true;
			} else if (line === "bare") {
				isBare = true;
			}
		}

		if (!path) {
			continue;
		}
		entries.push({
			path,
			head,
			branch,
			isMain: entries.length === 0,
			isDetached,
			isBare,
		});
	}

	return entries;
}

export async function listGitWorktrees(cwd: string): Promise<RuntimeGitWorktreeInventoryResponse> {
	const repoRootResult = await runGit(cwd, ["rev-parse", "--show-toplevel"]);
	if (!repoRootResult.ok || !repoRootResult.stdout) {
		return { ok: false, worktrees: [], error: "No git repository detected." };
	}

	const listResult = await runGit(repoRootResult.stdout, ["worktree", "list", "--porcelain"], { trimStdout: false });
	if (!listResult.ok) {
		return { ok: false, worktrees: [], error: listResult.error ?? "Failed to list worktrees." };
	}

	return { ok: true, worktrees: parseWorktreePorcelain(listResult.stdout) };
}
