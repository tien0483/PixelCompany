import { randomUUID } from "node:crypto";
import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";

import { resolveImageExtension, sanitizeFileNameSegment } from "../terminal/task-image-prompt";
import { isPathWithinRoot } from "../workspace/path-sandbox";
import { getRuntimeHomePath } from "./workspace-state";

export const SAVED_PLANS_FILENAME = "saved-plans.json";
export const PLAN_FILE_EXTENSIONS = new Set([".md", ".txt", ".html", ".htm"]);
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

export function isPlanFileName(name: string): boolean {
	return PLAN_FILE_EXTENSIONS.has(extname(name).toLowerCase());
}

/**
 * `<stem>.bak-<n>.<ext>` as written by {@link backupSavedPlan}. Excluded from bulk folder
 * import and from the directory browser: every brief expansion leaves one behind, so
 * offering them as plans would bury the real ones. Importing one by explicit path still
 * works — that is how a user recovers an old version.
 */
export function isPlanBackupFileName(name: string): boolean {
	return /\.bak-\d+$/.test(basename(name, extname(name)));
}

/** `<stem>.html.src.md` extension, split out so the path and the filter agree by construction. */
const PLAN_HTML_SOURCE_SUFFIX = ".html.src.md";

/**
 * `<stem>.html.src.md` as written by {@link writeSavedPlanHtmlSource}: the markdown that
 * `<stem>.html` was generated from, which is what Refine diffs against. Excluded from folder
 * import and the directory browser for the same reason as {@link isPlanBackupFileName} — it is
 * bookkeeping for another file, not a plan somebody wants to open.
 */
export function isPlanHtmlSourceFileName(name: string): boolean {
	return basename(name).toLowerCase().endsWith(PLAN_HTML_SOURCE_SUFFIX);
}

/**
 * `<planFileName>.deploy.json` as written by the Apps Script deploy flow: the script and
 * deployment ids that let a re-deploy update the same web app instead of publishing a
 * second one. The full file name rather than the stem, because `<stem>.md` and its
 * generated `<stem>.html` would otherwise share one record and only the HTML is deployed.
 */
export const PLAN_DEPLOY_STATE_SUFFIX = ".deploy.json";

export function isPlanDeployStateFileName(name: string): boolean {
	return basename(name).toLowerCase().endsWith(PLAN_DEPLOY_STATE_SUFFIX);
}

/** Auxiliary files that live beside a plan but must never be offered as one. */
export function isPlanAuxiliaryFileName(name: string): boolean {
	return isPlanBackupFileName(name) || isPlanHtmlSourceFileName(name) || isPlanDeployStateFileName(name);
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
	const listed = await Promise.all(
		entries.map(async (entry) => ({
			...entry,
			missing: !(await pathExists(entry.path)),
		})),
	);
	return listed.sort((a, b) => b.addedAt - a.addedAt);
}

function addOrReuseEntry(
	byPath: Map<string, SavedPlanEntry>,
	filePath: string,
	now: number,
): { entry: SavedPlanEntry; isNew: boolean } {
	const existing = byPath.get(filePath);
	if (existing) {
		return { entry: existing, isNew: false };
	}
	const entry: SavedPlanEntry = {
		id: randomUUID(),
		name: stemFromPath(filePath),
		path: filePath,
		addedAt: now,
	};
	byPath.set(filePath, entry);
	return { entry, isNew: true };
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
		if (!dirEntry.isFile() || !isPlanFileName(dirEntry.name) || isPlanAuxiliaryFileName(dirEntry.name)) {
			continue;
		}
		const filePath = normalizeAbsolutePath(join(resolvedFolder, dirEntry.name));
		if (byPath.has(filePath)) {
			skipped += 1;
			continue;
		}
		const { entry } = addOrReuseEntry(byPath, filePath, now);
		added.push(entry);
	}

	if (added.length > 0) {
		await writeSavedPlans([...existing, ...added]);
	}

	return { added, skipped };
}

export async function importPlanFile(filePath: string): Promise<{
	entry: SavedPlanEntry;
	isNew: boolean;
}> {
	const resolvedFilePath = normalizeAbsolutePath(filePath);
	if (!isPlanFileName(resolvedFilePath)) {
		throw new Error(`Not a supported plan file: ${resolvedFilePath}`);
	}
	const existing = await loadSavedPlans();
	const byPath = new Map(existing.map((entry) => [entry.path, entry]));
	const { entry, isNew } = addOrReuseEntry(byPath, resolvedFilePath, Date.now());

	if (isNew) {
		await writeSavedPlans([...existing, entry]);
	}

	return { entry, isNew };
}

/**
 * Write `<stem>.<ext>` beside an existing saved plan and register it via importPlanFile.
 * Sandboxed to the source plan's parent directory.
 */
export async function writeSavedPlanSibling(
	planId: string,
	ext: string,
	content: string,
): Promise<{ entry: SavedPlanEntry; isNew: boolean }> {
	const entry = await findSavedPlanById(planId);
	if (!entry) {
		throw new Error(`Plan "${planId}" was not found in the library.`);
	}
	const normalizedExt = ext.startsWith(".") ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
	if (!PLAN_FILE_EXTENSIONS.has(normalizedExt)) {
		throw new Error(`Unsupported plan sibling extension: ${normalizedExt}`);
	}
	const parentDir = dirname(entry.path);
	const siblingPath = normalizeAbsolutePath(join(parentDir, `${stemFromPath(entry.path)}${normalizedExt}`));
	if (!isPathWithinRoot(parentDir, siblingPath)) {
		throw new Error("Access denied: sibling path is outside the plan directory.");
	}
	await writeFile(siblingPath, content, "utf8");
	return await importPlanFile(siblingPath);
}

/**
 * Copy a saved plan's current bytes to `<stem>.bak-<n><ext>` beside it and return the
 * backup path. Deliberately NOT registered in the plan library (unlike
 * {@link writeSavedPlanSibling}): a backup is a safety net for a destructive rewrite,
 * not a plan the user wants cluttering the Plans list.
 */
export async function backupSavedPlan(planId: string): Promise<string> {
	const entry = await findSavedPlanById(planId);
	if (!entry) {
		throw new Error(`Plan "${planId}" was not found in the library.`);
	}
	if (!(await pathExists(entry.path))) {
		throw new Error(`Plan file is missing: ${entry.path}`);
	}
	const parentDir = dirname(entry.path);
	const extension = extname(entry.path);
	const fileName = await resolveUniqueSuffixedFileName(parentDir, `${stemFromPath(entry.path)}.bak`, extension);
	const backupPath = normalizeAbsolutePath(join(parentDir, fileName));
	if (!isPathWithinRoot(parentDir, backupPath)) {
		throw new Error("Access denied: backup path is outside the plan directory.");
	}
	const content = await readFile(entry.path);
	await writeFile(backupPath, content);
	return backupPath;
}

function resolvePlanHtmlSourcePath(entry: SavedPlanEntry): string {
	const parentDir = dirname(entry.path);
	const sourcePath = normalizeAbsolutePath(join(parentDir, `${stemFromPath(entry.path)}${PLAN_HTML_SOURCE_SUFFIX}`));
	if (!isPathWithinRoot(parentDir, sourcePath)) {
		throw new Error("Access denied: HTML source path is outside the plan directory.");
	}
	return sourcePath;
}

/**
 * Record the markdown that the plan's `<stem>.html` was generated from, as `<stem>.html.src.md`.
 * Refine diffs the current markdown against this, so it has to survive a page reload — an
 * in-memory ref does not, and a Refine with no base silently becomes a full regeneration.
 *
 * Deliberately NOT registered in the plan library (like {@link backupSavedPlan}): see
 * {@link isPlanHtmlSourceFileName}.
 */
export async function writeSavedPlanHtmlSource(planId: string, content: string): Promise<string> {
	const entry = await findSavedPlanById(planId);
	if (!entry) {
		throw new Error(`Plan "${planId}" was not found in the library.`);
	}
	const sourcePath = resolvePlanHtmlSourcePath(entry);
	await writeFile(sourcePath, content, "utf8");
	return sourcePath;
}

/** The recorded markdown for `<stem>.html`, or `null` when nothing has been recorded yet. */
export async function readSavedPlanHtmlSource(planId: string): Promise<string | null> {
	const entry = await findSavedPlanById(planId);
	if (!entry) {
		throw new Error(`Plan "${planId}" was not found in the library.`);
	}
	try {
		return await readFile(resolvePlanHtmlSourcePath(entry), "utf8");
	} catch (error) {
		if (error && typeof error === "object" && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") {
			return null;
		}
		throw error;
	}
}

async function resolveUniquePlanFileName(plansDir: string, baseName: string): Promise<string> {
	let attempt = 1;
	while (true) {
		const candidate = `${baseName}-${attempt}.md`;
		if (!(await pathExists(join(plansDir, candidate)))) {
			return candidate;
		}
		attempt += 1;
	}
}

export async function createSavedPlan(input: {
	name: string;
	content: string;
}): Promise<{ entry: SavedPlanEntry; isNew: true }> {
	const plansDir = join(getRuntimeHomePath(), "plans");
	await mkdir(plansDir, { recursive: true });
	const baseName = sanitizeFileNameSegment(input.name.trim() || "plan");
	const fileName = await resolveUniquePlanFileName(plansDir, baseName);
	const filePath = normalizeAbsolutePath(join(plansDir, fileName));
	await writeFile(filePath, input.content, "utf8");

	const existing = await loadSavedPlans();
	const byPath = new Map(existing.map((entry) => [entry.path, entry]));
	const { entry } = addOrReuseEntry(byPath, filePath, Date.now());
	await writeSavedPlans([...existing, entry]);
	return { entry, isNew: true };
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

export async function clearSavedPlans(): Promise<number> {
	const existing = await loadSavedPlans();
	if (existing.length === 0) {
		return 0;
	}
	await writeSavedPlans([]);
	return existing.length;
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

/** `<baseName>-<n><extension>` in `directory`, incrementing `n` until nothing is overwritten. */
async function resolveUniqueSuffixedFileName(directory: string, baseName: string, extension: string): Promise<string> {
	let attempt = 1;
	while (true) {
		const candidate = `${baseName}-${attempt}${extension}`;
		if (!(await pathExists(join(directory, candidate)))) {
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
	const fileName = await resolveUniqueSuffixedFileName(assetsDir, baseName, extension);
	await writeFile(join(assetsDir, fileName), Buffer.from(input.data, "base64"));
	return `${basename(assetsDir)}/${fileName}`;
}

const MARKDOWN_IMAGE_PATTERN = /!\[[^\]]*\]\(\s*([^)\s]+)/g;

/** Extension allowlist for what the agent is told it may open — mirrors PLAN_ASSET_MIME_TYPES. */
const PLAN_ASSET_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);

/**
 * Absolute, existing, in-sandbox paths for every `![](…)` image a plan's markdown
 * references — what HTML generation hands the agent so it can actually *look* at
 * a pasted screenshot instead of reading a path as prose.
 *
 * `planDir` doubles as the agent's cwd, which is what makes the relative
 * `<stem>.assets/foo.png` links inside the markdown resolvable on the agent side.
 * The sandbox is the plan's own folder, not just `<stem>.assets/`: a hand-authored
 * plan legitimately points at `./images/foo.png` or a screenshot sitting next to it,
 * and those used to be reported as unresolvable even though they were right there.
 * Remote links (`http(s):`) and inline `data:` URIs are excluded from BOTH lists:
 * there is nothing local to open, so they are not "unresolved" — they simply
 * never become a Read grant.
 *
 * Every other link that fails to resolve (bad extension, escapes the plan's
 * folder, or does not exist on disk) is collected into `unresolvedLinks` instead of
 * being dropped silently — the brief prompt tells the model about these so it stops
 * reaching for a Read tool it was never granted for a path it can't open anyway.
 */
export async function resolvePlanImageAssets(
	planId: string,
	markdown: string,
): Promise<{ planDir: string; assetPaths: string[]; unresolvedLinks: string[] }> {
	const entry = await findSavedPlanById(planId);
	if (!entry) {
		throw new Error(`Plan "${planId}" was not found in the library.`);
	}
	const planDir = dirname(entry.path);
	const seen = new Set<string>();
	const flaggedUnresolved = new Set<string>();
	const assetPaths: string[] = [];
	const unresolvedLinks: string[] = [];
	const flagUnresolved = (link: string) => {
		if (flaggedUnresolved.has(link)) {
			return;
		}
		flaggedUnresolved.add(link);
		unresolvedLinks.push(link);
	};
	for (const match of markdown.matchAll(MARKDOWN_IMAGE_PATTERN)) {
		const rawLink = match[1];
		if (!rawLink || /^[a-z][a-z0-9+.-]*:/i.test(rawLink)) {
			continue;
		}
		const link = decodeURI(rawLink);
		if (!PLAN_ASSET_EXTENSIONS.has(extname(link).toLowerCase())) {
			flagUnresolved(link);
			continue;
		}
		// Links are written relative to the plan file, so resolving from the plan dir
		// covers pasted `<stem>.assets/…` links and hand-written siblings alike.
		const resolvedPath = resolve(planDir, link);
		if (!isPathWithinRoot(planDir, resolvedPath)) {
			flagUnresolved(link);
			continue;
		}
		if (seen.has(resolvedPath)) {
			continue;
		}
		seen.add(resolvedPath);
		if (await pathExists(resolvedPath)) {
			assetPaths.push(resolvedPath);
		} else {
			flagUnresolved(link);
		}
	}
	return { planDir, assetPaths, unresolvedLinks };
}

const MIME_TYPE_BY_ASSET_EXTENSION: Record<string, string> = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
};

/**
 * Serve a file the plan references, resolved relative to the plan's own folder.
 * Sandboxed to that folder rather than `<stem>.assets/` so hand-authored
 * `./images/foo.png` links render the same as pasted ones — see
 * {@link resolvePlanImageAssets}, which grants the agent reads on the same set.
 */
export async function readSavedPlanAsset(
	planId: string,
	relativePath: string,
): Promise<{ content: Buffer; contentType: string }> {
	const entry = await findSavedPlanById(planId);
	if (!entry) {
		throw new Error(`Plan "${planId}" was not found in the library.`);
	}
	const planDir = dirname(entry.path);
	const resolvedPath = resolve(planDir, relativePath);
	if (!isPathWithinRoot(planDir, resolvedPath)) {
		throw new Error("Access denied: asset path is outside the plan's directory.");
	}
	if (!(await pathExists(resolvedPath))) {
		throw new Error(`Plan asset is missing: ${relativePath}`);
	}
	const extension = extname(resolvedPath).toLowerCase();
	const contentType = MIME_TYPE_BY_ASSET_EXTENSION[extension] ?? "application/octet-stream";
	const content = await readFile(resolvedPath);
	return { content, contentType };
}
