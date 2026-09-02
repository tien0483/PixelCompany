/**
 * Allowlist-only source bundle for private Windows distribution.
 *
 *   node scripts/windows/bundle-source.mjs [--out path] [--repo-root path]
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createZip, toArchivePath } from "./zip-stdlib.mjs";
import { collectAllowlist } from "./source-allowlist.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

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

async function main() {
	const opts = parseArgs(process.argv.slice(2));
	if (opts.help) {
		console.log(`Usage: node scripts/windows/bundle-source.mjs [--out path] [--repo-root path]`);
		process.exit(0);
	}

	const repoRoot = resolve(opts.repoRoot || join(__dirname, "..", ".."));
	const outPath = resolve(opts.out || join(__dirname, "dist", "PixelOffice-windows.zip"));
	const zipRoot = "PixelOffice";

	if (!existsSync(join(repoRoot, "package.json"))) {
		throw new Error(`Not a repo root (missing package.json): ${repoRoot}`);
	}

	const { files, included, missing } = collectAllowlist(repoRoot);
	console.log("PIXTiel source bundle (allowlist)");
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
