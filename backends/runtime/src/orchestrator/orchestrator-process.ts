// Optional DeepSeek Harness web sidecar on loopback :3020. Task orchestration normally runs
// headless in the task PTY; this process is for status/debug only and is gated on dsh being
// installed plus PIXELOFFICE_DSH_WEB=1.
import { type ChildProcess, spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync } from "node:fs";
import { join } from "node:path";

import { terminateProcessForTimeout } from "../server/process-termination";
import { readBrandEnv } from "../brand";
import { nextRestartDelayMs, shouldGiveUpRestarting } from "../stack/stack-daemon";
import { probePort, waitForPort } from "../stack/stack-ports";
import { buildDshArgv, resolveDshBinary } from "./dsh-binary";
import { DEFAULT_DSH_HOST, resolveDefaultDshHome, resolveDshWebPort } from "./dsh-endpoint";
import { ensureDshHome } from "./orchestrator-launch";

const STARTUP_TIMEOUT_MS = 120_000;
const HEALTHY_UPTIME_MS = 60_000;

export interface OrchestratorProcess {
	pid: number | null;
	spawned: boolean;
	ready: Promise<boolean>;
	close: () => Promise<void>;
}

export interface StartOrchestratorProcessDependencies {
	warn: (message: string) => void;
	log?: (message: string) => void;
	host?: string;
	port?: number;
}

function isWebSidecarEnabled(): boolean {
	const raw = readBrandEnv("DSH_WEB")?.trim().toLowerCase();
	return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function openLog(dshHome: string): { fd: number; path: string } | null {
	const path = join(dshHome, "web.log");
	try {
		mkdirSync(dshHome, { recursive: true });
		return { fd: openSync(path, "a"), path };
	} catch {
		return null;
	}
}

function createNoopProcess(isAlreadyUp: boolean): OrchestratorProcess {
	return {
		pid: null,
		spawned: false,
		ready: Promise.resolve(isAlreadyUp),
		close: async () => {},
	};
}

export async function startOrchestratorProcess(
	deps: StartOrchestratorProcessDependencies,
): Promise<OrchestratorProcess> {
	if (!isWebSidecarEnabled()) {
		deps.log?.("Orchestrator web sidecar disabled (set PIXTIEL_DSH_WEB=1 to listen on :3020).");
		return createNoopProcess(false);
	}

	const host = deps.host ?? DEFAULT_DSH_HOST;
	const port = resolveDshWebPort(deps.port);
	const log = deps.log ?? (() => {});

	if (await probePort(host, port)) {
		log(`Orchestrator web already listening on ${host}:${port}.`);
		return createNoopProcess(true);
	}

	const binary = resolveDshBinary();
	if (binary === null) {
		deps.warn("dsh not installed — orchestrator web sidecar skipped.");
		return createNoopProcess(false);
	}

	const dshHome = resolveDefaultDshHome();
	await ensureDshHome(dshHome);

	const webArgs = ["--profile", "web", "--port", String(port), "--host", host];
	const { command, args } = buildDshArgv(binary, webArgs);
	const env: NodeJS.ProcessEnv = {
		...process.env,
		DSH_HOME: dshHome,
		PORT: String(port),
	};
	delete env.ANTHROPIC_API_KEY;
	delete env.ANTHROPIC_BASE_URL;

	let child: ChildProcess | null = null;
	let stopped = false;
	let consecutiveFailures = 0;
	let restartTimer: NodeJS.Timeout | null = null;
	let readyResolved = false;
	let resolveReady: (value: boolean) => void = () => {};
	const ready = new Promise<boolean>((resolvePromise) => {
		resolveReady = (value: boolean) => {
			if (!readyResolved) {
				readyResolved = true;
				resolvePromise(value);
			}
		};
	});

	const spawnWeb = (): void => {
		if (stopped) {
			return;
		}
		const webLog = openLog(dshHome);
		let spawned: ChildProcess;
		try {
			spawned = spawn(command, args, {
				cwd: dshHome,
				env,
				stdio: webLog === null ? "ignore" : ["ignore", webLog.fd, webLog.fd],
				shell: false,
				windowsHide: true,
				detached: process.platform !== "win32",
			});
		} catch (error) {
			deps.warn(`Could not launch orchestrator web: ${error instanceof Error ? error.message : String(error)}`);
			resolveReady(false);
			return;
		} finally {
			if (webLog !== null) {
				try {
					closeSync(webLog.fd);
				} catch {
					// ignore
				}
			}
		}
		child = spawned;
		const startedAt = Date.now();
		let exited = false;

		spawned.once("exit", (code, signal) => {
			exited = true;
			child = null;
			if (Date.now() - startedAt >= HEALTHY_UPTIME_MS) {
				consecutiveFailures = 0;
			} else {
				consecutiveFailures += 1;
			}
			if (stopped) {
				return;
			}
			const how = signal !== null ? `signal ${signal}` : `code ${code ?? "unknown"}`;
			if (shouldGiveUpRestarting(consecutiveFailures)) {
				deps.warn(`Orchestrator web keeps exiting (${how}) — giving up.`);
				resolveReady(false);
				return;
			}
			const delay = nextRestartDelayMs(consecutiveFailures);
			deps.warn(`Orchestrator web exited (${how}) — restarting in ${Math.round(delay / 1000)}s.`);
			restartTimer = setTimeout(spawnWeb, delay);
		});

		void waitForPort(host, port, STARTUP_TIMEOUT_MS, () => !exited && !stopped).then((isUp) => {
			if (isUp) {
				log(`Orchestrator web listening on ${host}:${port}.`);
				resolveReady(true);
				return;
			}
			if (!stopped) {
				deps.warn(`Orchestrator web did not open ${host}:${port} within ${STARTUP_TIMEOUT_MS / 1000}s.`);
				resolveReady(false);
			}
		});
	};

	log("Starting orchestrator web sidecar (DeepSeek Harness).");
	spawnWeb();

	return {
		get pid() {
			return child?.pid ?? null;
		},
		spawned: true,
		ready,
		close: async () => {
			stopped = true;
			if (restartTimer !== null) {
				clearTimeout(restartTimer);
				restartTimer = null;
			}
			const running = child;
			const pid = running?.pid;
			if (running === null || pid === undefined) {
				return;
			}
			if (process.platform === "win32") {
				terminateProcessForTimeout(running);
			} else {
				try {
					process.kill(-pid, "SIGTERM");
				} catch {
					running.kill("SIGTERM");
				}
			}
			await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
		},
	};
}
