// The `/api/review/*` SSE routes, for the standalone Review package.
//
// Same handler and prompts as the full app (`review-stream-route.ts`), minus the
// Manager seat pin: this package has no Manager, so the agent bills whatever
// `claude` credential is already logged in on the machine.
import type { IncomingMessage, ServerResponse } from "node:http";

import {
	runtimeReviewAuditRequestSchema,
	runtimeReviewChatRequestSchema,
	runtimeReviewRulesExtractRequestSchema,
	runtimeReviewSuggestCommentRequestSchema,
} from "../core/api-contract";
import {
	REVIEW_AUDIT_ALLOWED_TOOLS,
	REVIEW_CHAT_ALLOWED_TOOLS,
	REVIEW_RULES_EXTRACT_ALLOWED_TOOLS,
	REVIEW_SUGGEST_ALLOWED_TOOLS,
	resolveReviewAgentCwd,
} from "../review/review-agent-args";
import { buildReviewChatSystemPrompt } from "../review/review-answer-style";
import { reviewCommandNeedsGraphImpact, reviewCommandNeedsRules } from "../review/review-command-expansion";
import { buildReviewGraphPromptSection, buildReviewGraphSymbolSection } from "../review/review-graph-brief";
import {
	buildAuditPrompt,
	buildChatPrompt,
	buildRulesExtractPrompt,
	buildSuggestionRewritePrompt,
} from "../review/review-prompts";
import { persistExtractedRules, readReviewRulesBundle } from "../review/review-rules";
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
				onComplete: async (text) => {
					await persistExtractedRules({
						projectKey: input.projectKey,
						sourceRoots: input.sourceRoots,
						text,
					});
				},
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
				// No project list here, so only an explicit cwd from the caller can point at
				// a checkout — and therefore at a knowledge graph.
				const cwd = resolveReviewAgentCwd({ cwd: input.cwd, projectPath: null });
				const graphImpact = await buildReviewGraphPromptSection({
					projectPath: cwd,
					changedPaths: input.files.map((file) => file.newPath),
					baseBranch: input.targetBranch,
					writeDiffOverlay: true,
				});
				return {
					ok: true,
					prompt: buildAuditPrompt({
						title: input.title,
						sourceBranch: input.sourceBranch,
						targetBranch: input.targetBranch,
						rules: bundle.rules,
						files: input.files,
						...(graphImpact === undefined ? {} : { graphImpact }),
						...(input.annotations === undefined ? {} : { annotations: input.annotations }),
					}),
					...(cwd === undefined ? {} : { cwd }),
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
				const isFirstTurn = input.resumeSessionId === undefined;
				// Skipped on a resumed turn: the merge-request context already lives in the
				// CLI session, so fetching it again would buy nothing.
				const mergeRequest = isFirstTurn
					? (
							await context.gitlabApi.getMergeRequest({
								projectId: input.projectId,
								iid: input.iid,
							})
						).mergeRequest
					: null;
				// No project list here, so only an explicit cwd from the caller applies —
				// otherwise the agent inherits the launcher's directory.
				const cwd = resolveReviewAgentCwd({ cwd: input.cwd, projectPath: null });
				// First turn, plus any later turn running a command whose answer is meant to
				// be read off the brief — a resumed session's brief was walked for whatever
				// file was on screen when it started. The walk costs no model tokens.
				const graphImpact =
					isFirstTurn || reviewCommandNeedsGraphImpact(input.prompt)
						? await buildReviewGraphPromptSection({
								projectPath: cwd,
								changedPaths: input.changedPaths,
								baseBranch: mergeRequest?.targetBranch ?? "unknown",
							})
						: undefined;
				// Every turn, unlike the brief: "where is X defined" is a mid-conversation
				// question, and a prompt naming no symbol returns before the graph is loaded.
				const graphSymbols = await buildReviewGraphSymbolSection({
					projectPath: cwd,
					prompt: input.prompt,
					changedPaths: input.changedPaths,
				});
				// Only the whole-merge-request review asks for these, and a missing bundle is
				// not an error — the expansion then tells the pass not to invent a style.
				const rules = reviewCommandNeedsRules(input.prompt)
					? ((await readReviewRulesBundle(input.projectKey))?.rules ?? undefined)
					: undefined;
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
						allDiffs: input.allDiffs,
						screen: input.screen,
						visible: input.visible,
						isFirstTurn,
						expectSuggestions: input.expectSuggestions,
						...(graphImpact === undefined ? {} : { graphImpact }),
						...(graphSymbols === undefined ? {} : { graphSymbols }),
						...(rules === undefined ? {} : { rules }),
						...(input.annotations === undefined ? {} : { annotations: input.annotations }),
					}),
					...(cwd === undefined ? {} : { cwd }),
					model: input.model,
					allowedTools: REVIEW_CHAT_ALLOWED_TOOLS,
					appendSystemPrompt: buildReviewChatSystemPrompt({ terse: input.terse ?? false }),
					resumeSessionId: input.resumeSessionId,
				};
			},
		});
		return true;
	}

	if (pathname === "/api/review/suggest-comment" && isPost) {
		await handleAgentStreamRoute(req, res, {
			schema: runtimeReviewSuggestCommentRequestSchema,
			buildRun: async (input) => ({
				ok: true,
				prompt: buildSuggestionRewritePrompt({
					rawText: input.rawText,
					newPath: input.newPath,
					line: input.line,
					diffExcerpt: input.diffExcerpt,
				}),
				cwd: resolveReviewAgentCwd({ cwd: input.cwd, projectPath: null }),
				model: input.model,
				allowedTools: REVIEW_SUGGEST_ALLOWED_TOOLS,
			}),
		});
		return true;
	}

	return false;
}
