import { homedir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { shouldAutoConfirmClaudeWorkspaceTrust } from "../../../src/terminal/claude-workspace-trust";
import {
	LEGACY_RUNTIME_HOME_PARENT_DIR_NAME,
	RUNTIME_HOME_PARENT_DIR_NAME,
} from "../../../src/workspace/task-worktree-path";

/**
 * Worktrees created before the home-directory rename are never moved (git records
 * absolute paths), so auto-trust has to recognise both roots or those in-flight tasks
 * would start prompting "do you trust this folder?" again.
 */
describe("claude workspace trust across runtime home roots", () => {
	const worktreeUnder = (parentDir: string) => join(homedir(), parentDir, "worktrees", "task-1", "my-repo");

	it("auto-confirms inside the current worktree root", () => {
		expect(shouldAutoConfirmClaudeWorkspaceTrust("claude", worktreeUnder(RUNTIME_HOME_PARENT_DIR_NAME))).toBe(true);
	});

	it("auto-confirms inside the legacy worktree root", () => {
		expect(shouldAutoConfirmClaudeWorkspaceTrust("claude", worktreeUnder(LEGACY_RUNTIME_HOME_PARENT_DIR_NAME))).toBe(
			true,
		);
	});

	it("auto-confirms for claude with any workspace or worktree path", () => {
		expect(shouldAutoConfirmClaudeWorkspaceTrust("claude", join(homedir(), "code", "my-repo"))).toBe(true);
	});

	it("does not auto-confirm when cwd is empty", () => {
		expect(shouldAutoConfirmClaudeWorkspaceTrust("claude", "")).toBe(false);
	});

	it("auto-confirms for gemini, which is also how Antigravity CLI launches", () => {
		expect(shouldAutoConfirmClaudeWorkspaceTrust("gemini", worktreeUnder(RUNTIME_HOME_PARENT_DIR_NAME))).toBe(true);
	});

	it("does not auto-confirm for gemini when cwd is empty", () => {
		expect(shouldAutoConfirmClaudeWorkspaceTrust("gemini", "")).toBe(false);
	});

	it("leaves agents with their own trust handling alone", () => {
		expect(shouldAutoConfirmClaudeWorkspaceTrust("codex", worktreeUnder(RUNTIME_HOME_PARENT_DIR_NAME))).toBe(false);
		expect(shouldAutoConfirmClaudeWorkspaceTrust("cursor", worktreeUnder(RUNTIME_HOME_PARENT_DIR_NAME))).toBe(false);
	});
});
