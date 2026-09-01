import { stat } from "node:fs/promises";
import { resolve } from "node:path";

import type {
	RuntimePlansClearAllResponse,
	RuntimePlansCreateRequest,
	RuntimePlansCreateResponse,
	RuntimePlansHistoryDiffRequest,
	RuntimePlansHistoryDiffResponse,
	RuntimePlansHistoryListRequest,
	RuntimePlansHistoryListResponse,
	RuntimePlansHistoryMarkRequest,
	RuntimePlansHistoryMarkResponse,
	RuntimePlansHistoryMaterializeResponse,
	RuntimePlansHistoryMoveRequest,
	RuntimePlansHistoryRestoreRequest,
	RuntimePlansHtmlSourceRequest,
	RuntimePlansImportFileRequest,
	RuntimePlansImportFileResponse,
	RuntimePlansImportFromFolderRequest,
	RuntimePlansImportFromFolderResponse,
	RuntimePlansListResponse,
	RuntimePlansReadHtmlSourceResponse,
	RuntimePlansReadRequest,
	RuntimePlansReadResponse,
	RuntimePlansRemoveRequest,
	RuntimePlansRemoveResponse,
	RuntimePlansWriteAssetRequest,
	RuntimePlansWriteAssetResponse,
	RuntimePlansWriteBackupRequest,
	RuntimePlansWriteBackupResponse,
	RuntimePlansWriteHtmlSourceRequest,
	RuntimePlansWriteHtmlSourceResponse,
	RuntimePlansWriteRequest,
	RuntimePlansWriteResponse,
	RuntimePlansWriteSiblingRequest,
	RuntimePlansWriteSiblingResponse,
} from "../core/api-contract";
import type { PlanHistoryMaterialization } from "../state/plan-history";
import {
	attachPlanHtmlSource,
	diffPlanVersionAgainstCurrent,
	listPlanVersions,
	redoPlanVersion,
	restorePlanVersion,
	snapshotPlanVersion,
	undoPlanVersion,
} from "../state/plan-history";
import {
	backupSavedPlan,
	clearSavedPlans,
	createSavedPlan,
	importPlanFile,
	importPlansFromFolder,
	listSavedPlans,
	readSavedPlanContent,
	readSavedPlanHtmlSource,
	removeSavedPlan,
	writeSavedPlanAsset,
	writeSavedPlanContent,
	writeSavedPlanHtmlSource,
	writeSavedPlanSibling,
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

/**
 * Shared shape for undo / redo / restore: all three write a recorded version back to disk, and all
 * three legitimately have nothing to do (already at the oldest version, unknown entry, git absent).
 * "Nothing to do" answers `ok` with a null entry so the editor can stay quiet instead of raising an
 * error for a no-op.
 */
async function materializeHistory(
	run: () => Promise<PlanHistoryMaterialization | null>,
): Promise<RuntimePlansHistoryMaterializeResponse> {
	try {
		const result = await run();
		if (result === null) {
			return { ok: true, entry: null, target: null, content: null };
		}
		return { ok: true, entry: result.entry, target: result.target, content: result.content };
	} catch (error) {
		return { ok: false, entry: null, target: null, content: null, error: toErrorMessage(error) };
	}
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
		create: async (input: RuntimePlansCreateRequest) => {
			try {
				const name = input.name.trim();
				if (!name) {
					return {
						ok: false,
						plan: null,
						error: "Plan name is required.",
					} satisfies RuntimePlansCreateResponse;
				}
				const { entry } = await createSavedPlan({ name, content: input.content });
				// The plan as created is version one, so undo has somewhere to land after the first edit.
				await snapshotPlanVersion({
					planId: entry.id,
					target: "md",
					label: "autosave",
					mode: "baseline",
				}).catch(() => null);
				return {
					ok: true,
					plan: { ...entry, missing: false },
				} satisfies RuntimePlansCreateResponse;
			} catch (error) {
				return {
					ok: false,
					plan: null,
					error: toErrorMessage(error),
				} satisfies RuntimePlansCreateResponse;
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
		clearAll: async () => {
			try {
				const clearedCount = await clearSavedPlans();
				return {
					ok: true,
					clearedCount,
				} satisfies RuntimePlansClearAllResponse;
			} catch (error) {
				return {
					ok: false,
					clearedCount: 0,
					error: toErrorMessage(error),
				} satisfies RuntimePlansClearAllResponse;
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
				// Before the write, and only when this plan has no history yet: without it the oldest
				// version anyone can undo to is the *result* of the first save, so the state the plan was
				// opened in would be unreachable.
				await snapshotPlanVersion({
					planId: input.planId,
					target: "md",
					label: "autosave",
					mode: "baseline",
				}).catch(() => null);
				const entry = await writeSavedPlanContent(input.planId, input.content);
				// After the write, so the snapshot hashes what is actually on disk. History is an extra:
				// a failure here must never turn a successful save into a reported one.
				await snapshotPlanVersion({
					planId: input.planId,
					target: "md",
					label: input.historyLabel ?? "autosave",
				}).catch(() => null);
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
		writeSibling: async (input: RuntimePlansWriteSiblingRequest) => {
			try {
				const normalizedExtBefore = input.ext.startsWith(".")
					? input.ext.toLowerCase()
					: `.${input.ext.toLowerCase()}`;
				if (normalizedExtBefore === ".html" || normalizedExtBefore === ".htm") {
					// Captures a page generated before history existed (or before this plan had any),
					// so the first Generate of a session can still be undone.
					await snapshotPlanVersion({
						planId: input.planId,
						target: "html",
						label: "generate",
						mode: "baseline",
					}).catch(() => null);
				}
				const { entry, isNew } = await writeSavedPlanSibling(input.planId, input.ext, input.content);
				const normalizedExt = normalizedExtBefore;
				if (normalizedExt === ".html" || normalizedExt === ".htm") {
					await snapshotPlanVersion({
						planId: input.planId,
						target: "html",
						label: input.historyLabel ?? "generate",
					}).catch(() => null);
				}
				return {
					ok: true,
					plan: { ...entry, missing: false },
					isNew,
				} satisfies RuntimePlansWriteSiblingResponse;
			} catch (error) {
				return {
					ok: false,
					plan: null,
					error: toErrorMessage(error),
				} satisfies RuntimePlansWriteSiblingResponse;
			}
		},
		writeBackup: async (input: RuntimePlansWriteBackupRequest) => {
			try {
				const path = await backupSavedPlan(input.planId);
				return {
					ok: true,
					path,
				} satisfies RuntimePlansWriteBackupResponse;
			} catch (error) {
				return {
					ok: false,
					path: null,
					error: toErrorMessage(error),
				} satisfies RuntimePlansWriteBackupResponse;
			}
		},
		readHtmlSource: async (input: RuntimePlansHtmlSourceRequest) => {
			try {
				const content = await readSavedPlanHtmlSource(input.planId);
				return {
					ok: true,
					content,
				} satisfies RuntimePlansReadHtmlSourceResponse;
			} catch (error) {
				return {
					ok: false,
					content: null,
					error: toErrorMessage(error),
				} satisfies RuntimePlansReadHtmlSourceResponse;
			}
		},
		writeHtmlSource: async (input: RuntimePlansWriteHtmlSourceRequest) => {
			try {
				const path = await writeSavedPlanHtmlSource(input.planId, input.content);
				// This call *is* the record of what the newest page was generated from, so it is also
				// what lets a restored page carry its own requirement back with it.
				await attachPlanHtmlSource(input.planId).catch(() => undefined);
				return {
					ok: true,
					path,
				} satisfies RuntimePlansWriteHtmlSourceResponse;
			} catch (error) {
				return {
					ok: false,
					path: null,
					error: toErrorMessage(error),
				} satisfies RuntimePlansWriteHtmlSourceResponse;
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
		historyList: async (input: RuntimePlansHistoryListRequest) => {
			try {
				const listing = await listPlanVersions(input.planId);
				return {
					ok: true,
					available: listing.available,
					entries: listing.entries,
					cursor: listing.cursor,
					...(listing.reason ? { reason: listing.reason } : {}),
				} satisfies RuntimePlansHistoryListResponse;
			} catch (error) {
				return {
					ok: false,
					available: false,
					entries: [],
					cursor: { md: null, html: null },
					error: toErrorMessage(error),
				} satisfies RuntimePlansHistoryListResponse;
			}
		},
		historyMark: async (input: RuntimePlansHistoryMarkRequest) => {
			try {
				const entry = await snapshotPlanVersion({
					planId: input.planId,
					target: input.target,
					label: input.label,
				});
				return { ok: true, entry } satisfies RuntimePlansHistoryMarkResponse;
			} catch (error) {
				return { ok: false, entry: null, error: toErrorMessage(error) } satisfies RuntimePlansHistoryMarkResponse;
			}
		},
		historyUndo: async (input: RuntimePlansHistoryMoveRequest) => {
			return await materializeHistory(() => undoPlanVersion(input.planId, input.target));
		},
		historyRedo: async (input: RuntimePlansHistoryMoveRequest) => {
			return await materializeHistory(() => redoPlanVersion(input.planId, input.target));
		},
		historyRestore: async (input: RuntimePlansHistoryRestoreRequest) => {
			return await materializeHistory(() => restorePlanVersion(input.planId, input.entryId));
		},
		historyDiff: async (input: RuntimePlansHistoryDiffRequest) => {
			try {
				const result = await diffPlanVersionAgainstCurrent(input.planId, input.entryId);
				if (result === null) {
					return {
						ok: false,
						diff: "",
						changed: false,
						error: "That version is no longer available to diff.",
					} satisfies RuntimePlansHistoryDiffResponse;
				}
				return { ok: true, ...result } satisfies RuntimePlansHistoryDiffResponse;
			} catch (error) {
				return {
					ok: false,
					diff: "",
					changed: false,
					error: toErrorMessage(error),
				} satisfies RuntimePlansHistoryDiffResponse;
			}
		},
	};
}
