/**
 * Single-URL Pixel Office launch: one Node runtime serving the built UI, board,
 * PTY sessions and the Manager bridge — plus the headless Manager child it starts
 * itself. No Vite, no second origin, no :8321 dashboard.
 *
 *   http://127.0.0.1:3484   →  board + Claude Accounts + Pixel Office
 *
 * Usage (from repo root):
 *   npm run solo              # build the UI when missing or stale, then serve
 *   npm run solo -- --restart # free the ports first
 *   npm run solo -- --skip-build   # fail if missing, warn+serve if stale
 *   npm run solo -- --build        # always rebuild first
 */
import { connect } from "node:net";
import { constants as fsConstants, existsSync } from "node:fs";
import { access, lstat, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";

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
const DOC_SKILL_PORT = Number(process.env.PIXELOFFICE_DOCSKILL_PORT ?? 8323);

const args = process.argv.slice(2);
const restart = args.includes("--restart");
const skipBuild = args.includes("--skip-build");
/** Forces a rebuild even when dist exists — used by the solo e2e config so specs
 * never run against a stale bundle after a UI source change. */
const forceBuild = args.includes("--build");
const noOpen = args.includes("--no-open");

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

async function main() {
	if (restart) {
		console.log(`Freeing ports ${RUNTIME_PORT}, ${MANAGER_PORT}, ${HTML_PORT}, ${DOC_SKILL_PORT}...`);
		freePort(RUNTIME_PORT);
		freePort(MANAGER_PORT);
		freePort(HTML_PORT);
		freePort(DOC_SKILL_PORT);
		await new Promise((resolve) => setTimeout(resolve, 500));
	} else if (await portIsListening(RUNTIME_PORT)) {
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

	console.log("");
	console.log("  Pixel Office (solo) — one process, one URL");
	console.log(`  App:     http://127.0.0.1:${RUNTIME_PORT}`);
	console.log(`  Manager:  http://127.0.0.1:${MANAGER_PORT} (headless child of the runtime)`);
	console.log(`  HTML:     http://127.0.0.1:${HTML_PORT} (template sidecar, headless)`);
	console.log(`  Docs:     http://127.0.0.1:${DOC_SKILL_PORT} (doc-site sidecar, headless)`);
	console.log("");

	// The runtime serves frontends/pixel_office/dist through server/assets.ts and
	// starts jacked itself, so this is the only process this script owns.
	const runtimeArgs = ["src/cli.ts", "--port", String(RUNTIME_PORT)];
	if (noOpen) {
		runtimeArgs.push("--no-open");
	}
	const runtime = spawn(process.execPath, [tsxCli, ...runtimeArgs], {
		cwd: runtimeRoot,
		stdio: "inherit",
		shell: false,
		env: { ...process.env, KANBAN_RUNTIME_PORT: String(RUNTIME_PORT) },
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
export { checkUiDistFreshness, newestMtimeMs, WATCHED_UI_PATHS };

if (process.argv[1] && resolve(process.argv[1]) === __filename) {
	main().catch((error) => {
		console.error(error);
		process.exit(1);
	});
}
