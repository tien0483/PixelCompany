import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

import { resolveImageExtension, sanitizeFileNameSegment } from "../terminal/task-image-prompt";
import { isPathWithinRoot } from "../workspace/path-sandbox";
import { getRuntimeHomePath } from "./workspace-state";

export const SAVED_PLANS_FILENAME = "saved-plans.json";
export const PLAN_FILE_EXTENSIONS = new Set([".md", ".txt"]);
export const PLAN_ASSET_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

export interface SavedPlanEntry {
	id: string;
	name: string;
	path: string;
	addedAt: number;
}

export interface SavedPlanListEntry extends SavedPlanEntry {
	missing: boolean;
}

function getSavedPlansPath(): string {
	return join(getRuntimeHomePath(), SAVED_PLANS_FILENAME);
}

function normalizeAbsolutePath(pathValue: string): string {
	return resolve(pathValue.trim());
}

function stemFromPath(pathValue: string): string {
	const fileName = basename(pathValue);
	const extension = extname(fileName);
	return extension.length > 0 ? fileName.slice(0, -extension.length) : fileName;
}

function isPlanFileName(name: string): boolean {
	return PLAN_FILE_EXTENSIONS.has(extname(name).toLowerCase());
}

async function pathExists(pathValue: string): Promise<boolean> {
	try {
		await access(pathValue);
		return true;
	} catch {
		return false;
	}
}

export async function loadSavedPlans(): Promise<SavedPlanEntry[]> {
	const filePath = getSavedPlansPath();
	try {
		const raw = await readFile(filePath, "utf8");
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) {
			return [];
		}
		const entries: SavedPlanEntry[] = [];
		for (const item of parsed) {
			if (!item || typeof item !== "object") {
				continue;
			}
			const record = item as Record<string, unknown>;
			const id = typeof record.id === "string" ? record.id.trim() : "";
			const name = typeof record.name === "string" ? record.name.trim() : "";
			const pathValue = typeof record.path === "string" ? record.path.trim() : "";
			const addedAt = typeof record.addedAt === "number" ? record.addedAt : Date.now();
			if (!id || !name || !pathValue) {
				continue;
			}
			entries.push({
				id,
				name,
				path: normalizeAbsolutePath(pathValue),
				addedAt,
			});
		}
		return entries;
	} catch (error) {
		if (error && typeof error === "object" && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") {
			return [];
		}
		throw error;
	}
}

async function writeSavedPlans(entries: SavedPlanEntry[]): Promise<void> {
	const home = getRuntimeHomePath();
	await mkdir(home, { recursive: true });
	await writeFile(getSavedPlansPath(), `${JSON.stringify(entries, null, 2)}\n`, "utf8");
}

export async function listSavedPlans(): Promise<SavedPlanListEntry[]> {
	const entries = await loadSavedPlans();
	return await Promise.all(
		entries.map(async (entry) => ({
			...entry,
			missing: !(await pathExists(entry.path)),
		})),
	);
}

export async function importPlansFromFolder(folderPath: string): Promise<{
	added: SavedPlanEntry[];
	skipped: number;
}> {
	const resolvedFolder = normalizeAbsolutePath(folderPath);
	const dirEntries = await readdir(resolvedFolder, { withFileTypes: true });
	const existing = await loadSavedPlans();
	const byPath = new Map(existing.map((entry) => [entry.path, entry]));
	const added: SavedPlanEntry[] = [];
	let skipped = 0;
	const now = Date.now();

	for (const dirEntry of dirEntries) {
		if (!dirEntry.isFile() || !isPlanFileName(dirEntry.name)) {
			continue;
		}
		const filePath = normalizeAbsolutePath(join(resolvedFolder, dirEntry.name));
		if (byPath.has(filePath)) {
			skipped += 1;
			continue;
		}
		const entry: SavedPlanEntry = {
			id: randomUUID(),
			name: stemFromPath(filePath),
			path: filePath,
			addedAt: now,
		};
		byPath.set(filePath, entry);
		added.push(entry);
	}

	if (added.length > 0) {
		await writeSavedPlans([...existing, ...added]);
	}

	return { added, skipped };
}

export async function removeSavedPlan(planId: string): Promise<boolean> {
	const normalizedId = planId.trim();
	if (!normalizedId) {
		return false;
	}
	const existing = await loadSavedPlans();
	const next = existing.filter((entry) => entry.id !== normalizedId);
	if (next.length === existing.length) {
		return false;
	}
	await writeSavedPlans(next);
	return true;
}

export async function findSavedPlanById(planId: string): Promise<SavedPlanEntry | null> {
	const normalizedId = planId.trim();
	if (!normalizedId) {
		return null;
	}
	const entries = await loadSavedPlans();
	return entries.find((entry) => entry.id === normalizedId) ?? null;
}

export async function readSavedPlanContent(planId: string): Promise<{ entry: SavedPlanEntry; content: string }> {
	const entry = await findSavedPlanById(planId);
	if (!entry) {
		throw new Error(`Plan "${planId}" was not found in the library.`);
	}
	if (!(await pathExists(entry.path))) {
		throw new Error(`Plan file is missing: ${entry.path}`);
	}
	const content = await readFile(entry.path, "utf8");
	return { entry, content };
}

export async function writeSavedPlanContent(planId: string, content: string): Promise<SavedPlanEntry> {
	const entry = await findSavedPlanById(planId);
	if (!entry) {
		throw new Error(`Plan "${planId}" was not found in the library.`);
	}
	await writeFile(entry.path, content, "utf8");
	return entry;
}

export function getPlanAssetsDir(entry: SavedPlanEntry): string {
	return join(dirname(entry.path), `${stemFromPath(entry.path)}.assets`);
}

async function resolveUniqueAssetFileName(assetsDir: string, baseName: string, extension: string): Promise<string> {
	let attempt = 1;
	while (true) {
		const candidate = `${baseName}-${attempt}${extension}`;
		if (!(await pathExists(join(assetsDir, candidate)))) {
			return candidate;
		}
		attempt += 1;
	}
}

export async function writeSavedPlanAsset(
	planId: string,
	input: { data: string; mimeType: string; name?: string },
): Promise<string> {
	const entry = await findSavedPlanById(planId);
	if (!entry) {
		throw new Error(`Plan "${planId}" was not found in the library.`);
	}
	const mimeType = input.mimeType.toLowerCase();
	if (!PLAN_ASSET_MIME_TYPES.has(mimeType)) {
		throw new Error(`Unsupported image type: ${input.mimeType}`);
	}
	const extension = resolveImageExtension(input.name, mimeType);
	if (!extension) {
		throw new Error(`Could not determine a file extension for ${input.mimeType}.`);
	}
	const baseName = sanitizeFileNameSegment(input.name?.trim() ? basename(input.name, extname(input.name)) : "pasted");

	const assetsDir = getPlanAssetsDir(entry);
	await mkdir(assetsDir, { recursive: true });
	const fileName = await resolveUniqueAssetFileName(assetsDir, baseName, extension);
	await writeFile(join(assetsDir, fileName), Buffer.from(input.data, "base64"));
	return `${basename(assetsDir)}/${fileName}`;
}

export async function readSavedPlanAsset(
	planId: string,
	relativePath: string,
): Promise<{ content: Buffer; contentType: string }> {
	const entry = await findSavedPlanById(planId);
	if (!entry) {
		throw new Error(`Plan "${planId}" was not found in the library.`);
	}
	const assetsDir = getPlanAssetsDir(entry);
	const resolvedPath = resolve(assetsDir, relativePath);
	if (!isPathWithinRoot(assetsDir, resolvedPath)) {
		throw new Error("Access denied: asset path is outside the plan's assets directory.");
	}
	if (!(await pathExists(resolvedPath))) {
		throw new Error(`Plan asset is missing: ${relativePath}`);
	}
	const extension = extname(resolvedPath).toLowerCase();
	const mimeTypeByExtension: Record<string, string> = {
		".png": "image/png",
		".jpg": "image/jpeg",
		".jpeg": "image/jpeg",
		".gif": "image/gif",
		".webp": "image/webp",
	};
	const contentType = mimeTypeByExtension[extension] ?? "application/octet-stream";
	const content = await readFile(resolvedPath);
	return { content, contentType };
}
