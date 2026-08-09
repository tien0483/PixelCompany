// Supervises one Claude Code Router per API seat, for the "subagents bill a different
// seat" split.
//
// One router per seat rather than one shared router: the vendored CCR build routes by
// category only (see `ccr-config.ts`), so a single instance can serve exactly one
// provider. Seats therefore get their own port, allocated from
// `STACK_CCR_SEAT_BASE_PORT` (default 3460) upward — deliberately clear of 3456, which
// belongs to the user's own `ENABLE_CCR` router from `activate-stack.sh`.
//
// The port is not shared state: it travels to the switchboard inside the
// `CLAUDE_CODE_SUBAGENT_MODEL` marker (`ccr-<port>,<modelId>`), so neither process has to
// discover the other.
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { terminateProcessForTimeout } from "../server/process-termination";
import { type CcrSeatDefinition, ensureCcrSeatConfig } from "./ccr-config";
import { findStackRoot } from "./stack-paths";
import { probePort, waitForPort } from "./stack-ports";

const CCR_HOST = "127.0.0.1";
const DEFAULT_SEAT_BASE_PORT = 3460;
/** Ports scanned upward from the base before giving up. */
const SEAT_PORT_RANGE = 40;
const STARTUP_TIMEOUT_MS = 30_000;

export interface CcrSeatRouter {
	providerId: string;
	port: number;
}

interface RunningSeatRouter extends CcrSeatRouter {
	child: ChildProcess | null;
	configPath: string;
}

/** Seat id → running router. Module-level so repeat launches reuse one process per seat. */
const RUNNING_ROUTERS = new Map<string, RunningSeatRouter>();
/** In-flight starts, so two tasks starting on the same seat do not race into two routers. */
const PENDING_STARTS = new Map<string, Promise<CcrSeatRouter | null>>();

export function resolveCcrSeatBasePort(): number {
	const configured = process.env.STACK_CCR_SEAT_BASE_PORT?.trim();
	if (configured && /^\d+$/.test(configured)) {
		return Number(configured);
	}
	return DEFAULT_SEAT_BASE_PORT;
}

/** Highest port a seat router may occupy; the switchboard rejects anything outside. */
export function resolveCcrSeatMaxPort(): number {
	return resolveCcrSeatBasePort() + SEAT_PORT_RANGE - 1;
}

/**
 * The router binary from the stack's own install. `activate-stack.sh` reaches it through
 * PATH after sourcing; the runtime has no such shell, so it is resolved by path.
 */
function resolveCcrBinary(stackRoot: string): string | null {
	const binary = join(stackRoot, "node_modules", ".bin", "ccr");
	return existsSync(binary) ? binary : null;
}

async function findFreePort(start: number): Promise<number | null> {
	for (let port = start; port < start + SEAT_PORT_RANGE; port += 1) {
		if (!(await probePort(CCR_HOST, port))) {
			return port;
		}
	}
	return null;
}

export interface EnsureCcrSeatRouterDependencies {
	warn: (message: string) => void;
	log?: (message: string) => void;
	/** Overrides `backends/agent_stack` discovery; mainly for tests. */
	stackRoot?: string | null;
}

/**
 * Returns the router serving `seat`, starting one if needed. Null whenever the seat cannot
 * be served — no stack installed, no router binary, no free port, or a router that never
 * came up. Callers must treat null as "launch without the subagent split" rather than as a
 * launch failure: losing the split costs tokens on the wrong seat, while refusing to start
 * costs the user their task.
 */
export async function ensureCcrSeatRouter(
	seat: CcrSeatDefinition,
	deps: EnsureCcrSeatRouterDependencies,
): Promise<CcrSeatRouter | null> {
	const pending = PENDING_STARTS.get(seat.providerId);
	if (pending) {
		return await pending;
	}
	const started = startSeatRouter(seat, deps).finally(() => {
		PENDING_STARTS.delete(seat.providerId);
	});
	PENDING_STARTS.set(seat.providerId, started);
	return await started;
}

async function startSeatRouter(
	seat: CcrSeatDefinition,
	deps: EnsureCcrSeatRouterDependencies,
): Promise<CcrSeatRouter | null> {
	const log = deps.log ?? (() => {});
	const stackRoot = deps.stackRoot === undefined ? findStackRoot() : deps.stackRoot;
	if (stackRoot === null) {
		deps.warn("Agent stack not installed — subagents fall back to the task's own seat.");
		return null;
	}
	const binary = resolveCcrBinary(stackRoot);
	if (binary === null) {
		deps.warn(`Claude Code Router not installed in ${stackRoot} — subagents fall back to the task's own seat.`);
		return null;
	}

	const existing = RUNNING_ROUTERS.get(seat.providerId);
	// A router whose port stopped answering (crash, or a machine-wide `ccr` cleanup) has to
	// be replaced, not reused — otherwise every subagent turn 502s for the rest of the day.
	if (existing && (await probePort(CCR_HOST, existing.port))) {
		const config = await ensureCcrSeatConfig({ seat, port: existing.port, stackRoot });
		if (config && !config.changed) {
			return { providerId: existing.providerId, port: existing.port };
		}
		// Credentials or endpoint moved: the running router still holds the old ones.
		await stopSeatRouter(seat.providerId);
	} else if (existing) {
		RUNNING_ROUTERS.delete(seat.providerId);
	}

	const port = await findFreePort(resolveCcrSeatBasePort());
	if (port === null) {
		deps.warn(
			`No free port for the ${seat.providerId} subagent router — subagents fall back to the task's own seat.`,
		);
		return null;
	}
	const config = await ensureCcrSeatConfig({ seat, port, stackRoot });
	if (config === null) {
		return null;
	}

	log(`Starting subagent router for seat ${seat.providerId} on ${CCR_HOST}:${port}.`);
	let child: ChildProcess;
	try {
		child = spawn(binary, ["start", "-c", config.configPath, "-p", String(port), "-h", CCR_HOST], {
			cwd: stackRoot,
			// CCR resolves auth/session files from HOME; keeping it inside the stack is what
			// stops it writing into the user's real `~/.claude-code-router`.
			env: { ...process.env, HOME: join(stackRoot, "ccr-home") },
			stdio: "ignore",
			shell: false,
			windowsHide: true,
			detached: process.platform !== "win32",
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		deps.warn(`Could not launch the ${seat.providerId} subagent router: ${message}`);
		return null;
	}

	let exited = false;
	child.once("exit", () => {
		exited = true;
		RUNNING_ROUTERS.delete(seat.providerId);
	});
	child.once("error", (error) => {
		exited = true;
		RUNNING_ROUTERS.delete(seat.providerId);
		deps.warn(`Could not launch the ${seat.providerId} subagent router: ${error.message}`);
	});

	const isUp = await waitForPort(CCR_HOST, port, STARTUP_TIMEOUT_MS, () => !exited);
	if (!isUp) {
		deps.warn(
			`The ${seat.providerId} subagent router did not open ${CCR_HOST}:${port} — subagents fall back to the task's own seat.`,
		);
		child.kill("SIGTERM");
		return null;
	}

	RUNNING_ROUTERS.set(seat.providerId, { providerId: seat.providerId, port, child, configPath: config.configPath });
	log(`Subagent router for seat ${seat.providerId} listening on ${CCR_HOST}:${port}.`);
	return { providerId: seat.providerId, port };
}

export async function stopSeatRouter(providerId: string): Promise<void> {
	const running = RUNNING_ROUTERS.get(providerId);
	RUNNING_ROUTERS.delete(providerId);
	const pid = running?.child?.pid;
	if (!running || running.child === null || pid === undefined) {
		return;
	}
	if (process.platform === "win32") {
		terminateProcessForTimeout(running.child);
	} else {
		try {
			process.kill(-pid, "SIGTERM");
		} catch {
			running.child.kill("SIGTERM");
		}
	}
	await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
}

/** Shuts every seat router down; wired into the runtime's exit path. */
export async function stopAllSeatRouters(): Promise<void> {
	await Promise.all([...RUNNING_ROUTERS.keys()].map((providerId) => stopSeatRouter(providerId)));
}
