import { describe, expect, it } from "vitest";

import {
	buildTaskGitActionPrompt,
	COMMIT_TRAILER_OMIT_POLICY,
	TASK_GIT_BASE_REF_PROMPT_VARIABLE,
	TASK_GIT_COMMIT_TRAILER_PROMPT_VARIABLE,
} from "@/git-actions/build-task-git-action-prompt";

const workspaceInfo = {
	taskId: "task-123",
	path: "/tmp/task-123",
	exists: true,
	baseRef: "main",
	branch: null,
	isDetached: true,
	headCommit: "abc123",
} as const;

describe("buildTaskGitActionPrompt", () => {
	it("interpolates the shared base ref variable into custom templates", () => {
		expect(
			buildTaskGitActionPrompt({
				action: "commit",
				workspaceInfo,
				templates: {
					commitPromptTemplate: `Commit onto ${TASK_GIT_BASE_REF_PROMPT_VARIABLE.token}.`,
				},
			}),
		).toBe(`Commit onto main.\n\n${COMMIT_TRAILER_OMIT_POLICY}`);
	});

	it("falls back to the default action prompt when no template is configured", () => {
		expect(
			buildTaskGitActionPrompt({
				action: "pr",
				workspaceInfo,
			}),
		).toBe(
			`Handle this pull request action using the provided git context.\n\n${COMMIT_TRAILER_OMIT_POLICY}`,
		);
	});

	it("uses taskBranchOverride for {{task_branch}} when provided", () => {
		expect(
			buildTaskGitActionPrompt({
				action: "commit",
				workspaceInfo,
				taskBranchOverride: "feature/official",
				templates: {
					commitPromptTemplate: "Branch={{task_branch}}",
				},
			}),
		).toBe(`Branch=feature/official\n\n${COMMIT_TRAILER_OMIT_POLICY}`);
	});

	it("omits trailer text and appends omit policy by default", () => {
		const prompt = buildTaskGitActionPrompt({
			action: "commit",
			workspaceInfo,
			templates: {
				commitPromptTemplate: `Trailer=[${TASK_GIT_COMMIT_TRAILER_PROMPT_VARIABLE.token}]`,
				commitTrailerMode: "omit",
				commitTrailerTemplate: "Co-Authored-By: Claude <noreply@anthropic.com>",
			},
		});
		expect(prompt).toBe(`Trailer=[]\n\n${COMMIT_TRAILER_OMIT_POLICY}`);
	});

	it("includes resolved trailer text and include policy when mode is include", () => {
		const prompt = buildTaskGitActionPrompt({
			action: "commit",
			workspaceInfo,
			agentDisplayName: "Tien",
			templates: {
				commitPromptTemplate: `Trailer=[${TASK_GIT_COMMIT_TRAILER_PROMPT_VARIABLE.token}]`,
				commitTrailerMode: "include",
				commitTrailerTemplate: "Co-Authored-By: {{agent_name}} <agent@example.com>",
			},
		});
		expect(prompt).toBe(
			[
				"Trailer=[Co-Authored-By: Tien <agent@example.com>]",
				"",
				"Append this exact trailer line to the commit message (and do not invent other AI attribution footers):",
				"Co-Authored-By: Tien <agent@example.com>",
			].join("\n"),
		);
	});
});
