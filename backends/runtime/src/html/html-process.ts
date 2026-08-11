// Supervises the html-anything Next.js sidecar so a single Kanban launch brings
// up the template + prompt service on loopback. Optional by construction: if the
// package or its build is missing, the board and office keep running and the
// HTML surface reports offline.
import { type ChildProcess, spawn } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync, realpathSync } from "node:fs";
import { connect } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { terminateProcessForTimeout } from "../server/process-termination";

const DEFAULT_HTML_HOST = "127.0.0.1";
const DEFAULT_HTML_PORT = 8322;
const PORT_PROBE_TIMEOUT_MS = 1_000;
/**
 * `next start` needs well under 20 s from a native filesystem, which is what this
 * used to allow. It needs far more when the install lives on a Windows drive under
 * `/mnt/<letter>`: 9p/drvfs turns Next's module resolution into thousands of slow
 * stat calls (the same I/O problem the repo's WSL dev-setup note describes). The
 * standalone Plan Editor package is meant to be handed to people who unzip it
 * wherever, and there it timed out, warned "Install: pnpm install …", and left an
 * empty template rail — while the sidecar it had just spawned came up seconds later
 * and served fine. Waiting is cheap because `waitForPort` returns as soon as the
 * child exits, so a genuinely broken sidecar is still reported promptly.
 */
const DEFAULT_STARTUP_TIMEOUT_MS = 120_000;
const STARTUP_TIMEOUT_ENV = "PIXELOFFICE_HTML_STARTUP_TIMEOUT_MS";
/** Emit a "still starting" line this far in, so a slow start doesn't read as a hang. */
const SLOW_START_NOTICE_MS = 15_000;
const PORT_POLL_INTERVAL_MS = 250;
const BUILD_ID_PROBE_TIMEOUT_MS = 2_000;
const DEFAULT_INSTALL_HINT = [
	"  Install deps: pnpm install  (workspace includes backends/html_anything)",
	"  Then build:   pnpm --filter @html-anything/next build",
];

export interface HtmlProcess {
	/** Null when the sidecar was already listening or could not be started. */
	pid: number | null;
	/** True when this runtime spawned the service (and therefore owns shutdown). */
	spawned: boolean;
	/** Resolves true once the port answers; never rejects. Callers need not await it. */
	ready: Promise<boolean>;
	close: () => Promise<void>;
}

export interface StartHtmlProcessDependencies {
	warn: (message: string) => void;
	log?: (message: string) => void;
	/** Overrides `backends/html_anything` discovery; mainly for tests. */
	htmlRoot?: string | null;
	host?: string;
	port?: number;
	/**
	 * The `agent-data/templates/skills` directory this caller expects the sidecar to
	 * serve. When set, an already-listening sidecar that resolved a *different*
	 * directory is refused instead of adopted — see {@link findForeignSidecar}.
	 */
	expectedTemplateSkillsDir?: string;
	/**
	 * Lines printed when the sidecar's dependencies or build look missing. Defaults to
	 * the monorepo's pnpm commands, which mean nothing inside a shipped standalone
	 * package — that caller passes its own (`./build.sh`).
	 */
	installHint?: string[];
	/**
	 * Serve only `/api/*` and 404 the rest (`HTML_ANYTHING_API_ONLY`). Callers that embed
	 * the sidecar purely as a template/prompt backend set this so its own HTML Anything
	 * editor UI is not reachable alongside theirs — see `next/src/middleware.ts`.
	 */
	apiOnly?: boolean;
}

/**
 * Locates the `backends/html_anything` package next to the runtime.
 *
 * Mirrors `findManagerRoot()`'s candidate walk so the bundled `dist/cli.js`
 * layout and the monorepo source layout both resolve.
 */
export function findHtmlRoot(): string | null {
	const here = dirname(fileURLToPath(import.meta.url));
	const candidates = [
		// Dev / monorepo: backends/runtime/src/html → backends/html_anything
		resolve(here, "../../../html_anything"),
		// tsc output: backends/runtime/dist/html → backends/html_anything
		resolve(here, "../../../../html_anything"),
		// Bundled dist/cli.js sitting in backends/runtime/dist
		resolve(here, "../../html_anything"),
	];
	for (const candidate of candidates) {
		if (existsSync(join(candidate, "next", "package.json"))) {
			return candidate;
		}
	}
	return null;
}

function resolveHtmlPort(configured: number | undefined): number {
	if (configured !== undefined) {
		return configured;
	}
	const fromUrl = process.env.PIXELOFFICE_HTML_URL?.trim();
	if (fromUrl) {
		try {
			const parsed = new URL(fromUrl);
			if (parsed.port) {
				return Number(parsed.port);
			}
		} catch {
			// Fall through.
		}
	}
	const fromPort = process.env.PIXELOFFICE_HTML_PORT?.trim();
	if (fromPort && /^\d+$/.test(fromPort)) {
		return Number(fromPort);
	}
	return DEFAULT_HTML_PORT;
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
	onSlowStart?: () => void,
): Promise<boolean> {
	const startedAt = Date.now();
	const deadline = startedAt + timeoutMs;
	let noticed = false;
	while (Date.now() < deadline && shouldKeepWaiting()) {
		if (await probePort(host, port)) {
			return true;
		}
		if (!noticed && Date.now() - startedAt >= SLOW_START_NOTICE_MS) {
			noticed = true;
			onSlowStart?.();
		}
		await new Promise((resolvePromise) => setTimeout(resolvePromise, PORT_POLL_INTERVAL_MS));
	}
	return false;
}

function resolveStartupTimeoutMs(): number {
	const raw = process.env[STARTUP_TIMEOUT_ENV]?.trim();
	return raw !== undefined && /^\d+$/.test(raw) && Number(raw) > 0 ? Number(raw) : DEFAULT_STARTUP_TIMEOUT_MS;
}

/**
 * The sidecar is spawned detached so it outlives the runtime, which rules out piping
 * its output through this process: the child would write into a broken pipe once the
 * parent goes away. A log file keeps its crashes readable — before this, `stdio:
 * "ignore"` meant a sidecar that failed to boot left no trace anywhere.
 */
function openSidecarLog(nextPkg: string): { fd: number; path: string } | null {
	const path = join(nextPkg, "sidecar.log");
	try {
		return { fd: openSync(path, "a"), path };
	} catch {
		return null;
	}
}

function readBuiltBuildId(nextPkg: string): string | null {
	try {
		const value = readFileSync(join(nextPkg, ".next", "BUILD_ID"), "utf8").trim();
		return value.length > 0 ? value : null;
	} catch {
		return null;
	}
}

async function fetchRunningBuildId(host: string, port: number): Promise<string | null> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), BUILD_ID_PROBE_TIMEOUT_MS);
	try {
		const response = await fetch(`http://${host}:${port}/api/build-id`, {
			signal: controller.signal,
		});
		if (!response.ok) {
			return null;
		}
		const parsed: unknown = await response.json();
		const buildId = typeof parsed === "object" && parsed !== null ? (parsed as { buildId?: unknown }).buildId : null;
		return typeof buildId === "string" && buildId.length > 0 ? buildId : null;
	} catch {
		return null;
	} finally {
		clearTimeout(timer);
	}
}

/**
 * The sidecar is spawned detached, so it outlives the runtime that started it.
 * A later `next build` then rewrites `.next` underneath that orphan, and the
 * old process keeps answering on the port with pre-rebuild code — templates
 * still list, but `/api/prompt` starts failing. Comparing the build the process
 * reports against the build on disk is what separates "already running, fine"
 * from "already running, but wrong".
 *
 * Returns null when the comparison cannot be made (older sidecar without the
 * `/api/build-id` route, unreadable `.next`); an unknown answer is not a stale
 * one, so those cases keep the previous adopt-and-continue behaviour.
 */
async function findStaleSidecar(
	host: string,
	port: number,
	nextPkg: string | null,
): Promise<{ running: string; onDisk: string } | null> {
	if (nextPkg === null) {
		return null;
	}
	const onDisk = readBuiltBuildId(nextPkg);
	if (onDisk === null) {
		return null;
	}
	const running = await fetchRunningBuildId(host, port);
	if (running === null || running === onDisk) {
		return null;
	}
	return { running, onDisk };
}

async function fetchRunningTemplateSkillsDir(host: string, port: number): Promise<string | null> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), BUILD_ID_PROBE_TIMEOUT_MS);
	try {
		const response = await fetch(`http://${host}:${port}/api/agent-data-root`, {
			signal: controller.signal,
		});
		if (!response.ok) {
			return null;
		}
		const parsed: unknown = await response.json();
		const skillsDir =
			typeof parsed === "object" && parsed !== null
				? (parsed as { templateSkillsDir?: unknown }).templateSkillsDir
				: null;
		return typeof skillsDir === "string" && skillsDir.length > 0 ? skillsDir : null;
	} catch {
		return null;
	} finally {
		clearTimeout(timer);
	}
}

/** Symlink-tolerant path comparison — a task worktree reaches the same dir by another name. */
function samePath(left: string, right: string): boolean {
	const canonical = (value: string): string => {
		try {
			return realpathSync(value);
		} catch {
			return resolve(value);
		}
	};
	return canonical(left) === canonical(right);
}

/**
 * The full app and the standalone Plan Editor package both supervise a sidecar on
 * loopback, and an already-listening one is adopted as-is. That adoption is what
 * made the standalone package's picker list all 86 repo templates instead of its
 * three papp skills: a full-app sidecar owned the port, and the package's
 * `PIXELOFFICE_AGENT_DATA` override only reaches a process it spawns itself.
 *
 * Comparing the template-skills directory the running process reports against the
 * one this caller expects separates "already running, mine" from "already running,
 * someone else's". Returns null when the caller stated no expectation or the
 * running sidecar predates `/api/agent-data-root` — an unknown answer is not a
 * foreign one, so those cases keep the adopt-and-continue behaviour.
 */
async function findForeignSidecar(
	host: string,
	port: number,
	expectedTemplateSkillsDir: string | undefined,
): Promise<{ running: string; expected: string } | null> {
	if (expectedTemplateSkillsDir === undefined) {
		return null;
	}
	const running = await fetchRunningTemplateSkillsDir(host, port);
	if (running === null || samePath(running, expectedTemplateSkillsDir)) {
		return null;
	}
	return { running, expected: expectedTemplateSkillsDir };
}

function createNoopProcess(isAlreadyUp: boolean): HtmlProcess {
	return {
		pid: null,
		spawned: false,
		ready: Promise.resolve(isAlreadyUp),
		close: async () => {},
	};
}

/**
 * Starts the html-anything sidecar unless it is already listening.
 */
export async function startHtmlProcess(deps: StartHtmlProcessDependencies): Promise<HtmlProcess> {
	const host = deps.host ?? DEFAULT_HTML_HOST;
	const port = resolveHtmlPort(deps.port);
	const log = deps.log ?? (() => {});

	const htmlRoot = deps.htmlRoot === undefined ? findHtmlRoot() : deps.htmlRoot;
	const nextPkg = htmlRoot === null ? null : join(htmlRoot, "next");

	if (await probePort(host, port)) {
		const foreign = await findForeignSidecar(host, port, deps.expectedTemplateSkillsDir);
		if (foreign) {
			deps.warn(`HTML sidecar on ${host}:${port} belongs to another install.`);
			deps.warn(`  It serves templates from ${foreign.running}, not ${foreign.expected}.`);
			deps.warn("  Refusing to use it — its template list and prompts are not this install's.");
			deps.warn(`  Free the port, or pick another one with PLAN_EDITOR_HTML_PORT.`);
			return createNoopProcess(false);
		}
		const stale = await findStaleSidecar(host, port, nextPkg);
		if (stale) {
			deps.warn(
				`HTML sidecar on ${host}:${port} is serving build ${stale.running}, but ${nextPkg}/.next holds ${stale.onDisk}.`,
			);
			deps.warn("  It is an orphan from an earlier launch; HTML generation will fail against it.");
			deps.warn(`  Free the port and relaunch: node scripts/solo.mjs --restart`);
			return createNoopProcess(true);
		}
		log(`HTML sidecar already listening on ${host}:${port} — using the running service.`);
		return createNoopProcess(true);
	}

	if (nextPkg === null) {
		deps.warn("HTML package not found next to the runtime — HTML templates stay offline.");
		return createNoopProcess(false);
	}

	const installHint = deps.installHint ?? DEFAULT_INSTALL_HINT;
	const nextBin = join(nextPkg, "node_modules", "next", "dist", "bin", "next");
	if (!existsSync(nextBin)) {
		deps.warn(`HTML sidecar next binary missing at ${nextBin}.`);
		for (const line of installHint) {
			deps.warn(line);
		}
		return createNoopProcess(false);
	}
	if (!existsSync(join(nextPkg, ".next"))) {
		deps.warn(`HTML sidecar build missing at ${join(nextPkg, ".next")}.`);
		for (const line of installHint) {
			deps.warn(line);
		}
		deps.warn("  Board and office keep running; HTML templates stay offline until built.");
		return createNoopProcess(false);
	}

	log(`Starting HTML sidecar with ${process.execPath} ${nextBin}`);
	const sidecarLog = openSidecarLog(nextPkg);
	let child: ChildProcess;
	try {
		child = spawn(process.execPath, [nextBin, "start", "--port", String(port), "--hostname", host], {
			// loader.ts resolves skills via process.cwd()/src/lib/templates/skills
			cwd: nextPkg,
			env: {
				...process.env,
				NODE_ENV: "production",
				HTML_ANYTHING_ALLOWED_HOSTS: host,
				...(deps.apiOnly === true ? { HTML_ANYTHING_API_ONLY: "1" } : {}),
			},
			stdio: sidecarLog === null ? "ignore" : ["ignore", sidecarLog.fd, sidecarLog.fd],
			shell: false,
			windowsHide: true,
			detached: process.platform !== "win32",
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		deps.warn(`Could not launch HTML sidecar: ${message}`);
		return createNoopProcess(false);
	} finally {
		// The child holds its own duplicate of the descriptor, so the parent's copy is
		// dead weight — and leaving it open would keep this process's handle count growing
		// across restarts.
		if (sidecarLog !== null) {
			try {
				closeSync(sidecarLog.fd);
			} catch {
				// Already closed by a failed spawn; nothing to recover.
			}
		}
	}

	let exited = false;
	child.once("exit", (code) => {
		exited = true;
		if (code !== 0 && code !== null) {
			deps.warn(`HTML sidecar exited (code ${code}) — HTML templates stay offline until restarted.`);
		}
	});
	child.once("error", (error) => {
		exited = true;
		deps.warn(`Could not launch HTML sidecar: ${error.message}`);
	});

	const startupTimeoutMs = resolveStartupTimeoutMs();
	const ready = waitForPort(
		host,
		port,
		startupTimeoutMs,
		() => !exited,
		() => log(`HTML sidecar is still starting (slow disks — a Windows drive under /mnt — take a while)...`),
	).then((isUp) => {
		if (isUp) {
			log(`HTML sidecar listening on ${host}:${port}.`);
			return true;
		}
		deps.warn(`HTML sidecar did not open ${host}:${port} within ${Math.round(startupTimeoutMs / 1000)}s.`);
		for (const line of installHint) {
			deps.warn(line);
		}
		if (sidecarLog !== null) {
			deps.warn(`  Its output is in ${sidecarLog.path}.`);
		}
		deps.warn(`  A slower disk may just need longer: raise ${STARTUP_TIMEOUT_ENV}.`);
		deps.warn("  Board and office keep running; HTML templates stay offline until the sidecar is up.");
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
