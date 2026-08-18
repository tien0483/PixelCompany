// The three `/api/review/*` SSE routes, for the standalone Review package.
//
// Same handler and prompts as the full app (`review-stream-route.ts`), minus the
// Manager seat pin: this package has no Manager, so the agent bills whatever
// `claude` credential is already logged in on the machine.
import type { IncomingMessage, ServerResponse } from "node:http";

import {
	runtimeReviewAuditRequestSchema,
	runtimeReviewChatRequestSchema,
	runtimeReviewRulesExtractRequestSchema,
} from "../core/api-contract";
import {
	REVIEW_AUDIT_ALLOWED_TOOLS,
	REVIEW_CHAT_ALLOWED_TOOLS,
	REVIEW_RULES_EXTRACT_ALLOWED_TOOLS,
	resolveReviewAgentCwd,
} from "../review/review-agent-args";
import { buildAuditPrompt, buildChatPrompt, buildRulesExtractPrompt } from "../review/review-prompts";
import { readReviewRulesBundle } from "../review/review-rules";
import { handleAgentStreamRoute } from "../review/review-stream-route";
import type { ReviewTrpcContext } from "./router";

/** Returns true when it handled the request, mirroring `tryHandlePlanEditorHtmlRoute`. */
export async function tryHandleReviewStandaloneRoute(
	req: IncomingMessage,
	res: ServerResponse,
	pathname: string,
	context: ReviewTrpcContext,
): Promise<boolean> {
	const isPost = (req.method ?? "GET").toUpperCase() === "POST";

	if (pathname === "/api/review/rules-extract" && isPost) {
		await handleAgentStreamRoute(req, res, {
			schema: runtimeReviewRulesExtractRequestSchema,
			buildRun: async (input) => ({
				ok: true,
				prompt: buildRulesExtractPrompt({ sourceRoots: input.sourceRoots }),
				model: input.model,
				allowedTools: REVIEW_RULES_EXTRACT_ALLOWED_TOOLS,
			}),
		});
		return true;
	}

	if (pathname === "/api/review/audit" && isPost) {
		await handleAgentStreamRoute(req, res, {
			maxBodyBytes: 8 * 1024 * 1024,
			schema: runtimeReviewAuditRequestSchema,
			buildRun: async (input) => {
				const bundle = await readReviewRulesBundle(input.projectKey);
				if (!bundle || bundle.rules.length === 0) {
					return {
						ok: false,
						status: 409,
						error: "No rules have been extracted for this project yet. Refresh the rules first.",
					};
				}
				return {
					ok: true,
					prompt: buildAuditPrompt({
						title: input.title,
						sourceBranch: input.sourceBranch,
						targetBranch: input.targetBranch,
						rules: bundle.rules,
						files: input.files,
					}),
					model: input.model,
					allowedTools: REVIEW_AUDIT_ALLOWED_TOOLS,
				};
			},
		});
		return true;
	}

	if (pathname === "/api/review/chat" && isPost) {
		await handleAgentStreamRoute(req, res, {
			schema: runtimeReviewChatRequestSchema,
			buildRun: async (input) => {
				const detail = await context.gitlabApi.getMergeRequest({
					projectId: input.projectId,
					iid: input.iid,
				});
				const mergeRequest = detail.mergeRequest;
				return {
					ok: true,
					prompt: buildChatPrompt({
						prompt: input.prompt,
						// Falling back rather than failing: a question about the diff is still
						// useful when GitLab is briefly unreachable.
						title: mergeRequest?.title ?? `!${input.iid}`,
						sourceBranch: mergeRequest?.sourceBranch ?? "unknown",
						targetBranch: mergeRequest?.targetBranch ?? "unknown",
						changedPaths: input.changedPaths,
						activeDiff: input.activeDiff,
					}),
					// No project list here, so only an explicit cwd from the caller applies —
					// otherwise the agent inherits the launcher's directory.
					cwd: resolveReviewAgentCwd({ cwd: input.cwd, projectPath: null }),
					model: input.model,
					allowedTools: REVIEW_CHAT_ALLOWED_TOOLS,
				};
			},
		});
		return true;
	}

	return false;
}
