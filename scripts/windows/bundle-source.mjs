/**
 * Allowlist-only source bundle for private Windows distribution.
 *
 *   node scripts/windows/bundle-source.mjs [--out path] [--repo-root path]
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createZip, toArchivePath } from "./zip-stdlib.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Relative paths from repo root — files or directories. */
const ALLOWLIST = [
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
	".agent/AGENT.md",
	".agent/manager",
	".agent/skills",
	".agent/workflows",
	".claude",
];

const SKIP_DIR_NAMES = new Set([
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

const SKIP_FILE_NAMES = new Set([
	".env",
	"settings.local.json",
	".DS_Store",
	"Thumbs.db",
]);

function shouldSkipFile(name) {
	if (SKIP_FILE_NAMES.has(name)) return true;
	if (name.startsWith(".env.")) return true;
	if (name.endsWith(".pyc")) return true;
	if (name.endsWith(".tsbuildinfo")) return true;
	if (name.endsWith(".zip")) return true;
	return false;
}

function parseArgs(argv) {
	const opts = { out: "", repoRoot: "" };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--out") opts.out = argv[++i] ?? "";
		else if (a === "--repo-root") opts.repoRoot = argv[++i] ?? "";
		else if (a === "--help" || a === "-h") opts.help = true;
		else throw new Error(`Unknown argument: ${a}`);
	}
	return opts;
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

function collectAllowlist(repoRoot) {
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

async function main() {
	const opts = parseArgs(process.argv.slice(2));
	if (opts.help) {
		console.log(`Usage: node scripts/windows/bundle-source.mjs [--out path] [--repo-root path]`);
		process.exit(0);
	}

	const repoRoot = resolve(opts.repoRoot || join(__dirname, "..", ".."));
	const outPath = resolve(
		opts.out || join(__dirname, "dist", "PixelOffice-windows.zip"),
	);
	const zipRoot = "PixelOffice";

	if (!existsSync(join(repoRoot, "package.json"))) {
		throw new Error(`Not a repo root (missing package.json): ${repoRoot}`);
	}

	const { files, included, missing } = collectAllowlist(repoRoot);
	console.log("PixelOffice source bundle (allowlist)");
	console.log(`  Repo: ${repoRoot}`);
	console.log(`  Out:  ${outPath}`);
	console.log("  Included roots:");
	for (const p of included) console.log(`    + ${p}`);
	if (missing.length > 0) {
		console.log("  Missing (skipped):");
		for (const p of missing) console.log(`    - ${p}`);
	}

	const zipFiles = files.map(({ abs, rel }) => ({
		archivePath: toArchivePath(zipRoot, rel),
		data: readFileSync(abs),
	}));

	if (zipFiles.length === 0) {
		throw new Error("Allowlist produced zero files.");
	}

	await createZip(outPath, zipFiles);
	console.log(`  Files: ${zipFiles.length}`);
	console.log(`Built ${outPath}`);
}

main().catch((err) => {
	console.error(err?.message ?? err);
	process.exit(1);
});
