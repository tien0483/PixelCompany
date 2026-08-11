#!/usr/bin/env node
// Builds a self-contained "Plan Editor" package: md editor -> refine -> pick a
// papp template -> generate html, with no Kanban board, Office, gitview,
// Manager/Jacked accounts, agent_stack, or OmniRoute. The output folder needs
// only Node and a locally logged-in Claude Code CLI to run (see the generated
// README.md).
//
// Usage: node scripts/build-plan-editor-standalone.mjs [outDir] [--slim] [--zip[=path]]
//
//   --slim        Ship no node_modules: the sidecar's prod dependencies are
//                 installed once on the target machine by the generated
//                 build.sh / build.bat. ~50 MB instead of ~490 MB.
//   --zip[=path]  Archive the finished package (default:
//                 dist/plan-editor-standalone.zip).
import { execFileSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

let slim = false;
let zipRequested = false;
let zipArg = null;
let outDirArg = null;
for (const arg of process.argv.slice(2)) {
	if (arg === "--slim") {
		slim = true;
	} else if (arg === "--zip") {
		zipRequested = true;
	} else if (arg.startsWith("--zip=")) {
		zipRequested = true;
		zipArg = arg.slice("--zip=".length);
	} else if (arg.startsWith("--")) {
		throw new Error(`Unknown flag "${arg}". Usage: build-plan-editor-standalone.mjs [outDir] [--slim] [--zip[=path]]`);
	} else if (outDirArg === null) {
		outDirArg = arg;
	} else {
		throw new Error(`Unexpected second output directory "${arg}".`);
	}
}

const outDir = resolve(repoRoot, outDirArg ?? "plan-editor-standalone");
const zipPath = resolve(repoRoot, zipArg ?? join("dist", `${basename(outDir)}.zip`));

// The template registry under agent-data/templates/skills carries 80+ skills for the
// full app; this package is an Akselos Papp tool, so it ships only those three. The
// repo keeps every template — widening the package is a matter of adding ids here.
const STANDALONE_TEMPLATE_IDS = ["papp-overview", "papp-monitoring", "papp-status-grid"];

const pixelOfficeDir = join(repoRoot, "frontends", "pixel_office");
const runtimeDir = join(repoRoot, "backends", "runtime");
const htmlAnythingDir = join(repoRoot, "backends", "html_anything");
const agentDataDir = join(repoRoot, "agent-data");

function run(command, args, cwd) {
	console.log(`$ ${command} ${args.join(" ")}${cwd ? ` (in ${cwd})` : ""}`);
	execFileSync(command, args, { cwd: cwd ?? repoRoot, stdio: "inherit" });
}

console.log(`Building ${slim ? "slim " : ""}standalone Plan Editor package into ${outDir}\n`);
rmSync(outDir, { recursive: true, force: true });
mkdirSync(join(outDir, "server"), { recursive: true });

// 1. Frontend: build the pixel_office Vite app (multi-page: main + plan-editor),
// then keep only the plan-editor page's output as this package's web-ui. Runs
// `vite build` directly rather than the package's `build` script (which chains
// a repo-wide `tsc --noEmit` gate) so pre-existing, unrelated type errors
// elsewhere in the app don't block packaging this one feature.
//
// Invokes the local vite binary instead of `pnpm --filter @kanban/web exec vite`:
// `pnpm exec` first runs its dependency-status check, and once step 3's
// `pnpm deploy --prod` has recorded the workspace's node_modules as prod-only,
// that check re-runs `pnpm install --production` — wiping devDependencies and
// then dying in backends/runtime's `prepare` script (`husky: not found`).
run(join(pixelOfficeDir, "node_modules", ".bin", "vite"), ["build"], pixelOfficeDir);
const viteDistDir = join(pixelOfficeDir, "dist");
const webUiDir = join(outDir, "server", "web-ui");
// `dereference: true` matters in a task worktree: gitignored build output like
// `dist` is itself symlinked back to the main checkout there (see repo AGENTS.md),
// and without it cpSync just recreates that symlink instead of copying real
// files — which would make the shipped package depend on the dev checkout.
cpSync(viteDistDir, webUiDir, { recursive: true, dereference: true });
cpSync(join(webUiDir, "index-plan-editor.html"), join(webUiDir, "index.html"), { dereference: true });
rmSync(join(webUiDir, "index-plan-editor.html"));

// 2. Backend: bundle the slim plan-editor-standalone server with esbuild,
// mirroring backends/runtime/scripts/build.mjs's config for this one entry point.
// Invokes backends/runtime's own local esbuild binary directly (rather than
// importing the "esbuild" package from this script's own resolution scope) so
// this doesn't depend on esbuild happening to be hoisted to the workspace root.
const cjsShimBanner = [
	'import { createRequire as __planEditorCreateRequire } from "node:module";',
	"const require = __planEditorCreateRequire(import.meta.url);",
].join("\n");
run(join(runtimeDir, "node_modules", ".bin", "esbuild"), [
	join(runtimeDir, "src", "plan-editor-standalone", "main.ts"),
	`--outfile=${join(outDir, "server", "index.js")}`,
	"--bundle",
	"--format=esm",
	"--platform=node",
	"--target=node20",
	"--packages=bundle",
	"--sourcemap",
	`--banner:js=#!/usr/bin/env node\n${cjsShimBanner}`,
]);

// 3. Sidecar: build backends/html_anything/next and ship its build output.
//
// Both modes build in a throwaway `pnpm deploy` tree, because building needs
// devDependencies (`tailwindcss`/`@tailwindcss/postcss`). `pnpm deploy` rather than a
// copy of backends/html_anything/next's own node_modules: pnpm's per-workspace-package
// node_modules only holds a symlink per direct dependency into the *workspace root's*
// .pnpm store, and a package's peer dependencies (e.g. `next` requiring `@swc/helpers`)
// resolve via *sibling* entries inside that same store directory — a plain `cp -RL` of
// the per-package node_modules dereferences each direct-dependency symlink's own folder
// but silently drops those siblings, producing a tree that's missing modules `next start`
// needs at runtime. `pnpm deploy` (with `--legacy`, since this workspace doesn't set
// `inject-workspace-packages`) is pnpm's supported way to produce a relocatable,
// self-contained copy of one workspace member.
//
// Default mode then makes a second, `--prod` deploy the shipped sidecar, so the package
// runs with no install step — at the cost of ~440 MB of node_modules.
//
// --slim ships no node_modules at all: only `.next` (minus its build cache), `public/`,
// and `package.json`, with the target machine's one-time `build.sh` installing prod deps.
// Nothing else from the source tree is needed — `next start` serves the prebuilt `.next`
// and never reads `src/`, the TS/test config, or `next.config.ts` (HTML_ANYTHING_BUILD_ID
// is inlined into the bundle at build time, and the build id `next start` reports comes
// from `.next/BUILD_ID`).
const sidecarBuildDir = join(outDir, ".sidecar-build-tmp");
rmSync(sidecarBuildDir, { recursive: true, force: true });
run("pnpm", ["--filter", "@html-anything/next", "deploy", "--legacy", sidecarBuildDir]);
run(join(sidecarBuildDir, "node_modules", ".bin", "next"), ["build"], sidecarBuildDir);

const sidecarDest = join(outDir, "html_anything", "next");
rmSync(sidecarDest, { recursive: true, force: true });
mkdirSync(join(outDir, "html_anything"), { recursive: true });

if (slim) {
	mkdirSync(sidecarDest, { recursive: true });
	// `.next/cache` is `next build`'s incremental cache — dead weight for `next start`.
	const nextCacheDir = join(sidecarBuildDir, ".next", "cache");
	cpSync(join(sidecarBuildDir, ".next"), join(sidecarDest, ".next"), {
		recursive: true,
		dereference: true,
		filter: (source) => source !== nextCacheDir && !source.startsWith(nextCacheDir + sep),
	});
	cpSync(join(sidecarBuildDir, "public"), join(sidecarDest, "public"), { recursive: true, dereference: true });
	cpSync(join(sidecarBuildDir, "package.json"), join(sidecarDest, "package.json"), { dereference: true });
	// A lockfile makes the target machine's install reproducible (`npm ci`). Best effort:
	// it needs the registry, and an offline packaging run should still produce a package —
	// build.sh falls back to `npm install`, and `next`/`react`/`react-dom` are pinned exact
	// in the sidecar's package.json, so the drift that fallback risks is limited to leaf libs.
	try {
		run("npm", ["install", "--package-lock-only", "--omit=dev"], sidecarDest);
	} catch {
		console.warn("  ! could not generate package-lock.json (offline?) — build.sh will use `npm install`");
	}
} else {
	run("pnpm", ["--filter", "@html-anything/next", "deploy", "--legacy", "--prod", sidecarDest]);
	cpSync(join(sidecarBuildDir, ".next"), join(sidecarDest, ".next"), { recursive: true, dereference: true });
}
rmSync(sidecarBuildDir, { recursive: true, force: true });

// 4. Templates: the papp skills live under agent-data/templates/skills, and only
// those (STANDALONE_TEMPLATE_IDS) are copied — the loader enumerates whatever
// folders it finds, so leaving the rest out is what keeps them out of the picker.
// The sidecar's PIXELOFFICE_AGENT_DATA override (see agent-data-root.ts) requires a
// manifest.json directly inside the target folder, so that ships too.
//
// The catalog (agent-data/catalog, ~1.5 MB of Manager shelves) is deliberately NOT
// copied wholesale — the standalone package has no shelf UI. But "Expand brief"
// inlines the vendored `prompt-master` skill rather than a hand-written prompt
// (see html-brief.ts's PROMPT_MASTER_SKILL_RELATIVE_PATH), and `loadPromptMasterBody`
// throws instead of degrading to a weaker prompt when that file is unreachable. Without
// this one skill folder the route answers 500 "Could not read the prompt-master skill
// at <install>/agent-data/catalog/skills/prompt-master/SKILL.md" on every expansion.
const agentDataDest = join(outDir, "agent-data");
mkdirSync(join(agentDataDest, "templates"), { recursive: true });
mkdirSync(join(agentDataDest, "catalog", "skills"), { recursive: true });
cpSync(join(agentDataDir, "manifest.json"), join(agentDataDest, "manifest.json"), { dereference: true });
const templateSkillsDir = join(agentDataDir, "templates", "skills");
const templateSkillsDest = join(agentDataDest, "templates", "skills");
mkdirSync(templateSkillsDest, { recursive: true });
for (const templateId of STANDALONE_TEMPLATE_IDS) {
	const source = join(templateSkillsDir, templateId);
	if (!existsSync(source)) {
		throw new Error(`Template "${templateId}" is listed in STANDALONE_TEMPLATE_IDS but missing at ${source}`);
	}
	cpSync(source, join(templateSkillsDest, templateId), { recursive: true, dereference: true });
	console.log(`  template: ${templateId}`);
}
cpSync(
	join(agentDataDir, "catalog", "skills", "prompt-master"),
	join(agentDataDest, "catalog", "skills", "prompt-master"),
	{ recursive: true, dereference: true },
);

// 5. Launch scripts + README.
//
// The slim package's start scripts refuse to boot before build.sh has run. Without that
// check the failure surfaces as html-process.ts's generic "next binary missing → pnpm
// install / pnpm --filter @html-anything/next build" warning, which names commands that
// mean nothing outside the monorepo, and the editor comes up with an empty template rail.
const startPreflight = join("html_anything", "next", "node_modules", "next", "dist", "bin", "next");
writeFileSync(
	join(outDir, "start.sh"),
	[
		"#!/usr/bin/env bash",
		"set -e",
		'cd "$(dirname "$0")"',
		...(slim
			? [
					`if [ ! -e "${startPreflight.split(sep).join("/")}" ]; then`,
					'  echo "Dependencies are not installed yet. Run ./build.sh first (one time, needs network)." >&2',
					"  exit 1",
					"fi",
				]
			: []),
		"exec node server/index.js",
		"",
	].join("\n"),
);
chmodSync(join(outDir, "start.sh"), 0o755);
writeFileSync(
	join(outDir, "start.bat"),
	[
		"@echo off",
		"cd /d %~dp0",
		...(slim
			? [
					`if not exist "${startPreflight.split(sep).join("\\")}" (`,
					"  echo Dependencies are not installed yet. Run build.bat first ^(one time, needs network^).",
					"  exit /b 1",
					")",
				]
			: []),
		"node server\\index.js",
		"",
	].join("\r\n"),
);

if (slim) {
	writeFileSync(
		join(outDir, "build.sh"),
		[
			"#!/usr/bin/env bash",
			"# One-time setup: installs the HTML sidecar's runtime dependencies. Needs network.",
			"set -e",
			'cd "$(dirname "$0")/html_anything/next"',
			"if [ -f package-lock.json ]; then",
			"  npm ci --omit=dev || npm install --omit=dev",
			"else",
			"  npm install --omit=dev",
			"fi",
			'echo "Done. Start the editor with ./start.sh"',
			"",
		].join("\n"),
	);
	chmodSync(join(outDir, "build.sh"), 0o755);
	writeFileSync(
		join(outDir, "build.bat"),
		[
			"@echo off",
			"REM One-time setup: installs the HTML sidecar's runtime dependencies. Needs network.",
			"cd /d %~dp0html_anything\\next",
			"if exist package-lock.json (",
			"  call npm ci --omit=dev",
			"  if errorlevel 1 call npm install --omit=dev",
			") else (",
			"  call npm install --omit=dev",
			")",
			"echo Done. Start the editor with start.bat",
			"",
		].join("\r\n"),
	);
}

writeFileSync(
	join(outDir, "README.md"),
	[
		"# Plan Editor (standalone)",
		"",
		"Write a plan in markdown, refine it, pick a template, and generate HTML from it",
		"using your local Claude Code CLI. No Kanban board, Office, git view, or accounts UI.",
		"",
		`Templates shipped: ${STANDALONE_TEMPLATE_IDS.join(", ")} (the Akselos Papp set).`,
		"They appear as thumbnails in the left pane of the editor.",
		"",
		"## Prerequisites",
		"",
		"- Node.js 20 or newer.",
		"- Claude Code CLI installed and already logged in (`claude` on your PATH).",
		"- `git` on your PATH, for version history. Without it the editor still works; the",
		"  Undo / Redo / History controls simply do not appear.",
		...(slim ? ["- Network access, once, for the setup step below."] : []),
		"",
		...(slim
			? [
					"## Set it up (once)",
					"",
					"- macOS/Linux: `./build.sh`",
					"- Windows: double-click `build.bat`",
					"",
					"This installs the HTML sidecar's runtime dependencies into",
					"`html_anything/next/node_modules`. Nothing is downloaded again on later runs.",
					"",
				]
			: []),
		"## Run it",
		"",
		"- macOS/Linux: `./start.sh`",
		"- Windows: double-click `start.bat`",
		"",
		"Then open the URL printed in the terminal (defaults to http://127.0.0.1:4173).",
		"",
		"The editor runs a template/HTML sidecar of its own on 127.0.0.1:8422. If that port is",
		"taken, set `PLAN_EDITOR_HTML_PORT` to a free one — the launcher refuses to borrow a",
		"sidecar from another install, since that install's template list is not this one's.",
		"",
		"The Templates rail's upload button installs a template from a .zip holding `SKILL.md`",
		"plus optional `example.md` / `example.html`, into `agent-data/templates/skills/<id>/`.",
		"Re-importing the same id replaces it.",
		"",
		"Every generated page and each markdown milestone is recorded as a version, stored as",
		"git objects under the runtime data folder's `plan-history/`. Undo / Redo / History in",
		"the preview pane's header walk those versions and can diff any of them against the",
		"current file.",
		"",
		"Plans are saved under your home directory's runtime data folder, the same place",
		"the full PixelOffice app stores them, so nothing is lost if you install that later.",
		"",
		"The toolbar's 5h / 7d meter reads your Claude account's usage windows from",
		"`~/.claude/.credentials.json` (or `$CLAUDE_CONFIG_DIR`). It shows `—` when no",
		"credential is found; nothing else in the editor depends on it. No credential of any",
		"kind is bundled in this package.",
		"",
	].join("\n"),
);

// 6. Archive. There is no `zip` binary on a stock WSL/Ubuntu image and Node ships no zip
// writer, so python3's `zipfile` is the primary path. Not `python3 -m zipfile -c`: that
// CLI drops the executable bit, and start.sh / build.sh would arrive unrunnable.
const ZIP_WITH_MODES_PY = `
import os, shutil, sys, zipfile

source, dest = sys.argv[1], sys.argv[2]
root = os.path.basename(source.rstrip(os.sep))
with zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED) as archive:
    for dirpath, dirnames, filenames in os.walk(source):
        dirnames.sort()
        for name in sorted(filenames):
            full = os.path.join(dirpath, name)
            info = zipfile.ZipInfo.from_file(full, os.path.join(root, os.path.relpath(full, source)))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = (0o755 if name.endswith(".sh") else 0o644) << 16
            with open(full, "rb") as handle, archive.open(info, "w") as out:
                shutil.copyfileobj(handle, out)
`;

function createArchive(sourceDir, destPath) {
	mkdirSync(dirname(destPath), { recursive: true });
	rmSync(destPath, { force: true });
	try {
		run("python3", ["-c", ZIP_WITH_MODES_PY, sourceDir, destPath]);
		return destPath;
	} catch {
		console.warn("  ! python3 zipfile unavailable — trying the `zip` binary");
	}
	try {
		run("zip", ["-r", "-q", destPath, basename(sourceDir)], dirname(sourceDir));
		return destPath;
	} catch {
		console.warn("  ! `zip` unavailable — falling back to tar.gz");
	}
	const tarPath = `${destPath.replace(/\.zip$/, "")}.tar.gz`;
	rmSync(tarPath, { force: true });
	run("tar", ["-czf", tarPath, "-C", dirname(sourceDir), basename(sourceDir)]);
	return tarPath;
}

let archivePath = null;
if (zipRequested) {
	archivePath = createArchive(outDir, zipPath);
}

console.log(`\nDone. Run: cd ${outDir} && ${slim ? "./build.sh && " : ""}./start.sh`);
if (archivePath) {
	console.log(`Archive: ${archivePath}`);
}
