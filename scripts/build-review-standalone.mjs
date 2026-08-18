#!/usr/bin/env node
// Builds a self-contained "Review" package: pick a GitLab merge request -> read it
// side by side -> draft inline notes against the team's rules -> publish back, with no
// Kanban board, Office, gitview, Manager/Jacked accounts, agent_stack, or OmniRoute.
// The output folder needs only Node, a GitLab account to authorize, and a locally
// logged-in Claude Code CLI (see the generated README.md).
//
// Usage: node scripts/build-review-standalone.mjs [outDir] [--zip[=path]]
//
//   --zip[=path]  Archive the finished package (default: dist/review-standalone.zip).
//
// There is no --slim counterpart to the plan editor's: that flag exists to defer the
// HTML sidecar's ~440 MB of node_modules to the target machine, and this package has no
// sidecar. The esbuild bundle plus the built frontend is the whole thing, so every build
// is already "slim" and needs no install step on the target.
import { execFileSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

let zipRequested = false;
let zipArg = null;
let outDirArg = null;
for (const arg of process.argv.slice(2)) {
	if (arg === "--zip") {
		zipRequested = true;
	} else if (arg.startsWith("--zip=")) {
		zipRequested = true;
		zipArg = arg.slice("--zip=".length);
	} else if (arg.startsWith("--")) {
		throw new Error(`Unknown flag "${arg}". Usage: build-review-standalone.mjs [outDir] [--zip[=path]]`);
	} else if (outDirArg === null) {
		outDirArg = arg;
	} else {
		throw new Error(`Unexpected second output directory "${arg}".`);
	}
}

const outDir = resolve(repoRoot, outDirArg ?? "review-standalone");
const zipPath = resolve(repoRoot, zipArg ?? join("dist", `${basename(outDir)}.zip`));

const pixelOfficeDir = join(repoRoot, "frontends", "pixel_office");
const runtimeDir = join(repoRoot, "backends", "runtime");
const agentDataDir = join(repoRoot, "agent-data");

function run(command, args, cwd) {
	console.log(`$ ${command} ${args.join(" ")}${cwd ? ` (in ${cwd})` : ""}`);
	execFileSync(command, args, { cwd: cwd ?? repoRoot, stdio: "inherit" });
}

console.log(`Building standalone Review package into ${outDir}\n`);
rmSync(outDir, { recursive: true, force: true });
mkdirSync(join(outDir, "server"), { recursive: true });

// 1. Frontend: build the pixel_office Vite app (multi-page: main + plan-editor +
// review), then keep the whole dist as this package's web-ui. Runs `vite build`
// directly rather than the package's `build` script (which chains a repo-wide
// `tsc --noEmit` gate) so pre-existing, unrelated type errors elsewhere in the app
// don't block packaging this one feature.
//
// Invokes the local vite binary rather than `pnpm --filter @kanban/web exec vite`:
// `pnpm exec` first runs its dependency-status check, which can re-run an install and
// wipe devDependencies mid-build (see build-plan-editor-standalone.mjs for the full
// account of that failure).
run(join(pixelOfficeDir, "node_modules", ".bin", "vite"), ["build"], pixelOfficeDir);
const viteDistDir = join(pixelOfficeDir, "dist");
const webUiDir = join(outDir, "server", "web-ui");
// `dereference: true` matters in a task worktree: gitignored build output like `dist`
// is itself symlinked back to the main checkout there (see repo AGENTS.md), and without
// it cpSync recreates that symlink instead of copying real files — which would make the
// shipped package depend on the dev checkout.
cpSync(viteDistDir, webUiDir, { recursive: true, dereference: true });
// The review page becomes this package's `index.html`, replacing the full app's entry:
// `getWebUiDir()` probes for `index.html` to decide a directory holds a built UI, so a
// package without one falls through to the dev checkout's dist and then 404s on `/`.
// The other two entries are dropped so nothing here can navigate to the whole board.
if (!existsSync(join(webUiDir, "index-review.html"))) {
	throw new Error(
		"index-review.html is missing from the Vite output — check that vite.config.ts still lists the `review` input.",
	);
}
cpSync(join(webUiDir, "index-review.html"), join(webUiDir, "index.html"), { dereference: true });
rmSync(join(webUiDir, "index-review.html"));
rmSync(join(webUiDir, "index-plan-editor.html"), { force: true });

// 2. Backend: bundle the slim review-standalone server with esbuild, mirroring
// backends/runtime/scripts/build.mjs's config for this one entry point. Invokes
// backends/runtime's own local esbuild binary directly (rather than importing the
// "esbuild" package from this script's resolution scope) so this doesn't depend on
// esbuild happening to be hoisted to the workspace root.
const cjsShimBanner = [
	'import { createRequire as __reviewCreateRequire } from "node:module";',
	"const require = __reviewCreateRequire(import.meta.url);",
].join("\n");
run(join(runtimeDir, "node_modules", ".bin", "esbuild"), [
	join(runtimeDir, "src", "review-standalone", "main.ts"),
	`--outfile=${join(outDir, "server", "index.js")}`,
	"--bundle",
	"--format=esm",
	"--platform=node",
	"--target=node20",
	"--packages=bundle",
	"--sourcemap",
	`--banner:js=#!/usr/bin/env node\n${cjsShimBanner}`,
]);

// 3. agent-data: only the manifest, and only so the rules cache has a home.
//
// `findAgentDataRepoRoot` accepts the PIXELOFFICE_AGENT_DATA override only when a
// manifest.json sits directly inside the pointed folder; without it the override is
// rejected and `getReviewRulesDir()` silently falls back to the runtime home. That
// fallback works, but it would put this package's rules somewhere different from every
// other install's, which is confusing the first time someone looks for the file.
const agentDataDest = join(outDir, "agent-data");
mkdirSync(join(agentDataDest, "review", "rules"), { recursive: true });
cpSync(join(agentDataDir, "manifest.json"), join(agentDataDest, "manifest.json"), { dereference: true });

// 4. Launch scripts + README. No build.sh counterpart: nothing needs installing.
writeFileSync(
	join(outDir, "start.sh"),
	["#!/usr/bin/env bash", "set -e", 'cd "$(dirname "$0")"', "exec node server/index.js", ""].join("\n"),
);
chmodSync(join(outDir, "start.sh"), 0o755);
writeFileSync(
	join(outDir, "start.bat"),
	["@echo off", "cd /d %~dp0", "node server\\index.js", ""].join("\r\n"),
);

writeFileSync(
	join(outDir, "README.md"),
	[
		"# Review (standalone)",
		"",
		"Read a GitLab merge request side by side, check it against your team's own rules,",
		"draft inline notes locally, and publish them in one action. No Kanban board, Office,",
		"plan editor, or accounts UI.",
		"",
		"## Prerequisites",
		"",
		"- Node.js 20 or newer.",
		"- A GitLab account on the instance you review on. The first run opens your browser",
		"  to authorize; the token is stored under your home directory's runtime data folder,",
		"  mode 0600, and one account serves every project.",
		"- Claude Code CLI installed and already logged in (`claude` on your PATH), for the",
		"  AI review pass and the assistant panel. Everything else works without it.",
		"",
		"## Run it",
		"",
		"- macOS/Linux: `./start.sh`",
		"- Windows: double-click `start.bat`",
		"",
		"Then open the URL printed in the terminal (defaults to http://127.0.0.1:4183).",
		"Set `REVIEW_PORT` to move it — 4183 is deliberately clear of the plan editor's 4173",
		"so both packages can run side by side.",
		"",
		"## Authorizing GitLab",
		"",
		"Press **Connect GitLab**. Authorization runs on the loopback callback port 14995,",
		"which is the same port a Claude Code session's GitLab MCP client uses — if a session",
		"is holding it, the connect step says so instead of hanging. Close that session and",
		"retry.",
		"",
		"## Rules",
		"",
		"The Rules tab reads a generated bundle at `agent-data/review/rules/<project>.json`.",
		"Point it at your guideline documents and lint configuration first (Review settings),",
		"then press **Extract rules**: a one-shot Claude run reads those paths and writes the",
		"bundle. Every rule keeps the file and heading it came from, so a citation you paste",
		"into a merge request is traceable.",
		"",
		"## Drafts",
		"",
		"Inline notes are drafts until you publish them, and they are stored per merge request",
		"under your home directory's runtime data folder — the same place the full PixelOffice",
		"app stores them, so nothing is lost if you install that later. Closing the tab does",
		"not discard them.",
		"",
		"Publishing posts each note as a GitLab diff discussion, one at a time. If one fails,",
		"everything before it is published and everything after it stays a draft, and the",
		"dialog names the note that failed.",
		"",
		"No credential of any kind is bundled in this package.",
		"",
	].join("\n"),
);

console.log(`\nPackage ready: ${outDir}`);

if (zipRequested) {
	mkdirSync(dirname(zipPath), { recursive: true });
	rmSync(zipPath, { force: true });
	// `zip -r` from the parent so the archive holds one top-level folder rather than a
	// loose spray of files.
	run("zip", ["-qr", zipPath, basename(outDir)], dirname(outDir));
	console.log(`Archive ready: ${zipPath}`);
}
