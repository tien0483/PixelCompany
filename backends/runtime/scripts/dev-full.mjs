/**
 * Starts runtime + Vite web UI + Manager companion on free ports.
 * Use via `npm run dev:full` or the VS Code "Dev (Full Stack)" launch config.
 */
import { createServer, connect } from "node:net";
import { access, constants as fsConstants } from "node:fs/promises";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const isWindows = process.platform === "win32";
const scriptDir = dirname(fileURLToPath(import.meta.url));
const runtimeRoot = join(scriptDir, "..");
const managerRoot = join(runtimeRoot, "..", "manager");
const MANAGER_PORT = Number(process.env.MANAGER_PORT ?? process.env.JACKED_PORT ?? 8321);

async function pathExists(target) {
	try {
		await access(target, fsConstants.F_OK);
		return true;
	} catch {
		return false;
	}
}

async function ensureDependenciesInstalled() {
	const lockIndicator = join(process.cwd(), "node_modules", ".package-lock.json");
	try {
		await access(lockIndicator);
		return;
	} catch {
		// node_modules is missing; fall through to install below.
	}
	console.warn("node_modules not installed in this worktree. Running npm ci...");
	for (const args of [["ci"], ["--prefix", "../../frontends/pixel_office", "ci"]]) {
		const result = spawnSync("npm", args, { stdio: "inherit", shell: isWindows });
		if (result.status !== 0) {
			process.exit(result.status ?? 1);
		}
	}
}

// Must run before importing any third-party modules so a fresh worktree with
// an empty node_modules can bootstrap itself using only node: built-ins.
await ensureDependenciesInstalled();

// Deferred until after ensureDependenciesInstalled so these resolve against
// the freshly-installed node_modules. Static top-level imports would be
// resolved before any code runs and fail with ERR_MODULE_NOT_FOUND.
const { default: treeKill } = await import("tree-kill");
const { default: open } = await import("open");

function findPort(start, reserved = new Set()) {
	if (reserved.has(start)) {
		return findPort(start + 1, reserved);
	}
	return new Promise((resolve) => {
		const srv = createServer();
		srv.listen(start, "127.0.0.1", () => {
			srv.close(() => resolve(start));
		});
		srv.on("error", () => resolve(findPort(start + 1, reserved)));
	});
}

function waitForPort(port, timeout = 15000) {
	const start = Date.now();
	return new Promise((resolve, reject) => {
		function attempt() {
			const sock = connect(port, "127.0.0.1");
			sock.on("connect", () => {
				sock.destroy();
				resolve();
			});
			sock.on("error", () => {
				if (Date.now() - start > timeout) {
					reject(new Error(`Port ${port} did not open within ${timeout}ms`));
				} else {
					setTimeout(attempt, 200);
				}
			});
		}
		attempt();
	});
}

const runtimePort = await findPort(3484);
const webUiPort = await findPort(4173, new Set([runtimePort]));
const requestedDevFullArgs = process.argv.slice(2);
const withShutdownCleanupFlag = "--with-shutdown-cleanup";
const requestedRuntimeArgs = requestedDevFullArgs.filter((arg) => arg !== withShutdownCleanupFlag);
const hasExplicitSkipCleanupArg = requestedRuntimeArgs.some((arg) => arg === "--skip-shutdown-cleanup");
const shouldDefaultSkipShutdownCleanup = !requestedDevFullArgs.includes(withShutdownCleanupFlag);
const runtimeCliArgs = [
	"--port",
	String(runtimePort),
	"--no-open",
	...(shouldDefaultSkipShutdownCleanup && !hasExplicitSkipCleanupArg ? ["--skip-shutdown-cleanup"] : []),
	...requestedRuntimeArgs,
];

console.log(`\n  Runtime port: ${runtimePort}`);
console.log(`  Web UI:       http://127.0.0.1:${webUiPort}`);
console.log(`  Manager:       http://127.0.0.1:${MANAGER_PORT}\n`);

const env = {
	NODE_ENV: "development",
	...process.env,
	KANBAN_RUNTIME_PORT: String(runtimePort),
	KANBAN_WEB_UI_PORT: String(webUiPort),
};

const tsxBin = isWindows ? "node_modules/.bin/tsx.cmd" : "node_modules/.bin/tsx";
const runtime = spawn(tsxBin, ["watch", "src/cli.ts", ...runtimeCliArgs], {
	env,
	stdio: "inherit",
});

let vite;
let manager;
let exiting = false;

function cleanup(exitCode = 0) {
	if (exiting) return;
	exiting = true;
	if (runtime.pid) treeKill(runtime.pid);
	if (vite?.pid) treeKill(vite.pid);
	if (manager?.pid) treeKill(manager.pid);
	process.exit(exitCode);
}

process.on("SIGTERM", () => cleanup(0));
process.on("SIGINT", () => cleanup(0));
runtime.on("exit", () => cleanup(1));

// Wait for runtime to accept connections before starting Vite / Manager
try {
	await waitForPort(runtimePort);
} catch (error) {
	const message = error instanceof Error ? error.message : String(error);
	console.error(`Failed to start runtime: ${message}`);
	cleanup(1);
}

const managerPresent = await pathExists(join(managerRoot, "manager"));
if (managerPresent) {
	manager = spawn(
		"python",
		["-m", "manager", "webux", "--host", "127.0.0.1", "--port", String(MANAGER_PORT), "--no-browser"],
		{
			cwd: managerRoot,
			env: { ...process.env, PYTHONPATH: managerRoot },
			stdio: "inherit",
			shell: isWindows,
		},
	);
	manager.on("exit", (code) => {
		if (!exiting) {
			console.warn(`Manager exited (code ${code ?? "?"}) — UI/runtime still running.`);
		}
	});
	try {
		await waitForPort(MANAGER_PORT, 20000);
	} catch {
		console.warn(`Manager did not open port ${MANAGER_PORT} in time.`);
		console.warn("  Install deps: cd backends/manager && pip install -e .");
		console.warn("  (or: cd backends/manager && uv sync)");
		console.warn("  Board/office will keep running; Accounts stay offline until Manager is up.");
	}
} else {
	console.warn(`Manager not found at ${managerRoot} — skipping.`);
}

vite = spawn("npm", ["run", "web:dev"], {
	env,
	stdio: "inherit",
	shell: isWindows,
});

vite.on("exit", () => cleanup(1));

// Auto-open browser after a short delay for Vite to start
setTimeout(() => {
	open(`http://127.0.0.1:${webUiPort}`);
}, 2000);
