import { readFile } from "node:fs/promises";
import { z } from "zod";

import { lockedFileSystem } from "../fs/locked-file-system";
import { getWorkspaceBranchRegistryPath } from "../state/workspace-state";

const BRANCH_REGISTRY_VERSION = 1;

export type BranchRegistryEntryStatus = "active" | "merging" | "done";

export interface BranchRegistryEntry {
	taskId: string;
	branch: string;
	worktreePath: string;
	baseRef?: string;
	agentDisplayName?: string;
	status: BranchRegistryEntryStatus;
	lastTouchedAt: string;
}

export interface BranchRegistryStatusLogEntry {
	at: string;
	taskId: string;
	op: string;
	detail?: string;
}

export interface BranchRegistryFile {
	version: number;
	entries: Record<string, BranchRegistryEntry>;
	statusLog: BranchRegistryStatusLogEntry[];
}

const branchRegistryEntryStatusSchema = z.enum(["active", "merging", "done"]);

const branchRegistryEntrySchema = z.object({
	taskId: z.string().min(1),
	branch: z.string().min(1),
	worktreePath: z.string().min(1),
	baseRef: z.string().min(1).optional(),
	agentDisplayName: z.string().optional(),
	status: branchRegistryEntryStatusSchema,
	lastTouchedAt: z.string(),
});

const branchRegistryStatusLogEntrySchema = z.object({
	at: z.string(),
	taskId: z.string(),
	op: z.string(),
	detail: z.string().optional(),
});

const branchRegistryFileSchema = z.object({
	version: z.number().int().nonnegative(),
	entries: z.record(z.string(), branchRegistryEntrySchema),
	statusLog: z.array(branchRegistryStatusLogEntrySchema),
});

function isNodeErrorWithCode(error: unknown, code: string): boolean {
	return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === code;
}

function createEmptyBranchRegistryFile(): BranchRegistryFile {
	return {
		version: BRANCH_REGISTRY_VERSION,
		entries: {},
		statusLog: [],
	};
}

function formatSchemaIssues(error: z.ZodError): string {
	return error.issues.map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`).join("; ");
}

async function readBranchRegistryFile(registryPath: string): Promise<BranchRegistryFile> {
	let raw: string;
	try {
		raw = await readFile(registryPath, "utf8");
	} catch (error) {
		if (isNodeErrorWithCode(error, "ENOENT")) {
			return createEmptyBranchRegistryFile();
		}
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Could not read branch registry file at ${registryPath}. ${message}`);
	}

	let parsedJson: unknown;
	try {
		parsedJson = JSON.parse(raw);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Malformed JSON in branch registry file at ${registryPath}. ${message}`);
	}

	const parsed = branchRegistryFileSchema.safeParse(parsedJson);
	if (!parsed.success) {
		throw new Error(
			`Invalid branch registry file at ${registryPath}. Fix or remove the file. Validation errors: ${formatSchemaIssues(parsed.error)}`,
		);
	}
	return parsed.data;
}

async function writeBranchRegistryFile(registryPath: string, file: BranchRegistryFile): Promise<void> {
	await lockedFileSystem.writeJsonFileAtomic(registryPath, file, { lock: null });
}

export async function registerActiveBranch(
	workspaceId: string,
	entry: Omit<BranchRegistryEntry, "lastTouchedAt" | "status"> & { status?: BranchRegistryEntry["status"] },
): Promise<void> {
	const registryPath = getWorkspaceBranchRegistryPath(workspaceId);
	await lockedFileSystem.withLock({ path: registryPath }, async () => {
		const file = await readBranchRegistryFile(registryPath);
		const now = new Date().toISOString();
		file.entries[entry.taskId] = {
			...entry,
			status: entry.status ?? "active",
			lastTouchedAt: now,
		};
		file.statusLog.push({
			at: now,
			taskId: entry.taskId,
			op: "register",
		});
		await writeBranchRegistryFile(registryPath, file);
	});
}

/**
 * Persist the real base ref once at worktree creation / adopt-on-ensure.
 * Never overwrites an already-set baseRef; preserves status and agentDisplayName.
 */
export async function recordTaskWorktreeBaseRef(
	workspaceId: string,
	entry: {
		taskId: string;
		branch: string;
		worktreePath: string;
		baseRef: string;
	},
): Promise<void> {
	const normalizedBaseRef = entry.baseRef.trim();
	if (!normalizedBaseRef) {
		return;
	}
	const registryPath = getWorkspaceBranchRegistryPath(workspaceId);
	await lockedFileSystem.withLock({ path: registryPath }, async () => {
		const file = await readBranchRegistryFile(registryPath);
		const existing = file.entries[entry.taskId];
		if (existing?.baseRef) {
			return;
		}
		const now = new Date().toISOString();
		if (existing) {
			file.entries[entry.taskId] = {
				...existing,
				branch: existing.branch || entry.branch,
				worktreePath: existing.worktreePath || entry.worktreePath,
				baseRef: normalizedBaseRef,
				lastTouchedAt: now,
			};
		} else {
			file.entries[entry.taskId] = {
				taskId: entry.taskId,
				branch: entry.branch,
				worktreePath: entry.worktreePath,
				baseRef: normalizedBaseRef,
				status: "active",
				lastTouchedAt: now,
			};
		}
		file.statusLog.push({
			at: now,
			taskId: entry.taskId,
			op: "record-base-ref",
			detail: normalizedBaseRef,
		});
		await writeBranchRegistryFile(registryPath, file);
	});
}

export async function deregisterActiveBranch(workspaceId: string, taskId: string): Promise<void> {
	const registryPath = getWorkspaceBranchRegistryPath(workspaceId);
	await lockedFileSystem.withLock({ path: registryPath }, async () => {
		const file = await readBranchRegistryFile(registryPath);
		delete file.entries[taskId];
		file.statusLog.push({
			at: new Date().toISOString(),
			taskId,
			op: "deregister",
		});
		await writeBranchRegistryFile(registryPath, file);
	});
}

export async function getActiveBranchEntry(
	workspaceId: string,
	taskId: string,
): Promise<BranchRegistryEntry | undefined> {
	const registryPath = getWorkspaceBranchRegistryPath(workspaceId);
	const file = await readBranchRegistryFile(registryPath);
	return file.entries[taskId];
}

export async function listActiveBranchEntries(workspaceId: string): Promise<BranchRegistryEntry[]> {
	const registryPath = getWorkspaceBranchRegistryPath(workspaceId);
	const file = await readBranchRegistryFile(registryPath);
	return Object.values(file.entries);
}

export async function appendBranchRegistryStatusLog(
	workspaceId: string,
	entry: { taskId: string; op: string; detail?: string },
): Promise<void> {
	const registryPath = getWorkspaceBranchRegistryPath(workspaceId);
	await lockedFileSystem.withLock({ path: registryPath }, async () => {
		const file = await readBranchRegistryFile(registryPath);
		file.statusLog.push({
			at: new Date().toISOString(),
			taskId: entry.taskId,
			op: entry.op,
			detail: entry.detail,
		});
		await writeBranchRegistryFile(registryPath, file);
	});
}
