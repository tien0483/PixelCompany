import { mkdtempSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { startFlowiseProcess } from "../../../src/flowise/flowise-process";

function listenOnEphemeralPort(): Promise<{ server: Server; port: number }> {
	return new Promise((resolve, reject) => {
		const server = createServer();
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			if (address === null || typeof address === "string") {
				reject(new Error("Expected a TCP address"));
				return;
			}
			resolve({ server, port: address.port });
		});
	});
}

const openServers: Server[] = [];

afterEach(async () => {
	while (openServers.length > 0) {
		const server = openServers.pop();
		if (server !== undefined) {
			await new Promise<void>((resolve) => server.close(() => resolve()));
		}
	}
});

describe("startFlowiseProcess", () => {
	it("reports not-installed without spawning when the submodule is absent", async () => {
		const messages: string[] = [];
		const warnings: string[] = [];
		const studio = await startFlowiseProcess({
			warn: (message) => warnings.push(message),
			log: (message) => messages.push(message),
			flowiseRoot: null,
			// An unused port, so the probe finds nothing and the root check is what decides.
			port: 59_912,
		});
		expect(studio.spawned).toBe(false);
		expect(studio.pid).toBeNull();
		await expect(studio.ready).resolves.toBe(false);
		// A fresh clone has no submodule; that is a normal state, so it must not warn.
		expect(warnings).toEqual([]);
		expect(messages.some((message) => message.includes("not installed"))).toBe(true);
		await studio.close();
	});

	it("adopts an already-listening studio instead of fighting for the port", async () => {
		const { server, port } = await listenOnEphemeralPort();
		openServers.push(server);
		const messages: string[] = [];
		const studio = await startFlowiseProcess({
			warn: () => {},
			log: (message) => messages.push(message),
			// A root is supplied to prove the probe wins: adoption happens before any build check.
			flowiseRoot: mkdtempSync(join(tmpdir(), "flowise-adopt-")),
			port,
		});
		expect(studio.spawned).toBe(false);
		await expect(studio.ready).resolves.toBe(true);
		expect(messages.some((message) => message.includes("already listening"))).toBe(true);
		// Closing must be a no-op for an adopted studio — a hand-started one keeps ownership.
		await studio.close();
		expect(server.listening).toBe(true);
	});

	it("warns with an install hint when the submodule is present but unbuilt", async () => {
		const warnings: string[] = [];
		const studio = await startFlowiseProcess({
			warn: (message) => warnings.push(message),
			log: () => {},
			flowiseRoot: mkdtempSync(join(tmpdir(), "flowise-unbuilt-")),
			port: 59_913,
		});
		expect(studio.spawned).toBe(false);
		await expect(studio.ready).resolves.toBe(false);
		expect(warnings.some((message) => message.includes("build missing"))).toBe(true);
		expect(warnings.some((message) => message.includes("git submodule update --init"))).toBe(true);
		await studio.close();
	});
});
