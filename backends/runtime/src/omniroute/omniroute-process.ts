// Supervises the OmniRoute Node service so a single PixelCompany launch brings up
// OmniRoute alongside the manager and runtime.
//
// OmniRoute is optional by construction: if node or the package is missing or fails to start,
// the runtime keeps running and OmniRoute seats report degraded status.

import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { connect } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { terminateProcessForTimeout } from "../server/process-termination";
import { nextRestartDelayMs, shouldGiveUpRestarting } from "../stack/stack-daemon";
import { DEFAULT_OMNIROUTE_HOST, resolveOmniRoutePort } from "./omniroute-endpoint";

const PORT_PROBE_TIMEOUT_MS = 1_000;
const STARTUP_TIMEOUT_MS = 30_000;
const PORT_POLL_INTERVAL_MS = 250;

/**
 * OmniRoute is a Next dev server (Turbopack) plus ~15 eager boot services, and
 * `backends/OmniRoute/package.json` sizes its own `dev` script at
 * `--max-old-space-size=8192`. We do not go through that script — we spawn
 * `run-next.mjs` directly — so without this the child runs on V8's default
 * old-space cap (~2 GB on a machine this size) and dies with
 * `FATAL ERROR: Reached heap limit` right as the dev server finishes booting.
 *
 * 4096 rather than the manifest's 8192: the runtime, the manager, an HTML Next
 * sidecar, headroom and the switchboard all share this box, so an 8 GB ceiling
 * only trades a V8 OOM for the kernel OOM-killer taking something else out.
 */
const DEFAULT_MAX_OLD_SPACE_MB = 4_096;

/**
 * The child's stdout/stderr are buffered so a startup failure can be reported.
 * A Next dev server logs every compile and every request, so an uncapped buffer
 * is an unbounded string living in the *runtime* process for the whole session.
 */
const MAX_ERR_BUFFER_BYTES = 64 * 1024;

/** A child that stays up this long is considered healthy; the backoff resets. */
const HEALTHY_UPTIME_MS = 60_000;

function resolveMaxOldSpaceMb(): number {
	const configured = Number(process.env.OMNIROUTE_MAX_OLD_SPACE_MB);
	return Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : DEFAULT_MAX_OLD_SPACE_MB;
}

export function buildOmniRouteNodeOptions(): string {
	return [process.env.NODE_OPTIONS, `--max-old-space-size=${String(resolveMaxOldSpaceMb())}`]
		.filter((part): part is string => Boolean(part && part.trim()))
		.join(" ");
}

export interface OmniRouteProcess {
	/** Null when OmniRoute was already listening or could not be started. */
	pid: number | null;
	/** True when this runtime spawned the service (and therefore owns shutdown). */
	spawned: boolean;
	/** Resolves true once the port answers; never rejects. Callers need not await it. */
	ready: Promise<boolean>;
	close: () => Promise<void>;
}

export interface StartOmniRouteProcessDependencies {
	warn: (message: string) => void;
	log?: (message: string) => void;
	/** Overrides `backends/OmniRoute` discovery. */
	omniRouteRoot?: string | null;
	host?: string;
	port?: number;
}

export function findOmniRouteRoot(): string | null {
	const here = dirname(fileURLToPath(import.meta.url));
	const candidates = [
		resolve(here, "../../../OmniRoute"),
		resolve(here, "../../../../OmniRoute"),
		resolve(here, "../../OmniRoute"),
	];
	for (const candidate of candidates) {
		if (existsSync(join(candidate, "package.json")) && existsSync(join(candidate, "bin", "omniroute.mjs"))) {
			return candidate;
		}
	}
	return null;
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

function createNoopProcess(isAlreadyUp: boolean): OmniRouteProcess {
	return {
		pid: null,
		spawned: false,
		ready: Promise.resolve(isAlreadyUp),
		close: async () => {},
	};
}

export async function startOmniRouteProcess(deps: StartOmniRouteProcessDependencies): Promise<OmniRouteProcess> {
	const host = deps.host ?? DEFAULT_OMNIROUTE_HOST;
	const port = deps.port ?? resolveOmniRoutePort();
	const log = deps.log ?? (() => {});

	if (await probePort(host, port)) {
		log(`OmniRoute already listening on ${host}:${port} — using the running service.`);
		return createNoopProcess(true);
	}

	const omniRouteRoot = deps.omniRouteRoot === undefined ? findOmniRouteRoot() : deps.omniRouteRoot;
	if (!omniRouteRoot) {
		deps.warn("OmniRoute package not found under backends/OmniRoute — OmniRoute service offline.");
		return createNoopProcess(false);
	}

	log(`Starting OmniRoute service from ${omniRouteRoot} on port ${port}...`);

	let child: ChildProcess | null = null;
	let errBuffer = "";
	let shuttingDown = false;
	let gaveUp = false;
	let consecutiveFailures = 0;
	let restartTimer: NodeJS.Timeout | null = null;

	const appendOutput = (chunk: Buffer) => {
		errBuffer = (errBuffer + chunk.toString()).slice(-MAX_ERR_BUFFER_BYTES);
	};

	/**
	 * Spawns one OmniRoute child and arms its restart. Returns null only when the
	 * spawn itself threw, which is the one failure the caller has to react to
	 * synchronously (there is nothing to supervise).
	 */
	const launch = (): ChildProcess | null => {
		let spawned: ChildProcess;
		try {
			spawned = spawn("npx", ["tsx", "scripts/dev/run-next.mjs", "dev", "--port", String(port)], {
				cwd: omniRouteRoot,
				env: {
					...process.env,
					NODE_OPTIONS: buildOmniRouteNodeOptions(),
					PORT: String(port),
					OMNIROUTE_PORT: String(port),
					DASHBOARD_PORT: String(port),
					API_PORT: String(port),
					HOST: host,
				},
				stdio: ["ignore", "pipe", "pipe"],
				shell: process.platform === "win32",
				windowsHide: true,
				detached: process.platform !== "win32",
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			deps.warn(`Could not launch OmniRoute: ${message}`);
			gaveUp = true;
			return null;
		}

		child = spawned;
		spawned.stderr?.on("data", appendOutput);
		spawned.stdout?.on("data", appendOutput);

		const startedAt = Date.now();
		// `error` and `exit` can both fire for a single launch (and on ENOENT only
		// `error` does), so this stays idempotent per child.
		let settled = false;
		const handleGone = (reason: string) => {
			if (settled) {
				return;
			}
			settled = true;
			if (child === spawned) {
				child = null;
			}
			if (shuttingDown) {
				return;
			}

			// A child that stayed up long enough to be useful starts the backoff over.
			consecutiveFailures = Date.now() - startedAt >= HEALTHY_UPTIME_MS ? 1 : consecutiveFailures + 1;
			const details = errBuffer.trim().length > 0 ? `: ${errBuffer.trim().slice(-500)}` : "";

			if (shouldGiveUpRestarting(consecutiveFailures)) {
				gaveUp = true;
				deps.warn(`OmniRoute ${reason} and keeps failing — not restarting it again${details}`);
				return;
			}

			const delayMs = nextRestartDelayMs(consecutiveFailures);
			deps.warn(`OmniRoute ${reason} — restarting in ${String(delayMs)}ms${details}`);
			errBuffer = "";
			restartTimer = setTimeout(() => {
				restartTimer = null;
				if (!shuttingDown) {
					launch();
				}
			}, delayMs);
			restartTimer.unref();
		};

		spawned.once("exit", (code, signal) => {
			// A V8 heap-limit abort or a kernel OOM-kill arrives as a signal with a
			// null exit code — the case the previous handler stayed completely silent
			// about, so OmniRoute simply vanished with no line in the log.
			handleGone(
				signal !== null
					? `process was killed (${signal}) — likely out of memory; raise OMNIROUTE_MAX_OLD_SPACE_MB (currently ${String(resolveMaxOldSpaceMb())})`
					: `process exited (code ${String(code)})`,
			);
		});
		spawned.once("error", (error) => {
			handleGone(`could not be launched: ${error.message}`);
		});

		return spawned;
	};

	const firstChild = launch();
	if (!firstChild) {
		return createNoopProcess(false);
	}

	const firstPid = firstChild.pid ?? null;

	const ready = waitForPort(host, port, STARTUP_TIMEOUT_MS, () => !gaveUp && !shuttingDown).then((isUp) => {
		if (isUp) {
			log(`OmniRoute listening on ${host}:${port}.`);
			return true;
		}
		deps.warn(`OmniRoute did not open ${host}:${port} within timeout.`);
		return false;
	});

	return {
		pid: firstPid,
		spawned: true,
		ready,
		close: async () => {
			shuttingDown = true;
			if (restartTimer) {
				clearTimeout(restartTimer);
				restartTimer = null;
			}
			const current = child;
			const pid = current?.pid;
			if (!current || pid === undefined) {
				return;
			}
			if (process.platform === "win32") {
				terminateProcessForTimeout(current);
			} else {
				try {
					process.kill(-pid, "SIGTERM");
				} catch {
					current.kill("SIGTERM");
				}
			}
			await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
		},
	};
}
