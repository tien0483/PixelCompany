import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { startHtmlProcess } from "../../../src/html/html-process";

/**
 * Covers the adopt-or-refuse decision `startHtmlProcess` makes when something is
 * already listening on the sidecar port. The full app and the standalone Plan
 * Editor package supervise sidecars that resolve *different* agent-data roots, so
 * adopting purely on "port answers" served one install's template list to the
 * other (86 repo templates in a package that ships three).
 */

interface FakeSidecar {
	port: number;
	close: () => Promise<void>;
}

async function startFakeSidecar(body: Record<string, unknown> | null): Promise<FakeSidecar> {
	const server: Server = createServer((request, response) => {
		if (request.url === "/api/agent-data-root" && body !== null) {
			response.writeHead(200, { "content-type": "application/json" });
			response.end(JSON.stringify(body));
			return;
		}
		response.writeHead(404).end();
	});
	await new Promise<void>((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
	const { port } = server.address() as AddressInfo;
	return {
		port,
		close: () => new Promise<void>((resolvePromise) => server.close(() => resolvePromise())),
	};
}

let sidecar: FakeSidecar | null = null;

afterEach(async () => {
	await sidecar?.close();
	sidecar = null;
});

describe("startHtmlProcess with an occupied port", () => {
	it("refuses a sidecar serving another install's template skills", async () => {
		sidecar = await startFakeSidecar({ templateSkillsDir: "/elsewhere/agent-data/templates/skills" });
		const warnings: string[] = [];

		const process_ = await startHtmlProcess({
			warn: (message) => warnings.push(message),
			htmlRoot: null,
			host: "127.0.0.1",
			port: sidecar.port,
			expectedTemplateSkillsDir: "/install/agent-data/templates/skills",
		});

		expect(await process_.ready).toBe(false);
		expect(process_.spawned).toBe(false);
		expect(warnings.join("\n")).toContain("belongs to another install");
	});

	it("adopts a sidecar serving the expected template skills", async () => {
		sidecar = await startFakeSidecar({ templateSkillsDir: "/install/agent-data/templates/skills" });
		const warnings: string[] = [];

		const process_ = await startHtmlProcess({
			warn: (message) => warnings.push(message),
			htmlRoot: null,
			host: "127.0.0.1",
			port: sidecar.port,
			expectedTemplateSkillsDir: "/install/agent-data/templates/skills",
		});

		expect(await process_.ready).toBe(true);
		expect(warnings).toEqual([]);
	});

	it("adopts a sidecar too old to report its root rather than failing closed", async () => {
		sidecar = await startFakeSidecar(null);
		const warnings: string[] = [];

		const process_ = await startHtmlProcess({
			warn: (message) => warnings.push(message),
			htmlRoot: null,
			host: "127.0.0.1",
			port: sidecar.port,
			expectedTemplateSkillsDir: "/install/agent-data/templates/skills",
		});

		expect(await process_.ready).toBe(true);
		expect(warnings).toEqual([]);
	});
});
