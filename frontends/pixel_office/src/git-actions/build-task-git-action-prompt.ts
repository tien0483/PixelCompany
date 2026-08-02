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

export const TASK_GIT_SEAM_TICKET_ID_PROMPT_VARIABLE: TaskGitPromptVariable = {
	key: "ticket_id",
	token: "{{ticket_id}}",
	description: "the task ID this work is filed under",
};
export const TASK_GIT_SEAM_AGENT_NAME_PROMPT_VARIABLE: TaskGitPromptVariable = {
	key: "agent_name",
	token: "{{agent_name}}",
	description: "your configured name, used to tag concurrent edits to shared files",
};
export const TASK_GIT_SEAM_COMMENT_TAG_PROMPT_VARIABLE: TaskGitPromptVariable = {
	key: "seam_comment_tag",
	token: "{{seam_comment_tag}}",
	description: "the computed seam-comment tag; reference this inside commit/PR prompts",
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
	seamCommentTagTemplate?: string | null;
	seamCommentTagTemplateDefault?: string | null;
}

interface BuildTaskGitActionPromptInput {
	action: TaskGitAction;
	workspaceInfo: RuntimeTaskWorkspaceInfoResponse;
	templates?: TaskGitPromptTemplates | null;
	agentDisplayName?: string;
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

export function resolveSeamCommentTag(
	templates?: TaskGitPromptTemplates | null,
	variables?: Record<string, string>,
): string {
	const resolvedTemplate = (() => {
		const template = templates?.seamCommentTagTemplate?.trim();
		if (template) {
			return template;
		}
		const defaultTemplate = templates?.seamCommentTagTemplateDefault?.trim();
		if (defaultTemplate) {
			return defaultTemplate;
		}
		return "";
	})();
	return interpolateTemplate(resolvedTemplate, variables ?? {});
}

export function buildTaskGitActionPrompt(input: BuildTaskGitActionPromptInput): string {
	const variables: Record<string, string> = {
		[TASK_GIT_BASE_REF_PROMPT_VARIABLE.key]: input.workspaceInfo.baseRef,
		[TASK_GIT_TASK_BRANCH_PROMPT_VARIABLE.key]: deriveTaskBranchName(input.workspaceInfo.taskId),
		[TASK_GIT_SEAM_TICKET_ID_PROMPT_VARIABLE.key]: input.workspaceInfo.taskId,
		[TASK_GIT_SEAM_AGENT_NAME_PROMPT_VARIABLE.key]: input.agentDisplayName ?? "",
	};
	variables[TASK_GIT_SEAM_COMMENT_TAG_PROMPT_VARIABLE.key] = resolveSeamCommentTag(input.templates, variables);
	const template = resolveTemplate(input.action, input.templates);
	return interpolateTemplate(template, variables);
}
