// Supervises the forked Flowise agent studio (`backends/flowise`, a git submodule) so a
// single PixelOffice launch brings the Agents tab's backend up on loopback. Optional by
// construction: an uninitialized submodule or an unbuilt server only means the tab reports
// "not installed", exactly like the HTML and docs sidecars.
//
// Deliberately not `superviseStackDaemon`: that one assumes an agent-stack root with a
// `logs/` dir and its own pidfile protocol. This follows `html-process.ts` instead, and
// borrows only the backoff arithmetic from `stack/stack-daemon.ts` — the pairing
// `AGENTS.md` (`spawned-services-lose-their-package-json-flags`) prescribes for a
// non-stack service.
import { type ChildProcess, spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync } from "node:fs";
import { join } from "node:path";

import { terminateProcessForTimeout } from "../server/process-termination";
import { nextRestartDelayMs, shouldGiveUpRestarting } from "../stack/stack-daemon";
import { probePort, waitForPort } from "../stack/stack-ports";
import { DEFAULT_FLOWISE_HOST, findFlowiseRoot, resolveFlowisePort } from "./flowise-endpoint";
import { describeMissingStudioNode, resolveStudioNodeBinary } from "./flowise-node";

/**
 * Flowise boots TypeORM plus its whole node/component registry before it listens, which is
 * far slower than a `next start`. The same 9p/drvfs penalty the HTML sidecar documents
 * applies here and then some, so the budget is generous — `waitForPort` returns as soon as
 * the child exits, so a genuinely broken studio is still reported promptly.
 */
const DEFAULT_STARTUP_TIMEOUT_MS = 180_000;
const STARTUP_TIMEOUT_ENV = "PIXELOFFICE_FLOWISE_STARTUP_TIMEOUT_MS";
/** Emit a "still starting" line this far in, so a slow first boot doesn't read as a hang. */
const SLOW_START_NOTICE_MS = 20_000;
/** A child that survives this long resets the failure count, so backoff tracks real flapping. */
const HEALTHY_UPTIME_MS = 60_000;
const INSTALL_HINT = [
	"  Init the fork:  git submodule update --init backends/flowise",
	"  Then build:     cd backends/flowise && pnpm install && pnpm build",
];

export interface FlowiseProcess {
	/** Null when the studio was already listening or could not be started. */
	pid: number | null;
	/** True when this runtime spawned the service (and therefore owns shutdown). */
	spawned: boolean;
	/** Resolves true once the port answers; never rejects. Callers need not await it. */
	ready: Promise<boolean>;
	close: () => Promise<void>;
}

export interface StartFlowiseProcessDependencies {
	warn: (message: string) => void;
	log?: (message: string) => void;
	/** Overrides `backends/flowise` discovery; mainly for tests. */
	flowiseRoot?: string | null;
	host?: string;
	port?: number;
}

function resolveStartupTimeoutMs(): number {
	const raw = process.env[STARTUP_TIMEOUT_ENV]?.trim();
	return raw !== undefined && /^\d+$/.test(raw) && Number(raw) > 0 ? Number(raw) : DEFAULT_STARTUP_TIMEOUT_MS;
}

/**
 * The studio is spawned detached so it outlives the runtime, which rules out piping its
 * output through this process — the child would write into a broken pipe once the parent
 * goes away. A log file keeps its crashes readable.
 */
function openStudioLog(dataDir: string): { fd: number; path: string } | null {
	const path = join(dataDir, "studio.log");
	try {
		return { fd: openSync(path, "a"), path };
	} catch {
		return null;
	}
}

/**
 * Everything Flowise persists is redirected under `<root>/.flowise` — sqlite DB, the
 * credential encryption key, API keys, logs, uploads. That path is gitignored, which is
 * load-bearing: `syncIgnoredPathsIntoWorktree` then symlinks it into every task worktree,
 * so all tasks share one studio instead of each growing its own database.
 *
 * `ANTHROPIC_BASE_URL`/`ANTHROPIC_API_KEY` are stripped on purpose. `scripts/solo.mjs`
 * exports the base URL so *task agents* traverse the stack chain; inheriting it here would
 * silently route every Anthropic node in every flow through the switchboard. Billing a
 * flow to a chosen seat is a per-credential decision inside the studio, not an ambient one.
 */
/** Loopback hostnames browsers treat as distinct origins for CSP frame-ancestors. */
function resolvePixelOfficeEmbedOrigins(pixelOfficePort: string): string {
	return [`http://127.0.0.1:${pixelOfficePort}`, `http://localhost:${pixelOfficePort}`].join(",");
}

function buildStudioEnv(dataDir: string, host: string, port: number, pixelOfficePort: string): NodeJS.ProcessEnv {
	const embedOrigins = resolvePixelOfficeEmbedOrigins(pixelOfficePort);
	const env: NodeJS.ProcessEnv = {
		...process.env,
		NODE_ENV: "production",
		PORT: String(port),
		FLOWISE_HOST: host,
		DATABASE_PATH: dataDir,
		SECRETKEY_PATH: dataDir,
		APIKEY_PATH: dataDir,
		LOG_PATH: join(dataDir, "logs"),
		BLOB_STORAGE_PATH: join(dataDir, "storage"),
		DISABLE_FLOWISE_TELEMETRY: "true",
		// Unlocks the fork's `/api/v1/pixeloffice-embed/credential` route, which serves the
		// seeded local credential to loopback callers so the framed UI can sign itself in.
		// Without this the studio behaves exactly as upstream and shows its login screen.
		PIXELOFFICE_EMBED: "1",
		// Only the runtime origin may call the API or frame the studio. With the fork's
		// commercial-licensed auth stripped there is no login in front of the canvas, and
		// Flowise's Custom Function nodes execute arbitrary code by design — so loopback
		// plus these two headers are the whole boundary. Never widen them.
		CORS_ORIGINS: embedOrigins,
		IFRAME_ORIGINS: embedOrigins,
	};
	delete env.ANTHROPIC_BASE_URL;
	delete env.ANTHROPIC_API_KEY;
	return env;
}

function createNoopProcess(isAlreadyUp: boolean): FlowiseProcess {
	return {
		pid: null,
		spawned: false,
		ready: Promise.resolve(isAlreadyUp),
		close: async () => {},
	};
}

interface StudioLaunchTarget {
	binary: string;
	args: string[];
	cwd: string;
	dataDir: string;
}

/**
 * Resolves the built server entry. Upstream starts through its oclif wrapper
 * (`packages/server/bin/run start`), and that wrapper is what reads `PORT` and the
 * `*_PATH` env vars — invoking `dist/index.js` directly skips its argv/env plumbing, the
 * same class of mistake `AGENTS.md` records for OmniRoute's `NODE_OPTIONS`.
 */
function resolveLaunchTarget(flowiseRoot: string, warn: (message: string) => void): StudioLaunchTarget | null {
	const serverPkg = join(flowiseRoot, "packages", "server");
	const binRun = join(serverPkg, "bin", "run");
	const built = join(serverPkg, "dist", "index.js");
	if (!existsSync(binRun) || !existsSync(built)) {
		warn(`Flowise studio build missing at ${built}.`);
		for (const line of INSTALL_HINT) {
			warn(line);
		}
		warn("  Board and tasks keep running; the Agents tab stays offline until it is built.");
		return null;
	}
	const dataDir = join(flowiseRoot, ".flowise");
	try {
		mkdirSync(dataDir, { recursive: true });
	} catch (error) {
		warn(
			`Could not create the Flowise data dir at ${dataDir}: ${error instanceof Error ? error.message : String(error)}`,
		);
		return null;
	}
	// The studio needs a newer Node than PixelOffice runs on, so the binary is resolved
	// rather than inherited — see flowise-node.ts.
	const studioNode = resolveStudioNodeBinary();
	if (!studioNode.satisfiesMinimum) {
		for (const line of describeMissingStudioNode()) {
			warn(line);
		}
		warn("  Starting it anyway on this Node; if it exits immediately, that is why.");
	}
	return { binary: studioNode.path, args: [binRun, "start"], cwd: serverPkg, dataDir };
}

/**
 * Starts the Flowise studio unless it is already listening, then keeps it up with capped
 * backoff. An already-served port is adopted rather than fought over, so a studio started
 * by hand (`pnpm start` in the submodule) keeps ownership.
 */
export async function startFlowiseProcess(deps: StartFlowiseProcessDependencies): Promise<FlowiseProcess> {
	const host = deps.host ?? DEFAULT_FLOWISE_HOST;
	const port = resolveFlowisePort(deps.port);
	const log = deps.log ?? (() => {});

	const flowiseRoot = deps.flowiseRoot === undefined ? findFlowiseRoot() : deps.flowiseRoot;

	if (await probePort(host, port)) {
		log(`Flowise studio already listening on ${host}:${port} — using the running service.`);
		return createNoopProcess(true);
	}

	if (flowiseRoot === null) {
		// Not a warning: a checkout that never initialized the submodule is a normal state,
		// and the Agents tab says so in the UI.
		log("Flowise studio not installed (backends/flowise is empty) — the Agents tab stays offline.");
		return createNoopProcess(false);
	}

	const target = resolveLaunchTarget(flowiseRoot, deps.warn);
	if (target === null) {
		return createNoopProcess(false);
	}

	const pixelOfficePort = process.env.PIXELOFFICE_PORT?.trim() ?? "3484";
	const startupTimeoutMs = resolveStartupTimeoutMs();

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

	const spawnStudio = (): void => {
		if (stopped) {
			return;
		}
		const studioLog = openStudioLog(target.dataDir);
		let spawned: ChildProcess;
		try {
			spawned = spawn(target.binary, target.args, {
				cwd: target.cwd,
				env: buildStudioEnv(target.dataDir, host, port, pixelOfficePort),
				stdio: studioLog === null ? "ignore" : ["ignore", studioLog.fd, studioLog.fd],
				shell: false,
				windowsHide: true,
				detached: process.platform !== "win32",
			});
		} catch (error) {
			deps.warn(`Could not launch the Flowise studio: ${error instanceof Error ? error.message : String(error)}`);
			resolveReady(false);
			return;
		} finally {
			// The child holds its own duplicate of the descriptor, so the parent's copy is dead
			// weight — and leaving it open grows this process's handle count across restarts.
			if (studioLog !== null) {
				try {
					closeSync(studioLog.fd);
				} catch {
					// Already closed by a failed spawn; nothing to recover.
				}
			}
		}
		child = spawned;
		const startedAt = Date.now();
		let exited = false;

		// `code === null` is how both a V8 abort and an OOM-kill arrive, so the signal has to
		// be read too — a supervisor that only checks the code says nothing about either.
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
				deps.warn(`Flowise studio keeps exiting (${how}) — giving up after ${consecutiveFailures} tries.`);
				deps.warn(`  Its output is in ${join(target.dataDir, "studio.log")}.`);
				resolveReady(false);
				return;
			}
			const delay = nextRestartDelayMs(consecutiveFailures);
			deps.warn(`Flowise studio exited (${how}) — restarting in ${Math.round(delay / 1000)}s.`);
			restartTimer = setTimeout(spawnStudio, delay);
		});
		spawned.once("error", (error) => {
			exited = true;
			deps.warn(`Could not launch the Flowise studio: ${error.message}`);
		});

		const slowNotice = setTimeout(() => {
			log("Flowise studio is still starting (first boot builds its node registry)...");
		}, SLOW_START_NOTICE_MS);
		void waitForPort(host, port, startupTimeoutMs, () => !exited && !stopped)
			.then((isUp) => {
				clearTimeout(slowNotice);
				if (isUp) {
					log(`Flowise studio listening on ${host}:${port}.`);
					resolveReady(true);
					return;
				}
				if (stopped) {
					return;
				}
				deps.warn(`Flowise studio did not open ${host}:${port} within ${Math.round(startupTimeoutMs / 1000)}s.`);
				deps.warn(`  Its output is in ${join(target.dataDir, "studio.log")}.`);
				deps.warn(`  A slower disk may just need longer: raise ${STARTUP_TIMEOUT_ENV}.`);
				resolveReady(false);
			})
			.catch(() => {
				clearTimeout(slowNotice);
			});
	};

	log(`Starting the Flowise studio from ${flowiseRoot}.`);
	spawnStudio();

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
					// The oclif wrapper forks, so the whole group has to go.
					process.kill(-pid, "SIGTERM");
				} catch {
					running.kill("SIGTERM");
				}
			}
			await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
		},
	};
}
