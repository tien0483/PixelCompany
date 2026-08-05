/**
 * Stage allowlisted repo source + a flat (hoisted) node_modules + prebuilt UI
 * for the offline Windows installer. Unlike bundle-source.mjs's zip, this
 * copies straight to disk so Inno Setup can pick the tree up as-is — Inno
 * copies files, not symlinks, so the default pnpm store-linked tree would
 * arrive broken on the target machine.
 *
 *   node scripts/windows/installer/stage-app.mjs [--stage-dir path] [--repo-root path]
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { collectAllowlist } from "../source-allowlist.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
	const opts = { stageDir: "", repoRoot: "" };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--stage-dir") opts.stageDir = argv[++i] ?? "";
		else if (a === "--repo-root") opts.repoRoot = argv[++i] ?? "";
		else if (a === "--help" || a === "-h") opts.help = true;
		else throw new Error(`Unknown argument: ${a}`);
	}
	return opts;
}

function run(cmd, args, cwd) {
	const r = spawnSync(cmd, args, {
		cwd,
		stdio: "inherit",
		windowsHide: true,
		shell: process.platform === "win32",
		env: process.env,
	});
	if (r.error) throw new Error(`${cmd} ${args.join(" ")} failed to start: ${r.error.message}`);
	if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed (exit ${r.status})`);
}

function copyAllowlist(repoRoot, stageDir) {
	const { files, included, missing } = collectAllowlist(repoRoot);
	console.log("Staging allowlisted source...");
	for (const p of included) console.log(`  + ${p}`);
	if (missing.length > 0) {
		console.log("  Missing (skipped):");
		for (const p of missing) console.log(`    - ${p}`);
	}
	if (files.length === 0) {
		throw new Error("Allowlist produced zero files.");
	}
	for (const { abs, rel } of files) {
		const dest = join(stageDir, ...rel.split("/"));
		mkdirSync(dirname(dest), { recursive: true });
		copyFileSync(abs, dest);
	}
	console.log(`  Copied ${files.length} files.`);
}

async function main() {
	const opts = parseArgs(process.argv.slice(2));
	if (opts.help) {
		console.log("Usage: node scripts/windows/installer/stage-app.mjs [--stage-dir path] [--repo-root path]");
		process.exit(0);
	}
	if (process.platform !== "win32") {
		throw new Error("Staging must run on Windows x64 (native modules build for that ABI).");
	}

	const repoRoot = resolve(opts.repoRoot || join(__dirname, "..", "..", ".."));
	const stageDir = resolve(opts.stageDir || join(__dirname, "stage", "app"));

	if (!existsSync(join(repoRoot, "package.json"))) {
		throw new Error(`Not a repo root (missing package.json): ${repoRoot}`);
	}

	if (existsSync(stageDir)) rmSync(stageDir, { recursive: true, force: true });
	mkdirSync(stageDir, { recursive: true });

	copyAllowlist(repoRoot, stageDir);

	console.log("Installing dependencies (hoisted, flat tree)...");
	run("pnpm", ["install", "--node-linker=hoisted", "--ignore-scripts"], stageDir);
	console.log("Rebuilding native / allowlisted packages...");
	run("pnpm", ["rebuild"], stageDir);

	console.log("Building the UI (frontends/pixel_office)...");
	// Deliberately `exec vite build`, not `run build` (which chains `tsc --noEmit`).
	// Under --node-linker=hoisted, pnpm's peer-dependency virtual-store forking can
	// produce more than one physical copy of the same zod version, so TypeScript
	// sees `z.infer<>`-derived types (e.g. RuntimeManagerAccount) declared via one
	// copy as nominally "unrelated" to the same type reached via the other copy —
	// tripping `tsc --noEmit` in test-only files even though the app itself is fine
	// (vite's own build never runs tsc; it only strips types). The installer only
	// needs a working dist/, not a clean workspace-wide typecheck, so skip that guard here.
	run("pnpm", ["--dir", join(stageDir, "frontends", "pixel_office"), "exec", "vite", "build"], stageDir);

	console.log(`Staged app: ${stageDir}`);
}

main().catch((err) => {
	console.error(err?.message ?? err);
	process.exit(1);
});
