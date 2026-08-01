// Supervises the Manager Python service so a single Kanban launch brings up
// the whole product: board + PTY + Claude account management.
//
// Manager stays headless here — no browser, no tray. PixelOffice renders every
// Manager surface natively (Accounts upper-right, config in the sidebar), so the
// raw :8321 dashboard must never be opened on the user's behalf.
//
// Manager is optional by construction: if Python or the package is missing, the
// board and office keep running and Accounts simply report offline.
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { connect } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { terminateProcessForTimeout } from "../server/process-termination";

const DEFAULT_MANAGER_HOST = "127.0.0.1";
const DEFAULT_MANAGER_PORT = 8321;
const PORT_PROBE_TIMEOUT_MS = 1_000;
const STARTUP_TIMEOUT_MS = 20_000;
const PORT_POLL_INTERVAL_MS = 250;

export interface ManagerProcess {
	/** Null when Manager was already listening or could not be started. */
	pid: number | null;
	/** True when this runtime spawned the service (and therefore owns shutdown). */
	spawned: boolean;
	/** Resolves true once the port answers; never rejects. Callers need not await it. */
	ready: Promise<boolean>;
	close: () => Promise<void>;
}

export interface StartManagerProcessDependencies {
	warn: (message: string) => void;
	log?: (message: string) => void;
	/** Overrides `backends/manager` discovery; mainly for tests. */
	managerRoot?: string | null;
	host?: string;
	port?: number;
}

/**
 * Locates the `backends/manager` package next to the runtime.
 *
 * Mirrors `getWebUiDir()`'s candidate walk so the bundled `dist/cli.js` layout
 * and the monorepo source layout both resolve.
 */
export function findManagerRoot(): string | null {
	const here = dirname(fileURLToPath(import.meta.url));
	const candidates = [
		// Dev / monorepo: backends/runtime/src/manager → backends/manager
		resolve(here, "../../../manager"),
		// tsc output: backends/runtime/dist/manager → backends/manager
		resolve(here, "../../../../manager"),
		// Bundled dist/cli.js sitting in backends/runtime/dist
		resolve(here, "../../manager"),
	];
	for (const candidate of candidates) {
		if (existsSync(join(candidate, "manager", "__main__.py"))) {
			return candidate;
		}
	}
	return null;
}

function resolveManagerPort(configured: number | undefined): number {
	if (configured !== undefined) {
		return configured;
	}
	const fromEnv = (process.env.MANAGER_URL ?? process.env.JACKED_URL)?.trim();
	if (fromEnv) {
		try {
			const parsed = new URL(fromEnv);
			if (parsed.port) {
				return Number(parsed.port);
			}
		} catch {
			// Fall through to the default port.
		}
	}
	return DEFAULT_MANAGER_PORT;
}

function probePort(host: string, port: number, timeoutMs = PORT_PROBE_TIMEOUT_MS): Promise<boolean> {
	return new Promise((resolvePromise) => {
		const socket = connect({ host, port });
		const finish = (isOpen: boolean) => {
			socket.destroy();
			resolvePromise(isOpen);
		};
		socket.setTimeout(timeoutMs);
		socket.once("connect", () => finish(true));
		socket.once("timeout", () => finish(false));
		socket.once("error", () => finish(false));
	});
}

async function waitForPort(
	host: string,
	port: number,
	timeoutMs: number,
	shouldKeepWaiting: () => boolean,
): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline && shouldKeepWaiting()) {
		if (await probePort(host, port)) {
			return true;
		}
		await new Promise((resolvePromise) => setTimeout(resolvePromise, PORT_POLL_INTERVAL_MS));
	}
	return false;
}

/**
 * The bare `python3` (or `python`) on PATH is frequently a system interpreter
 * without Manager's deps (aiohttp, fastapi, ...) installed — `uv sync` /
 * `pip install -e .` puts them in `backends/manager/.venv` instead. Missing
 * deps make the FastAPI auth router's import silently fail (caught by a
 * broad `except ImportError` in `manager/api/main.py`), so every OAuth call
 * 405s against the SPA catch-all instead of erroring clearly. Prefer the
 * venv when one exists so a fresh `uv sync` is picked up with no extra config.
 */
function resolveVenvPythonPath(managerBackendRoot: string): string | null {
	const venvPython =
		process.platform === "win32"
			? join(managerBackendRoot, ".venv", "Scripts", "python.exe")
			: join(managerBackendRoot, ".venv", "bin", "python");
	return existsSync(venvPython) ? venvPython : null;
}

function resolvePythonBinary(managerBackendRoot: string): string {
	const configured = (process.env.MANAGER_PYTHON ?? process.env.JACKED_PYTHON)?.trim();
	if (configured) {
		return configured;
	}
	return resolveVenvPythonPath(managerBackendRoot) ?? (process.platform === "win32" ? "python" : "python3");
}

function createNoopProcess(isAlreadyUp: boolean): ManagerProcess {
	return {
		pid: null,
		spawned: false,
		ready: Promise.resolve(isAlreadyUp),
		close: async () => {},
	};
}

/**
 * Starts Manager unless it is already listening (an externally managed service or
 * the macOS menu-bar app owns the port in that case — never double-spawn).
 */
export async function startManagerProcess(deps: StartManagerProcessDependencies): Promise<ManagerProcess> {
	const host = deps.host ?? DEFAULT_MANAGER_HOST;
	const port = resolveManagerPort(deps.port);
	const log = deps.log ?? (() => {});

	if (await probePort(host, port)) {
		log(`Manager already listening on ${host}:${port} — using the running service.`);
		return createNoopProcess(true);
	}

	const managerBackendRoot = deps.managerRoot === undefined ? findManagerRoot() : deps.managerRoot;
	if (!managerBackendRoot) {
		deps.warn("Manager package not found next to the runtime — Claude Accounts stay offline.");
		return createNoopProcess(false);
	}

	const python = resolvePythonBinary(managerBackendRoot);
	log(`Starting Manager with interpreter: ${python}`);
	const repoRoot = resolve(managerBackendRoot, "../..");
	const agentManagerRoot = join(repoRoot, ".agent", "manager");
	const agentCatalog = join(agentManagerRoot, "data");
	const agentRuntime = join(agentManagerRoot, "runtime");
	const catalogEnv =
		existsSync(join(agentCatalog, "skills")) || existsSync(join(agentCatalog, "packs.json"))
			? { PIXELOFFICE_AGENT_MANAGER_DATA: agentCatalog }
			: {};
	const runtimeEnv =
		existsSync(join(agentRuntime, "hooks")) || existsSync(join(agentRuntime, "web"))
			? { PIXELOFFICE_AGENT_MANAGER_RUNTIME: agentRuntime }
			: {};
	let child: ChildProcess;
	try {
<<<<<<< HEAD:backends/runtime/src/manager/manager-process.ts
		child = spawn(
			python,
			["-m", "manager", "webux", "--host", host, "--port", String(port), "--no-browser"],
			{
				cwd: managerBackendRoot,
				// An explicit --host plus loopback keeps the remote-access setting out of
				// play: an embedded Manager is only ever reachable from this machine.
				env: { ...process.env, PYTHONPATH: managerBackendRoot, ...catalogEnv, ...runtimeEnv },
				stdio: "ignore",
				// Windows resolves `python` through shims that need a shell.
				shell: process.platform === "win32",
				windowsHide: true,
				detached: process.platform !== "win32",
			},
		);
=======
		child = spawn(python, ["-m", "jacked", "webux", "--host", host, "--port", String(port), "--no-browser"], {
			cwd: jackedRoot,
			// An explicit --host plus loopback keeps the remote-access setting out of
			// play: an embedded jacked is only ever reachable from this machine.
			env: { ...process.env, PYTHONPATH: jackedRoot },
			stdio: "ignore",
			// Windows resolves `python` through shims that need a shell.
			shell: process.platform === "win32",
			windowsHide: true,
			detached: process.platform !== "win32",
		});
>>>>>>> refs/remotes/origin/main:backends/runtime/src/jacked/jacked-process.ts
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		deps.warn(`Could not launch Manager (${python}): ${message}`);
		return createNoopProcess(false);
	}

	let exited = false;
	child.once("exit", (code) => {
		exited = true;
		if (code !== 0 && code !== null) {
			deps.warn(`Manager exited (code ${code}) — Claude Accounts stay offline until it is restarted.`);
		}
	});
	child.once("error", (error) => {
		exited = true;
		deps.warn(`Could not launch Manager (${python}): ${error.message}`);
	});

	// Readiness is reported in the background: the board, PTY sessions and office
	// must not wait on Python, and the Accounts pane already renders an offline
	// state until the monitor's first successful poll.
	const ready = waitForPort(host, port, STARTUP_TIMEOUT_MS, () => !exited).then((isUp) => {
		if (isUp) {
			log(`Manager listening on ${host}:${port} (headless).`);
			return true;
		}
		deps.warn(`Manager did not open ${host}:${port}.`);
		deps.warn("  Install deps: cd backends/manager && pip install -e .   (or: uv sync)");
		deps.warn("  Board and office keep running; Claude Accounts stay offline until Manager is up.");
		return false;
	});

	return {
		pid: child.pid ?? null,
		spawned: true,
		ready,
		close: async () => {
			const pid = child.pid;
			if (exited || pid === undefined) {
				return;
			}
			if (process.platform === "win32") {
				// tree-kill: the shell shim is the direct child, python sits under it.
				terminateProcessForTimeout(child);
			} else {
				// Spawned detached, so the child leads its own group — signal the group
				// to reach uvicorn's workers too.
				try {
					process.kill(-pid, "SIGTERM");
				} catch {
					child.kill("SIGTERM");
				}
			}
			// uvicorn needs a moment to release the port before the next launch.
			await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
		},
	};
}
