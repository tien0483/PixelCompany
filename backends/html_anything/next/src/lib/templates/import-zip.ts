import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import JSZip from "jszip";

import { templateSkillsDir } from "@/lib/agent-data-root";
import { parseFrontmatter } from "./loader";

/**
 * Installs a template skill from a zip the user picked in the editor's rail.
 *
 * A template is a folder with `SKILL.md` (+ optional `example.md` / `example.html`) — see
 * `loader.ts` — so importing one is "vet the archive, then write that folder". The limits and
 * defences mirror `lib/skills/install.ts`, which does the same job for a GitHub tarball: caps per
 * file, no traversal, no surprise entry types, and a staged directory renamed into place so a
 * half-written template is never visible to the picker.
 *
 * Accepted layouts, since zipping a folder and zipping its contents both feel natural:
 *
 *   SKILL.md, example.md, example.html          (files at the archive root)
 *   my-template/SKILL.md, my-template/…         (exactly one wrapping directory)
 */

const SKILL_MD_MAX_BYTES = 256 * 1024;
const EXAMPLE_HTML_MAX_BYTES = 2 * 1024 * 1024;
const EXAMPLE_MD_MAX_BYTES = 512 * 1024;
/** Compressed archive cap. The runtime proxy in front of this route allows ~12 MB of base64. */
export const ZIP_MAX_BYTES = 8 * 1024 * 1024;
/** Guards against a zip bomb: the three files above cannot legitimately exceed this together. */
const TOTAL_UNCOMPRESSED_MAX_BYTES = 6 * 1024 * 1024;

/** The only files an imported template may carry. Anything else is ignored, not an error. */
const KNOWN_FILES = ["SKILL.md", "example.md", "example.html"] as const;
type KnownFile = (typeof KNOWN_FILES)[number];

const MAX_BYTES_BY_FILE: Record<KnownFile, number> = {
	"SKILL.md": SKILL_MD_MAX_BYTES,
	"example.md": EXAMPLE_MD_MAX_BYTES,
	"example.html": EXAMPLE_HTML_MAX_BYTES,
};

export class TemplateImportError extends Error {
	readonly code: string;
	constructor(code: string, message: string) {
		super(message);
		this.code = code;
		this.name = "TemplateImportError";
	}
}

export interface TemplateImportResult {
	id: string;
	/** True when a template with this id already existed and was replaced. */
	replaced: boolean;
	files: KnownFile[];
}

export interface TemplateImportOptions {
	/** Overridden by tests; defaults to the resolved agent-data templates dir. */
	skillsDir?: string;
	/** Falls back to the archive's own folder name, then this, when frontmatter carries no name. */
	fileName?: string;
}

/**
 * `loader.ts` accepts folder names matching `/^[a-z0-9][a-z0-9-]*$/i`, so an id this function
 * returns has to satisfy that or the imported template would be silently skipped by the picker.
 * Underscores and dots are therefore folded to `-`, unlike `install.ts`'s looser rule.
 */
export function sanitizeTemplateId(name: string): string | null {
	const cleaned = name
		.trim()
		.toLowerCase()
		.replace(/\.zip$/, "")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	if (!cleaned || !/^[a-z0-9][a-z0-9-]*$/.test(cleaned)) {
		return null;
	}
	return cleaned.slice(0, 64).replace(/-+$/, "");
}

function assertSafeEntryPath(entryPath: string): void {
	if (entryPath.includes("\0") || entryPath.startsWith("/") || /^[a-z]:[\\/]/i.test(entryPath)) {
		throw new TemplateImportError("unsafe_path", `archive entry has an unsafe path: ${JSON.stringify(entryPath)}`);
	}
	if (entryPath.split(/[\\/]/).some((segment) => segment === "..")) {
		throw new TemplateImportError("unsafe_path", `archive entry contains a '..' segment: ${JSON.stringify(entryPath)}`);
	}
}

interface CollectedEntry {
	file: KnownFile;
	text: string;
	bytes: number;
}

/**
 * Finds the three known files inside the archive, tolerating one wrapping directory. Depth is
 * capped rather than searched: a `docs/examples/SKILL.md` buried in an unrelated archive must not
 * be mistaken for the template being imported.
 */
async function collectEntries(zip: JSZip): Promise<{ entries: CollectedEntry[]; folderName: string | null }> {
	const candidates = new Map<KnownFile, { entryPath: string; folderName: string | null }>();

	for (const [entryPath, entry] of Object.entries(zip.files)) {
		assertSafeEntryPath(entryPath);
		if (entry.dir) {
			continue;
		}
		const segments = entryPath.split(/[\\/]/).filter((segment) => segment !== "" && segment !== ".");
		// Ignore macOS archive cruft rather than failing an otherwise valid zip.
		if (segments.includes("__MACOSX") || segments.some((segment) => segment.startsWith("._"))) {
			continue;
		}
		if (segments.length > 2) {
			continue;
		}
		const fileName = segments[segments.length - 1] ?? "";
		const known = KNOWN_FILES.find((candidate) => candidate.toLowerCase() === fileName.toLowerCase());
		if (!known) {
			continue;
		}
		const folderName = segments.length === 2 ? (segments[0] ?? null) : null;
		const existing = candidates.get(known);
		// A root-level file wins over a nested one, so a stray copy one level down cannot shadow it.
		if (!existing || (existing.folderName !== null && folderName === null)) {
			candidates.set(known, { entryPath, folderName });
		}
	}

	const skill = candidates.get("SKILL.md");
	if (!skill) {
		throw new TemplateImportError(
			"skill_md_missing",
			"the archive has no SKILL.md at its root or one folder deep — that file is what defines a template",
		);
	}

	const entries: CollectedEntry[] = [];
	let total = 0;
	for (const file of KNOWN_FILES) {
		const candidate = candidates.get(file);
		if (!candidate) {
			continue;
		}
		const zipEntry = zip.file(candidate.entryPath);
		if (!zipEntry) {
			continue;
		}
		// Decompressing to a string is what enforces the real size; the declared size in a zip
		// header is attacker-controlled and cannot be trusted on its own.
		const text = await zipEntry.async("string");
		const bytes = Buffer.byteLength(text, "utf8");
		if (bytes > MAX_BYTES_BY_FILE[file]) {
			throw new TemplateImportError(
				"entry_too_large",
				`${file} is ${bytes} bytes (cap ${MAX_BYTES_BY_FILE[file]})`,
			);
		}
		total += bytes;
		if (total > TOTAL_UNCOMPRESSED_MAX_BYTES) {
			throw new TemplateImportError(
				"archive_too_large",
				`the archive's files total more than ${TOTAL_UNCOMPRESSED_MAX_BYTES} bytes uncompressed`,
			);
		}
		entries.push({ file, text, bytes });
	}

	return { entries, folderName: skill.folderName };
}

async function pathExists(target: string): Promise<boolean> {
	try {
		await fs.access(target);
		return true;
	} catch {
		return false;
	}
}

/** Installs the archive as a template folder and returns what was written. */
export async function importTemplateZip(
	zipBytes: Buffer,
	options: TemplateImportOptions = {},
): Promise<TemplateImportResult> {
	if (zipBytes.byteLength === 0) {
		throw new TemplateImportError("empty_archive", "the uploaded file is empty");
	}
	if (zipBytes.byteLength > ZIP_MAX_BYTES) {
		throw new TemplateImportError("archive_too_large", `the zip is ${zipBytes.byteLength} bytes (cap ${ZIP_MAX_BYTES})`);
	}

	let zip: JSZip;
	try {
		zip = await JSZip.loadAsync(zipBytes);
	} catch (error) {
		throw new TemplateImportError(
			"archive_unreadable",
			`could not read the file as a zip: ${error instanceof Error ? error.message : String(error)}`,
		);
	}

	const { entries, folderName } = await collectEntries(zip);
	const skill = entries.find((entry) => entry.file === "SKILL.md");
	if (!skill) {
		throw new TemplateImportError("skill_md_missing", "the archive has no SKILL.md");
	}
	const { fm } = parseFrontmatter(skill.text);
	if (!/^---\s*\r?\n[\s\S]*?\r?\n---/.test(skill.text)) {
		throw new TemplateImportError(
			"skill_md_no_frontmatter",
			"SKILL.md has no YAML frontmatter, so the picker would have nothing to label it with",
		);
	}

	// Frontmatter first: it is the template's own idea of its name. The folder and file names are
	// fallbacks for an archive whose SKILL.md only carries localized names.
	const id =
		sanitizeTemplateId(fm.en_name ?? "") ??
		sanitizeTemplateId(fm.name ?? "") ??
		sanitizeTemplateId(folderName ?? "") ??
		sanitizeTemplateId(options.fileName ?? "");
	if (!id) {
		throw new TemplateImportError(
			"id_unresolvable",
			"could not derive a template id from SKILL.md, the folder name, or the file name",
		);
	}

	const skillsDir = options.skillsDir ?? templateSkillsDir();
	const targetDir = path.join(skillsDir, id);
	// Staged next to the target so the rename below stays on one filesystem, and hidden behind a
	// `.` so `listSkills`' id check skips it if anything leaves it behind.
	const stageDir = path.join(skillsDir, `.stage-${id}-${randomBytes(6).toString("hex")}`);

	await fs.mkdir(skillsDir, { recursive: true });
	try {
		await fs.mkdir(stageDir, { recursive: true });
		for (const entry of entries) {
			await fs.writeFile(path.join(stageDir, entry.file), entry.text, "utf8");
		}

		const replaced = await pathExists(targetDir);
		let backupDir: string | null = null;
		if (replaced) {
			backupDir = `${targetDir}.replaced-${randomBytes(6).toString("hex")}`;
			await fs.rename(targetDir, backupDir);
		}
		try {
			await fs.rename(stageDir, targetDir);
		} catch (error) {
			if (backupDir) {
				await fs.rename(backupDir, targetDir).catch(() => undefined);
			}
			throw error;
		}
		if (backupDir) {
			await fs.rm(backupDir, { recursive: true, force: true }).catch(() => undefined);
		}

		return { id, replaced, files: entries.map((entry) => entry.file) };
	} finally {
		await fs.rm(stageDir, { recursive: true, force: true }).catch(() => undefined);
	}
}
