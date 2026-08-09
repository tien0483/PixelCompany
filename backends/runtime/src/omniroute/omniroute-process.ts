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
import { DEFAULT_OMNIROUTE_HOST, resolveOmniRoutePort } from "./omniroute-endpoint";

const PORT_PROBE_TIMEOUT_MS = 1_000;
const STARTUP_TIMEOUT_MS = 30_000;
const PORT_POLL_INTERVAL_MS = 250;

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
	let child: ChildProcess;
	let errBuffer = "";
	try {
		child = spawn("npx", ["tsx", "scripts/dev/run-next.mjs", "dev", "--port", String(port)], {
			cwd: omniRouteRoot,
			env: {
				...process.env,
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

		child.stderr?.on("data", (chunk: Buffer) => {
			errBuffer += chunk.toString();
		});
		child.stdout?.on("data", (chunk: Buffer) => {
			errBuffer += chunk.toString();
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		deps.warn(`Could not launch OmniRoute: ${message}`);
		return createNoopProcess(false);
	}

	let exited = false;
	child.once("exit", (code) => {
		exited = true;
		if (code !== 0 && code !== null) {
			const details = errBuffer.trim().length > 0 ? `: ${errBuffer.trim().slice(-500)}` : "";
			deps.warn(`OmniRoute process exited (code ${code})${details}`);
		}
	});
	child.once("error", (error) => {
		exited = true;
		deps.warn(`Could not launch OmniRoute: ${error.message}`);
	});

	const ready = waitForPort(host, port, STARTUP_TIMEOUT_MS, () => !exited).then((isUp) => {
		if (isUp) {
			log(`OmniRoute listening on ${host}:${port}.`);
			return true;
		}
		deps.warn(`OmniRoute did not open ${host}:${port} within timeout.`);
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
