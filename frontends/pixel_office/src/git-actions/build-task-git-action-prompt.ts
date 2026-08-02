import type { RuntimeTaskAutoReviewMode, RuntimeTaskWorkspaceInfoResponse } from "@/runtime/types";

export type TaskGitAction = Extract<RuntimeTaskAutoReviewMode, "commit" | "pr">;

interface TaskGitPromptVariable {
	key: string;
	token: string;
	description: string;
}

export const TASK_GIT_BASE_REF_PROMPT_VARIABLE: TaskGitPromptVariable = {
	key: "base_ref",
	token: "{{base_ref}}",
	description: "the branch this task worktree was created from",
};

export const TASK_GIT_TASK_BRANCH_PROMPT_VARIABLE: TaskGitPromptVariable = {
	key: "task_branch",
	token: "{{task_branch}}",
	description: "the dedicated branch to commit this task's work onto",
};

/**
 * Deterministic name for a task's commit branch. The commit agent creates this
 * branch and the "Merge → base" card button merges the task worktree's branch
 * back into the base ref, so both sides agree on a predictable name.
 */
export function deriveTaskBranchName(taskId: string): string {
	const normalized = taskId
		.trim()
		.replace(/[^A-Za-z0-9._/-]+/g, "-")
		.replace(/^[-/]+|[-/]+$/g, "");
	return `kanban/task-${normalized || "task"}`;
}

export interface TaskGitPromptTemplates {
	commitPromptTemplate?: string | null;
	openPrPromptTemplate?: string | null;
	commitPromptTemplateDefault?: string | null;
	openPrPromptTemplateDefault?: string | null;
}

interface BuildTaskGitActionPromptInput {
	action: TaskGitAction;
	workspaceInfo: RuntimeTaskWorkspaceInfoResponse;
	templates?: TaskGitPromptTemplates | null;
}

function resolveTemplate(action: TaskGitAction, templates?: TaskGitPromptTemplates | null): string {
	if (action === "commit") {
		const template = templates?.commitPromptTemplate?.trim();
		if (template) {
			return template;
		}
		const defaultTemplate = templates?.commitPromptTemplateDefault?.trim();
		if (defaultTemplate) {
			return defaultTemplate;
		}
		return "Handle this commit action using the provided git context.";
	}
	const template = templates?.openPrPromptTemplate?.trim();
	if (template) {
		return template;
	}
	const defaultTemplate = templates?.openPrPromptTemplateDefault?.trim();
	if (defaultTemplate) {
		return defaultTemplate;
	}
	return "Handle this pull request action using the provided git context.";
}

function interpolateTemplate(template: string, variables: Record<string, string>): string {
	let result = template;
	for (const [key, value] of Object.entries(variables)) {
		result = result.replaceAll(`{{${key}}}`, value);
	}
	return result;
}

export function buildTaskGitActionPrompt(input: BuildTaskGitActionPromptInput): string {
	const variables: Record<string, string> = {
		[TASK_GIT_BASE_REF_PROMPT_VARIABLE.key]: input.workspaceInfo.baseRef,
		[TASK_GIT_TASK_BRANCH_PROMPT_VARIABLE.key]: deriveTaskBranchName(input.workspaceInfo.taskId),
	};
	const template = resolveTemplate(input.action, input.templates);
	return interpolateTemplate(template, variables);
}
