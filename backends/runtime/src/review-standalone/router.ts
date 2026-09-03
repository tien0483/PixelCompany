// Minimal tRPC router for the standalone Review package: just `gitlab.*`,
// `review.*` and `claude.usage`. Everything else in the full `runtimeAppRouter`
// (board/task, git, terminal, manager, plans, hooks) is intentionally absent —
// this router is mounted by `server.ts` instead of the full app router.
import { initTRPC } from "@trpc/server";
import { z } from "zod";

import {
	RuntimeClaudeUsageSchema,
	runtimeGitlabConnectionSchema,
	runtimeGitlabConnectStartRequestSchema,
	runtimeGitlabConnectStartResponseSchema,
	runtimeGitlabConnectStatusRequestSchema,
	runtimeGitlabConnectStatusSchema,
	runtimeGitlabConnectTokenRequestSchema,
	runtimeGitlabConnectTokenResponseSchema,
	runtimeGitlabCreateDiffNoteRequestSchema,
	runtimeGitlabCreateNoteRequestSchema,
	runtimeGitlabDiffsResponseSchema,
	runtimeGitlabDiscussionListResponseSchema,
	runtimeGitlabMergeRequestDetailResponseSchema,
	runtimeGitlabMergeRequestListRequestSchema,
	runtimeGitlabMergeRequestListResponseSchema,
	runtimeGitlabMergeRequestRefSchema,
	runtimeGitlabMergeRequestVersionsResponseSchema,
	runtimeGitlabMutationResponseSchema,
	runtimeGitlabProjectListRequestSchema,
	runtimeGitlabProjectListResponseSchema,
	runtimeGitlabRawFileRequestSchema,
	runtimeGitlabRawFileResponseSchema,
	runtimeGitlabResolveDiscussionRequestSchema,
	runtimeReviewCheckProjectsGraphRequestSchema,
	runtimeReviewCheckProjectsGraphResponseSchema,
	runtimeReviewCommandsRequestSchema,
	runtimeReviewCommandsResponseSchema,
	runtimeReviewGraphDashboardRequestSchema,
	runtimeReviewGraphDashboardResponseSchema,
	runtimeReviewGraphImpactRequestSchema,
	runtimeReviewGraphImpactResponseSchema,
	runtimeReviewGraphRebuildActionRequestSchema,
	runtimeReviewGraphRebuildActionResponseSchema,
	runtimeReviewGraphRebuildStatusRequestSchema,
	runtimeReviewGraphRebuildStatusResponseSchema,
	runtimeReviewImportGraphRequestSchema,
	runtimeReviewImportGraphResponseSchema,
	runtimeReviewRulesConfigResponseSchema,
	runtimeReviewRulesConfigSchema,
	runtimeReviewRulesReadRequestSchema,
	runtimeReviewRulesReadResponseSchema,
	runtimeReviewSessionReadRequestSchema,
	runtimeReviewSessionResponseSchema,
	runtimeReviewSessionSchema,
	runtimeReviewSessionWriteRequestSchema,
} from "../core/api-contract";
import type { GitlabClient } from "../gitlab/gitlab-client";
import type { GitlabOauthSession } from "../gitlab/gitlab-oauth";
import type { RuntimeTrpcContext } from "../trpc/app-router";
import { createClaudeUsageApi } from "../trpc/claude-usage-api";
import { createGitlabApi } from "../trpc/gitlab-api";
import { createReviewApi } from "../trpc/review-api";

export interface ReviewTrpcContext {
	gitlabApi: RuntimeTrpcContext["gitlabApi"];
	reviewApi: RuntimeTrpcContext["reviewApi"];
	claudeUsageApi: RuntimeTrpcContext["claudeUsageApi"];
	/** Exposed so the standalone server can handle the OAuth callback HTTP route. */
	oauthSession: GitlabOauthSession;
}

const t = initTRPC.context<ReviewTrpcContext>().create();

export const reviewStandaloneRouter = t.router({
	gitlab: t.router({
		status: t.procedure.output(runtimeGitlabConnectionSchema).query(async ({ ctx }) => {
			return await ctx.gitlabApi.status();
		}),
		connect: t.procedure
			.input(runtimeGitlabConnectStartRequestSchema)
			.output(runtimeGitlabConnectStartResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.gitlabApi.connect(input);
			}),
		connectToken: t.procedure
			.input(runtimeGitlabConnectTokenRequestSchema)
			.output(runtimeGitlabConnectTokenResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.gitlabApi.connectToken(input);
			}),
		connectStatus: t.procedure
			.input(runtimeGitlabConnectStatusRequestSchema)
			.output(runtimeGitlabConnectStatusSchema)
			.query(async ({ ctx, input }) => {
				return await ctx.gitlabApi.connectStatus(input);
			}),
		disconnect: t.procedure.output(runtimeGitlabMutationResponseSchema).mutation(async ({ ctx }) => {
			return await ctx.gitlabApi.disconnect();
		}),
		listProjects: t.procedure
			.input(runtimeGitlabProjectListRequestSchema)
			.output(runtimeGitlabProjectListResponseSchema)
			.query(async ({ ctx, input }) => {
				return await ctx.gitlabApi.listProjects(input);
			}),
		listMergeRequests: t.procedure
			.input(runtimeGitlabMergeRequestListRequestSchema)
			.output(runtimeGitlabMergeRequestListResponseSchema)
			.query(async ({ ctx, input }) => {
				return await ctx.gitlabApi.listMergeRequests(input);
			}),
		getMergeRequest: t.procedure
			.input(runtimeGitlabMergeRequestRefSchema)
			.output(runtimeGitlabMergeRequestDetailResponseSchema)
			.query(async ({ ctx, input }) => {
				return await ctx.gitlabApi.getMergeRequest(input);
			}),
		getDiffs: t.procedure
			.input(runtimeGitlabMergeRequestRefSchema)
			.output(runtimeGitlabDiffsResponseSchema)
			.query(async ({ ctx, input }) => {
				return await ctx.gitlabApi.getDiffs(input);
			}),
		getVersions: t.procedure
			.input(runtimeGitlabMergeRequestRefSchema)
			.output(runtimeGitlabMergeRequestVersionsResponseSchema)
			.query(async ({ ctx, input }) => {
				return await ctx.gitlabApi.getVersions(input);
			}),
		getRawFile: t.procedure
			.input(runtimeGitlabRawFileRequestSchema)
			.output(runtimeGitlabRawFileResponseSchema)
			.query(async ({ ctx, input }) => {
				return await ctx.gitlabApi.getRawFile(input);
			}),
		listDiscussions: t.procedure
			.input(runtimeGitlabMergeRequestRefSchema)
			.output(runtimeGitlabDiscussionListResponseSchema)
			.query(async ({ ctx, input }) => {
				return await ctx.gitlabApi.listDiscussions(input);
			}),
		createDiffDiscussion: t.procedure
			.input(runtimeGitlabCreateDiffNoteRequestSchema)
			.output(runtimeGitlabMutationResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.gitlabApi.createDiffDiscussion(input);
			}),
		createNote: t.procedure
			.input(runtimeGitlabCreateNoteRequestSchema)
			.output(runtimeGitlabMutationResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.gitlabApi.createNote(input);
			}),
		resolveDiscussion: t.procedure
			.input(runtimeGitlabResolveDiscussionRequestSchema)
			.output(runtimeGitlabMutationResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.gitlabApi.resolveDiscussion(input);
			}),
		setApproval: t.procedure
			.input(runtimeGitlabMergeRequestRefSchema.extend({ approved: z.boolean() }))
			.output(runtimeGitlabMutationResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.gitlabApi.setApproval(input);
			}),
	}),
	review: t.router({
		getSession: t.procedure
			.input(runtimeReviewSessionReadRequestSchema)
			.output(runtimeReviewSessionResponseSchema)
			.query(async ({ ctx, input }) => {
				return await ctx.reviewApi.getSession(input);
			}),
		saveSession: t.procedure
			.input(runtimeReviewSessionWriteRequestSchema)
			.output(runtimeReviewSessionResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.reviewApi.saveSession(input);
			}),
		listSessionsWithDrafts: t.procedure
			.input(z.object({ host: z.string().min(1) }))
			.output(runtimeReviewSessionSchema.array())
			.query(async ({ ctx, input }) => {
				return await ctx.reviewApi.listSessionsWithDrafts(input);
			}),
		getRules: t.procedure
			.input(runtimeReviewRulesReadRequestSchema)
			.output(runtimeReviewRulesReadResponseSchema)
			.query(async ({ ctx, input }) => {
				return await ctx.reviewApi.getRules(input);
			}),
		getRulesConfig: t.procedure
			.input(runtimeReviewRulesReadRequestSchema)
			.output(runtimeReviewRulesConfigResponseSchema)
			.query(async ({ ctx, input }) => {
				return await ctx.reviewApi.getRulesConfig(input);
			}),
		setRulesConfig: t.procedure
			.input(runtimeReviewRulesConfigSchema)
			.output(runtimeReviewRulesConfigResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.reviewApi.setRulesConfig(input);
			}),
		listCommands: t.procedure
			.input(runtimeReviewCommandsRequestSchema)
			.output(runtimeReviewCommandsResponseSchema)
			.query(async ({ ctx, input }) => {
				return await ctx.reviewApi.listCommands(input);
			}),
		getGraphImpact: t.procedure
			.input(runtimeReviewGraphImpactRequestSchema)
			.output(runtimeReviewGraphImpactResponseSchema)
			.query(async ({ ctx, input }) => {
				return await ctx.reviewApi.getGraphImpact(input);
			}),
		openGraphDashboard: t.procedure
			.input(runtimeReviewGraphDashboardRequestSchema)
			.output(runtimeReviewGraphDashboardResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.reviewApi.openGraphDashboard(input);
			}),
		importGraph: t.procedure
			.input(runtimeReviewImportGraphRequestSchema)
			.output(runtimeReviewImportGraphResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.reviewApi.importGraph(input);
			}),
		getRebuildStatus: t.procedure
			.input(runtimeReviewGraphRebuildStatusRequestSchema)
			.output(runtimeReviewGraphRebuildStatusResponseSchema)
			.query(async ({ ctx, input }) => {
				return await ctx.reviewApi.getRebuildStatus(input);
			}),
		pauseRebuild: t.procedure
			.input(runtimeReviewGraphRebuildActionRequestSchema)
			.output(runtimeReviewGraphRebuildActionResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.reviewApi.pauseRebuild(input);
			}),
		resumeRebuild: t.procedure
			.input(runtimeReviewGraphRebuildActionRequestSchema)
			.output(runtimeReviewGraphRebuildActionResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.reviewApi.resumeRebuild(input);
			}),
		cancelRebuild: t.procedure
			.input(runtimeReviewGraphRebuildActionRequestSchema)
			.output(runtimeReviewGraphRebuildActionResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.reviewApi.cancelRebuild(input);
			}),
		checkProjectsGraph: t.procedure
			.input(runtimeReviewCheckProjectsGraphRequestSchema)
			.output(runtimeReviewCheckProjectsGraphResponseSchema)
			.query(async ({ ctx, input }) => {
				return await ctx.reviewApi.checkProjectsGraph(input);
			}),
	}),
	claude: t.router({
		usage: t.procedure.output(RuntimeClaudeUsageSchema).query(async ({ ctx }) => {
			return await ctx.claudeUsageApi.get();
		}),
	}),
});

export function createReviewStandaloneContext(deps: {
	gitlabClient: GitlabClient;
	gitlabOauth: GitlabOauthSession;
	openInBrowser: (url: string) => void;
	warn: (message: string) => void;
}): ReviewTrpcContext {
	return {
		gitlabApi: createGitlabApi({
			client: deps.gitlabClient,
			oauth: deps.gitlabOauth,
			openInBrowser: deps.openInBrowser,
			warn: deps.warn,
		}),
		reviewApi: createReviewApi(),
		claudeUsageApi: createClaudeUsageApi(),
		oauthSession: deps.gitlabOauth,
	};
}
