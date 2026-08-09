// Supervises the agent-stack switchboard (backends/agent_stack/server.py) so a
// single Kanban launch also brings up the tool switchboard the Stack Control
// dialog talks to.
//
// The switchboard is the only part of the stack the runtime owns. Everything
// else `activate-stack.sh` does — PATH, the venv, `ANTHROPIC_BASE_URL` — is
// shell-scoped by design and is deliberately NOT reproduced here: exporting the
// proxy env for spawned agents would route every task agent through the local
// chain under `sk-dummy-key-for-sandbox`, and CCR's default provider has no
// credentials, so every agent would die on `Authentication failed`.
//
// One deliberate exception: a card that pins a subagent seat gets
// `ANTHROPIC_BASE_URL` (and never `ANTHROPIC_API_KEY`) pointed at the switchboard, so
// the session keeps its own OAuth credential and only subagent turns are diverted to a
// per-seat router. See `ccr-process.ts` and `agent-session-adapters.ts`.
//
// Optional by construction: with no stack installed the board keeps running and
// Stack Control reports the switchboard offline.
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { terminateProcessForTimeout } from "../server/process-termination";
import { findStackRoot } from "./stack-paths";
import { probePort, waitForPort } from "./stack-ports";

const DEFAULT_STACK_HOST = "127.0.0.1";
const DEFAULT_STACK_PORT = 8000;
const STARTUP_TIMEOUT_MS = 20_000;

export interface StackProcess {
	/** Null when the switchboard was already listening or could not be started. */
	pid: number | null;
	/** True when this runtime spawned the service (and therefore owns shutdown). */
	spawned: boolean;
	/** Resolves true once the port answers; never rejects. Callers need not await it. */
	ready: Promise<boolean>;
	close: () => Promise<void>;
}

export interface StartStackProcessDependencies {
	warn: (message: string) => void;
	log?: (message: string) => void;
	/** Overrides `backends/agent_stack` discovery; mainly for tests. */
	stackRoot?: string | null;
	host?: string;
	port?: number;
}

export function resolveStackPort(configured?: number | undefined): number {
	if (configured !== undefined) {
		return configured;
	}
	const fromPort = process.env.STACK_UI_PORT?.trim();
	if (fromPort && /^\d+$/.test(fromPort)) {
		return Number(fromPort);
	}
	return DEFAULT_STACK_PORT;
}

/**
 * Same reasoning as Manager's `resolveVenvPythonPath`: a bare `python3` is
 * usually a system interpreter without fastapi/httpx/uvicorn, and `uv sync`
 * installs them into `backends/agent_stack/.venv` instead. Prefer the venv so a
 * fresh `uv sync` is picked up with no extra config.
 */
function resolveStackPython(stackRoot: string): string | null {
	const configured = process.env.STACK_PYTHON?.trim();
	if (configured) {
		return configured;
	}
	const venvPython =
		process.platform === "win32"
			? join(stackRoot, ".venv", "Scripts", "python.exe")
			: join(stackRoot, ".venv", "bin", "python");
	return existsSync(venvPython) ? venvPython : null;
}

function createNoopProcess(isAlreadyUp: boolean): StackProcess {
	return {
		pid: null,
		spawned: false,
		ready: Promise.resolve(isAlreadyUp),
		close: async () => {},
	};
}

/**
 * The switchboard inherits the runtime's environment, which — when Kanban was
 * launched from a shell that sourced `activate-stack.sh` — contains
 * `ANTHROPIC_BASE_URL` pointing at this very port and the sandbox's dummy API
 * key. Neither is read by `server.py` (it resolves its upstream from
 * `STACK_*` vars), and forwarding a dummy credential to a proxy is exactly the
 * confusion the sandbox's real-key handling exists to avoid, so both are
 * dropped rather than passed through.
 */
function buildStackEnv(): NodeJS.ProcessEnv {
	const { ANTHROPIC_BASE_URL: _baseUrl, ANTHROPIC_API_KEY: _apiKey, ...rest } = process.env;
	return rest;
}

/**
 * Starts the switchboard unless it is already listening — an activated shell may
 * already own the port, and double-spawning would leave an orphan holding 8000.
 */
export async function startStackProcess(deps: StartStackProcessDependencies): Promise<StackProcess> {
	const host = deps.host ?? DEFAULT_STACK_HOST;
	const port = resolveStackPort(deps.port);
	const log = deps.log ?? (() => {});

	if (await probePort(host, port)) {
		log(`Agent stack switchboard already listening on ${host}:${port} — using the running service.`);
		return createNoopProcess(true);
	}

	const stackRoot = deps.stackRoot === undefined ? findStackRoot() : deps.stackRoot;
	if (stackRoot === null) {
		// Not a warning: most checkouts never install the stack, and the Stack
		// Control dialog already renders an offline state.
		log("Agent stack not installed next to the runtime — Stack Control stays offline.");
		return createNoopProcess(false);
	}

	const python = resolveStackPython(stackRoot);
	if (python === null) {
		deps.warn(`Agent stack venv missing at ${join(stackRoot, ".venv")} — Stack Control stays offline.`);
		deps.warn(`  Create it with: cd ${stackRoot} && uv sync`);
		return createNoopProcess(false);
	}

	log(`Starting agent stack switchboard with interpreter: ${python}`);
	let child: ChildProcess;
	try {
		child = spawn(python, ["-m", "uvicorn", "server:app", "--host", host, "--port", String(port)], {
			// `server:app` is imported relative to the working directory.
			cwd: stackRoot,
			env: buildStackEnv(),
			stdio: "ignore",
			shell: false,
			windowsHide: true,
			detached: process.platform !== "win32",
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		deps.warn(`Could not launch the agent stack switchboard (${python}): ${message}`);
		return createNoopProcess(false);
	}

	let exited = false;
	child.once("exit", (code) => {
		exited = true;
		if (code !== 0 && code !== null) {
			deps.warn(`Agent stack switchboard exited (code ${code}) — Stack Control stays offline until restarted.`);
		}
	});
	child.once("error", (error) => {
		exited = true;
		deps.warn(`Could not launch the agent stack switchboard (${python}): ${error.message}`);
	});

	const ready = waitForPort(host, port, STARTUP_TIMEOUT_MS, () => !exited).then((isUp) => {
		if (isUp) {
			log(`Agent stack switchboard listening on ${host}:${port}.`);
			return true;
		}
		deps.warn(`Agent stack switchboard did not open ${host}:${port} — Stack Control stays offline.`);
		deps.warn(`  Check deps with: cd ${stackRoot} && uv sync`);
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
				terminateProcessForTimeout(child);
			} else {
				try {
					process.kill(-pid, "SIGTERM");
				} catch {
					child.kill("SIGTERM");
				}
			}
			await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
		},
	};
}
