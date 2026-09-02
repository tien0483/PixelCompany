/**
 * Single-URL Pixel Office launch: one Node runtime serving the built UI, board,
 * PTY sessions and the Manager bridge — plus the headless Manager child it starts
 * itself. No Vite, no second origin, no :8321 dashboard.
 *
 *   http://127.0.0.1:3484   →  board + Claude Accounts + Pixel Office
 *
 * Usage (from repo root):
 *   pnpm run solo --restart --build   # normal dev loop: rebuild UI, fresh stack + runtime
 *   npm run solo              # build the UI when missing or stale, then serve
 *   npm run solo -- --restart # free app + stack ports, restart stack daemons
 *   npm run solo -- --skip-build   # fail if missing, warn+serve if stale
 *   npm run solo -- --build        # always rebuild first
 *   npm run solo -- --no-stack-link # do not link agent-stack skills into .claude/skills
 *   npm run solo -- --no-proxy-env  # do not route agent traffic through the stack chain
 */
import { connect } from "node:net";
import { constants as fsConstants, existsSync, readFileSync } from "node:fs";
import { access, lstat, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { ensureAgentStack, restartAgentStackDaemons, STACK_DAEMON_PORTS } from "./ensure-agent-stack.mjs";

const MIN_NODE_MAJOR = 22;
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function nodeMajor(version = process.version) {
	return Number(version.slice(1).split(".")[0]);
}

function probeNodeBinary(nodePath) {
	if (!existsSync(nodePath)) {
		return null;
	}
	const result = spawnSync(nodePath, ["-p", "process.versions.node"], {
		encoding: "utf8",
		windowsHide: true,
	});
	if (result.status !== 0) {
		return null;
	}
	const version = String(result.stdout ?? "").trim();
	return nodeMajor(`v${version}`) >= MIN_NODE_MAJOR ? nodePath : null;
}

function resolveNode22Candidates() {
	const fromEnv = process.env.PIXELOFFICE_NODE?.trim() || process.env.KANBAN_NODE?.trim();
	const candidates = [];
	if (fromEnv) {
		candidates.push(fromEnv);
	}
	if (process.platform === "win32") {
		const localApp = process.env.LOCALAPPDATA ?? "";
		candidates.push(
			join(localApp, "Programs", "cursor", "resources", "app", "resources", "helpers", "node.exe"),
			"C:\\Program Files\\nodejs\\node.exe",
		);
		const nvmHome = process.env.NVM_HOME ?? join(process.env.APPDATA ?? "", "nvm");
		for (const version of ["22.22.1", "22.12.0", "22.11.0", "22.10.0", "22.9.0", "22.0.0"]) {
			candidates.push(join(nvmHome, `v${version}`, "node.exe"));
		}
	} else {
		candidates.push("/usr/local/bin/node", join(homedir(), ".nvm/versions/node/v22.22.1/bin/node"));
	}
	return candidates;
}

function ensureNode22() {
	if (nodeMajor() >= MIN_NODE_MAJOR) {
		return;
	}
	for (const candidate of resolveNode22Candidates()) {
		const node22 = probeNodeBinary(candidate);
		if (node22) {
			console.warn(`PixelOffice requires Node >= ${MIN_NODE_MAJOR} (found ${process.version}).`);
			console.warn(`Re-launching with ${node22}`);
			const result = spawnSync(node22, [__filename, ...process.argv.slice(2)], {
				stdio: "inherit",
				env: process.env,
			});
			process.exit(result.status ?? 1);
		}
	}
	console.error(`PixelOffice requires Node.js >= ${MIN_NODE_MAJOR} (current: ${process.version}).`);
	console.error("Install Node 22 (nvm install 22 && nvm use 22) or set PIXELOFFICE_NODE to a Node 22 binary.");
	process.exit(1);
}

ensureNode22();

const isWindows = process.platform === "win32";
const repoRoot = join(__dirname, "..");
const runtimeRoot = join(repoRoot, "backends", "runtime");
const webUiRoot = join(repoRoot, "frontends", "pixel_office");
const webUiDist = join(webUiRoot, "dist");
const htmlNextRoot = join(repoRoot, "backends", "html_anything", "next");
const htmlNextDist = join(htmlNextRoot, ".next");
const openmaicRoot = join(repoRoot, "backends", "openmaic");
const openmaicDist = join(openmaicRoot, ".next");
const flowiseRoot = join(repoRoot, "backends", "flowise");
const flowiseServerRoot = join(flowiseRoot, "packages", "server");
const flowiseServerDist = join(flowiseServerRoot, "dist");
const omniRouteRoot = join(repoRoot, "backends", "OmniRoute");

/**
 * What counts as a UI source change. Mirrors WATCH_PATHS in
 * scripts/rebuild-ui-if-changed.sh so the git hooks and this script agree.
 */
const WATCHED_UI_PATHS = [
	join(webUiRoot, "src"),
	join(webUiRoot, "index.html"),
	join(webUiRoot, "vite.config.ts"),
	join(webUiRoot, "package.json"),
];

const WATCHED_HTML_PATHS = [
	join(htmlNextRoot, "src"),
	join(htmlNextRoot, "package.json"),
	join(htmlNextRoot, "next.config.ts"),
];

const WATCHED_OPENMAIC_PATHS = [
	join(openmaicRoot, "app"),
	join(openmaicRoot, "components"),
	join(openmaicRoot, "lib"),
	join(openmaicRoot, "package.json"),
	join(openmaicRoot, "next.config.ts"),
];

const WATCHED_FLOWISE_PATHS = [
	join(flowiseRoot, "package.json"),
	join(flowiseRoot, "pnpm-lock.yaml"),
	join(flowiseRoot, "packages", "server", "src"),
	join(flowiseRoot, "packages", "components", "src"),
];

const WATCHED_OMNIROUTE_PATHS = [
	join(omniRouteRoot, "src"),
	join(omniRouteRoot, "scripts"),
	join(omniRouteRoot, "package.json"),
];

/**
 * Resolves a dependency entrypoint from either the package's own node_modules or
 * the hoisted root one — a workspace install puts shared deps at the root.
 */
function resolveDependencyEntry(packageRoot, ...segments) {
	for (const base of [packageRoot, repoRoot]) {
		const candidate = join(base, "node_modules", ...segments);
		if (existsSync(candidate)) {
			return candidate;
		}
	}
	return null;
}

const tsxCli = resolveDependencyEntry(runtimeRoot, "tsx", "dist", "cli.mjs");
const viteCli = resolveDependencyEntry(webUiRoot, "vite", "bin", "vite.js");

const RUNTIME_PORT = Number(process.env.PIXELOFFICE_PORT ?? 3484);
const MANAGER_PORT = Number(process.env.MANAGER_PORT ?? process.env.JACKED_PORT ?? 8321);
const HTML_PORT = Number(process.env.PIXELOFFICE_HTML_PORT ?? 8322);
/**
 * The agent-stack switchboard, backing the Stack Control dialog
 * (frontends/pixel_office/src/stack/stack-control-client.ts). Owned by the
 * runtime, not by this script — probed here only to report an already-running
 * instance, e.g. one started by a shell that sourced activate-stack.sh.
 */
const STACK_CONTROL_PORT = Number(process.env.STACK_UI_PORT ?? 8000);
const DOC_SKILL_PORT = Number(process.env.PIXELOFFICE_DOCSKILL_PORT ?? 8323);
/**
 * The Flowise agent studio behind the Agents tab, spawned by the runtime from the
 * `backends/flowise` submodule. Clear of 3000 (upstream's default) on purpose: 3001 is the
 * DevTools daemon and 3456/3460+ are CCR routers.
 */
const FLOWISE_PORT = Number(process.env.PIXELOFFICE_FLOWISE_PORT ?? 3010);
/** Optional DeepSeek Harness web UI when PIXELOFFICE_DSH_WEB=1 (orchestrator sidecar). */
const DSH_WEB_PORT = Number(process.env.PIXELOFFICE_DSH_WEB_PORT ?? 3020);

const args = process.argv.slice(2);
const restart = args.includes("--restart");
const skipBuild = args.includes("--skip-build");
/** Forces a rebuild even when dist exists — used by the solo e2e config so specs
 * never run against a stale bundle after a UI source change. */
const forceBuild = args.includes("--build");
const noOpen = args.includes("--no-open");
const noStackLink = args.includes("--no-stack-link");
// `STACK_PROXY_ENV=0` is the env-side opt-out, for wrappers that cannot pass flags.
const noProxyEnv = args.includes("--no-proxy-env") || process.env.STACK_PROXY_ENV?.trim() === "0";
const stackRoot = join(repoRoot, "backends", "agent_stack");

function freePort(port) {
	if (isWindows) {
		const script = [
			`$conns = Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue`,
			"if ($conns) {",
			"  $conns | ForEach-Object {",
			"    Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue",
			"  }",
			"}",
		].join("; ");
		spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
			stdio: "ignore",
			windowsHide: true,
		});
		return;
	}
	for (const pid of listenerPids(port)) {
		try {
			process.kill(pid, "SIGKILL");
		} catch {
			// already gone
		}
	}
}

/**
 * `lsof` is the usual tool here but reports nothing for loopback listeners on
 * some WSL2 kernels, which made `--restart` a silent no-op — an orphaned
 * sidecar kept the port and every later rebuild was ignored. Fall through to
 * `ss` and `fuser` so a port is actually freed wherever one of the three works.
 */
function listenerPids(port) {
	const probes = [
		`lsof -tiTCP:${port} -sTCP:LISTEN`,
		`ss -ltnpH 'sport = :${port}' | grep -o 'pid=[0-9]*' | cut -d= -f2`,
		`fuser -n tcp ${port} 2>/dev/null`,
	];
	const pids = new Set();
	for (const probe of probes) {
		const result = spawnSync("sh", ["-c", probe], { encoding: "utf8" });
		for (const value of (result.stdout || "").split(/\s+/)) {
			if (/^\d+$/.test(value)) {
				pids.add(Number(value));
			}
		}
		if (pids.size > 0) {
			break;
		}
	}
	return [...pids];
}

function portIsListening(port) {
	return new Promise((resolve) => {
		const sock = connect(port, "127.0.0.1");
		sock.on("connect", () => {
			sock.destroy();
			resolve(true);
		});
		sock.on("error", () => {
			sock.destroy();
			resolve(false);
		});
	});
}

async function pathExists(path) {
	try {
		await access(path, fsConstants.F_OK);
		return true;
	} catch {
		return false;
	}
}

async function hasBuiltUi() {
	return (await pathExists(join(webUiDist, "index.html"))) && (await pathExists(join(webUiDist, "assets")));
}

/**
 * Newest mtime across `targets`, walking directories recursively. Missing paths
 * contribute 0 so a deleted watch path never reads as a fresh edit.
 */
async function newestMtimeMs(targets) {
	let newest = 0;
	const pending = [...targets];
	while (pending.length > 0) {
		const current = pending.pop();
		let entry;
		try {
			entry = await stat(current);
		} catch {
			continue;
		}
		if (entry.mtimeMs > newest) {
			newest = entry.mtimeMs;
		}
		if (!entry.isDirectory()) {
			continue;
		}
		let children;
		try {
			children = await readdir(current);
		} catch {
			continue;
		}
		for (const child of children) {
			pending.push(join(current, child));
		}
	}
	return newest;
}

/**
 * Existence alone is not enough: a checkout that built dist once kept serving
 * that bundle after every later `git pull`, so anything merged afterwards was
 * simply absent from the running app. That reads as an environment-specific bug
 * (present under `npm start`/Vite, missing here) rather than a stale build, so
 * compare dist against the watched sources and rebuild when it has fallen behind.
 *
 * Returns "missing" | "fresh" | "stale"; `distStamp` is set for the last two.
 */
async function checkUiDistFreshness() {
	if (!(await hasBuiltUi())) {
		return { state: "missing", distStamp: 0 };
	}
	const distStamp = (await stat(join(webUiDist, "index.html"))).mtimeMs;
	const sourceStamp = await newestMtimeMs(WATCHED_UI_PATHS);
	return { state: sourceStamp <= distStamp ? "fresh" : "stale", distStamp };
}

async function hasBuiltHtmlSidecar() {
	return await pathExists(join(htmlNextDist, "BUILD_ID"));
}

async function checkHtmlSidecarFreshness() {
	if (!(await hasBuiltHtmlSidecar())) {
		return { state: "missing", distStamp: 0 };
	}
	const distStamp = (await newestMtimeMs([htmlNextDist]));
	const sourceStamp = await newestMtimeMs(WATCHED_HTML_PATHS);
	return { state: sourceStamp <= distStamp ? "fresh" : "stale", distStamp };
}

async function hasBuiltOpenmaicSidecar() {
	return await pathExists(join(openmaicDist, "BUILD_ID"));
}

async function checkOpenmaicSidecarFreshness() {
	if (!(await pathExists(join(openmaicRoot, "package.json")))) {
		return { state: "missing", distStamp: 0 };
	}
	if (!(await hasBuiltOpenmaicSidecar())) {
		return { state: "missing", distStamp: 0 };
	}
	const distStamp = await newestMtimeMs([openmaicDist]);
	const sourceStamp = await newestMtimeMs(WATCHED_OPENMAIC_PATHS);
	return { state: sourceStamp <= distStamp ? "fresh" : "stale", distStamp };
}

async function hasBuiltFlowiseSidecar() {
	return await pathExists(join(flowiseServerDist, "index.js"));
}

async function checkFlowiseSidecarFreshness() {
	if (!(await pathExists(join(flowiseRoot, "package.json")))) {
		return { state: "missing", distStamp: 0 };
	}
	if (!(await hasBuiltFlowiseSidecar())) {
		return { state: "missing", distStamp: 0 };
	}
	const distStamp = await newestMtimeMs([flowiseServerDist]);
	const sourceStamp = await newestMtimeMs(WATCHED_FLOWISE_PATHS);
	return { state: sourceStamp <= distStamp ? "fresh" : "stale", distStamp };
}

async function checkOmniRouteSourcePresence() {
	if (!(await pathExists(join(omniRouteRoot, "package.json")))) {
		return { state: "missing" };
	}
	const sourceStamp = await newestMtimeMs(WATCHED_OMNIROUTE_PATHS);
	return { state: sourceStamp > 0 ? "present" : "missing" };
}

function buildHtmlSidecar() {
	console.log("  Building the HTML sidecar (backends/html_anything/next)...");
	const nextBin = resolveDependencyEntry(htmlNextRoot, "next", "dist", "bin", "next");
	if (!nextBin) {
		console.warn("  next binary not found for HTML sidecar — skipping build.");
		return;
	}
	const result = spawnSync(process.execPath, [nextBin, "build"], {
		cwd: htmlNextRoot,
		stdio: "inherit",
		env: { ...process.env, NODE_ENV: "production" },
	});
	if (result.status !== 0) {
		console.warn("  HTML sidecar build failed — templates will stay offline.");
	}
}

function buildOpenmaicSidecar() {
	if (!existsSync(join(openmaicRoot, "package.json"))) {
		return;
	}
	console.log("  Building OpenMAIC sidecar (backends/openmaic)...");
	const ancestors = `http://127.0.0.1:${RUNTIME_PORT} http://localhost:${RUNTIME_PORT}`;
	const result = spawnSync(
		"sh",
		[
			"-c",
			`CI=true npx pnpm@10.28.0 install --frozen-lockfile && ALLOWED_FRAME_ANCESTORS="${ancestors}" CI=true npx pnpm@10.28.0 build`,
		],
		{
			cwd: openmaicRoot,
			stdio: "inherit",
			env: { ...process.env },
		},
	);
	if (result.status !== 0) {
		console.warn("  OpenMAIC build failed — Learning media/features may stay stale.");
	}
}

function buildFlowiseSidecar() {
	if (!existsSync(join(flowiseRoot, "package.json"))) {
		return;
	}
	console.log("  Building Flowise sidecar (backends/flowise)...");
	const result = spawnSync("sh", ["-c", "CI=true npx pnpm@10.26.0 install --frozen-lockfile && CI=true npx pnpm@10.26.0 build"], {
		cwd: flowiseRoot,
		stdio: "inherit",
		env: { ...process.env },
	});
	if (result.status !== 0) {
		console.warn("  Flowise build failed — Agents studio may stay stale.");
	}
}

function buildOmniRouteSidecar() {
	if (!existsSync(join(omniRouteRoot, "package.json"))) {
		return;
	}
	let hasBuildScript = false;
	try {
		const packageJson = JSON.parse(readFileSync(join(omniRouteRoot, "package.json"), "utf8"));
		hasBuildScript = typeof packageJson?.scripts?.build === "string";
	} catch {
		hasBuildScript = false;
	}
	if (!hasBuildScript) {
		console.log("  OmniRoute has no build script — skipping explicit build.");
		return;
	}
	console.log("  Building OmniRoute/OpenRouter module (backends/OmniRoute)...");
	const result = spawnSync("npm", ["run", "build"], {
		cwd: omniRouteRoot,
		stdio: "inherit",
		env: { ...process.env },
	});
	if (result.status !== 0) {
		console.warn("  OmniRoute build failed — OpenRouter-related changes may stay stale.");
	}
}

/**
 * Task worktrees get `frontends/pixel_office/dist` symlinked in by the runtime
 * (see backends/runtime/AGENTS.md, worktree-hooks-fire-before-symlinks), so a
 * rebuild here would overwrite the main checkout's shared bundle from worktree
 * source. Warn and serve as-is instead.
 */
async function uiDistIsSymlink() {
	try {
		return (await lstat(webUiDist)).isSymbolicLink();
	} catch {
		return false;
	}
}

function warnStaleUi(distStamp, reason) {
	console.warn(
		`  Warning: the built UI at ${webUiDist} is older than its sources (dist built ${new Date(distStamp).toLocaleString()}).`,
	);
	console.warn(`  Serving it as-is because ${reason}. Run \`npm run solo -- --build\` to rebuild.`);
}

function buildUi() {
	console.log("  Building the UI (frontends/pixel_office)...");
	const result = spawnSync(process.execPath, [viteCli, "build"], {
		cwd: webUiRoot,
		stdio: "inherit",
	});
	if (result.status !== 0) {
		console.error("UI build failed.");
		process.exit(result.status ?? 1);
	}
}

/**
 * Non-fatal by design: a machine without the agent-stack sandbox must still be
 * able to run the app, so every failure here degrades to a warning.
 */
async function wireAgentStack() {
	let summary;
	try {
		summary = ensureAgentStack({ repoRoot, skipLink: noStackLink });
	} catch (error) {
		console.warn(`  Agent stack: setup failed — ${error.message}`);
		return;
	}
	// No warning when the port is quiet: the runtime spawns the switchboard itself
	// (backends/runtime/src/stack/stack-process.ts) a moment after this runs, so a
	// closed port here is the normal cold-start state, not a fault. A switchboard
	// that never comes up is reported by the runtime, which knows why.
	if (summary.present && !summary.skipLink && (await portIsListening(STACK_CONTROL_PORT))) {
		console.log(`Agent stack switchboard: already up on ${STACK_CONTROL_PORT}.`);
	}
}

/**
 * The half of `activate-stack.sh` that is an environment, not a daemon: it points
 * Claude Code at the switchboard so a task's turns traverse the flagged proxy
 * chain (`:8000 → headroom:8787 → upstream`). Sourcing the activator is no longer
 * needed for this; `--no-proxy-env` opts out.
 *
 * Two deliberate differences from the activator:
 *
 * 1. `ANTHROPIC_API_KEY` is never set, and an inherited `sk-dummy-key-for-sandbox`
 *    is actively dropped. Claude Code prefers an API key over its OAuth
 *    credential, so exporting the placeholder moves every session off the seat the
 *    card resolved and onto a key the switchboard has to replace — and if
 *    STACK_UPSTREAM_ANTHROPIC_API_KEY is unset, that is a 401 per turn. With only
 *    the base URL set, the session's own OAuth bearer travels with the request and
 *    `has_caller_credential()` in server.py leaves it untouched. This is the same
 *    trick `subagent-seat-launch.ts` already relies on.
 * 2. It is announced, with the cost caveat. Headroom rewrites request context, and
 *    Anthropic's prompt cache keys on an exact prefix — measured hit rate on this
 *    repo's sessions is 97–99%, so a rewrite that breaks the prefix turns a cache
 *    read (0.1x) into a cache write (1.25x) and costs more than the compression
 *    saves. `--no-proxy-env` is the lever if usage jumps.
 */
function resolveStackProxyEnv() {
	if (noProxyEnv || !existsSync(join(stackRoot, "server.py"))) {
		return null;
	}
	let chain = "flags unreadable";
	try {
		const flags = JSON.parse(readFileSync(join(stackRoot, "stack-flags.json"), "utf8"));
		const hops = [
			`switchboard:${STACK_CONTROL_PORT}`,
			...(flags.ENABLE_HEADROOM ? ["headroom:8787"] : []),
			...(flags.ENABLE_CCR ? ["ccr:3456"] : []),
			"upstream",
		];
		chain = hops.join(" → ");
	} catch {
		// server.py resolves the real chain per request; this string is cosmetic.
	}
	const delta = { ANTHROPIC_BASE_URL: `http://127.0.0.1:${STACK_CONTROL_PORT}` };
	// A shell that sourced the activator before running solo would otherwise hand
	// the placeholder key down to every agent.
	const inheritedKey = process.env.ANTHROPIC_API_KEY ?? "";
	const dropDummyKey = inheritedKey.startsWith("sk-dummy-key");
	return { delta, chain, dropDummyKey };
}

async function main() {
	if (restart) {
		const stackPorts = Object.values(STACK_DAEMON_PORTS).join(", ");
		console.log(
			`Restart: freeing stack daemons (${stackPorts}) and app ports ${RUNTIME_PORT}, ${MANAGER_PORT}, ${HTML_PORT}, ${DOC_SKILL_PORT}, ${FLOWISE_PORT}...`,
		);
		restartAgentStackDaemons({ freePortFn: freePort });
		freePort(RUNTIME_PORT);
		freePort(MANAGER_PORT);
		freePort(HTML_PORT);
		freePort(DOC_SKILL_PORT);
		freePort(FLOWISE_PORT);
		await new Promise((resolve) => setTimeout(resolve, 500));
	}

	await wireAgentStack();

	if (!restart && (await portIsListening(RUNTIME_PORT))) {
		console.error(`Port ${RUNTIME_PORT} is already in use. Run: npm run solo -- --restart`);
		process.exit(1);
	}

	if (!tsxCli) {
		console.error("tsx not found (backends/runtime or repo root). Run: npm install --install-links");
		process.exit(1);
	}

	const freshness = await checkUiDistFreshness();
	let shouldBuild = forceBuild || freshness.state !== "fresh";
	if (shouldBuild && !forceBuild) {
		// A missing dist stays a hard error under --skip-build (nothing to serve);
		// a stale one is served with a loud warning, since --skip-build is an
		// explicit opt-out and the solo e2e config passes --build instead.
		if (freshness.state === "missing" && skipBuild) {
			console.error(`No built UI at ${webUiDist}. Drop --skip-build or run: npm --prefix frontends/pixel_office run build`);
			process.exit(1);
		}
		if (freshness.state === "stale" && skipBuild) {
			warnStaleUi(freshness.distStamp, "--skip-build was passed");
			shouldBuild = false;
		} else if (freshness.state === "stale" && (await uiDistIsSymlink())) {
			warnStaleUi(freshness.distStamp, "dist is a symlink into another checkout (task worktree)");
			shouldBuild = false;
		}
	}
	if (shouldBuild) {
		if (!viteCli) {
			console.error("vite not found (frontends/pixel_office or repo root). Run: npm install --install-links");
			process.exit(1);
		}
		if (freshness.state === "stale") {
			console.log("  Built UI is older than its sources — rebuilding.");
		}
		buildUi();
	}

	const htmlFreshness = await checkHtmlSidecarFreshness();
	if (htmlFreshness.state !== "fresh" && !skipBuild) {
		if (htmlFreshness.state === "stale") {
			console.log("  HTML sidecar build is older than its sources — rebuilding.");
		}
		buildHtmlSidecar();
	} else if (htmlFreshness.state === "missing" && skipBuild) {
		console.warn("  HTML sidecar .next missing — templates stay offline (--skip-build).");
	}

	const openmaicFreshness = await checkOpenmaicSidecarFreshness();
	if (openmaicFreshness.state !== "fresh" && !skipBuild) {
		if (openmaicFreshness.state === "stale") {
			console.log("  OpenMAIC build is older than its sources — rebuilding.");
		}
		buildOpenmaicSidecar();
	} else if (openmaicFreshness.state === "missing" && skipBuild) {
		console.warn("  OpenMAIC build missing — Learning sidecar may stay offline/stale (--skip-build).");
	}

	const flowiseFreshness = await checkFlowiseSidecarFreshness();
	if (flowiseFreshness.state !== "fresh" && !skipBuild) {
		if (flowiseFreshness.state === "stale") {
			console.log("  Flowise build is older than its sources — rebuilding.");
		}
		buildFlowiseSidecar();
	} else if (flowiseFreshness.state === "missing" && skipBuild) {
		console.warn("  Flowise build missing — Agents studio may stay offline/stale (--skip-build).");
	}

	const omniRoutePresence = await checkOmniRouteSourcePresence();
	if (omniRoutePresence.state === "present" && forceBuild && !skipBuild) {
		buildOmniRouteSidecar();
	}

	const proxyEnv = resolveStackProxyEnv();

	console.log("");
	console.log("  Pixel Office (solo) — one process, one URL");
	console.log(`  App:     http://127.0.0.1:${RUNTIME_PORT}`);
	console.log(`  Manager:  http://127.0.0.1:${MANAGER_PORT} (headless child of the runtime)`);
	console.log(`  HTML:     http://127.0.0.1:${HTML_PORT} (template sidecar, headless)`);
	console.log(`  Docs:     http://127.0.0.1:${DOC_SKILL_PORT} (doc-site sidecar, headless)`);
	if (proxyEnv) {
		console.log(`  Agents:   ${proxyEnv.chain}`);
		console.log("            OAuth is preserved (no ANTHROPIC_API_KEY is exported).");
		console.log("            Watch cache hit rate; opt out with: npm run solo -- --no-proxy-env");
	} else if (noProxyEnv) {
		console.log("  Agents:   direct to api.anthropic.com (--no-proxy-env)");
	}
	console.log("");

	// The runtime serves frontends/pixel_office/dist through server/assets.ts and
	// starts jacked itself, so this is the only process this script owns.
	const runtimeArgs = ["src/cli.ts", "--port", String(RUNTIME_PORT)];
	if (noOpen) {
		runtimeArgs.push("--no-open");
	}
	const runtimeEnv = { ...process.env, KANBAN_RUNTIME_PORT: String(RUNTIME_PORT), ...(proxyEnv?.delta ?? {}) };
	if (proxyEnv?.dropDummyKey || (noProxyEnv && (process.env.ANTHROPIC_API_KEY ?? "").startsWith("sk-dummy-key"))) {
		delete runtimeEnv.ANTHROPIC_API_KEY;
	}
	if (noProxyEnv) {
		// An activated shell exported the base URL too; --no-proxy-env has to undo
		// both halves or agents still route through the chain.
		delete runtimeEnv.ANTHROPIC_BASE_URL;
	}
	const runtime = spawn(process.execPath, [tsxCli, ...runtimeArgs], {
		cwd: runtimeRoot,
		stdio: "inherit",
		shell: false,
		env: runtimeEnv,
	});

	const stop = () => {
		if (!runtime.pid) {
			process.exit(0);
		}
		if (isWindows) {
			spawnSync("taskkill", ["/pid", String(runtime.pid), "/T", "/F"], {
				stdio: "ignore",
				windowsHide: true,
			});
		} else {
			runtime.kill("SIGTERM");
		}
	};

	process.on("SIGINT", stop);
	process.on("SIGTERM", stop);
	runtime.on("exit", (code) => {
		process.exit(code ?? 0);
	});
}

// Only launch when run as a script, so the freshness helpers above can be
// imported and exercised directly without booting the whole stack.
export { checkUiDistFreshness, newestMtimeMs, resolveStackProxyEnv, WATCHED_UI_PATHS };

if (process.argv[1] && resolve(process.argv[1]) === __filename) {
	main().catch((error) => {
		console.error(error);
		process.exit(1);
	});
}
