// Supervises the agent-stack switchboard (backends/agent_stack/server.py) so a
// single Kanban launch also brings up the tool switchboard the Stack Control
// dialog talks to.
//
// Everything else `activate-stack.sh` does for a shell — PATH, the venv,
// `ANTHROPIC_BASE_URL` — is shell-scoped by design and is deliberately NOT
// reproduced here: exporting the proxy env for spawned agents would route every
// task agent through the local chain under `sk-dummy-key-for-sandbox`, and CCR's
// default provider has no credentials, so every agent would die on
// `Authentication failed`. `scripts/solo.mjs` owns that decision instead.
//
// One deliberate exception: a card that pins a subagent seat gets
// `ANTHROPIC_BASE_URL` (and never `ANTHROPIC_API_KEY`) pointed at the switchboard, so
// the session keeps its own OAuth credential and only subagent turns are diverted to a
// per-seat router. See `ccr-process.ts` and `agent-session-adapters.ts`.
//
// The switchboard used to be spawned here by hand, with `stdio: "ignore"` and no
// restart: when it died mid-session nothing brought it back, nothing was logged,
// and — because agents dial it through `ANTHROPIC_BASE_URL` — every turn failed
// with ECONNREFUSED until someone noticed. It now runs through the same
// `superviseStackDaemon` core as headroom and CCR, which restarts it, keeps
// `logs/switchboard.log` truthful, and maintains `logs/switchboard.pid`.
//
// Optional by construction: with no stack installed the board keeps running and
// Stack Control reports the switchboard offline.
import { existsSync } from "node:fs";
import { join } from "node:path";

import {
	createNoopProcess,
	type StackDaemonDependencies,
	type StackProcess,
	superviseStackDaemon,
} from "./stack-daemon";
import { findStackRoot } from "./stack-paths";
import { probePort } from "./stack-ports";

const DEFAULT_STACK_HOST = "127.0.0.1";
const DEFAULT_STACK_PORT = 8000;

export interface StartStackProcessDependencies extends StackDaemonDependencies {
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

/**
 * Starts the switchboard unless it is already listening — an activated shell may
 * already own the port, and double-spawning would leave an orphan holding 8000.
 * An already-listening switchboard is adopted, not ignored: `superviseStackDaemon`
 * keeps probing it and takes over if its owner disappears.
 */
export async function startStackProcess(deps: StartStackProcessDependencies): Promise<StackProcess> {
	const host = deps.host ?? DEFAULT_STACK_HOST;
	const port = resolveStackPort(deps.port);
	const log = deps.log ?? (() => {});

	const stackRoot = deps.stackRoot === undefined ? findStackRoot() : deps.stackRoot;
	if (stackRoot === null) {
		// Not a warning: most checkouts never install the stack, and the Stack
		// Control dialog already renders an offline state.
		log("Agent stack not installed next to the runtime — Stack Control stays offline.");
		// Probed rather than assumed false: another checkout's switchboard may still
		// be serving this port, and Stack Control should report it as up.
		return createNoopProcess(await probePort(host, port));
	}

	const python = resolveStackPython(stackRoot);
	if (python === null) {
		deps.warn(`Agent stack venv missing at ${join(stackRoot, ".venv")} — Stack Control stays offline.`);
		deps.warn(`  Create it with: cd ${stackRoot} && uv sync`);
		return createNoopProcess(await probePort(host, port));
	}

	return superviseStackDaemon(
		{
			name: "switchboard",
			label: "Agent stack switchboard",
			stackRoot,
			host,
			port,
			binary: python,
			// `server:app` is imported relative to the working directory, which
			// `superviseStackDaemon` sets to `stackRoot`.
			args: ["-m", "uvicorn", "server:app", "--host", host, "--port", String(port)],
			readinessHint: " — Stack Control stays offline.",
		},
		deps,
	);
}
