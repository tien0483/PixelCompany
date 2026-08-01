/**
 * Single-URL Pixel Office launch: one Node runtime serving the built UI, board,
 * PTY sessions and the Manager bridge — plus the headless Manager child it starts
 * itself. No Vite, no second origin, no :8321 dashboard.
 *
 *   http://127.0.0.1:3484   →  board + Claude Accounts + Pixel Office
 *
 * Usage (from repo root):
 *   npm run solo              # build the UI if needed, then serve
 *   npm run solo -- --restart # free the ports first
 *   npm run solo -- --skip-build   # fail instead of building
 *   npm run solo -- --build        # always rebuild first
 */
import { connect } from "node:net";
import { constants as fsConstants, existsSync } from "node:fs";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
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
	const lsof = spawnSync("sh", ["-c", `lsof -tiTCP:${port} -sTCP:LISTEN`], { encoding: "utf8" });
	for (const pid of (lsof.stdout || "").split(/\s+/).filter((value) => /^\d+$/.test(value))) {
		try {
			process.kill(Number(pid), "SIGKILL");
		} catch {
			// already gone
		}
	}
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
		console.log(`Freeing ports ${RUNTIME_PORT}, ${MANAGER_PORT}...`);
		freePort(RUNTIME_PORT);
		freePort(MANAGER_PORT);
		await new Promise((resolve) => setTimeout(resolve, 500));
	} else if (await portIsListening(RUNTIME_PORT)) {
		console.error(`Port ${RUNTIME_PORT} is already in use. Run: npm run solo -- --restart`);
		process.exit(1);
	}

	if (!tsxCli) {
		console.error("tsx not found (backends/runtime or repo root). Run: npm install --install-links");
		process.exit(1);
	}

	if (forceBuild || !(await hasBuiltUi())) {
		if (skipBuild && !forceBuild) {
			console.error(`No built UI at ${webUiDist}. Drop --skip-build or run: npm --prefix frontends/pixel_office run build`);
			process.exit(1);
		}
		if (!viteCli) {
			console.error("vite not found (frontends/pixel_office or repo root). Run: npm install --install-links");
			process.exit(1);
		}
		buildUi();
	}

	console.log("");
	console.log("  Pixel Office (solo) — one process, one URL");
	console.log(`  App:     http://127.0.0.1:${RUNTIME_PORT}`);
	console.log(`  Manager:  http://127.0.0.1:${MANAGER_PORT} (headless child of the runtime)`);
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

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
