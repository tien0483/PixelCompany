/**
 * Serves a project's knowledge graph in the Understand Anything dashboard, on
 * demand, from the review tab.
 *
 * Unlike Manager or the stack daemons this is not started at boot: a reviewer asks
 * for it, per project, and most reviews never do. So there is a registry keyed by
 * project path rather than a fixed port, and the runtime hands back a URL to open
 * in a browser tab.
 *
 * The runtime generates the access token and passes it in the environment rather
 * than scraping it out of the child's banner. `bin/viewer.mjs` reads
 * `UNDERSTAND_ACCESS_TOKEN` and only invents one when it is absent, so this makes
 * the URL knowable before the child has printed anything — every data endpoint in
 * the viewer 403s without a matching `?token=`, and a dashboard opened without it
 * is just a token gate.
 *
 * Nothing here needs the network: the viewer is served out of the plugin's own
 * `packages/viewer/dist`, which is why the missing-build case gets a real error
 * message instead of a silent `npx` download.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { connect, createServer } from "node:net";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { terminateProcessForTimeout } from "../server/process-termination";

/**
 * Well clear of Vite's 5173 (which the dashboard's own dev server takes) and of
 * the stack's 3456/3460+ seat routers.
 */
const DASHBOARD_PORT_BASE = 5273;
const DASHBOARD_PORT_ATTEMPTS = 40;
const STARTUP_TIMEOUT_MS = 30_000;
const PORT_PROBE_TIMEOUT_MS = 750;
const PORT_POLL_INTERVAL_MS = 200;
/** Captured for the error message when the child dies before printing a URL. */
const STDERR_CAPTURE_LIMIT = 8 * 1024;

/** The banner both the viewer and the dashboard dev server print. */
const DASHBOARD_URL_PATTERN = /Dashboard URL:\s*(\S+)/;

export interface ReviewGraphDashboard {
	projectPath: string;
	url: string;
	port: number;
	pid: number | null;
}

export type StartReviewGraphDashboardResult =
	| { ok: true; dashboard: ReviewGraphDashboard }
	| { ok: false; error: string };

interface RegistryEntry extends ReviewGraphDashboard {
	child: ChildProcess;
	exited: boolean;
}

/**
 * One viewer per project path. A reviewer moving between merge requests in the
 * same repo reuses the running one; two projects get two.
 */
const dashboards = new Map<string, RegistryEntry>();
/** In-flight starts, so a double click does not spawn two viewers on one project. */
const pending = new Map<string, Promise<StartReviewGraphDashboardResult>>();

/**
 * Where the Understand Anything plugin is installed.
 *
 * `~/.understand-anything-plugin` is the universal symlink every install creates,
 * and in this repo it points into `backends/agent_stack/src-understand-anything`.
 * The in-repo path is probed too, so a checkout whose installer has not run still
 * works.
 */
export function findUnderstandPluginRoot(): string | null {
	const here = dirname(fileURLToPath(import.meta.url));
	const configured = process.env.UNDERSTAND_ANYTHING_PLUGIN_ROOT?.trim();
	const inRepo = [
		// Dev / monorepo: backends/runtime/src/review → backends/agent_stack/...
		resolve(here, "../../../agent_stack/src-understand-anything/understand-anything-plugin"),
		// tsc output: backends/runtime/dist/review → …
		resolve(here, "../../../../agent_stack/src-understand-anything/understand-anything-plugin"),
	];
	const candidates = [...(configured ? [configured] : []), join(homedir(), ".understand-anything-plugin"), ...inRepo];
	for (const candidate of candidates) {
		if (existsSync(join(candidate, "packages", "viewer", "bin", "viewer.mjs"))) {
			return candidate;
		}
	}
	return null;
}

export interface ResolvedViewerEntry {
	binPath: string;
	distPath: string;
}

/**
 * The viewer's `dist/` is a build artifact, not something the repo ships: the
 * tarball is packed with it, a source checkout is not. `bin/viewer.mjs` already
 * exits with a message about it, but that message would arrive as "the dashboard
 * did not start", so it is checked here where the fix can be named.
 */
export function resolveViewerEntry(
	pluginRoot: string,
): { ok: true; entry: ResolvedViewerEntry } | { ok: false; error: string } {
	const binPath = join(pluginRoot, "packages", "viewer", "bin", "viewer.mjs");
	const distPath = join(pluginRoot, "packages", "viewer", "dist");
	if (!existsSync(binPath)) {
		return { ok: false, error: `The Understand Anything viewer is not installed at ${binPath}.` };
	}
	if (!existsSync(join(distPath, "index.html"))) {
		return {
			ok: false,
			error:
				`The dashboard has not been built yet (${distPath} is empty). Build it once with: ` +
				`cd ${join(pluginRoot, "packages", "viewer")} && node build.mjs`,
		};
	}
	return { ok: true, entry: { binPath, distPath } };
}

function probePort(port: number, timeoutMs = PORT_PROBE_TIMEOUT_MS): Promise<boolean> {
	return new Promise((resolvePromise) => {
		const socket = connect({ host: "127.0.0.1", port });
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

/**
 * Binds and releases, rather than probing. A probe answers "is something serving
 * this", which is not the same question: a port held by a process that is not
 * listening yet would still look free.
 */
function isPortBindable(port: number): Promise<boolean> {
	return new Promise((resolvePromise) => {
		const server = createServer();
		server.once("error", () => resolvePromise(false));
		server.once("listening", () => {
			server.close(() => resolvePromise(true));
		});
		server.listen(port, "127.0.0.1");
	});
}

async function findFreePort(): Promise<number | null> {
	for (let offset = 0; offset < DASHBOARD_PORT_ATTEMPTS; offset += 1) {
		const port = DASHBOARD_PORT_BASE + offset;
		if (await isPortBindable(port)) {
			return port;
		}
	}
	return null;
}

async function waitForPort(port: number, shouldKeepWaiting: () => boolean): Promise<boolean> {
	const deadline = Date.now() + STARTUP_TIMEOUT_MS;
	while (Date.now() < deadline && shouldKeepWaiting()) {
		if (await probePort(port)) {
			return true;
		}
		await new Promise((resolvePromise) => setTimeout(resolvePromise, PORT_POLL_INTERVAL_MS));
	}
	return false;
}

export interface StartReviewGraphDashboardInput {
	projectPath: string;
	warn?: (message: string) => void;
	log?: (message: string) => void;
}

async function spawnDashboard(input: StartReviewGraphDashboardInput): Promise<StartReviewGraphDashboardResult> {
	const warn = input.warn ?? (() => {});
	const log = input.log ?? (() => {});

	const pluginRoot = findUnderstandPluginRoot();
	if (pluginRoot === null) {
		return {
			ok: false,
			error:
				"The Understand Anything plugin was not found. Expected ~/.understand-anything-plugin or " +
				"backends/agent_stack/src-understand-anything.",
		};
	}
	const resolved = resolveViewerEntry(pluginRoot);
	if (!resolved.ok) {
		return resolved;
	}

	const port = await findFreePort();
	if (port === null) {
		return {
			ok: false,
			error: `No free port in ${DASHBOARD_PORT_BASE}–${DASHBOARD_PORT_BASE + DASHBOARD_PORT_ATTEMPTS}.`,
		};
	}
	const token = randomBytes(16).toString("hex");

	let child: ChildProcess;
	try {
		child = spawn(
			process.execPath,
			[resolved.entry.binPath, input.projectPath, "--port", String(port), "--no-open"],
			{
				cwd: input.projectPath,
				// The token is the whole access-control story for the viewer, so it is
				// generated here and never logged.
				env: { ...process.env, UNDERSTAND_ACCESS_TOKEN: token },
				stdio: ["ignore", "pipe", "pipe"],
				windowsHide: true,
				detached: process.platform !== "win32",
			},
		);
	} catch (error) {
		return { ok: false, error: error instanceof Error ? error.message : String(error) };
	}

	let exited = false;
	let exitDetail: string | null = null;
	let stderrTail = "";
	let announcedUrl: string | null = null;

	child.stdout?.setEncoding("utf8");
	child.stdout?.on("data", (chunk: string) => {
		const match = DASHBOARD_URL_PATTERN.exec(chunk);
		if (match?.[1] && announcedUrl === null) {
			// The child's own banner is the authority on the URL: it re-picks the port on
			// EADDRINUSE when one was not pinned, and this keeps that case honest.
			announcedUrl = match[1];
		}
	});
	child.stderr?.setEncoding("utf8");
	child.stderr?.on("data", (chunk: string) => {
		if (stderrTail.length < STDERR_CAPTURE_LIMIT) {
			stderrTail += chunk;
		}
	});
	child.once("exit", (code, signal) => {
		exited = true;
		// A signal death arrives as `code === null`, which is exactly the case a
		// `code !== 0` check reports as success.
		exitDetail = signal ? `killed by ${signal}` : `exit code ${code ?? "unknown"}`;
		dashboards.delete(input.projectPath);
	});
	child.once("error", (error) => {
		exited = true;
		exitDetail = error.message;
	});

	const isUp = await waitForPort(port, () => !exited);
	if (!isUp) {
		const detail = stderrTail.trim() || exitDetail || "it did not open the port";
		if (!exited) {
			terminateProcessForTimeout(child);
		}
		warn(`Graph dashboard for ${input.projectPath} did not start: ${detail}`);
		return { ok: false, error: `The graph dashboard did not start: ${detail}` };
	}

	const url = announcedUrl ?? `http://127.0.0.1:${port}/?token=${token}`;
	const entry: RegistryEntry = {
		projectPath: input.projectPath,
		url,
		port,
		pid: child.pid ?? null,
		child,
		exited: false,
	};
	dashboards.set(input.projectPath, entry);
	log(`Graph dashboard for ${input.projectPath} listening on 127.0.0.1:${port}.`);
	return { ok: true, dashboard: { projectPath: entry.projectPath, url: entry.url, port: entry.port, pid: entry.pid } };
}

/**
 * Returns a URL for the project's dashboard, starting the viewer if it is not
 * already running. Idempotent per project path.
 */
export async function startReviewGraphDashboard(
	input: StartReviewGraphDashboardInput,
): Promise<StartReviewGraphDashboardResult> {
	const existing = dashboards.get(input.projectPath);
	if (existing && !existing.exited && (await probePort(existing.port))) {
		return {
			ok: true,
			dashboard: {
				projectPath: existing.projectPath,
				url: existing.url,
				port: existing.port,
				pid: existing.pid,
			},
		};
	}
	if (existing) {
		// Registered but dead or no longer serving: drop it so the retry below is a
		// real start rather than another handout of a URL that 404s.
		dashboards.delete(input.projectPath);
	}

	const inFlight = pending.get(input.projectPath);
	if (inFlight) {
		return await inFlight;
	}
	const started = spawnDashboard(input).finally(() => {
		pending.delete(input.projectPath);
	});
	pending.set(input.projectPath, started);
	return await started;
}

export function getReviewGraphDashboard(projectPath: string): ReviewGraphDashboard | null {
	const entry = dashboards.get(projectPath);
	if (!entry || entry.exited) {
		return null;
	}
	return { projectPath: entry.projectPath, url: entry.url, port: entry.port, pid: entry.pid };
}

/** Shutdown hook. Detached children would otherwise outlive the runtime. */
export async function closeAllReviewGraphDashboards(): Promise<void> {
	const entries = [...dashboards.values()];
	dashboards.clear();
	for (const entry of entries) {
		if (entry.exited) {
			continue;
		}
		const pid = entry.child.pid;
		if (pid === undefined) {
			continue;
		}
		if (process.platform === "win32") {
			terminateProcessForTimeout(entry.child);
			continue;
		}
		try {
			// Spawned detached, so the child leads its own group.
			process.kill(-pid, "SIGTERM");
		} catch {
			entry.child.kill("SIGTERM");
		}
	}
}
