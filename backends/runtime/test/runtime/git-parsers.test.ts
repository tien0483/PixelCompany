import { describe, expect, it } from "vitest";

import { parseBlamePorcelain } from "../../src/workspace/git-history.js";
import { parseWorktreePorcelain } from "../../src/workspace/git-worktree-inventory.js";

describe("parseWorktreePorcelain", () => {
	it("parses main and linked worktrees, flagging the first as main", () => {
		const output = [
			"worktree /repo/main",
			"HEAD aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
			"branch refs/heads/main",
			"",
			"worktree /repo/.agent/worktrees/task-1",
			"HEAD bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
			"detached",
			"",
		].join("\n");
		const entries = parseWorktreePorcelain(output);
		expect(entries).toHaveLength(2);
		expect(entries[0]).toMatchObject({ path: "/repo/main", branch: "main", isMain: true, isDetached: false });
		expect(entries[1]).toMatchObject({
			path: "/repo/.agent/worktrees/task-1",
			branch: null,
			isMain: false,
			isDetached: true,
		});
	});

	it("flags a bare repository worktree", () => {
		const entries = parseWorktreePorcelain("worktree /repo/bare\nbare\n");
		expect(entries[0]).toMatchObject({ path: "/repo/bare", isBare: true });
	});
});

describe("parseBlamePorcelain", () => {
	it("attaches cached commit metadata to every line of the same commit", () => {
		const output = [
			"1111111111111111111111111111111111111111 1 1 2",
			"author Alice",
			"author-time 1700000000",
			"summary first commit",
			"filename foo.txt",
			"\tline one",
			"1111111111111111111111111111111111111111 2 2",
			"\tline two",
		].join("\n");
		const lines = parseBlamePorcelain(output);
		expect(lines).toHaveLength(2);
		expect(lines[0]).toMatchObject({ lineNumber: 1, author: "Alice", summary: "first commit", shortHash: "1111111" });
		// Second line reuses cached metadata from the first appearance of the commit.
		expect(lines[1]).toMatchObject({ lineNumber: 2, author: "Alice", summary: "first commit" });
		expect(lines[0]?.date).toBe(new Date(1700000000 * 1000).toISOString());
	});
});
