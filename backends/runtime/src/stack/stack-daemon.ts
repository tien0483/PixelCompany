// The supervision core shared by every agent-stack daemon the runtime owns
// besides the switchboard: headroom, CCR, DevTools.
//
// `activate-stack.sh` supervises these through pidfiles in a shell that has to
// stay sourced; the runtime needs the same daemons without that shell, and needs
// them to come back after a crash. Everything here is deliberately identical to
// the activator's behaviour — same ports, same args, same pidfiles — so the two
// entry points can be used interchangeably and neither double-binds a port.
import { type ChildProcess, spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { terminateProcessForTimeout } from "../server/process-termination";
import { probePort, waitForPort } from "./stack-ports";
import { buildStackEnv, createNoopProcess, type StackProcess } from "./stack-process";

/** Last entry is the cap: a daemon that keeps dying should not be retried every second forever. */
const RESTART_BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 30_000];
/** A binary that dies in milliseconds every time is a config error, not a blip — stop retrying. */
const MAX_CONSECUTIVE_FAILURES = 5;
/** Uptime past which a crash counts as a fresh incident rather than part of a failing streak. */
const HEALTHY_UPTIME_MS = 60_000;
const DEFAULT_STARTUP_TIMEOUT_MS = 20_000;

export interface StackDaemonSpec {
	/** Also the `logs/<name>.log` / `logs/<name>.pid` basename the activator uses. */
	name: string;
	/** Human label for log lines, e.g. "Headroom". */
	label: string;
	stackRoot: string;
	host: string;
	port: number;
	binary: string;
	args: string[];
	/** Layered on top of `buildStackEnv()`; CCR needs `HOME` scoped to `ccr-home/`. */
	env?: Record<string, string>;
	startupTimeoutMs?: number;
	/** Appended to the "did not open its port" warning, e.g. a config hint. */
	readinessHint?: string;
}

export interface StackDaemonDependencies {
	warn: (message: string) => void;
	log?: (message: string) => void;
}

/**
 * Reads `stack-flags.json`, the same file the Stack Control dialog writes and
 * `server.py` re-reads per request. Null means "unreadable", which the activator
 * treats as every tool ON (`stack_flag()` prints `1` on exception) — a corrupt
 * flags file must not silently disable the stack.
 */
export function readStackFlags(stackRoot: string): Record<string, unknown> | null {
	try {
		const parsed: unknown = JSON.parse(readFileSync(join(stackRoot, "stack-flags.json"), "utf8"));
		return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
	} catch {
		return null;
	}
}

/**
 * Matches the activator's semantics exactly, including the asymmetry: an
 * unreadable file defaults ON, but a key absent from a readable file is OFF
 * (`json.load(f).get(name)` → `None`).
 */
export function isStackFlagEnabled(flags: Record<string, unknown> | null, name: string): boolean {
	if (flags === null) {
		return true;
	}
	return Boolean(flags[name]);
}

/** Reads one of the activator's `STACK_*_PORT` overrides, falling back to its default. */
export function resolveStackDaemonPort(envKey: string, fallback: number, configured?: number | undefined): number {
	if (configured !== undefined) {
		return configured;
	}
	const fromEnv = process.env[envKey]?.trim();
	if (fromEnv && /^\d+$/.test(fromEnv)) {
		return Number(fromEnv);
	}
	return fallback;
}

export function nextRestartDelayMs(consecutiveFailures: number): number {
	const index = Math.min(Math.max(consecutiveFailures, 1), RESTART_BACKOFF_MS.length) - 1;
	return RESTART_BACKOFF_MS[index] ?? RESTART_BACKOFF_MS[RESTART_BACKOFF_MS.length - 1] ?? 30_000;
}

export function shouldGiveUpRestarting(consecutiveFailures: number): boolean {
	return consecutiveFailures > MAX_CONSECUTIVE_FAILURES;
}

/**
 * Appends to `logs/<name>.log` instead of discarding output the way the
 * switchboard supervisor does. That file is the only diagnostic for a daemon that
 * dies during startup — headroom's `ImportError: 'h2' package is not installed`
 * era was only debuggable because the activator kept it.
 */
function openDaemonLogFd(spec: StackDaemonSpec, warn: (message: string) => void): number | null {
	try {
		const logDir = join(spec.stackRoot, "logs");
		mkdirSync(logDir, { recursive: true });
		return openSync(join(logDir, `${spec.name}.log`), "a");
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		warn(`Could not open the ${spec.label} log file: ${message} — its output will be discarded.`);
		return null;
	}
}

/**
 * Keeps `logs/<name>.pid` truthful. Without it, `stop-stack.sh` cannot stop a
 * runtime-spawned daemon, and a later `source activate-stack.sh` reads the stale
 * pid, concludes the daemon is down and tries to double-bind its port.
 */
function writeDaemonPidFile(spec: StackDaemonSpec, pid: number): void {
	try {
		mkdirSync(join(spec.stackRoot, "logs"), { recursive: true });
		writeFileSync(join(spec.stackRoot, "logs", `${spec.name}.pid`), `${String(pid)}\n`, "utf8");
	} catch {
		// A missing pidfile only costs `stop-stack.sh` its handle on us.
	}
}

function removeDaemonPidFile(spec: StackDaemonSpec): void {
	try {
		rmSync(join(spec.stackRoot, "logs", `${spec.name}.pid`), { force: true });
	} catch {
		// Best effort; a stale pidfile is cleared by the activator on next start.
	}
}

/**
 * Starts one stack daemon unless its port is already served, and keeps it alive
 * with a backoff restart. Never throws: a daemon that cannot start degrades to a
 * warning, because `server.py` routes around dead hops and the board must keep
 * running either way.
 */
export async function superviseStackDaemon(
	spec: StackDaemonSpec,
	deps: StackDaemonDependencies,
): Promise<StackProcess> {
	const log = deps.log ?? (() => {});
	const logPath = join(spec.stackRoot, "logs", `${spec.name}.log`);

	if (await probePort(spec.host, spec.port)) {
		log(`${spec.label} already listening on ${spec.host}:${String(spec.port)} — using the running service.`);
		return createNoopProcess(true);
	}

	let child: ChildProcess | null = null;
	let shuttingDown = false;
	let gaveUp = false;
	let consecutiveFailures = 0;
	let restartTimer: NodeJS.Timeout | null = null;

	const launch = (): ChildProcess | null => {
		const logFd = openDaemonLogFd(spec, deps.warn);
		const stdio: ("ignore" | number)[] = ["ignore", logFd ?? "ignore", logFd ?? "ignore"];
		let spawned: ChildProcess;
		try {
			spawned = spawn(spec.binary, spec.args, {
				cwd: spec.stackRoot,
				env: { ...buildStackEnv(), ...spec.env },
				stdio,
				shell: false,
				windowsHide: true,
				detached: process.platform !== "win32",
			});
		} catch (error) {
			if (logFd !== null) {
				closeSync(logFd);
			}
			const message = error instanceof Error ? error.message : String(error);
			deps.warn(`Could not launch ${spec.label} (${spec.binary}): ${message}`);
			gaveUp = true;
			return null;
		}

		if (spawned.pid !== undefined) {
			writeDaemonPidFile(spec, spawned.pid);
		}

		const startedAt = Date.now();
		// `error` and `exit` can both fire for one launch (and on ENOENT only
		// `error` does), so the handler is idempotent per child.
		let settled = false;
		const handleGone = (reason: string) => {
			if (settled) {
				return;
			}
			settled = true;
			if (logFd !== null) {
				try {
					closeSync(logFd);
				} catch {
					// Already closed with the process group.
				}
			}
			if (shuttingDown) {
				return;
			}
			child = null;
			if (Date.now() - startedAt >= HEALTHY_UPTIME_MS) {
				consecutiveFailures = 0;
			}
			consecutiveFailures += 1;
			if (shouldGiveUpRestarting(consecutiveFailures)) {
				gaveUp = true;
				deps.warn(
					`${spec.label} died ${String(consecutiveFailures)} times in a row (${reason}) — not restarting it again. See ${logPath}.`,
				);
				removeDaemonPidFile(spec);
				return;
			}
			const delay = nextRestartDelayMs(consecutiveFailures);
			deps.warn(`${spec.label} died (${reason}) — restarting in ${String(Math.round(delay / 1000))}s.`);
			restartTimer = setTimeout(() => {
				restartTimer = null;
				child = launch();
			}, delay);
			restartTimer.unref();
		};

		spawned.once("exit", (code, signal) => {
			handleGone(code === null ? `signal ${String(signal)}` : `code ${String(code)}`);
		});
		spawned.once("error", (error) => {
			handleGone(error.message);
		});
		return spawned;
	};

	log(`Starting ${spec.label}: ${spec.binary} ${spec.args.join(" ")}`);
	child = launch();
	if (child === null) {
		return createNoopProcess(false);
	}

	const ready = waitForPort(
		spec.host,
		spec.port,
		spec.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS,
		() => !gaveUp,
	).then((isUp) => {
		if (isUp) {
			log(`${spec.label} listening on ${spec.host}:${String(spec.port)}.`);
			return true;
		}
		deps.warn(`${spec.label} did not open ${spec.host}:${String(spec.port)}${spec.readinessHint ?? ""}`);
		deps.warn(`  Check ${logPath}`);
		return false;
	});

	return {
		pid: child.pid ?? null,
		spawned: true,
		ready,
		close: async () => {
			shuttingDown = true;
			if (restartTimer !== null) {
				clearTimeout(restartTimer);
				restartTimer = null;
			}
			const running = child;
			child = null;
			removeDaemonPidFile(spec);
			const pid = running?.pid;
			if (running === null || pid === undefined) {
				return;
			}
			if (process.platform === "win32") {
				terminateProcessForTimeout(running);
			} else {
				try {
					// Detached, so the whole group goes: `ccr start` and headroom's
					// worker both fork children that would otherwise keep the port
					// bound after the parent dies.
					process.kill(-pid, "SIGTERM");
				} catch {
					running.kill("SIGTERM");
				}
			}
			await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
		},
	};
}
