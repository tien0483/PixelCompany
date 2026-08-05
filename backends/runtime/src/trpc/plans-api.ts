import { resolve } from "node:path";
import { stat } from "node:fs/promises";

import type {
	RuntimePlansImportFileRequest,
	RuntimePlansImportFileResponse,
	RuntimePlansImportFromFolderRequest,
	RuntimePlansImportFromFolderResponse,
	RuntimePlansListResponse,
	RuntimePlansReadRequest,
	RuntimePlansReadResponse,
	RuntimePlansRemoveRequest,
	RuntimePlansRemoveResponse,
	RuntimePlansWriteAssetRequest,
	RuntimePlansWriteAssetResponse,
	RuntimePlansWriteRequest,
	RuntimePlansWriteResponse,
} from "../core/api-contract";
import {
	importPlanFile,
	importPlansFromFolder,
	listSavedPlans,
	readSavedPlanContent,
	removeSavedPlan,
	writeSavedPlanAsset,
	writeSavedPlanContent,
} from "../state/saved-plans";
import { isPathWithinRoot } from "../workspace/path-sandbox";
import type { RuntimeTrpcContext } from "./app-router";

export interface CreatePlansApiDependencies {
	/** Server cwd; root sandbox matches projects directory browser (`resolve(cwd, "/")`). */
	serverCwd: string;
}

function toErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function createPlansApi(deps: CreatePlansApiDependencies): RuntimeTrpcContext["plansApi"] {
	const rootPath = resolve(deps.serverCwd, "/");

	return {
		list: async () => {
			try {
				const plans = await listSavedPlans();
				return {
					ok: true,
					plans,
				} satisfies RuntimePlansListResponse;
			} catch (error) {
				return {
					ok: false,
					plans: [],
					error: toErrorMessage(error),
				} satisfies RuntimePlansListResponse;
			}
		},
		importFromFolder: async (input: RuntimePlansImportFromFolderRequest) => {
			try {
				const folderPath = resolve(input.folderPath.trim());
				if (!isPathWithinRoot(rootPath, folderPath)) {
					return {
						ok: false,
						added: [],
						skipped: 0,
						error: "Access denied: folder is outside the server root directory.",
					} satisfies RuntimePlansImportFromFolderResponse;
				}
				const folderStat = await stat(folderPath);
				if (!folderStat.isDirectory()) {
					return {
						ok: false,
						added: [],
						skipped: 0,
						error: "The specified path is not a directory.",
					} satisfies RuntimePlansImportFromFolderResponse;
				}
				const result = await importPlansFromFolder(folderPath);
				return {
					ok: true,
					added: result.added.map((entry) => ({ ...entry, missing: false })),
					skipped: result.skipped,
				} satisfies RuntimePlansImportFromFolderResponse;
			} catch (error) {
				return {
					ok: false,
					added: [],
					skipped: 0,
					error: toErrorMessage(error),
				} satisfies RuntimePlansImportFromFolderResponse;
			}
		},
		importFile: async (input: RuntimePlansImportFileRequest) => {
			try {
				const filePath = resolve(input.filePath.trim());
				if (!isPathWithinRoot(rootPath, filePath)) {
					return {
						ok: false,
						plan: null,
						alreadyExists: false,
						error: "Access denied: file is outside the server root directory.",
					} satisfies RuntimePlansImportFileResponse;
				}
				const fileStat = await stat(filePath);
				if (!fileStat.isFile()) {
					return {
						ok: false,
						plan: null,
						alreadyExists: false,
						error: "The specified path is not a file.",
					} satisfies RuntimePlansImportFileResponse;
				}
				const { entry, isNew } = await importPlanFile(filePath);
				return {
					ok: true,
					plan: { ...entry, missing: false },
					alreadyExists: !isNew,
				} satisfies RuntimePlansImportFileResponse;
			} catch (error) {
				return {
					ok: false,
					plan: null,
					alreadyExists: false,
					error: toErrorMessage(error),
				} satisfies RuntimePlansImportFileResponse;
			}
		},
		remove: async (input: RuntimePlansRemoveRequest) => {
			try {
				const removed = await removeSavedPlan(input.planId);
				if (!removed) {
					return {
						ok: false,
						error: `Plan "${input.planId}" was not found.`,
					} satisfies RuntimePlansRemoveResponse;
				}
				return { ok: true } satisfies RuntimePlansRemoveResponse;
			} catch (error) {
				return {
					ok: false,
					error: toErrorMessage(error),
				} satisfies RuntimePlansRemoveResponse;
			}
		},
		read: async (input: RuntimePlansReadRequest) => {
			try {
				const { entry, content } = await readSavedPlanContent(input.planId);
				return {
					ok: true,
					plan: { ...entry, missing: false },
					content,
				} satisfies RuntimePlansReadResponse;
			} catch (error) {
				return {
					ok: false,
					plan: null,
					content: null,
					error: toErrorMessage(error),
				} satisfies RuntimePlansReadResponse;
			}
		},
		write: async (input: RuntimePlansWriteRequest) => {
			try {
				const entry = await writeSavedPlanContent(input.planId, input.content);
				return {
					ok: true,
					plan: { ...entry, missing: false },
				} satisfies RuntimePlansWriteResponse;
			} catch (error) {
				return {
					ok: false,
					plan: null,
					error: toErrorMessage(error),
				} satisfies RuntimePlansWriteResponse;
			}
		},
		writeAsset: async (input: RuntimePlansWriteAssetRequest) => {
			try {
				const relativePath = await writeSavedPlanAsset(input.planId, {
					data: input.data,
					mimeType: input.mimeType,
					name: input.name,
				});
				return {
					ok: true,
					relativePath,
				} satisfies RuntimePlansWriteAssetResponse;
			} catch (error) {
				return {
					ok: false,
					relativePath: null,
					error: toErrorMessage(error),
				} satisfies RuntimePlansWriteAssetResponse;
			}
		},
	};
}
