// The supervision core shared by every agent-stack daemon the runtime owns:
// the switchboard, headroom, CCR, DevTools.
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

export interface StackProcess {
	/** Null when the daemon was already listening or could not be started. */
	pid: number | null;
	/** True when this runtime spawned the service (and therefore owns shutdown). */
	spawned: boolean;
	/** Resolves true once the port answers; never rejects. Callers need not await it. */
	ready: Promise<boolean>;
	close: () => Promise<void>;
}

export function createNoopProcess(isAlreadyUp: boolean): StackProcess {
	return {
		pid: null,
		spawned: false,
		ready: Promise.resolve(isAlreadyUp),
		close: async () => {},
	};
}

/**
 * Every stack daemon inherits the runtime's environment, which — when Kanban was
 * launched from a shell that sourced `activate-stack.sh` — contains
 * `ANTHROPIC_BASE_URL` pointing at the switchboard and the sandbox's dummy API
 * key. Neither is read by `server.py` (it resolves its upstream from `STACK_*`
 * vars), and forwarding a dummy credential to a proxy is exactly the confusion the
 * sandbox's real-key handling exists to avoid, so both are dropped rather than
 * passed through. For headroom the inherited base URL is worse than useless: it
 * would dial the very proxy that fronts it.
 */
export function buildStackEnv(): NodeJS.ProcessEnv {
	const { ANTHROPIC_BASE_URL: _baseUrl, ANTHROPIC_API_KEY: _apiKey, ...rest } = process.env;
	return rest;
}

/** Last entry is the cap: a daemon that keeps dying should not be retried every second forever. */
const RESTART_BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 30_000];
/** A binary that dies in milliseconds every time is a config error, not a blip — stop retrying. */
const MAX_CONSECUTIVE_FAILURES = 5;
/** Uptime past which a crash counts as a fresh incident rather than part of a failing streak. */
const HEALTHY_UPTIME_MS = 60_000;
const DEFAULT_STARTUP_TIMEOUT_MS = 20_000;
/** How often a daemon we did not spawn is re-probed. Cheap: one loopback connect. */
const ADOPTED_POLL_INTERVAL_MS = 5_000;
/**
 * Consecutive failed probes before we take a port over. One is not enough: a
 * daemon with a full accept queue, or one being restarted by its own owner,
 * refuses a connection without being gone.
 */
const ADOPTED_FAILURES_BEFORE_TAKEOVER = 2;

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
	/**
	 * What this daemon's *upstream* was fixed to at launch, recorded in
	 * `logs/<name>.chain` for `server.py` to read back.
	 *
	 * Args are frozen when the process starts, but `stack-flags.json` can change
	 * underneath it. Headroom is the case that bit: started while `ENABLE_CCR` was on
	 * it holds `--anthropic-api-url http://127.0.0.1:3456` forever, so turning CCR off
	 * left `resolve_route` still sending every request through a CCR the user had
	 * disabled — the flag appeared to work while nothing about the actual path changed.
	 */
	chainState?: string;
	/** Layered on top of `buildStackEnv()`; CCR needs `HOME` scoped to `ccr-home/`. */
	env?: Record<string, string>;
	startupTimeoutMs?: number;
	/** How often an adopted (not-spawned-by-us) port is re-probed. Tests shorten it. */
	adoptedPollIntervalMs?: number;
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
 * Publishes `spec.chainState` so the switchboard can compare the daemon's real
 * upstream against the current flags instead of assuming they still agree.
 * Written next to the pidfile and removed with it, so a marker without a live
 * daemon cannot outlive the process it describes.
 */
function writeDaemonChainFile(spec: StackDaemonSpec): void {
	if (spec.chainState === undefined) {
		return;
	}
	try {
		mkdirSync(join(spec.stackRoot, "logs"), { recursive: true });
		writeFileSync(join(spec.stackRoot, "logs", `${spec.name}.chain`), `${spec.chainState}\n`, "utf8");
	} catch {
		// Unknown chain state degrades to the old assume-flags-match behaviour.
	}
}

function removeDaemonChainFile(spec: StackDaemonSpec): void {
	if (spec.chainState === undefined) {
		return;
	}
	try {
		rmSync(join(spec.stackRoot, "logs", `${spec.name}.chain`), { force: true });
	} catch {
		// Best effort, same as the pidfile.
	}
}

/**
 * Starts one stack daemon unless its port is already served, and keeps it alive
 * with a backoff restart. A port that is already served is adopted rather than
 * ignored: we do not double-bind it, but we keep probing it and take over if its
 * original owner goes away. Never throws: a daemon that cannot start degrades to a
 * warning, because `server.py` routes around dead hops and the board must keep
 * running either way.
 */
export async function superviseStackDaemon(
	spec: StackDaemonSpec,
	deps: StackDaemonDependencies,
): Promise<StackProcess> {
	const log = deps.log ?? (() => {});
	const logPath = join(spec.stackRoot, "logs", `${spec.name}.log`);

	let child: ChildProcess | null = null;
	let shuttingDown = false;
	let gaveUp = false;
	/** True once we have spawned a child of our own, so `close()` knows whose pidfile it may remove. */
	let owned = false;
	let consecutiveFailures = 0;
	let restartTimer: NodeJS.Timeout | null = null;
	let watchTimer: NodeJS.Timeout | null = null;

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

		owned = true;
		if (spawned.pid !== undefined) {
			writeDaemonPidFile(spec, spawned.pid);
			writeDaemonChainFile(spec);
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
				removeDaemonChainFile(spec);
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

	const close = async (): Promise<void> => {
		shuttingDown = true;
		if (restartTimer !== null) {
			clearTimeout(restartTimer);
			restartTimer = null;
		}
		if (watchTimer !== null) {
			clearTimeout(watchTimer);
			watchTimer = null;
		}
		const running = child;
		child = null;
		if (owned) {
			// Only ours to clear. An adopted daemon's pidfile belongs to whoever
			// started it — an activated shell, or a previous runtime.
			removeDaemonPidFile(spec);
			removeDaemonChainFile(spec);
		}
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
	};

	/**
	 * Keeps watching a port we did not open. Without this, a boot-time probe decided
	 * ownership for the whole session: a daemon started by a sourced
	 * `activate-stack.sh` that died an hour later was never restarted and never
	 * reported, and — for the switchboard — every agent turn then failed with
	 * ECONNREFUSED against `ANTHROPIC_BASE_URL`.
	 */
	const watchAdoptedDaemon = (): void => {
		const intervalMs = spec.adoptedPollIntervalMs ?? ADOPTED_POLL_INTERVAL_MS;
		let missedProbes = 0;
		const scheduleProbe = (): void => {
			watchTimer = setTimeout(() => {
				watchTimer = null;
				void (async () => {
					if (shuttingDown) {
						return;
					}
					if (await probePort(spec.host, spec.port)) {
						missedProbes = 0;
						scheduleProbe();
						return;
					}
					missedProbes += 1;
					if (missedProbes < ADOPTED_FAILURES_BEFORE_TAKEOVER) {
						scheduleProbe();
						return;
					}
					// `close()` may have run while the probe was in flight.
					if (shuttingDown) {
						return;
					}
					deps.warn(
						`${spec.label} disappeared from ${spec.host}:${String(spec.port)} — taking it over and supervising it from here.`,
					);
					child = launch();
				})();
			}, intervalMs);
			watchTimer.unref();
		};
		scheduleProbe();
	};

	if (await probePort(spec.host, spec.port)) {
		log(`${spec.label} already listening on ${spec.host}:${String(spec.port)} — using the running service.`);
		watchAdoptedDaemon();
		return { pid: null, spawned: false, ready: Promise.resolve(true), close };
	}

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

	return { pid: child.pid ?? null, spawned: true, ready, close };
}
