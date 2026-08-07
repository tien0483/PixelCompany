/**
 * Shared allowlist for private Windows distribution — one source of truth for
 * both the zip bundle (bundle-source.mjs) and the offline installer stage
 * (installer/stage-app.mjs), so the two paths can't silently drift apart.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

/** Relative paths from repo root — files or directories. */
export const ALLOWLIST = [
	"package.json",
	"pnpm-workspace.yaml",
	"pnpm-lock.yaml",
	"AGENT.md",
	"frontends/pixel_office",
	"backends/runtime",
	"backends/manager",
	"scripts/solo.mjs",
	"scripts/start-stack.mjs",
	"scripts/pm.mjs",
	"agent-data",
	".agent/AGENT.md",
	".agent/skills",
	".agent/workflows",
	".claude",
];

export const SKIP_DIR_NAMES = new Set([
	"node_modules",
	".git",
	".venv",
	"venv",
	"__pycache__",
	"dist",
	"coverage",
	"test-results",
	"test-results-solo",
	".turbo",
	".cache",
	"playwright-report",
]);

export const SKIP_FILE_NAMES = new Set([".env", "settings.local.json", ".DS_Store", "Thumbs.db"]);

export function shouldSkipFile(name) {
	if (SKIP_FILE_NAMES.has(name)) return true;
	if (name.startsWith(".env.")) return true;
	if (name.endsWith(".pyc")) return true;
	if (name.endsWith(".tsbuildinfo")) return true;
	if (name.endsWith(".zip")) return true;
	return false;
}

function walkFiles(absDir, repoRoot, files) {
	let entries;
	try {
		entries = readdirSync(absDir, { withFileTypes: true });
	} catch {
		return;
	}
	for (const ent of entries) {
		const abs = join(absDir, ent.name);
		if (ent.isDirectory()) {
			if (SKIP_DIR_NAMES.has(ent.name)) continue;
			walkFiles(abs, repoRoot, files);
			continue;
		}
		if (!ent.isFile() && !ent.isSymbolicLink()) continue;
		if (shouldSkipFile(ent.name)) continue;
		const rel = relative(repoRoot, abs).split(sep).join("/");
		files.push({ abs, rel });
	}
}

export function collectAllowlist(repoRoot) {
	const files = [];
	const included = [];
	const missing = [];

	for (const entry of ALLOWLIST) {
		const abs = join(repoRoot, entry);
		if (!existsSync(abs)) {
			missing.push(entry);
			continue;
		}
		included.push(entry);
		const st = statSync(abs);
		if (st.isFile()) {
			if (!shouldSkipFile(entry.split("/").pop())) {
				files.push({ abs, rel: entry.replace(/\\/g, "/") });
			}
		} else if (st.isDirectory()) {
			walkFiles(abs, repoRoot, files);
		}
	}
	return { files, included, missing };
}
