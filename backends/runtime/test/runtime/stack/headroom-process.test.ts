import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { buildHeadroomArgs, resolveHeadroomPort, startHeadroomProcess } from "../../../src/stack/headroom-process";
import {
	isStackFlagEnabled,
	nextRestartDelayMs,
	readStackFlags,
	shouldGiveUpRestarting,
} from "../../../src/stack/stack-daemon";
import { startCcrProcess, startDevToolsProcess } from "../../../src/stack/stack-extra-daemons";

const ENV_KEYS = ["STACK_HEADROOM_PORT", "STACK_CCR_PORT", "STACK_DEVTOOLS_PORT", "STACK_HEADROOM_BIN"] as const;

function clearStackEnv(): void {
	for (const key of ENV_KEYS) {
		delete process.env[key];
	}
}

async function makeStackRoot(flags: Record<string, boolean> | null): Promise<string> {
	const stackRoot = await mkdtemp(join(tmpdir(), "headroom-"));
	if (flags !== null) {
		writeFileSync(join(stackRoot, "stack-flags.json"), JSON.stringify(flags), "utf8");
	}
	return stackRoot;
}

/** A stand-in for `.venv/bin/headroom`, reached through the STACK_HEADROOM_BIN override. */
function writeFakeHeadroom(stackRoot: string, body: string): string {
	const binary = join(stackRoot, "fake-headroom");
	writeFileSync(binary, `#!/usr/bin/env bash\n${body}\n`, "utf8");
	chmodSync(binary, 0o755);
	process.env.STACK_HEADROOM_BIN = binary;
	return binary;
}

function listenOn(): Promise<{ port: number; server: Server }> {
	return new Promise((resolvePromise) => {
		const server = createServer();
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			resolvePromise({ port: typeof address === "object" && address !== null ? address.port : 0, server });
		});
	});
}

function waitFor(predicate: () => boolean, timeoutMs = 4_000): Promise<void> {
	return new Promise((resolvePromise, rejectPromise) => {
		const deadline = Date.now() + timeoutMs;
		const tick = () => {
			if (predicate()) {
				resolvePromise();
				return;
			}
			if (Date.now() > deadline) {
				rejectPromise(new Error("condition never became true"));
				return;
			}
			setTimeout(tick, 25);
		};
		tick();
	});
}

const openServers: Server[] = [];

afterEach(async () => {
	clearStackEnv();
	while (openServers.length > 0) {
		const server = openServers.pop();
		await new Promise((resolvePromise) => {
			server?.close(() => {
				resolvePromise(undefined);
			});
		});
	}
});

describe("resolveHeadroomPort", () => {
	it("prefers an explicit port, then the env, then 8787", () => {
		expect(resolveHeadroomPort(9000)).toBe(9000);
		process.env.STACK_HEADROOM_PORT = "9100";
		expect(resolveHeadroomPort()).toBe(9100);
		clearStackEnv();
		expect(resolveHeadroomPort()).toBe(8787);
	});

	it("ignores a non-numeric env port instead of producing NaN", () => {
		process.env.STACK_HEADROOM_PORT = "not-a-port";
		expect(resolveHeadroomPort()).toBe(8787);
	});
});

describe("stack flags", () => {
	it("defaults every tool ON when the flags file is unreadable, like the activator", async () => {
		const stackRoot = await makeStackRoot(null);
		expect(readStackFlags(stackRoot)).toBeNull();
		expect(isStackFlagEnabled(null, "ENABLE_HEADROOM")).toBe(true);
	});

	// `json.load(f).get(name)` → None → OFF, which is the asymmetry with the case above.
	it("treats a key absent from a readable file as OFF", async () => {
		const stackRoot = await makeStackRoot({ ENABLE_CCR: true });
		const flags = readStackFlags(stackRoot);
		expect(isStackFlagEnabled(flags, "ENABLE_HEADROOM")).toBe(false);
		expect(isStackFlagEnabled(flags, "ENABLE_CCR")).toBe(true);
	});
});

describe("buildHeadroomArgs", () => {
	it("proxies to Anthropic itself when CCR is off", () => {
		expect(buildHeadroomArgs({ host: "127.0.0.1", port: 8787, chainToCcr: false })).toEqual([
			"proxy",
			"--host",
			"127.0.0.1",
			"--port",
			"8787",
			"--mode",
			"cache",
		]);
	});

	// Headroom never chains on its own — this flag is what makes the hop real.
	it("chains to CCR only when asked, honouring STACK_CCR_PORT", () => {
		expect(buildHeadroomArgs({ host: "127.0.0.1", port: 8787, chainToCcr: true })).toContain("http://127.0.0.1:3456");
		process.env.STACK_CCR_PORT = "3999";
		expect(buildHeadroomArgs({ host: "127.0.0.1", port: 8787, chainToCcr: true })).toContain("http://127.0.0.1:3999");
	});
});

describe("restart policy", () => {
	it("backs off and then caps", () => {
		expect(nextRestartDelayMs(1)).toBe(1_000);
		expect(nextRestartDelayMs(4)).toBe(8_000);
		expect(nextRestartDelayMs(5)).toBe(30_000);
		expect(nextRestartDelayMs(99)).toBe(30_000);
	});

	it("gives up past five consecutive failures", () => {
		expect(shouldGiveUpRestarting(5)).toBe(false);
		expect(shouldGiveUpRestarting(6)).toBe(true);
	});
});

describe("startHeadroomProcess", () => {
	it("no-ops when no stack is installed", async () => {
		const logs: string[] = [];
		const warnings: string[] = [];
		const process_ = await startHeadroomProcess({
			stackRoot: null,
			warn: (message) => warnings.push(message),
			log: (message) => logs.push(message),
		});
		expect(process_.spawned).toBe(false);
		expect(await process_.ready).toBe(false);
		expect(warnings).toEqual([]);
		expect(logs.join(" ")).toContain("not installed");
	});

	it("respects ENABLE_HEADROOM: false without warning", async () => {
		const stackRoot = await makeStackRoot({ ENABLE_HEADROOM: false });
		const logs: string[] = [];
		const warnings: string[] = [];
		const process_ = await startHeadroomProcess({
			stackRoot,
			warn: (message) => warnings.push(message),
			log: (message) => logs.push(message),
		});
		expect(process_.spawned).toBe(false);
		expect(warnings).toEqual([]);
		expect(logs.join(" ")).toContain("disabled in stack-flags.json");
	});

	// An activated shell owns its own daemon; double-spawning would orphan a process on 8787.
	it("leaves an already-listening headroom alone", async () => {
		const stackRoot = await makeStackRoot({ ENABLE_HEADROOM: true });
		writeFakeHeadroom(stackRoot, "sleep 60");
		const { port, server } = await listenOn();
		openServers.push(server);
		const process_ = await startHeadroomProcess({ stackRoot, port, warn: () => {} });
		expect(process_.spawned).toBe(false);
		expect(process_.pid).toBeNull();
		expect(await process_.ready).toBe(true);
	});

	it("warns and stays offline when the binary is missing", async () => {
		const stackRoot = await makeStackRoot({ ENABLE_HEADROOM: true });
		const warnings: string[] = [];
		const process_ = await startHeadroomProcess({
			stackRoot,
			port: 0,
			warn: (message) => warnings.push(message),
		});
		expect(process_.spawned).toBe(false);
		expect(warnings.join(" ")).toContain("uv sync");
	});

	it("spawns the binary, records a pidfile, and stops it on close", async () => {
		const stackRoot = await makeStackRoot({ ENABLE_HEADROOM: true });
		const { port, server } = await listenOn();
		// Free the port again so the fake daemon can bind it itself.
		await new Promise((resolvePromise) => {
			server.close(() => resolvePromise(undefined));
		});
		writeFakeHeadroom(
			stackRoot,
			`exec python3 -c "import socket,time
s=socket.socket(); s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
s.bind(('127.0.0.1', ${String(port)})); s.listen(1); time.sleep(60)"`,
		);
		const warnings: string[] = [];
		const process_ = await startHeadroomProcess({ stackRoot, port, warn: (message) => warnings.push(message) });

		expect(process_.spawned).toBe(true);
		expect(await process_.ready).toBe(true);
		expect(readFileSync(join(stackRoot, "logs", "headroom.pid"), "utf8").trim()).toBe(String(process_.pid));
		expect(warnings).toEqual([]);

		await process_.close();
		// Closing must not be mistaken for a crash — no restart warning, no pidfile.
		expect(warnings).toEqual([]);
		expect(() => readFileSync(join(stackRoot, "logs", "headroom.pid"), "utf8")).toThrow();
	});

	// server.py reads this to decide whether a *running* headroom really reaches CCR.
	// Without it, turning ENABLE_CCR off left every request still crossing a headroom
	// that had been started with --anthropic-api-url pointed at CCR, so the flag looked
	// like it worked while the path never changed.
	it("records the chain it was actually started with, and clears it on close", async () => {
		const stackRoot = await makeStackRoot({ ENABLE_HEADROOM: true, ENABLE_CCR: true });
		const { port, server } = await listenOn();
		await new Promise((resolvePromise) => {
			server.close(() => resolvePromise(undefined));
		});
		writeFakeHeadroom(
			stackRoot,
			`exec python3 -c "import socket,time
s=socket.socket(); s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
s.bind(('127.0.0.1', ${String(port)})); s.listen(1); time.sleep(60)"`,
		);
		const process_ = await startHeadroomProcess({ stackRoot, port, warn: () => {} });
		expect(await process_.ready).toBe(true);
		expect(readFileSync(join(stackRoot, "logs", "headroom.chain"), "utf8").trim()).toBe("ccr");

		await process_.close();
		// A marker outliving its daemon would make server.py route around a hop that is gone.
		expect(() => readFileSync(join(stackRoot, "logs", "headroom.chain"), "utf8")).toThrow();
	});

	it("records a direct chain when CCR is off", async () => {
		const stackRoot = await makeStackRoot({ ENABLE_HEADROOM: true, ENABLE_CCR: false });
		const { port, server } = await listenOn();
		await new Promise((resolvePromise) => {
			server.close(() => resolvePromise(undefined));
		});
		writeFakeHeadroom(
			stackRoot,
			`exec python3 -c "import socket,time
s=socket.socket(); s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
s.bind(('127.0.0.1', ${String(port)})); s.listen(1); time.sleep(60)"`,
		);
		const process_ = await startHeadroomProcess({ stackRoot, port, warn: () => {} });
		expect(await process_.ready).toBe(true);
		expect(readFileSync(join(stackRoot, "logs", "headroom.chain"), "utf8").trim()).toBe("direct");
		await process_.close();
	});

	it("schedules a restart when the proxy dies, and cancels it on close", async () => {
		const stackRoot = await makeStackRoot({ ENABLE_HEADROOM: true });
		mkdirSync(join(stackRoot, "logs"), { recursive: true });
		writeFakeHeadroom(stackRoot, "exit 3");
		const warnings: string[] = [];
		const process_ = await startHeadroomProcess({
			stackRoot,
			// An unbindable port: readiness must fail on its own rather than hang.
			port: 1,
			warn: (message) => warnings.push(message),
		});
		expect(process_.spawned).toBe(true);
		await waitFor(() => warnings.some((message) => message.includes("restarting in 1s")));
		expect(warnings.join(" ")).toContain("code 3");
		await process_.close();
	});

	it("keeps the daemon's output in logs/headroom.log", async () => {
		const stackRoot = await makeStackRoot({ ENABLE_HEADROOM: true });
		writeFakeHeadroom(stackRoot, "echo headroom-fake-banner; exit 0");
		const process_ = await startHeadroomProcess({ stackRoot, port: 1, warn: () => {} });
		await waitFor(() => {
			try {
				return readFileSync(join(stackRoot, "logs", "headroom.log"), "utf8").includes("headroom-fake-banner");
			} catch {
				return false;
			}
		});
		await process_.close();
	});
});

describe("startCcrProcess", () => {
	// Both extra daemons ship flagged OFF, so a default checkout must stay quiet.
	it("stays offline while ENABLE_CCR is false", async () => {
		const stackRoot = await makeStackRoot({ ENABLE_CCR: false });
		const warnings: string[] = [];
		const logs: string[] = [];
		const process_ = await startCcrProcess({
			stackRoot,
			warn: (message) => warnings.push(message),
			log: (message) => logs.push(message),
		});
		expect(process_.spawned).toBe(false);
		expect(warnings).toEqual([]);
		expect(logs.join(" ")).toContain("disabled in stack-flags.json");
	});

	it("warns when flagged on but not installed", async () => {
		const stackRoot = await makeStackRoot({ ENABLE_CCR: true });
		const warnings: string[] = [];
		const process_ = await startCcrProcess({ stackRoot, port: 0, warn: (message) => warnings.push(message) });
		expect(process_.spawned).toBe(false);
		expect(warnings.join(" ")).toContain("flagged on but not installed");
	});
});

describe("startDevToolsProcess", () => {
	it("stays offline while ENABLE_DEVTOOLS is false", async () => {
		const stackRoot = await makeStackRoot({ ENABLE_DEVTOOLS: false });
		const warnings: string[] = [];
		const process_ = await startDevToolsProcess({ stackRoot, warn: (message) => warnings.push(message) });
		expect(process_.spawned).toBe(false);
		expect(warnings).toEqual([]);
	});

	it("warns when flagged on with neither build present", async () => {
		const stackRoot = await makeStackRoot({ ENABLE_DEVTOOLS: true });
		const warnings: string[] = [];
		const process_ = await startDevToolsProcess({ stackRoot, port: 0, warn: (message) => warnings.push(message) });
		expect(process_.spawned).toBe(false);
		expect(warnings.join(" ")).toContain("neither");
	});

	// The standalone server defaults to 3456 — CCR's port — so PORT must be explicit.
	it("prefers the standalone build and pins its port", async () => {
		const stackRoot = await makeStackRoot({ ENABLE_DEVTOOLS: true });
		const standaloneDir = join(stackRoot, "src-claude-devtools", "dist-standalone");
		mkdirSync(standaloneDir, { recursive: true });
		const { port, server } = await listenOn();
		await new Promise((resolvePromise) => {
			server.close(() => resolvePromise(undefined));
		});
		writeFileSync(
			join(standaloneDir, "index.cjs"),
			`const net = require("node:net");
net.createServer().listen(Number(process.env.PORT), process.env.HOST);
setTimeout(() => {}, 60000);`,
			"utf8",
		);
		const warnings: string[] = [];
		const process_ = await startDevToolsProcess({ stackRoot, port, warn: (message) => warnings.push(message) });
		expect(process_.spawned).toBe(true);
		expect(await process_.ready).toBe(true);
		expect(warnings).toEqual([]);
		await process_.close();
	});
});
