/**
 * Download (with an on-disk cache) and stage a portable Node.js runtime and a
 * relocatable Python + Manager dependencies for the offline Windows
 * installer. Independent of stage-app.mjs — reads Manager's deps straight
 * from the repo's backends/manager, not from the staged copy.
 *
 *   node scripts/windows/installer/stage-runtime.mjs [--stage-dir path] [--repo-root path]
 */
import { spawnSync } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { finished } from "node:stream/promises";
import { extractZip } from "../zip-stdlib.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

const NODE_VERSION = "22.22.1";
const NODE_ZIP_URL = `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-win-x64.zip`;
const PYTHON_TAG = "20260804";
const PYTHON_VERSION = "3.10.20";
const PYTHON_TAR_URL =
	`https://github.com/astral-sh/python-build-standalone/releases/download/${PYTHON_TAG}/` +
	`cpython-${PYTHON_VERSION}%2B${PYTHON_TAG}-x86_64-pc-windows-msvc-install_only.tar.gz`;

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

async function downloadCached(url, cachePath) {
	if (existsSync(cachePath) && statSync(cachePath).size > 0) {
		console.log(`  Using cached ${cachePath}`);
		return;
	}
	console.log(`  Downloading ${url}`);
	mkdirSync(dirname(cachePath), { recursive: true });
	const res = await fetch(url);
	if (!res.ok || !res.body) {
		throw new Error(`Download failed (${res.status}): ${url}`);
	}
	const tmp = `${cachePath}.part`;
	const out = createWriteStream(tmp);
	await finished(Readable.fromWeb(res.body).pipe(out));
	renameSync(tmp, cachePath);
}

function flattenSingleChildDir(dir) {
	const entries = readdirSync(dir, { withFileTypes: true });
	if (entries.length !== 1 || !entries[0].isDirectory()) return;
	const nested = join(dir, entries[0].name);
	const tmp = `${dir}.flatten-tmp`;
	renameSync(nested, tmp);
	rmSync(dir, { recursive: true, force: true });
	renameSync(tmp, dir);
}

function run(cmd, args, cwd) {
	const r = spawnSync(cmd, args, { cwd, stdio: "inherit", windowsHide: true, shell: process.platform === "win32" });
	if (r.error) throw new Error(`${cmd} ${args.join(" ")} failed to start: ${r.error.message}`);
	if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed (exit ${r.status})`);
}

// Resolve the Windows-native bsdtar (System32\tar.exe, shipped since Windows
// 10 1803) by absolute path instead of a bare "tar". On machines with Git for
// Windows installed, its MSYS-based tar.exe commonly wins PATH resolution
// ahead of System32, and that MSYS tar misbehaves when spawned as a child of
// a native Win32 process (as Node always does on Windows, even with
// shell: true): it garbles/loses the "-C" destination argument and also
// misparses an absolute "C:\..." archive path as a "host:path" remote-tar
// spec (a single-letter "host" followed by a colon), trying to rsh into a
// host named "C". Going straight for the known-good System32 binary sidesteps
// both bugs; `tar` on PATH is only a fallback for the unlikely case that path
// doesn't exist (e.g. a stripped-down Windows image).
function resolveSystemTar() {
	const systemRoot = process.env.SystemRoot || process.env.windir || "C:\\Windows";
	const candidate = join(systemRoot, "System32", "tar.exe");
	return existsSync(candidate) ? candidate : "tar";
}

async function stageNode(cacheDir, runtimeDir) {
	const zipPath = join(cacheDir, `node-v${NODE_VERSION}-win-x64.zip`);
	console.log("Staging Node runtime...");
	await downloadCached(NODE_ZIP_URL, zipPath);
	const nodeDir = join(runtimeDir, "node");
	if (existsSync(nodeDir)) rmSync(nodeDir, { recursive: true, force: true });
	mkdirSync(nodeDir, { recursive: true });
	extractZip(zipPath, nodeDir);
	flattenSingleChildDir(nodeDir);
	const nodeExe = join(nodeDir, "node.exe");
	if (!existsSync(nodeExe)) throw new Error(`Expected ${nodeExe} after extracting Node zip.`);
	return nodeExe;
}

async function stagePython(cacheDir, runtimeDir, managerSourceDir) {
	const tarPath = join(cacheDir, `cpython-${PYTHON_VERSION}-win-x64.tar.gz`);
	console.log("Staging Python runtime...");
	await downloadCached(PYTHON_TAR_URL, tarPath);
	const pythonDir = join(runtimeDir, "python");
	if (existsSync(pythonDir)) rmSync(pythonDir, { recursive: true, force: true });
	mkdirSync(pythonDir, { recursive: true });
	// python-build-standalone ships a POSIX tarball even for Windows builds;
	// Windows 10 1803+/11 ship tar.exe (bsdtar) on PATH, so shell out rather
	// than reimplementing tar in JS for a maintainer-only staging script.
	run(resolveSystemTar(), ["-xzf", tarPath, "-C", pythonDir], undefined);
	flattenSingleChildDir(pythonDir);
	const pythonExe = join(pythonDir, "python.exe");
	if (!existsSync(pythonExe)) throw new Error(`Expected ${pythonExe} after extracting Python tarball.`);

	console.log("Installing Manager dependencies into the staged Python...");
	run(
		"uv",
		["pip", "install", "--python", pythonExe, "--target", join(pythonDir, "Lib", "site-packages"), managerSourceDir],
		undefined,
	);
	return pythonExe;
}

async function main() {
	const opts = parseArgs(process.argv.slice(2));
	if (opts.help) {
		console.log("Usage: node scripts/windows/installer/stage-runtime.mjs [--stage-dir path] [--repo-root path]");
		process.exit(0);
	}
	if (process.platform !== "win32") {
		throw new Error("Staging must run on Windows x64.");
	}

	const repoRoot = resolve(opts.repoRoot || join(__dirname, "..", "..", ".."));
	const runtimeDir = resolve(opts.stageDir || join(__dirname, "stage", "runtime"));
	const cacheDir = join(__dirname, ".cache");
	const managerSourceDir = join(repoRoot, "backends", "manager");

	if (!existsSync(managerSourceDir)) {
		throw new Error(`Manager source not found: ${managerSourceDir}`);
	}

	mkdirSync(runtimeDir, { recursive: true });
	const nodeExe = await stageNode(cacheDir, runtimeDir);
	const pythonExe = await stagePython(cacheDir, runtimeDir, managerSourceDir);

	console.log(`Staged Node:   ${nodeExe}`);
	console.log(`Staged Python: ${pythonExe}`);
}

main().catch((err) => {
	console.error(err?.message ?? err);
	process.exit(1);
});
