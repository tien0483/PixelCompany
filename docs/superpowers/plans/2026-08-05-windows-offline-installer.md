# Windows Offline GUI Installer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the console-based `PixelOffice-Setup.cmd` flow with a single double-click `PixelOffice-Setup.exe` (Inno Setup wizard, project icon, Programs & Features uninstall entry) that installs fully offline — no winget, pnpm, uv, or network access on the end-user machine.

**Architecture:** Maintainer-only staging scripts copy an allowlisted source tree with a flat (hoisted) `node_modules`, a prebuilt UI, a bundled Node 22 runtime, and a relocatable Python + Manager deps into `installer/stage/`. A small windowless C# launcher (compiled with the in-box .NET Framework compiler, no new toolchain) boots the stack and opens the existing chromeless `--app=` browser window. Inno Setup 6 compiles the staged tree into one exe that just copies files — no scripts run at install time.

**Tech Stack:** Node.js (staging scripts, reusing existing `zip-stdlib.mjs`), C# via in-box `csc.exe` (launcher), Inno Setup 6 / `ISCC.exe` (installer wizard), pnpm (hoisted install), uv (Python dependency resolution against a staged interpreter).

## Global Constraints

- Node >= 22 required end-to-end (repo `package.json` `engines.node`, `solo.mjs`'s `MIN_NODE_MAJOR`) — bundle Node **v22.22.1** windows-x64 (`https://nodejs.org/dist/v22.22.1/node-v22.22.1-win-x64.zip`, verified present).
- Python: bundle **CPython 3.10.20** via python-build-standalone tag `20260804` (`https://github.com/astral-sh/python-build-standalone/releases/download/20260804/cpython-3.10.20%2B20260804-x86_64-pc-windows-msvc-install_only.tar.gz`, verified present) — satisfies Manager's `requires-python = ">=3.10"`.
- Per-user install under `%LOCALAPPDATA%\PixelOffice`, no admin/UAC — Inno `PrivilegesRequired=lowest`.
- Fully offline install: the installer only copies files. All network access (pnpm registry, PyPI, Node/Python downloads) happens at **staging time** on the maintainer's machine, never at install time.
- x64 + one pinned Node major only (native modules `node-pty`, `esbuild` are prebuilt for that ABI) — staging must run on Windows x64.
- Manager Python resolution reuses the existing `MANAGER_PYTHON` env var read in `backends/runtime/src/manager/manager-process.ts:133` (`resolvePythonBinary`) — **zero runtime code changes**.
- UI is prebuilt at stage time; the launcher runs `solo.mjs --skip-build --no-open`.
- Build-machine tools: Node >= 22, pnpm, uv (all already required by the existing dev workflow per repo `CLAUDE.md`), Inno Setup 6 (`winget install -e --id JRSoftware.InnoSetup`), Windows' in-box `tar.exe` (ships since Windows 10 1803), and the in-box C# compiler at `C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe`.
- No AI-attribution trailers in commit messages (repo `CLAUDE.md`).
- Reuse, don't duplicate: the source allowlist must have one definition shared by the existing zip bundler and the new disk-staging script.

## File Structure

```
scripts/windows/
  source-allowlist.mjs         [NEW] shared ALLOWLIST/SKIP sets + collectAllowlist(), extracted from bundle-source.mjs
  bundle-source.mjs            [MODIFIED] imports from source-allowlist.mjs instead of owning the arrays
  installer/                   [NEW]
    stage-app.mjs               [NEW] copies allowlisted source + hoisted pnpm install + UI build -> stage/app
    stage-runtime.mjs           [NEW] downloads/caches Node zip + Python tarball, installs Manager deps -> stage/runtime
    Launcher.cs                 [NEW] windowless start/stop launcher -> compiled to stage/PixelOffice.exe
    PixelOffice.iss              [NEW] Inno Setup script -> ../dist/PixelOffice-Setup.exe
    build-installer.mjs         [NEW] orchestrates the four scripts/compiles above end-to-end
    .cache/                     [NEW, gitignored] downloaded Node zip + Python tarball (re-used across builds)
    stage/                      [NEW, gitignored] staged install tree consumed by ISCC.exe
  README.md                    [MODIFIED] documents the new one-file offline installer as the recommended path
.gitignore                     [MODIFIED] add installer/.cache/ and installer/stage/
```

---

### Task 1: Extract the shared source allowlist

**Files:**
- Create: `scripts/windows/source-allowlist.mjs`
- Modify: `scripts/windows/bundle-source.mjs`

**Interfaces:**
- Produces: `collectAllowlist(repoRoot: string): { files: {abs: string, rel: string}[], included: string[], missing: string[] }`, `shouldSkipFile(name: string): boolean`, `ALLOWLIST: string[]`, `SKIP_DIR_NAMES: Set<string>`, `SKIP_FILE_NAMES: Set<string>` — consumed by Task 2's `stage-app.mjs`.

- [ ] **Step 1: Create `scripts/windows/source-allowlist.mjs`**

```js
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
	".agent/AGENT.md",
	".agent/manager",
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
```

- [ ] **Step 2: Rewrite `scripts/windows/bundle-source.mjs` to import from it**

Replace the whole file with:

```js
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
```

- [ ] **Step 3: Regression-check the refactor**

Run: `node scripts/windows/bundle-source.mjs --out scratch/before-refactor-check.zip` from the repo root, twice — once on the ORIGINAL `bundle-source.mjs` (via `git stash` before Step 2) noting the printed `Files: N`, then again after Step 2's rewrite. Both runs must print the identical `Files: N` count and identical included/missing lists. Delete the scratch zip afterward.

Expected: same file count before and after.

- [ ] **Step 4: Commit**

```bash
git add scripts/windows/source-allowlist.mjs scripts/windows/bundle-source.mjs
git commit -m "refactor(windows): extract shared source allowlist"
```

---

### Task 2: Stage the app tree (source + hoisted deps + built UI)

**Files:**
- Create: `scripts/windows/installer/stage-app.mjs`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: `collectAllowlist(repoRoot)` from Task 1's `scripts/windows/source-allowlist.mjs`.
- Produces: a stage tree at `scripts/windows/installer/stage/app/` with a flat `node_modules` and a prebuilt `frontends/pixel_office/dist/` — consumed by Task 5 (`PixelOffice.iss`'s `[Files]`) and Task 6 (`build-installer.mjs`).

- [ ] **Step 1: Add installer scratch dirs to `.gitignore`**

Append to `.gitignore`:

```
# Windows offline installer staging (rebuilt by installer/build-installer.mjs)
scripts/windows/installer/.cache/
scripts/windows/installer/stage/
```

- [ ] **Step 2: Create `scripts/windows/installer/stage-app.mjs`**

```js
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
	run("pnpm", ["--dir", join(stageDir, "frontends", "pixel_office"), "run", "build"], stageDir);

	console.log(`Staged app: ${stageDir}`);
}

main().catch((err) => {
	console.error(err?.message ?? err);
	process.exit(1);
});
```

- [ ] **Step 3: Run it and verify the flat tree + prebuilt UI**

Run: `node scripts/windows/installer/stage-app.mjs`

Then verify (PowerShell):

```powershell
node -e "const fs=require('fs'); const p='scripts/windows/installer/stage/app/node_modules/tsx/dist/cli.mjs'; if(!fs.existsSync(p)) throw new Error('missing '+p); if(fs.lstatSync(p).isSymbolicLink()) throw new Error('tsx cli.mjs is still a symlink'); console.log('tsx OK (flat file)');"
node -e "const fs=require('fs'); const p='scripts/windows/installer/stage/app/frontends/pixel_office/dist/index.html'; if(!fs.existsSync(p)) throw new Error('missing '+p); console.log('UI dist OK');"
```

Expected: both print `OK` with no thrown error.

- [ ] **Step 4: Commit**

```bash
git add scripts/windows/installer/stage-app.mjs .gitignore
git commit -m "feat(windows): stage a flat app tree for the offline installer"
```

---

### Task 3: Stage the bundled Node + Python runtime

**Files:**
- Create: `scripts/windows/installer/stage-runtime.mjs`

**Interfaces:**
- Consumes: `extractZip(zipPath, destDir)` from existing `scripts/windows/zip-stdlib.mjs`.
- Produces: `scripts/windows/installer/stage/runtime/node/node.exe` and `scripts/windows/installer/stage/runtime/python/python.exe` (with Manager's deps already installed into that Python's `Lib/site-packages`) — consumed by Task 5/6 and referenced by Task 4's `Launcher.cs` (`runtime\node\node.exe`, `runtime\python\python.exe`).

- [ ] **Step 1: Create `scripts/windows/installer/stage-runtime.mjs`**

```js
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
	run("tar", ["-xzf", tarPath, "-C", pythonDir], undefined);
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
```

- [ ] **Step 2: Run it**

Run: `node scripts/windows/installer/stage-runtime.mjs`

Expected: prints `Staged Node: ...\stage\runtime\node\node.exe` and `Staged Python: ...\stage\runtime\python\python.exe`. First run downloads ~36 MB (Node) + Python's tarball; re-running immediately should print `Using cached ...` for both and skip re-downloading.

- [ ] **Step 3: Verify both interpreters work standalone**

```powershell
scripts\windows\installer\stage\runtime\node\node.exe --version
scripts\windows\installer\stage\runtime\python\python.exe -c "import fastapi, uvicorn, click, aiohttp; print('manager deps OK')"
```

Expected: first prints `v22.22.1`; second prints `manager deps OK` with no `ModuleNotFoundError`.

- [ ] **Step 4: Commit**

```bash
git add scripts/windows/installer/stage-runtime.mjs
git commit -m "feat(windows): stage a bundled Node + Python runtime for the offline installer"
```

---

### Task 4: Windowless launcher (`Launcher.cs`)

**Files:**
- Create: `scripts/windows/installer/Launcher.cs`

**Interfaces:**
- Consumes (at runtime, once installed): `{installDir}\config.json` (`Url` field), `{installDir}\runtime\node\node.exe`, `{installDir}\runtime\python\python.exe`, `{installDir}\app\scripts\solo.mjs`, `{installDir}\stop.mjs` — all populated by Tasks 2/3/6.
- Produces: `PixelOffice.exe` (compiled artifact, not committed as source-built binary) — installed by Task 5's `[Files]`/`[Icons]` sections; invoked with no args to start, `--stop` to stop.

- [ ] **Step 1: Create `scripts/windows/installer/Launcher.cs`**

```csharp
using System;
using System.Diagnostics;
using System.IO;
using System.Net.Sockets;
using System.Threading;
using System.Windows.Forms;

static class PixelOfficeLauncher
{
	[STAThread]
	static int Main(string[] args)
	{
		string installDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');

		if (Array.IndexOf(args, "--stop") >= 0)
		{
			return RunStop(installDir);
		}

		string configPath = Path.Combine(installDir, "config.json");
		if (!File.Exists(configPath))
		{
			MessageBox.Show("PixelOffice config not found: " + configPath, "PixelOffice",
				MessageBoxButtons.OK, MessageBoxIcon.Error);
			return 1;
		}
		string configJson = File.ReadAllText(configPath);
		string url = ExtractJsonString(configJson, "Url") ?? "http://127.0.0.1:3484";
		Uri uri;
		try
		{
			uri = new Uri(url);
		}
		catch (Exception ex)
		{
			MessageBox.Show("Invalid Url in config.json: " + ex.Message, "PixelOffice",
				MessageBoxButtons.OK, MessageBoxIcon.Error);
			return 1;
		}
		return RunStart(installDir, uri);
	}

	static bool PortOpen(string hostName, int port, int timeoutMs)
	{
		try
		{
			using (var client = new TcpClient())
			{
				var result = client.BeginConnect(hostName, port, null, null);
				bool signaled = result.AsyncWaitHandle.WaitOne(timeoutMs);
				if (!signaled || !client.Connected) return false;
				client.EndConnect(result);
				return true;
			}
		}
		catch
		{
			return false;
		}
	}

	static int RunStop(string installDir)
	{
		string nodeExe = Path.Combine(installDir, "runtime", "node", "node.exe");
		string stopScript = Path.Combine(installDir, "stop.mjs");
		if (!File.Exists(nodeExe) || !File.Exists(stopScript))
		{
			MessageBox.Show("PixelOffice is not fully installed (missing runtime or stop.mjs).", "PixelOffice",
				MessageBoxButtons.OK, MessageBoxIcon.Error);
			return 1;
		}
		var psi = new ProcessStartInfo(nodeExe, "\"" + stopScript + "\"")
		{
			WorkingDirectory = installDir,
			UseShellExecute = false,
			CreateNoWindow = true,
		};
		try
		{
			using (var p = Process.Start(psi))
			{
				p.WaitForExit(15000);
				return p.HasExited ? p.ExitCode : 0;
			}
		}
		catch (Exception ex)
		{
			MessageBox.Show("Could not stop PixelOffice: " + ex.Message, "PixelOffice",
				MessageBoxButtons.OK, MessageBoxIcon.Error);
			return 1;
		}
	}

	static int RunStart(string installDir, Uri uri)
	{
		if (PortOpen(uri.Host, uri.Port, 500))
		{
			OpenAppWindow(uri.ToString());
			return 0;
		}

		using (var splash = new SplashForm())
		{
			splash.Show();
			splash.Refresh();

			if (!BootStack(installDir))
			{
				splash.Close();
				MessageBox.Show(
					"Could not start PixelOffice. Check " + Path.Combine(installDir, "solo.log"),
					"PixelOffice", MessageBoxButtons.OK, MessageBoxIcon.Error);
				return 1;
			}

			DateTime deadline = DateTime.UtcNow.AddSeconds(120);
			bool ready = false;
			while (DateTime.UtcNow < deadline)
			{
				if (PortOpen(uri.Host, uri.Port, 500)) { ready = true; break; }
				Application.DoEvents();
				Thread.Sleep(500);
			}

			splash.Close();

			if (!ready)
			{
				MessageBox.Show(
					"Timed out waiting for PixelOffice to start.\nCheck " + Path.Combine(installDir, "solo.log"),
					"PixelOffice", MessageBoxButtons.OK, MessageBoxIcon.Error);
				return 1;
			}
		}

		OpenAppWindow(uri.ToString());
		return 0;
	}

	// Writes a throwaway boot.cmd rather than shelling a quoted command line
	// directly (cmd.exe's quoting rules differ from CommandLineToArgvW, so a
	// hand-built /c string is a classic source of mis-parsed paths-with-spaces;
	// a generated .cmd file sidesteps that, matching install.mjs's writeCmd()).
	// This also avoids redirecting the child's stdout through a managed pipe:
	// a detached long-lived process needs a live reader to drain a pipe, but
	// cmd.exe's ">>" opens the log file with its own handle, so nothing needs
	// to keep reading after this launcher exits.
	static bool BootStack(string installDir)
	{
		string nodeExe = Path.Combine(installDir, "runtime", "node", "node.exe");
		string pythonExe = Path.Combine(installDir, "runtime", "python", "python.exe");
		string appDir = Path.Combine(installDir, "app");
		string soloScript = Path.Combine(appDir, "scripts", "solo.mjs");
		string logPath = Path.Combine(installDir, "solo.log");
		string bootBat = Path.Combine(installDir, "boot.cmd");

		if (!File.Exists(nodeExe) || !File.Exists(pythonExe) || !File.Exists(soloScript))
		{
			return false;
		}

		string batContents =
			"@echo off\r\n" +
			"cd /d \"" + appDir + "\"\r\n" +
			"set \"MANAGER_PYTHON=" + pythonExe + "\"\r\n" +
			"\"" + nodeExe + "\" \"" + soloScript + "\" --skip-build --no-open >> \"" + logPath + "\" 2>&1\r\n";
		File.WriteAllText(bootBat, batContents);

		var psi = new ProcessStartInfo(bootBat)
		{
			UseShellExecute = true,
			WindowStyle = ProcessWindowStyle.Hidden,
		};
		try
		{
			Process.Start(psi);
			return true;
		}
		catch
		{
			return false;
		}
	}

	static void OpenAppWindow(string url)
	{
		string[] candidates =
		{
			Environment.ExpandEnvironmentVariables(@"%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"),
			Environment.ExpandEnvironmentVariables(@"%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"),
			Environment.ExpandEnvironmentVariables(@"%LOCALAPPDATA%\Microsoft\Edge\Application\msedge.exe"),
			Environment.ExpandEnvironmentVariables(@"%ProgramFiles%\Google\Chrome\Application\chrome.exe"),
			Environment.ExpandEnvironmentVariables(@"%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"),
			Environment.ExpandEnvironmentVariables(@"%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"),
		};
		foreach (var exe in candidates)
		{
			if (File.Exists(exe))
			{
				Process.Start(new ProcessStartInfo(exe, "--app=" + url) { UseShellExecute = false });
				return;
			}
		}
		Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
	}

	static string ExtractJsonString(string json, string key)
	{
		string pattern = "\"" + key + "\"";
		int idx = json.IndexOf(pattern, StringComparison.Ordinal);
		if (idx < 0) return null;
		int colon = json.IndexOf(':', idx + pattern.Length);
		if (colon < 0) return null;
		int firstQuote = json.IndexOf('"', colon + 1);
		if (firstQuote < 0) return null;
		int secondQuote = json.IndexOf('"', firstQuote + 1);
		if (secondQuote < 0) return null;
		return json.Substring(firstQuote + 1, secondQuote - firstQuote - 1);
	}
}

class SplashForm : Form
{
	public SplashForm()
	{
		Text = "PixelOffice";
		FormBorderStyle = FormBorderStyle.FixedDialog;
		StartPosition = FormStartPosition.CenterScreen;
		ClientSize = new System.Drawing.Size(320, 100);
		ControlBox = false;
		MinimizeBox = false;
		MaximizeBox = false;
		TopMost = true;
		var label = new Label
		{
			Text = "Starting PixelOffice...",
			Dock = DockStyle.Fill,
			TextAlign = System.Drawing.ContentAlignment.MiddleCenter,
			Font = new System.Drawing.Font("Segoe UI", 11),
		};
		Controls.Add(label);
	}
}
```

- [ ] **Step 2: Compile it**

```bat
"C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /target:winexe /out:"scripts\windows\installer\stage\PixelOffice.exe" /win32icon:"scripts\windows\PixelOffice.ico" /reference:System.Windows.Forms.dll /reference:System.Drawing.dll "scripts\windows\installer\Launcher.cs"
```

Expected: exits 0, produces `scripts\windows\installer\stage\PixelOffice.exe` with the PixelOffice icon.

- [ ] **Step 3: Build a minimal test fixture for `--stop`**

`stage\runtime\` already exists from Task 3. Add the two remaining install-root files it needs:

```powershell
Copy-Item scripts\windows\stop.mjs scripts\windows\installer\stage\stop.mjs
'{"Runtime":"windows","Url":"http://127.0.0.1:3484","Browser":"auto"}' | Set-Content scripts\windows\installer\stage\config.json
```

- [ ] **Step 4: Verify `--stop` when nothing is listening**

Run: `scripts\windows\installer\stage\PixelOffice.exe --stop`

Expected: no message box, process exits promptly (`stop.mjs` prints "No listeners found..." and exits 0 — verify via `echo %ERRORLEVEL%` after the run, expect `0`).

- [ ] **Step 5: Verify `--stop` actually kills a listener**

In one terminal: `scripts\windows\installer\stage\runtime\node\node.exe -e "require('net').createServer(()=>{}).listen(3484,()=>console.log('listening'))"` (leave running).

In another terminal: `netstat -ano | findstr :3484` (confirm a LISTENING line), then run `scripts\windows\installer\stage\PixelOffice.exe --stop`, then `netstat -ano | findstr :3484` again.

Expected: the second `netstat` check shows no LISTENING line on 3484 — the dummy listener process was killed.

- [ ] **Step 6: Commit**

```bash
git add scripts/windows/installer/Launcher.cs
git commit -m "feat(windows): add windowless start/stop launcher"
```

(The compiled `stage/PixelOffice.exe`, `stage/stop.mjs`, and `stage/config.json` test fixtures are under the gitignored `installer/stage/` — nothing to add there.)

---

### Task 5: Inno Setup script (`PixelOffice.iss`)

**Files:**
- Create: `scripts/windows/installer/PixelOffice.iss`

**Interfaces:**
- Consumes: `stage\app\*` (Task 2), `stage\runtime\*` (Task 3), `stage\PixelOffice.exe` (Task 4), `stage\stop.mjs` (copied in Task 6), `..\PixelOffice.ico` (existing file).
- Produces: `scripts/windows/dist/PixelOffice-Setup.exe`.

- [ ] **Step 1: Install Inno Setup 6 on the build machine**

```bat
winget install -e --id JRSoftware.InnoSetup --accept-package-agreements --accept-source-agreements
```

Expected: `ISCC.exe` becomes available (typically at `C:\Program Files (x86)\Inno Setup 6\ISCC.exe`, added to PATH by the installer).

**Deviation from the design spec:** the spec called for a pre-install check that stops PixelOffice if it's already running before overwriting its files. That's chicken-and-egg for a first install (there's nothing at `{app}\PixelOffice.exe` to invoke `--stop` on until Setup has already copied files), and fragile to script correctly for the upgrade-over-existing-install case. This plan drops it and relies on Inno's built-in behavior instead: if a target file is locked (e.g. `node.exe` still running), Inno's file-copy step natively shows a Retry/Abort dialog rather than silently corrupting the install. The uninstall-time stop (`InitializeUninstall` below) is kept, since by then `{app}\PixelOffice.exe` reliably exists.

- [ ] **Step 2: Generate a real AppId GUID**

```powershell
[guid]::NewGuid().ToString('B').ToUpper()
```

Copy the printed value (e.g. `{A1B2C3D4-E5F6-4789-ABCD-1234567890AB}`) — it goes into `AppId=` in Step 3, replacing the placeholder shown there literally. This value must never change across future rebuilds (it's what lets a re-run of the installer recognize and upgrand the existing install rather than side-by-side installing).

- [ ] **Step 3: Create `scripts/windows/installer/PixelOffice.iss`**

```ini
; PixelOffice.iss — Inno Setup script for the offline GUI installer.
; Compiled via ISCC.exe by build-installer.mjs after stage-app.mjs and
; stage-runtime.mjs populate the "stage" directory referenced below.
#define MyAppName "PixelOffice"
#define MyAppVersion "1.0.0"

[Setup]
AppId={{PASTE-YOUR-GENERATED-GUID-HERE}}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
DefaultDirName={localappdata}\PixelOffice
DefaultGroupName=PixelOffice
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=..\dist
OutputBaseFilename=PixelOffice-Setup
SetupIconFile=..\PixelOffice.ico
UninstallDisplayIcon={app}\PixelOffice.exe
Compression=lzma2
SolidCompression=yes
WizardStyle=modern

[Files]
Source: "stage\app\*"; DestDir: "{app}\app"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "stage\runtime\*"; DestDir: "{app}\runtime"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "stage\PixelOffice.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "stage\stop.mjs"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\PixelOffice.ico"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\PixelOffice"; Filename: "{app}\PixelOffice.exe"; IconFilename: "{app}\PixelOffice.ico"
Name: "{group}\PixelOffice Stop"; Filename: "{app}\PixelOffice.exe"; Parameters: "--stop"; IconFilename: "{app}\PixelOffice.ico"
Name: "{group}\Uninstall PixelOffice"; Filename: "{uninstallexe}"
Name: "{userdesktop}\PixelOffice"; Filename: "{app}\PixelOffice.exe"; IconFilename: "{app}\PixelOffice.ico"
Name: "{userdesktop}\PixelOffice Stop"; Filename: "{app}\PixelOffice.exe"; Parameters: "--stop"; IconFilename: "{app}\PixelOffice.ico"

[Run]
Filename: "{app}\PixelOffice.exe"; Description: "Launch PixelOffice"; Flags: postinstall nowait skipifsilent unchecked

[UninstallDelete]
Type: filesandordirs; Name: "{app}\app\node_modules"
Type: filesandordirs; Name: "{app}\runtime"

[Code]
var
  RemoveConfig: Boolean;

procedure CurStepChanged(CurStep: TSetupStep);
var
  ConfigJson, AppDir, AppDirEscaped: String;
begin
  if CurStep = ssPostInstall then
  begin
    AppDir := ExpandConstant('{app}');
    AppDirEscaped := AppDir;
    StringChange(AppDirEscaped, '\', '\\');
    ConfigJson :=
      '{' + #13#10 +
      '  "Runtime": "windows",' + #13#10 +
      '  "Url": "http://127.0.0.1:3484",' + #13#10 +
      '  "Browser": "auto",' + #13#10 +
      '  "WslDistro": "",' + #13#10 +
      '  "WslRepoPath": "",' + #13#10 +
      '  "WindowsRepoPath": "' + AppDirEscaped + '\\app"' + #13#10 +
      '}';
    SaveStringToFile(AppDir + '\config.json', ConfigJson, False);
  end;
end;

function InitializeUninstall(): Boolean;
var
  ResultCode: Integer;
begin
  Exec(ExpandConstant('{app}\PixelOffice.exe'), '--stop', '', SW_HIDE,
       ewWaitUntilTerminated, ResultCode);
  RemoveConfig := (MsgBox('Also remove PixelOffice configuration (config.json)?',
    mbConfirmation, MB_YESNO) = IDYES);
  Result := True;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if (CurUninstallStep = usPostUninstall) and RemoveConfig then
  begin
    DeleteFile(ExpandConstant('{app}\config.json'));
    RemoveDir(ExpandConstant('{app}'));
  end;
end;
```

- [ ] **Step 4: Copy `stop.mjs` into stage root (needed for this compile — Task 6 automates it permanently)**

```powershell
Copy-Item scripts\windows\stop.mjs scripts\windows\installer\stage\stop.mjs -Force
```

- [ ] **Step 5: Compile and verify the installer**

```bat
ISCC.exe scripts\windows\installer\PixelOffice.iss
```

Expected: exits 0, produces `scripts\windows\dist\PixelOffice-Setup.exe`.

- [ ] **Step 6: Silent-install and verify the install tree**

```bat
scripts\windows\dist\PixelOffice-Setup.exe /VERYSILENT /SUPPRESSMSGBOXES /LOG="%TEMP%\po-install.log"
```

Then verify:

```powershell
Test-Path "$env:LOCALAPPDATA\PixelOffice\app\package.json"
Test-Path "$env:LOCALAPPDATA\PixelOffice\runtime\node\node.exe"
Test-Path "$env:LOCALAPPDATA\PixelOffice\PixelOffice.exe"
Test-Path "$env:LOCALAPPDATA\PixelOffice\config.json"
Test-Path "$env:USERPROFILE\Desktop\PixelOffice.lnk"
```

Expected: all five print `True`.

- [ ] **Step 7: Verify uninstall**

Run `& "$env:LOCALAPPDATA\PixelOffice\unins000.exe"` (interactive — click through; answer "No" to the "remove config?" prompt first to confirm the prompt appears at all). Then re-run install (Step 6) and uninstall again answering "Yes", confirming `%LOCALAPPDATA%\PixelOffice` is fully removed both times except for `config.json` in the "No" case.

Expected: install dir removed; `config.json` survives the "No" uninstall and is removed in the "Yes" uninstall.

- [ ] **Step 8: Commit**

```bash
git add scripts/windows/installer/PixelOffice.iss
git commit -m "feat(windows): add Inno Setup script for the offline installer"
```

---

### Task 6: Orchestration script (`build-installer.mjs`)

**Files:**
- Create: `scripts/windows/installer/build-installer.mjs`

**Interfaces:**
- Consumes: Task 2's `stage-app.mjs`, Task 3's `stage-runtime.mjs`, Task 4's `Launcher.cs` (compiles it), Task 5's `PixelOffice.iss` (runs `ISCC.exe` on it).
- Produces: `scripts/windows/dist/PixelOffice-Setup.exe` from a single command.

- [ ] **Step 1: Create `scripts/windows/installer/build-installer.mjs`**

```js
/**
 * Build scripts/windows/dist/PixelOffice-Setup.exe end-to-end: stage the app
 * tree, stage the bundled Node/Python runtime, copy the install-root files
 * (stop.mjs), compile Launcher.cs, then run ISCC.exe. Requires Inno Setup 6
 * on PATH (winget install -e --id JRSoftware.InnoSetup) and the in-box
 * .NET Framework C# compiler.
 *
 *   node scripts/windows/installer/build-installer.mjs [--skip-stage]
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSC = "C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe";

function run(cmd, args, cwd) {
	const r = spawnSync(cmd, args, { cwd, stdio: "inherit", windowsHide: true });
	if (r.error) throw new Error(`${cmd} ${args.join(" ")} failed to start: ${r.error.message}`);
	if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed (exit ${r.status})`);
}

function main() {
	if (process.platform !== "win32") {
		throw new Error("The installer can only be built on Windows.");
	}
	const skipStage = process.argv.includes("--skip-stage");
	const stageDir = join(__dirname, "stage");

	if (!skipStage) {
		run(process.execPath, [join(__dirname, "stage-app.mjs")], undefined);
		run(process.execPath, [join(__dirname, "stage-runtime.mjs")], undefined);
	} else {
		console.log("Skipping stage-app/stage-runtime (--skip-stage).");
	}

	if (!existsSync(join(stageDir, "app", "package.json"))) {
		throw new Error(`Missing staged app tree: ${join(stageDir, "app")}. Run without --skip-stage first.`);
	}
	if (!existsSync(join(stageDir, "runtime", "node", "node.exe"))) {
		throw new Error(`Missing staged Node runtime: ${join(stageDir, "runtime", "node")}.`);
	}

	console.log("Copying install-root files into stage...");
	copyFileSync(join(__dirname, "..", "stop.mjs"), join(stageDir, "stop.mjs"));

	console.log("Compiling Launcher.cs...");
	if (!existsSync(CSC)) {
		throw new Error(`In-box C# compiler not found: ${CSC}`);
	}
	run(
		CSC,
		[
			"/nologo",
			"/target:winexe",
			`/out:${join(stageDir, "PixelOffice.exe")}`,
			`/win32icon:${join(__dirname, "..", "PixelOffice.ico")}`,
			"/reference:System.Windows.Forms.dll",
			"/reference:System.Drawing.dll",
			join(__dirname, "Launcher.cs"),
		],
		undefined,
	);

	console.log("Compiling installer (ISCC.exe)...");
	mkdirSync(join(__dirname, "..", "dist"), { recursive: true });
	run("ISCC.exe", [join(__dirname, "PixelOffice.iss")], undefined);

	const exePath = join(__dirname, "..", "dist", "PixelOffice-Setup.exe");
	if (!existsSync(exePath)) {
		throw new Error(`Expected ${exePath} after ISCC.exe run.`);
	}
	console.log(`Built ${exePath}`);
}

try {
	main();
} catch (err) {
	console.error(err?.message ?? err);
	process.exit(1);
}
```

- [ ] **Step 2: Full end-to-end build**

```bat
node scripts\windows\installer\build-installer.mjs
```

Expected: runs staging, compiles the launcher, runs ISCC, and prints `Built ...\scripts\windows\dist\PixelOffice-Setup.exe`. Confirm the file exists and is at least 100 MB (sanity check on the offline payload, not an exact size).

- [ ] **Step 3: Verify the `--skip-stage` fast path**

```bat
node scripts\windows\installer\build-installer.mjs --skip-stage
```

Expected: skips both staging scripts, still recompiles the launcher and re-runs ISCC, still produces the exe — useful for iterating on `Launcher.cs`/`PixelOffice.iss` without a multi-minute re-stage.

- [ ] **Step 4: Commit**

```bash
git add scripts/windows/installer/build-installer.mjs
git commit -m "feat(windows): add end-to-end offline installer build script"
```

---

### Task 7: End-to-end smoke test + docs

**Files:**
- Modify: `scripts/windows/README.md`

- [ ] **Step 1: Clean slate**

If PixelOffice is installed via any prior flow, uninstall it first (`%LOCALAPPDATA%\PixelOffice\PixelOffice-Uninstall.cmd` or `unins000.exe`), so this test starts from nothing.

- [ ] **Step 2: Disconnect network, then install**

Disable Wi-Fi/Ethernet (proves the offline claim), then double-click `scripts\windows\dist\PixelOffice-Setup.exe`. Click through Next → Next → Install → Finish with "Launch PixelOffice" checked.

Expected: no console window ever flashes; a small "Starting PixelOffice..." splash appears; a chromeless browser window opens to `http://127.0.0.1:3484` within ~30 seconds, entirely offline.

- [ ] **Step 3: Verify Manager wiring**

Check `%LOCALAPPDATA%\PixelOffice\solo.log` for a line matching `Starting Manager with interpreter: ...\runtime\python\python.exe` (emitted by `backends/runtime/src/manager/manager-process.ts:170`). Open the Claude Accounts / Manager pane in the UI and confirm it is not stuck offline — this is the exact failure mode documented at `manager-process.ts:116-123` (a Python without Manager's deps silently 405s every OAuth call).

- [ ] **Step 4: Verify stop**

Click the "PixelOffice Stop" shortcut, then run `netstat -ano | findstr :3484` — expect no output (port closed).

- [ ] **Step 5: Verify uninstall from Programs & Features**

Uninstall via Settings → Apps (or Start Menu → "Uninstall PixelOffice"). Confirm the "remove config?" prompt appears; choose Yes; confirm `%LOCALAPPDATA%\PixelOffice` is fully gone.

- [ ] **Step 6: Update `scripts/windows/README.md`**

Add a new section above the existing "Full setup — Node bundle (recommended)" section:

```markdown
## Offline one-file installer (recommended)

Fully offline: no winget, pnpm, uv, or network access needed on the target machine.

### Build (maintainers)

Requires Node >= 22, pnpm, uv, and Inno Setup 6 (`winget install -e --id JRSoftware.InnoSetup`):

\`\`\`bat
node scripts\windows\installer\build-installer.mjs
\`\`\`

Output: `scripts\windows\dist\PixelOffice-Setup.exe` (single file, several hundred MB — bundles Node, Python, and the built UI).

### Install (end users)

Double-click `PixelOffice-Setup.exe`. Welcome → Install Location → Install → Finish. No terminal, no prerequisites, no network. Creates Desktop/Start Menu shortcuts and a Programs & Features uninstall entry.
```

Then re-label the existing "Full setup — Node bundle (recommended)" heading to "Full setup — Node bundle (fallback, requires network)" so there's exactly one "recommended" path.

- [ ] **Step 7: Commit**

```bash
git add scripts/windows/README.md
git commit -m "docs(windows): document the offline one-file installer"
```

## Known trade-offs (carried from the design spec)

- Exe is large (hundreds of MB) and pinned to x64 + the bundled Node major — accepted for a fully offline, single-file install.
- The exe is unsigned; first run trips SmartScreen ("Windows protected your PC" → More info → Run anyway). Not addressed by this plan — a follow-up item if it becomes a problem.
- The chromeless `--app=` window still needs Edge or Chrome present (falls back to the OS default browser via `ShellExecute` otherwise) — unchanged from today's `launch.mjs` behavior.
- Pre-install "already running" detection was dropped in favor of Inno's native locked-file retry dialog (see the deviation note in Task 5) — only uninstall-time stop is implemented.
