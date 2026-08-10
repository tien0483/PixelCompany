#!/usr/bin/env node
// Builds a self-contained "Plan Editor" package: md editor -> refine -> pick a
// papp template -> generate html, with no Kanban board, Office, gitview,
// Manager/Jacked accounts, agent_stack, or OmniRoute. The output folder needs
// only Node and a locally logged-in Claude Code CLI to run (see the generated
// README.md). Usage: node scripts/build-plan-editor-standalone.mjs [outDir]
import { execFileSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = resolve(repoRoot, process.argv[2] ?? "plan-editor-standalone");

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

console.log(`Building standalone Plan Editor package into ${outDir}\n`);
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

// 3. Sidecar: build backends/html_anything/next and ship it as a fully
// self-contained copy (own node_modules + .next build output) so the package
// needs no `pnpm install` of its own.
//
// This uses `pnpm deploy` rather than copying backends/html_anything/next's own
// node_modules directly. pnpm's per-workspace-package node_modules only holds a
// symlink per direct dependency into the *workspace root's* .pnpm store, and a
// package's peer dependencies (e.g. `next` requiring `@swc/helpers`) resolve via
// *sibling* entries inside that same store directory — a plain `cp -RL` of the
// per-package node_modules dereferences each direct-dependency symlink's own
// folder but silently drops those siblings, producing a tree that's missing
// modules `next start` needs at runtime. `pnpm deploy` (with `--legacy`, since
// this workspace doesn't set `inject-workspace-packages`) is pnpm's supported
// way to produce a relocatable, self-contained copy of one workspace member.
//
// Building needs devDependencies (`tailwindcss`/`@tailwindcss/postcss`), but
// `next start` at runtime does not, so this deploys twice: once with dev deps
// into a throwaway build dir to run `next build`, then a leaner `--prod` deploy
// straight into the shipped location, with the just-built `.next` copied over.
const sidecarBuildDir = join(outDir, ".sidecar-build-tmp");
rmSync(sidecarBuildDir, { recursive: true, force: true });
run("pnpm", ["--filter", "@html-anything/next", "deploy", "--legacy", sidecarBuildDir]);
run(join(sidecarBuildDir, "node_modules", ".bin", "next"), ["build"], sidecarBuildDir);

const sidecarDest = join(outDir, "html_anything", "next");
rmSync(sidecarDest, { recursive: true, force: true });
mkdirSync(join(outDir, "html_anything"), { recursive: true });
run("pnpm", ["--filter", "@html-anything/next", "deploy", "--legacy", "--prod", sidecarDest]);
cpSync(join(sidecarBuildDir, ".next"), join(sidecarDest, ".next"), { recursive: true, dereference: true });
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
writeFileSync(
	join(outDir, "start.sh"),
	['#!/usr/bin/env bash', "set -e", 'cd "$(dirname "$0")"', "exec node server/index.js", ""].join("\n"),
);
chmodSync(join(outDir, "start.sh"), 0o755);
writeFileSync(join(outDir, "start.bat"), ["@echo off", "cd /d %~dp0", "node server\\index.js", ""].join("\r\n"));
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
		"",
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
		"Plans are saved under your home directory's runtime data folder, the same place",
		"the full PixelOffice app stores them, so nothing is lost if you install that later.",
		"",
		"The toolbar's 5h / 7d meter reads your Claude account's usage windows from",
		"`~/.claude/.credentials.json` (or `$CLAUDE_CONFIG_DIR`). It shows `—` when no",
		"credential is found; nothing else in the editor depends on it.",
		"",
	].join("\n"),
);

console.log(`\nDone. Run: cd ${outDir} && ./start.sh`);
