// Supervises OpenMAIC (`backends/openmaic`, a git submodule) so a single PixelOffice launch
// brings the Learning tab's classroom up on loopback. Optional by construction: an
// uninitialized submodule or an unbuilt app only means the tab reports "not installed",
// exactly like the Flowise studio and the HTML/docs sidecars.
//
// Deliberately not `superviseStackDaemon`: that one assumes an agent-stack root with a
// `logs/` dir and its own pidfile protocol. This follows `flowise-process.ts` instead, and
// borrows only the backoff arithmetic from `stack/stack-daemon.ts` — the pairing
// `AGENTS.md` (`spawned-services-lose-their-package-json-flags`) prescribes for a
// non-stack service.
import { type ChildProcess, spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { terminateProcessForTimeout } from "../server/process-termination";
import { getKanbanRuntimeOrigin } from "../core/runtime-endpoint";
import {
	isFlowiseLlmProxyEnabled,
	resolveFlowiseLlmProxyProviderUrl,
} from "../flowise/flowise-llm-proxy-config";
import { nextRestartDelayMs, shouldGiveUpRestarting } from "../stack/stack-daemon";
import { probePort, waitForPort } from "../stack/stack-ports";
import {
	DEFAULT_OPENMAIC_HOST,
	ensureOpenmaicDataDirExcluded,
	findOpenmaicRoot,
	isOpenmaicBuilt,
	isOpenmaicBuiltForEmbedding,
	OPENMAIC_FRAME_ANCESTORS_ENV,
	resolveOpenmaicDataDir,
	resolveOpenmaicFrameAncestors,
	resolveOpenmaicPort,
} from "./openmaic-endpoint";

/** `next start` serves a prebuilt tree, so it is up far sooner than the Flowise studio. */
const DEFAULT_STARTUP_TIMEOUT_MS = 60_000;
const STARTUP_TIMEOUT_ENV = "PIXELOFFICE_OPENMAIC_STARTUP_TIMEOUT_MS";
/** A child that survives this long resets the failure count, so backoff tracks real flapping. */
const HEALTHY_UPTIME_MS = 60_000;
/**
 * The build command carries `ALLOWED_FRAME_ANCESTORS` because the classroom otherwise bakes
 * `X-Frame-Options: SAMEORIGIN` into its manifest and the embed renders blank — see
 * `isOpenmaicBuiltForEmbedding`. `CI=true` is upstream's own posture (its Dockerfile pins
 * pnpm 10.28 via corepack); without it pnpm refuses to replace a `node_modules` built by a
 * different pnpm major with no TTY to ask.
 */
function buildInstallHint(frameAncestors: string): string[] {
	return [
		"  Init the classroom:  git submodule update --init backends/openmaic",
		"  Then build:          cd backends/openmaic \\",
		"                         && CI=true npx pnpm@10.28.0 install --frozen-lockfile \\",
		`                         && ${OPENMAIC_FRAME_ANCESTORS_ENV}="${frameAncestors}" \\`,
		"                            CI=true npx pnpm@10.28.0 build",
	];
}
/**
 * What `resolveLaunchTarget` expects `scripts.start` to be. Spawning the framework binary
 * instead of the package script is what `AGENTS.md` warns about — a script's flags are
 * silently lost — so the assumption is asserted rather than left implicit. Going through
 * `pnpm` is not an option here: OpenMAIC pins `packageManager: pnpm@10.x` while this repo
 * runs pnpm 11, which would try to fetch the pinned version over the network on every
 * spawn.
 */
const EXPECTED_START_SCRIPT = "next start";

export interface OpenmaicProcess {
	/** Null when the classroom was already listening or could not be started. */
	pid: number | null;
	/** True when this runtime spawned the service (and therefore owns shutdown). */
	spawned: boolean;
	/** Resolves true once the port answers; never rejects. Callers need not await it. */
	ready: Promise<boolean>;
	close: () => Promise<void>;
}

export interface StartOpenmaicProcessDependencies {
	warn: (message: string) => void;
	log?: (message: string) => void;
	/** Overrides `backends/openmaic` discovery; mainly for tests. */
	openmaicRoot?: string | null;
	host?: string;
	port?: number;
}

function resolveStartupTimeoutMs(): number {
	const raw = process.env[STARTUP_TIMEOUT_ENV]?.trim();
	return raw !== undefined && /^\d+$/.test(raw) && Number(raw) > 0 ? Number(raw) : DEFAULT_STARTUP_TIMEOUT_MS;
}

/**
 * Spawned detached so it outlives the runtime, which rules out piping its output through
 * this process — the child would write into a broken pipe once the parent goes away. A log
 * file keeps its crashes readable.
 */
function openClassroomLog(dataDir: string): { fd: number; path: string } | null {
	const path = join(dataDir, "classroom.log");
	try {
		return { fd: openSync(path, "a"), path };
	} catch {
		return null;
	}
}

function readStartScript(openmaicRoot: string): string | null {
	try {
		const parsed = JSON.parse(readFileSync(join(openmaicRoot, "package.json"), "utf8")) as {
			scripts?: Record<string, string>;
		};
		return parsed.scripts?.start ?? null;
	} catch {
		return null;
	}
}

/**
 * `ANTHROPIC_*` is stripped on purpose. `scripts/solo.mjs` exports `ANTHROPIC_BASE_URL`
 * for *task agents*; inheriting it would route every OpenMAIC LLM call through the
 * switchboard, and `ANTHROPIC_API_KEY` may be the `sk-dummy-key-*` placeholder.
 *
 * Nothing here redirects OpenMAIC's own state: Next.js reads `.env.local` from the process
 * cwd and nowhere else, and no env var for a data directory is documented, so inventing
 * one would only imply a contract upstream does not honour. Its state stays where upstream
 * puts it (all of it already covered by the submodule's own `.gitignore` — `.env*`,
 * `/data`, `/logs`); `.openmaic/` holds only what this supervisor writes.
 */
function buildClassroomEnv(host: string, port: number): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = {
		...process.env,
		NODE_ENV: "production",
		PORT: String(port),
		PIXELOFFICE_RUNTIME_ORIGIN: getKanbanRuntimeOrigin(),
		// Loopback only. With no login in front of the classroom and a provider key sitting
		// in its `.env.local`, the bind is the entire boundary — never widen it to 0.0.0.0.
		// `next start` ignores HOSTNAME, so this is belt-and-braces behind the explicit `-H`.
		HOSTNAME: host,
		// Browser-native is OpenMAIC's default mic path; keep it enabled when PixelOffice
		// embeds the classroom unless the operator explicitly turned it off in .env.local.
		ASR_BROWSER_NATIVE_ENABLED: "true",
	};
	if (isFlowiseLlmProxyEnabled()) {
		// Whisper ASR bills through the Manager API seat (OmniRoute/Cline) via the same
		// loopback proxy Flowise uses — no separate key in backends/openmaic/.env.local.
		env.ASR_OPENAI_BASE_URL = `${resolveFlowiseLlmProxyProviderUrl("openai")}/v1`;
		env.ASR_OPENAI_API_KEY = "pixeloffice-seat";
	}
	delete env.ANTHROPIC_BASE_URL;
	delete env.ANTHROPIC_API_KEY;
	return env;
}

function createNoopProcess(isAlreadyUp: boolean): OpenmaicProcess {
	return {
		pid: null,
		spawned: false,
		ready: Promise.resolve(isAlreadyUp),
		close: async () => {},
	};
}

interface ClassroomLaunchTarget {
	binary: string;
	args: string[];
	cwd: string;
	dataDir: string;
}

/**
 * Resolves the Next.js binary inside the submodule. `process.execPath` is enough here —
 * OpenMAIC asks for node ≥ 20.9 and this runtime is well past that, so unlike the Flowise
 * studio there is no newest-node hunt.
 */
function resolveLaunchTarget(
	openmaicRoot: string,
	host: string,
	port: number,
	pixelOfficePort: string,
	warn: (message: string) => void,
): ClassroomLaunchTarget | null {
	const installHint = buildInstallHint(resolveOpenmaicFrameAncestors(pixelOfficePort));
	if (!isOpenmaicBuilt(openmaicRoot)) {
		warn(`OpenMAIC build missing at ${join(openmaicRoot, ".next")}.`);
		for (const line of installHint) {
			warn(line);
		}
		warn("  Board and tasks keep running; the Learning tab stays offline until it is built.");
		return null;
	}
	const nextBin = join(openmaicRoot, "node_modules", "next", "dist", "bin", "next");
	if (!existsSync(nextBin)) {
		warn(`OpenMAIC dependencies are missing at ${join(openmaicRoot, "node_modules", "next")}.`);
		for (const line of installHint) {
			warn(line);
		}
		return null;
	}
	// Started anyway: it is reachable in a browser tab, and the Learning tab explains the
	// blank frame rather than leaving it a mystery.
	if (!isOpenmaicBuiltForEmbedding(openmaicRoot)) {
		warn("OpenMAIC was built without ALLOWED_FRAME_ANCESTORS, so it serves X-Frame-Options: SAMEORIGIN.");
		warn("  PixelOffice is a different origin, so the Learning frame will render blank. Rebuild with:");
		for (const line of installHint) {
			warn(line);
		}
	}
	const startScript = readStartScript(openmaicRoot);
	if (startScript !== null && startScript.trim() !== EXPECTED_START_SCRIPT) {
		// Not fatal, but it is exactly the failure mode AGENTS.md records: upstream added
		// flags to its start script and this launch does not carry them.
		warn(`OpenMAIC's start script is now "${startScript}" — this supervisor runs "${EXPECTED_START_SCRIPT}" only.`);
	}
	const dataDir = resolveOpenmaicDataDir(openmaicRoot);
	ensureOpenmaicDataDirExcluded(openmaicRoot);
	try {
		mkdirSync(dataDir, { recursive: true });
	} catch (error) {
		warn(
			`Could not create the OpenMAIC data dir at ${dataDir}: ${error instanceof Error ? error.message : String(error)}`,
		);
		return null;
	}
	// `-H` is passed explicitly because `next start` defaults to 0.0.0.0 and only reads
	// `PORT` from the environment, never `HOSTNAME`.
	return {
		binary: process.execPath,
		args: [nextBin, "start", "-p", String(port), "-H", host],
		cwd: openmaicRoot,
		dataDir,
	};
}

/**
 * Starts OpenMAIC unless it is already listening, then keeps it up with capped backoff. An
 * already-served port is adopted rather than fought over, so a classroom started by hand
 * (`pnpm start` in the submodule) keeps ownership.
 */
export async function startOpenmaicProcess(deps: StartOpenmaicProcessDependencies): Promise<OpenmaicProcess> {
	const host = deps.host ?? DEFAULT_OPENMAIC_HOST;
	const port = resolveOpenmaicPort(deps.port);
	const log = deps.log ?? (() => {});

	const openmaicRoot = deps.openmaicRoot === undefined ? findOpenmaicRoot() : deps.openmaicRoot;

	if (await probePort(host, port)) {
		log(`OpenMAIC already listening on ${host}:${port} — using the running service.`);
		return createNoopProcess(true);
	}

	if (openmaicRoot === null) {
		// Not a warning: a checkout that never initialized the submodule is a normal state,
		// and the Learning tab says so in the UI.
		log("OpenMAIC not installed (backends/openmaic is empty) — the Learning tab stays offline.");
		return createNoopProcess(false);
	}

	const pixelOfficePort = process.env.PIXELOFFICE_PORT?.trim() ?? "3484";
	const target = resolveLaunchTarget(openmaicRoot, host, port, pixelOfficePort, deps.warn);
	if (target === null) {
		return createNoopProcess(false);
	}

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

	const spawnClassroom = (): void => {
		if (stopped) {
			return;
		}
		const classroomLog = openClassroomLog(target.dataDir);
		let spawned: ChildProcess;
		try {
			spawned = spawn(target.binary, target.args, {
				cwd: target.cwd,
				env: buildClassroomEnv(host, port),
				stdio: classroomLog === null ? "ignore" : ["ignore", classroomLog.fd, classroomLog.fd],
				shell: false,
				windowsHide: true,
				detached: process.platform !== "win32",
			});
		} catch (error) {
			deps.warn(`Could not launch OpenMAIC: ${error instanceof Error ? error.message : String(error)}`);
			resolveReady(false);
			return;
		} finally {
			// The child holds its own duplicate of the descriptor, so the parent's copy is dead
			// weight — and leaving it open grows this process's handle count across restarts.
			if (classroomLog !== null) {
				try {
					closeSync(classroomLog.fd);
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
				deps.warn(`OpenMAIC keeps exiting (${how}) — giving up after ${consecutiveFailures} tries.`);
				deps.warn(`  Its output is in ${join(target.dataDir, "classroom.log")}.`);
				resolveReady(false);
				return;
			}
			const delay = nextRestartDelayMs(consecutiveFailures);
			deps.warn(`OpenMAIC exited (${how}) — restarting in ${Math.round(delay / 1000)}s.`);
			restartTimer = setTimeout(spawnClassroom, delay);
		});
		spawned.once("error", (error) => {
			exited = true;
			deps.warn(`Could not launch OpenMAIC: ${error.message}`);
		});

		void waitForPort(host, port, startupTimeoutMs, () => !exited && !stopped)
			.then((isUp) => {
				if (isUp) {
					log(`OpenMAIC listening on ${host}:${port}.`);
					resolveReady(true);
					return;
				}
				if (stopped) {
					return;
				}
				deps.warn(`OpenMAIC did not open ${host}:${port} within ${Math.round(startupTimeoutMs / 1000)}s.`);
				deps.warn(`  Its output is in ${join(target.dataDir, "classroom.log")}.`);
				deps.warn(`  A slower disk may just need longer: raise ${STARTUP_TIMEOUT_ENV}.`);
				resolveReady(false);
			})
			.catch(() => {
				resolveReady(false);
			});
	};

	log(`Starting OpenMAIC from ${openmaicRoot}.`);
	spawnClassroom();

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
					// `next start` forks its own workers, so the whole group has to go.
					process.kill(-pid, "SIGTERM");
				} catch {
					running.kill("SIGTERM");
				}
			}
			await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
		},
	};
}
