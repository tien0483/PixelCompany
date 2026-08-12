// Supervises the docs sidecar (backends/doc_skill/server) so PixelOffice can
// bring up documentation-pipeline tooling alongside the board and office.
//
// The sidecar is optional by construction: it is a stdlib-only Python HTTP
// server with no venv and no heavy deps, so failures here should never be
// fatal to the rest of the product — a missing/broken docs sidecar just means
// the Docs pane reports offline, same as Manager's Accounts pane does when
// Manager itself is unavailable.
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { connect } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { terminateProcessForTimeout } from "../server/process-termination";
import { DEFAULT_DOCSKILL_HOST, resolveDocSkillPort } from "./doc-skill-endpoint";

const PORT_PROBE_TIMEOUT_MS = 1_000;
const STARTUP_TIMEOUT_MS = 10_000; // sidecar has no venv/build step, starts fast
const PORT_POLL_INTERVAL_MS = 250;

export interface DocSkillProcess {
	/** Null when the sidecar was already listening or could not be started. */
	pid: number | null;
	/** True when this runtime spawned the service (and therefore owns shutdown). */
	spawned: boolean;
	/** Resolves true once the port answers; never rejects. Callers need not await it. */
	ready: Promise<boolean>;
	close: () => Promise<void>;
}

export interface StartDocSkillProcessDependencies {
	warn: (message: string) => void;
	log?: (message: string) => void;
	/** Overrides `backends/doc_skill` discovery; mainly for tests. Explicit null forces "not found". */
	docSkillRoot?: string | null;
	host?: string;
	port?: number;
}

/**
 * Locates the `backends/doc_skill` package next to the runtime.
 *
 * Mirrors `findManagerRoot()`'s candidate walk so the bundled `dist/cli.js`
 * layout and the monorepo source layout both resolve.
 */
export function findDocSkillRoot(): string | null {
	const here = dirname(fileURLToPath(import.meta.url));
	const candidates = [
		// Dev / monorepo: backends/runtime/src/doc-skill → backends/doc_skill
		resolve(here, "../../../doc_skill"),
		// tsc output: backends/runtime/dist/doc-skill → backends/doc_skill
		resolve(here, "../../../../doc_skill"),
		// Bundled dist/cli.js sitting in backends/runtime/dist
		resolve(here, "../../doc_skill"),
	];
	for (const candidate of candidates) {
		if (existsSync(join(candidate, "server", "__main__.py"))) {
			return candidate;
		}
	}
	return null;
}

/**
 * This backend is stdlib-only (no aiohttp/fastapi/etc.), so unlike Manager
 * there is no venv to prefer — the bare interpreter on PATH is enough.
 */
function resolvePythonBinary(): string {
	const configured = process.env.PIXELOFFICE_DOCSKILL_PYTHON?.trim();
	if (configured) {
		return configured;
	}
	return process.platform === "win32" ? "python" : "python3";
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

function createNoopProcess(isAlreadyUp: boolean): DocSkillProcess {
	return {
		pid: null,
		spawned: false,
		ready: Promise.resolve(isAlreadyUp),
		close: async () => {},
	};
}

/**
 * Starts the docs sidecar unless it is already listening (an externally
 * managed instance owns the port in that case — never double-spawn).
 */
export async function startDocSkillProcess(deps: StartDocSkillProcessDependencies): Promise<DocSkillProcess> {
	const host = deps.host ?? DEFAULT_DOCSKILL_HOST;
	const port = resolveDocSkillPort(deps.port);
	const log = deps.log ?? (() => {});

	if (await probePort(host, port)) {
		log(`Docs sidecar already listening on ${host}:${port} — using the running service.`);
		return createNoopProcess(true);
	}

	const docSkillRoot = deps.docSkillRoot === undefined ? findDocSkillRoot() : deps.docSkillRoot;
	if (!docSkillRoot || !existsSync(join(docSkillRoot, "server", "__main__.py"))) {
		deps.warn("Docs sidecar package not found next to the runtime — Docs stay offline.");
		return createNoopProcess(false);
	}

	const python = resolvePythonBinary();
	log(`Starting docs sidecar with interpreter: ${python}`);
	let child: ChildProcess;
	try {
		child = spawn(python, ["-m", "server", "--host", host, "--port", String(port)], {
			cwd: docSkillRoot,
			stdio: "ignore",
			// Windows resolves `python` through shims that need a shell.
			shell: process.platform === "win32",
			windowsHide: true,
			detached: process.platform !== "win32",
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		deps.warn(`Could not launch docs sidecar (${python}): ${message}`);
		return createNoopProcess(false);
	}

	let exited = false;
	child.once("exit", (code) => {
		exited = true;
		if (code !== 0 && code !== null) {
			deps.warn(`Docs sidecar exited (code ${code}) — Docs stay offline until it is restarted.`);
		}
	});
	child.once("error", (error) => {
		exited = true;
		deps.warn(`Could not launch docs sidecar (${python}): ${error.message}`);
	});

	// Readiness is reported in the background: the board, PTY sessions, office
	// and Manager must not wait on this optional subsystem.
	const ready = waitForPort(host, port, STARTUP_TIMEOUT_MS, () => !exited).then((isUp) => {
		if (isUp) {
			log(`Docs sidecar listening on ${host}:${port}.`);
			return true;
		}
		deps.warn(`Docs sidecar did not open ${host}:${port}.`);
		deps.warn("  Docs stay offline until the sidecar is up.");
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
				// tree-kill: the shell shim is the direct child, python sits under it.
				terminateProcessForTimeout(child);
			} else {
				// Spawned detached, so the child leads its own group — signal the
				// group in case the server ever forks workers.
				try {
					process.kill(-pid, "SIGTERM");
				} catch {
					child.kill("SIGTERM");
				}
			}
			// Give the server a moment to release the port before the next launch.
			await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
		},
	};
}
