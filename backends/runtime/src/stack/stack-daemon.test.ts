import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
	buildStackEnv,
	isStackFlagEnabled,
	nextRestartDelayMs,
	shouldGiveUpRestarting,
	type StackDaemonSpec,
	type StackProcess,
	superviseStackDaemon,
} from "./stack-daemon";

const POLL_MS = 100;

/** Never binds a port: takeover is observed through the pidfile, not through readiness. */
const STUB_ARGS = ["-e", "setInterval(() => {}, 1_000)"];

function listenOnFreePort(): Promise<{ server: Server; port: number }> {
	return new Promise((resolvePromise, rejectPromise) => {
		const server = createServer();
		server.once("error", rejectPromise);
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			if (address === null || typeof address === "string") {
				rejectPromise(new Error("expected a TCP address"));
				return;
			}
			resolvePromise({ server, port: address.port });
		});
	});
}

function closeServer(server: Server): Promise<void> {
	return new Promise((resolvePromise) => {
		server.close(() => {
			resolvePromise();
		});
	});
}

function listenOnPort(port: number): Promise<Server> {
	return new Promise((resolvePromise, rejectPromise) => {
		const server = createServer();
		server.once("error", rejectPromise);
		server.listen(port, "127.0.0.1", () => {
			resolvePromise(server);
		});
	});
}

function wait(ms: number): Promise<void> {
	return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

/** Polls instead of sleeping a fixed slice, so the takeover assertions are not timing-fragile. */
async function waitUntil(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (predicate()) {
			return true;
		}
		await wait(20);
	}
	return predicate();
}

describe("superviseStackDaemon adoption", () => {
	const stackRoots: string[] = [];
	const servers: Server[] = [];
	const processes: StackProcess[] = [];

	afterEach(async () => {
		for (const supervised of processes.splice(0)) {
			await supervised.close();
		}
		for (const server of servers.splice(0)) {
			await closeServer(server).catch(() => {});
		}
		for (const root of stackRoots.splice(0)) {
			rmSync(root, { recursive: true, force: true });
		}
	});

	function makeSpec(port: number): StackDaemonSpec {
		const stackRoot = mkdtempSync(join(tmpdir(), "stack-daemon-test-"));
		stackRoots.push(stackRoot);
		return {
			name: "switchboard",
			label: "Agent stack switchboard",
			stackRoot,
			host: "127.0.0.1",
			port,
			binary: process.execPath,
			args: STUB_ARGS,
			adoptedPollIntervalMs: POLL_MS,
		};
	}

	function pidFilePath(spec: StackDaemonSpec): string {
		return join(spec.stackRoot, "logs", `${spec.name}.pid`);
	}

	async function supervise(spec: StackDaemonSpec): Promise<StackProcess> {
		const supervised = await superviseStackDaemon(spec, { warn: () => {}, log: () => {} });
		processes.push(supervised);
		return supervised;
	}

	it("adopts a port that is already served instead of double-binding it", async () => {
		const { server, port } = await listenOnFreePort();
		servers.push(server);
		const spec = makeSpec(port);

		const supervised = await supervise(spec);

		expect(supervised.spawned).toBe(false);
		expect(supervised.pid).toBeNull();
		await expect(supervised.ready).resolves.toBe(true);
		// Nothing of ours is running, so no pidfile may claim the port.
		expect(existsSync(pidFilePath(spec))).toBe(false);
	});

	it("takes the port over once its original owner disappears", async () => {
		const { server, port } = await listenOnFreePort();
		const spec = makeSpec(port);
		const supervised = await supervise(spec);
		expect(supervised.spawned).toBe(false);

		await closeServer(server);

		// Two consecutive failed probes, then a launch.
		const tookOver = await waitUntil(() => existsSync(pidFilePath(spec)), 5_000);
		expect(tookOver).toBe(true);
		const pid = Number(readFileSync(pidFilePath(spec), "utf8").trim());
		expect(Number.isInteger(pid)).toBe(true);
		expect(pid).toBeGreaterThan(0);
	});

	it("does not take over after a single failed probe", async () => {
		const { server, port } = await listenOnFreePort();
		const spec = makeSpec(port);
		await supervise(spec);

		await closeServer(server);
		// Long enough for exactly one probe to miss.
		await wait(POLL_MS + POLL_MS / 2);
		servers.push(await listenOnPort(port));

		await wait(POLL_MS * 6);
		expect(existsSync(pidFilePath(spec))).toBe(false);
	});

	it("cancels the watch on close, so a shutdown cannot spawn an orphan", async () => {
		const { server, port } = await listenOnFreePort();
		const spec = makeSpec(port);
		const supervised = await supervise(spec);

		await supervised.close();
		await closeServer(server);

		await wait(POLL_MS * 6);
		expect(existsSync(pidFilePath(spec))).toBe(false);
	});

	it("leaves an adopted daemon's pidfile alone on close", async () => {
		const { server, port } = await listenOnFreePort();
		servers.push(server);
		const spec = makeSpec(port);
		const supervised = await supervise(spec);

		await supervised.close();

		// The pidfile belongs to whoever started the daemon we adopted.
		expect(existsSync(pidFilePath(spec))).toBe(false);
	});
});

describe("superviseStackDaemon restart policy", () => {
	it("backs off further after each consecutive failure and caps", () => {
		expect(nextRestartDelayMs(1)).toBe(1_000);
		expect(nextRestartDelayMs(2)).toBe(2_000);
		expect(nextRestartDelayMs(3)).toBe(4_000);
		expect(nextRestartDelayMs(4)).toBe(8_000);
		expect(nextRestartDelayMs(5)).toBe(30_000);
		expect(nextRestartDelayMs(9)).toBe(30_000);
	});

	it("keeps restarting up to five consecutive failures and then gives up", () => {
		expect(shouldGiveUpRestarting(5)).toBe(false);
		expect(shouldGiveUpRestarting(6)).toBe(true);
	});
});

describe("buildStackEnv", () => {
	it("drops the inherited Anthropic vars so a daemon cannot dial the proxy that fronts it", () => {
		const previousBaseUrl = process.env.ANTHROPIC_BASE_URL;
		const previousApiKey = process.env.ANTHROPIC_API_KEY;
		process.env.ANTHROPIC_BASE_URL = "http://127.0.0.1:8000";
		process.env.ANTHROPIC_API_KEY = "sk-dummy-key-for-sandbox";
		try {
			const env = buildStackEnv();
			expect(env.ANTHROPIC_BASE_URL).toBeUndefined();
			expect(env.ANTHROPIC_API_KEY).toBeUndefined();
			expect(env.PATH).toBe(process.env.PATH);
		} finally {
			if (previousBaseUrl === undefined) {
				delete process.env.ANTHROPIC_BASE_URL;
			} else {
				process.env.ANTHROPIC_BASE_URL = previousBaseUrl;
			}
			if (previousApiKey === undefined) {
				delete process.env.ANTHROPIC_API_KEY;
			} else {
				process.env.ANTHROPIC_API_KEY = previousApiKey;
			}
		}
	});
});

describe("isStackFlagEnabled", () => {
	it("treats an unreadable flags file as every tool ON, matching activate-stack.sh", () => {
		expect(isStackFlagEnabled(null, "ENABLE_HEADROOM")).toBe(true);
	});

	it("treats a key absent from a readable file as OFF", () => {
		expect(isStackFlagEnabled({ ENABLE_CCR: true }, "ENABLE_HEADROOM")).toBe(false);
		expect(isStackFlagEnabled({ ENABLE_CCR: true }, "ENABLE_CCR")).toBe(true);
	});
});
