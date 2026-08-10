// Minimal tRPC router for the standalone Plan Editor package: just the `plans`,
// `html`, `claude.usage`, and the two `projects` procedures the plan list/import UI
// needs (`pickDirectory`, `listDirectoryContents`). Everything else in the full
// `runtimeAppRouter` (board/task, git, terminal, manager, hooks) is intentionally
// absent — this router is mounted by `server.ts` instead of the full app router.
import { readdir, stat } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";

import { initTRPC } from "@trpc/server";
import { z } from "zod";
import type {
	RuntimeDirectoryListRequest,
	RuntimeDirectoryListResponse,
	RuntimeProjectDirectoryPickerResponse,
} from "../core/api-contract";
import {
	RuntimeClaudeUsageSchema,
	RuntimeHtmlStatusSchema,
	RuntimeHtmlTemplateExampleSchema,
	RuntimeHtmlTemplateSchema,
	runtimeDirectoryListRequestSchema,
	runtimeDirectoryListResponseSchema,
	runtimePlansCreateRequestSchema,
	runtimePlansCreateResponseSchema,
	runtimePlansImportFileRequestSchema,
	runtimePlansImportFileResponseSchema,
	runtimePlansHtmlSourceRequestSchema,
	runtimePlansImportFromFolderRequestSchema,
	runtimePlansImportFromFolderResponseSchema,
	runtimePlansListResponseSchema,
	runtimePlansReadHtmlSourceResponseSchema,
	runtimePlansReadRequestSchema,
	runtimePlansReadResponseSchema,
	runtimePlansRemoveRequestSchema,
	runtimePlansRemoveResponseSchema,
	runtimePlansWriteAssetRequestSchema,
	runtimePlansWriteAssetResponseSchema,
	runtimePlansWriteBackupRequestSchema,
	runtimePlansWriteBackupResponseSchema,
	runtimePlansWriteHtmlSourceRequestSchema,
	runtimePlansWriteHtmlSourceResponseSchema,
	runtimePlansWriteRequestSchema,
	runtimePlansWriteResponseSchema,
	runtimePlansWriteSiblingRequestSchema,
	runtimePlansWriteSiblingResponseSchema,
	runtimeProjectDirectoryPickerResponseSchema,
} from "../core/api-contract";
import { parseDirectoryListRequest } from "../core/api-validation";
import type { HtmlClient } from "../html/html-client";
import { pickDirectoryPathFromSystemDialog } from "../server/directory-picker";
import { isPlanAuxiliaryFileName, isPlanFileName } from "../state/saved-plans";
import type { RuntimeTrpcContext } from "../trpc/app-router";
import { createClaudeUsageApi } from "../trpc/claude-usage-api";
import { createHtmlApi } from "../trpc/html-api";
import { createPlansApi } from "../trpc/plans-api";
import { isPathWithinRoot } from "../workspace/path-sandbox";

export interface PlanEditorTrpcContext {
	plansApi: RuntimeTrpcContext["plansApi"];
	htmlApi: RuntimeTrpcContext["htmlApi"];
	claudeUsageApi: RuntimeTrpcContext["claudeUsageApi"];
	projectsApi: {
		pickDirectory: () => Promise<RuntimeProjectDirectoryPickerResponse>;
		listDirectoryContents: (input: RuntimeDirectoryListRequest) => Promise<RuntimeDirectoryListResponse>;
	};
}

/**
 * Free-function reimplementation of `projects-api.ts`'s `pickProjectDirectory`/
 * `listDirectoryContents` (lines ~247-320), dropped down to just what the plan
 * list's "Add from folder" / file-browser UI needs. The full `createProjectsApi`
 * factory pulls in `TerminalSessionManager`, git-clone, and task-worktree — none
 * of which the standalone package boots.
 */
function createPlanEditorProjectsApi(serverCwd: string): PlanEditorTrpcContext["projectsApi"] {
	const rootPath = resolve(serverCwd, "/");

	return {
		pickDirectory: async () => {
			try {
				const selectedPath = await Promise.resolve(pickDirectoryPathFromSystemDialog());
				if (!selectedPath) {
					return { ok: false, path: null, error: "No directory was selected." };
				}
				return { ok: true, path: selectedPath };
			} catch (error) {
				return { ok: false, path: null, error: error instanceof Error ? error.message : String(error) };
			}
		},
		listDirectoryContents: async (input) => {
			const body = parseDirectoryListRequest(input);
			const requestedPath = body.path?.trim() || "";
			if (requestedPath && isAbsolute(requestedPath) && !isPathWithinRoot(rootPath, requestedPath)) {
				return {
					ok: false,
					currentPath: rootPath,
					parentPath: null,
					rootPath,
					entries: [],
					error: "Access denied: absolute path is outside the server root directory.",
				} satisfies RuntimeDirectoryListResponse;
			}
			const resolvedPath = resolve(rootPath, requestedPath) || rootPath;
			if (!isPathWithinRoot(rootPath, resolvedPath)) {
				return {
					ok: false,
					currentPath: rootPath,
					parentPath: null,
					rootPath,
					entries: [],
					error: "Access denied: path is outside the server root directory.",
				} satisfies RuntimeDirectoryListResponse;
			}

			try {
				const dirStat = await stat(resolvedPath);
				if (!dirStat.isDirectory()) {
					return {
						ok: false,
						currentPath: resolvedPath,
						parentPath: null,
						rootPath,
						entries: [],
						error: "The specified path is not a directory.",
					} satisfies RuntimeDirectoryListResponse;
				}

				const dirEntries = await readdir(resolvedPath, { withFileTypes: true });
				const directoryEntries = dirEntries.filter((entry) => entry.isDirectory());
				const planFileEntries = body.includeFiles
					? dirEntries.filter(
							(entry) => entry.isFile() && isPlanFileName(entry.name) && !isPlanAuxiliaryFileName(entry.name),
						)
					: [];

				directoryEntries.sort((a, b) => a.name.localeCompare(b.name));
				planFileEntries.sort((a, b) => a.name.localeCompare(b.name));

				const directoryResults = await Promise.all(
					directoryEntries.map(async (entry) => {
						const entryPath = resolve(resolvedPath, entry.name);
						let isGitRepository = false;
						try {
							const gitDirStat = await stat(resolve(entryPath, ".git"));
							isGitRepository = gitDirStat.isDirectory() || gitDirStat.isFile();
						} catch {
							// .git does not exist or is not accessible
						}
						return { name: entry.name, path: entryPath, isGitRepository, isDirectory: true };
					}),
				);
				const fileResults = planFileEntries.map((entry) => ({
					name: entry.name,
					path: resolve(resolvedPath, entry.name),
					isGitRepository: false,
					isDirectory: false,
				}));

				const entries = [...directoryResults, ...fileResults];
				const isAtRoot = resolvedPath === rootPath;
				const rawParent = dirname(resolvedPath);
				const parentIsWithinRoot = isPathWithinRoot(rootPath, rawParent);
				const parentPath = isAtRoot ? null : parentIsWithinRoot ? rawParent : null;

				return {
					ok: true,
					currentPath: resolvedPath,
					parentPath,
					rootPath,
					entries,
				} satisfies RuntimeDirectoryListResponse;
			} catch (error) {
				const isPermissionError =
					error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "EACCES";
				const isNotFoundError =
					error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT";
				return {
					ok: false,
					currentPath: resolvedPath,
					parentPath: null,
					rootPath,
					entries: [],
					error: isPermissionError
						? "Permission denied: cannot read this directory."
						: isNotFoundError
							? "Directory not found."
							: error instanceof Error
								? error.message
								: String(error),
				} satisfies RuntimeDirectoryListResponse;
			}
		},
	};
}

const t = initTRPC.context<PlanEditorTrpcContext>().create();

export const planEditorRouter = t.router({
	projects: t.router({
		pickDirectory: t.procedure.output(runtimeProjectDirectoryPickerResponseSchema).mutation(async ({ ctx }) => {
			return await ctx.projectsApi.pickDirectory();
		}),
		listDirectoryContents: t.procedure
			.input(runtimeDirectoryListRequestSchema)
			.output(runtimeDirectoryListResponseSchema)
			.query(async ({ ctx, input }) => {
				return await ctx.projectsApi.listDirectoryContents(input);
			}),
	}),
	plans: t.router({
		list: t.procedure.output(runtimePlansListResponseSchema).query(async ({ ctx }) => {
			return await ctx.plansApi.list();
		}),
		importFromFolder: t.procedure
			.input(runtimePlansImportFromFolderRequestSchema)
			.output(runtimePlansImportFromFolderResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.plansApi.importFromFolder(input);
			}),
		importFile: t.procedure
			.input(runtimePlansImportFileRequestSchema)
			.output(runtimePlansImportFileResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.plansApi.importFile(input);
			}),
		create: t.procedure
			.input(runtimePlansCreateRequestSchema)
			.output(runtimePlansCreateResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.plansApi.create(input);
			}),
		remove: t.procedure
			.input(runtimePlansRemoveRequestSchema)
			.output(runtimePlansRemoveResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.plansApi.remove(input);
			}),
		read: t.procedure
			.input(runtimePlansReadRequestSchema)
			.output(runtimePlansReadResponseSchema)
			.query(async ({ ctx, input }) => {
				return await ctx.plansApi.read(input);
			}),
		write: t.procedure
			.input(runtimePlansWriteRequestSchema)
			.output(runtimePlansWriteResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.plansApi.write(input);
			}),
		writeSibling: t.procedure
			.input(runtimePlansWriteSiblingRequestSchema)
			.output(runtimePlansWriteSiblingResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.plansApi.writeSibling(input);
			}),
		// Brief expansion backs the plan up before it rewrites it, unconditionally — without
		// this procedure every compliant Expand response died here on "no such procedure".
		writeBackup: t.procedure
			.input(runtimePlansWriteBackupRequestSchema)
			.output(runtimePlansWriteBackupResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.plansApi.writeBackup(input);
			}),
		readHtmlSource: t.procedure
			.input(runtimePlansHtmlSourceRequestSchema)
			.output(runtimePlansReadHtmlSourceResponseSchema)
			.query(async ({ ctx, input }) => {
				return await ctx.plansApi.readHtmlSource(input);
			}),
		writeHtmlSource: t.procedure
			.input(runtimePlansWriteHtmlSourceRequestSchema)
			.output(runtimePlansWriteHtmlSourceResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.plansApi.writeHtmlSource(input);
			}),
		writeAsset: t.procedure
			.input(runtimePlansWriteAssetRequestSchema)
			.output(runtimePlansWriteAssetResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.plansApi.writeAsset(input);
			}),
	}),
	html: t.router({
		status: t.procedure.output(RuntimeHtmlStatusSchema).query(async ({ ctx }) => {
			return await ctx.htmlApi.status();
		}),
		templates: t.procedure.output(RuntimeHtmlTemplateSchema.array()).query(async ({ ctx }) => {
			return await ctx.htmlApi.templates();
		}),
		templateExample: t.procedure
			.input(z.object({ id: z.string().min(1) }))
			.output(RuntimeHtmlTemplateExampleSchema.nullable())
			.query(async ({ ctx, input }) => {
				return await ctx.htmlApi.templateExample(input.id);
			}),
	}),
	// Same shape as the full router's `claude.usage`: the package has no Manager, but
	// the usage windows come straight off the local Claude credential either way.
	claude: t.router({
		usage: t.procedure.output(RuntimeClaudeUsageSchema).query(async ({ ctx }) => {
			return await ctx.claudeUsageApi.get();
		}),
	}),
});

export type PlanEditorAppRouter = typeof planEditorRouter;

export function createPlanEditorContext(deps: { htmlClient: HtmlClient; serverCwd: string }): PlanEditorTrpcContext {
	return {
		plansApi: createPlansApi({ serverCwd: deps.serverCwd }),
		htmlApi: createHtmlApi({ client: deps.htmlClient }),
		claudeUsageApi: createClaudeUsageApi(),
		projectsApi: createPlanEditorProjectsApi(deps.serverCwd),
	};
}
