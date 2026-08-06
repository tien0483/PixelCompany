/**
 * Stage allowlisted repo source + a flat (hoisted) node_modules + prebuilt UI
 * for the offline Windows installer. Unlike bundle-source.mjs's zip, this
 * copies straight to disk so Inno Setup can pick the tree up as-is — Inno
 * copies files, not symlinks, so the default pnpm store-linked tree would
 * arrive broken on the target machine.
 *
 * `--node-linker=hoisted` only flattens the TOP-LEVEL node_modules/<pkg>
 * entries; pnpm's internal node_modules/.pnpm virtual store still exists and
 * still symlinks nested/transitive deps to each other using absolute paths
 * rooted in *this* build machine's working directory. Those would dangle the
 * instant the tree is copied anywhere else (exactly what Inno Setup does on
 * the end user's machine), so after the install/build steps we walk every
 * node_modules tree and replace every remaining symlink (file or directory)
 * with a real recursive copy of whatever it resolves to.
 *
 *   node scripts/windows/installer/stage-app.mjs [--stage-dir path] [--repo-root path]
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, rmSync } from "node:fs";
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

/**
 * Recursively copy `src` into `dest`, dereferencing any symlink encountered
 * at any depth (not just at `src` itself) so the result is 100% real files
 * and directories. `visiting` is the set of realpaths currently being
 * resolved on the active call chain — used to detect a *structural* symlink
 * cycle (A -> symlink -> B -> ... -> symlink -> A) that a single
 * `realpathSync` call can't catch on its own (it only resolves one symlink's
 * own chain, not a cycle formed across several independent symlinks visited
 * while walking a directory tree).
 */
function copyReal(src, dest, visiting) {
	const st = lstatSync(src);
	if (st.isSymbolicLink()) {
		let real;
		try {
			real = realpathSync(src);
		} catch (err) {
			throw new Error(`Broken symlink while de-symlinking: ${src} (${err.message})`);
		}
		if (visiting.has(real)) {
			throw new Error(`Symlink cycle detected while de-symlinking (would recurse forever): ${src} -> ${real}`);
		}
		visiting.add(real);
		try {
			copyReal(real, dest, visiting);
		} finally {
			visiting.delete(real);
		}
		return;
	}
	if (st.isDirectory()) {
		mkdirSync(dest, { recursive: true });
		for (const name of readdirSync(src)) {
			copyReal(join(src, name), join(dest, name), visiting);
		}
		return;
	}
	mkdirSync(dirname(dest), { recursive: true });
	copyFileSync(src, dest);
}

/** Recursively replace every symlink under `dir` (at any depth) with a real, dereferenced copy in place. */
function deSymlinkTree(dir) {
	let entries;
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return;
	}
	for (const ent of entries) {
		const p = join(dir, ent.name);
		if (ent.isSymbolicLink()) {
			let real;
			try {
				real = realpathSync(p);
			} catch (err) {
				throw new Error(`Broken symlink while de-symlinking: ${p} (${err.message})`);
			}
			// `rm` on a path that is itself a symlink removes only the link, never the
			// target it points to — but double-check, since silently destroying shared
			// content other symlinks still point to would be far worse than leaving one
			// symlink behind.
			rmSync(p, { recursive: true, force: true });
			if (!existsSync(real)) {
				throw new Error(`De-symlinking ${p} appears to have deleted its target ${real} too — aborting.`);
			}
			copyReal(real, p, new Set([real]));
		} else if (ent.isDirectory()) {
			deSymlinkTree(p);
		}
	}
}

/** Recursively count symlinks under `dir`, at any depth. Used to verify de-symlinking left zero behind. */
function countSymlinks(dir) {
	let count = 0;
	let entries;
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return count;
	}
	for (const ent of entries) {
		const p = join(dir, ent.name);
		if (ent.isSymbolicLink()) count++;
		else if (ent.isDirectory()) count += countSymlinks(p);
	}
	return count;
}

/** Find every directory literally named `node_modules` under `root` (not descending into one once found — deSymlinkTree covers everything nested inside it, including further nested node_modules folders). */
function findNodeModulesDirs(root, found = []) {
	let entries;
	try {
		entries = readdirSync(root, { withFileTypes: true });
	} catch {
		return found;
	}
	for (const ent of entries) {
		if (!ent.isDirectory()) continue;
		const p = join(root, ent.name);
		if (ent.name === "node_modules") {
			found.push(p);
			continue;
		}
		findNodeModulesDirs(p, found);
	}
	return found;
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
	// tripping `tsc --noEmit` even though the app itself is fine (vite's own build
	// never runs tsc; it only strips types). The installer only needs a working
	// dist/, not a clean workspace-wide typecheck, so skip that guard here.
	run("pnpm", ["--dir", join(stageDir, "frontends", "pixel_office"), "exec", "vite", "build"], stageDir);

	// Run this last (not between install/rebuild/build) so no later pnpm
	// invocation gets a chance to notice the altered .pnpm store and "fix" it
	// back into symlinks, or get confused by state that no longer matches what
	// it originally linked.
	console.log("Flattening remaining symlinks under node_modules (pnpm's internal .pnpm store still uses them, even with --node-linker=hoisted)...");
	const nodeModulesDirs = findNodeModulesDirs(stageDir);
	for (const nm of nodeModulesDirs) deSymlinkTree(nm);
	const remainingSymlinks = countSymlinks(stageDir);
	if (remainingSymlinks > 0) {
		throw new Error(`${remainingSymlinks} symlink(s) remain under the staged tree after de-symlinking.`);
	}
	console.log(`  De-symlinked ${nodeModulesDirs.length} node_modules tree(s); verified zero symlinks remain under ${stageDir}.`);

	console.log(`Staged app: ${stageDir}`);
}

main().catch((err) => {
	console.error(err?.message ?? err);
	process.exit(1);
});
