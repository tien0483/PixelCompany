import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { findDocSkillRoot, startDocSkillProcess } from "../../../src/doc-skill/doc-skill-process";

const ENV_KEYS = ["PIXELOFFICE_DOCSKILL_URL", "PIXELOFFICE_DOCSKILL_PORT"] as const;
type EnvKey = (typeof ENV_KEYS)[number];

async function withEnv<T>(overrides: Partial<Record<EnvKey, string | undefined>>, fn: () => Promise<T>): Promise<T> {
	const previous: Partial<Record<EnvKey, string | undefined>> = {};
	for (const key of ENV_KEYS) {
		previous[key] = process.env[key];
		const value = overrides[key];
		if (value === undefined) {
			delete process.env[key];
		} else {
			process.env[key] = value;
		}
	}
	try {
		return await fn();
	} finally {
		for (const key of ENV_KEYS) {
			if (previous[key] === undefined) {
				delete process.env[key];
			} else {
				process.env[key] = previous[key];
			}
		}
	}
}

async function listenOnFreePort(): Promise<{ port: number; close: () => Promise<void> }> {
	const server = createServer();
	await new Promise<void>((resolvePromise, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => resolvePromise());
	});
	const address = server.address();
	if (address === null || typeof address === "string") {
		throw new Error("expected a bound TCP address");
	}
	return {
		port: address.port,
		close: () => new Promise<void>((resolvePromise) => server.close(() => resolvePromise())),
	};
}

describe("findDocSkillRoot", () => {
	it("resolves the real vendored doc_skill root from this repo layout", () => {
		const root = findDocSkillRoot();
		expect(root).not.toBeNull();
	});
});

describe("startDocSkillProcess — root discovery via the docSkillRoot override", () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await mkdtemp(join(tmpdir(), "doc-skill-root-"));
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	it("accepts a directory containing the server/__main__.py marker", async () => {
		await mkdir(join(tempDir, "server"), { recursive: true });
		await writeFile(join(tempDir, "server", "__main__.py"), "# marker\n", "utf8");
		const { port, close } = await listenOnFreePort();
		await close(); // leave the port free so startDocSkillProcess proceeds past the adopt check

		const warn: string[] = [];
		const proc = await startDocSkillProcess({
			warn: (message) => warn.push(message),
			docSkillRoot: tempDir,
			host: "127.0.0.1",
			port,
		});

		// A valid marker means the process object reflects a real spawn attempt...
		expect(proc.spawned).toBe(true);
		expect(proc.pid).not.toBeNull();
		// ...even though the fake root has no real `server` package, so python3
		// fails fast to import it — that failure must never be reported as "not found".
		expect(warn.some((message) => message.includes("package not found"))).toBe(false);
		await proc.close();
	});

	it("rejects a directory missing the server/__main__.py marker", async () => {
		const { port, close } = await listenOnFreePort();
		await close();

		const warn: string[] = [];
		const proc = await startDocSkillProcess({
			warn: (message) => warn.push(message),
			docSkillRoot: tempDir,
			host: "127.0.0.1",
			port,
		});

		expect(proc.spawned).toBe(false);
		expect(proc.pid).toBeNull();
		await expect(proc.ready).resolves.toBe(false);
		expect(warn.some((message) => message.includes("package not found"))).toBe(true);
		await proc.close();
	});
});

describe("startDocSkillProcess — adopt vs. spawn", () => {
	it("adopts an already-listening port without spawning", async () => {
		const { port, close } = await listenOnFreePort();
		try {
			const warn: string[] = [];
			const log: string[] = [];
			const proc = await startDocSkillProcess({
				warn: (message) => warn.push(message),
				log: (message) => log.push(message),
				// Prove the adopt path short-circuits before root resolution would
				// even matter: null forces "not found" if it were ever consulted.
				docSkillRoot: null,
				host: "127.0.0.1",
				port,
			});

			expect(proc.spawned).toBe(false);
			expect(proc.pid).toBeNull();
			await expect(proc.ready).resolves.toBe(true);
			expect(warn).toHaveLength(0);
			expect(log.some((line) => line.includes("already listening"))).toBe(true);

			await proc.close();
		} finally {
			await close();
		}
	});

	it("warns and returns a never-fatal no-op process when the root cannot be found", async () => {
		const { port, close } = await listenOnFreePort();
		await close(); // free the port again so the port probe reports "closed"

		const warn: string[] = [];
		const proc = await startDocSkillProcess({
			warn: (message) => warn.push(message),
			docSkillRoot: null,
			host: "127.0.0.1",
			port,
		});

		expect(proc.spawned).toBe(false);
		expect(proc.pid).toBeNull();
		await expect(proc.ready).resolves.toBe(false);
		expect(warn.some((line) => line.includes("Docs stay offline"))).toBe(true);
		await proc.close();
	});
});

describe("startDocSkillProcess — port resolution precedence", () => {
	it("prefers the explicit port over any env var", async () => {
		const { port, close } = await listenOnFreePort();
		try {
			const proc = await withEnv(
				{ PIXELOFFICE_DOCSKILL_URL: "http://127.0.0.1:1", PIXELOFFICE_DOCSKILL_PORT: "2" },
				() => startDocSkillProcess({ warn: () => {}, docSkillRoot: null, host: "127.0.0.1", port }),
			);
			expect(proc.spawned).toBe(false);
			await expect(proc.ready).resolves.toBe(true);
			await proc.close();
		} finally {
			await close();
		}
	});

	it("prefers PIXELOFFICE_DOCSKILL_URL's port over PIXELOFFICE_DOCSKILL_PORT", async () => {
		const { port, close } = await listenOnFreePort();
		try {
			const proc = await withEnv(
				{ PIXELOFFICE_DOCSKILL_URL: `http://127.0.0.1:${port}`, PIXELOFFICE_DOCSKILL_PORT: "1" },
				() => startDocSkillProcess({ warn: () => {}, docSkillRoot: null }),
			);
			expect(proc.spawned).toBe(false);
			await expect(proc.ready).resolves.toBe(true);
			await proc.close();
		} finally {
			await close();
		}
	});

	it("falls back to PIXELOFFICE_DOCSKILL_PORT when no URL is set", async () => {
		const { port, close } = await listenOnFreePort();
		try {
			const proc = await withEnv({ PIXELOFFICE_DOCSKILL_PORT: String(port) }, () =>
				startDocSkillProcess({ warn: () => {}, docSkillRoot: null }),
			);
			expect(proc.spawned).toBe(false);
			await expect(proc.ready).resolves.toBe(true);
			await proc.close();
		} finally {
			await close();
		}
	});

	it("falls back to the default port 8323 when neither env var nor an explicit port is given", async () => {
		// Bind the literal default port so the adopt path's "already listening on
		// host:port" observation proves the resolver landed on 8323 specifically,
		// not just "some" port. A real dev sidecar could theoretically already
		// occupy 8323 — if so this test fails loudly on `listen`, which is a
		// clearer signal than silently skipping.
		const server = createServer();
		await new Promise<void>((resolvePromise, reject) => {
			server.once("error", reject);
			server.listen(8323, "127.0.0.1", () => resolvePromise());
		});
		try {
			const log: string[] = [];
			const proc = await withEnv({ PIXELOFFICE_DOCSKILL_URL: undefined, PIXELOFFICE_DOCSKILL_PORT: undefined }, () =>
				startDocSkillProcess({ warn: () => {}, log: (message) => log.push(message), docSkillRoot: null }),
			);
			expect(proc.spawned).toBe(false);
			await expect(proc.ready).resolves.toBe(true);
			expect(log.some((line) => line.includes("127.0.0.1:8323"))).toBe(true);
			await proc.close();
		} finally {
			await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
		}
	});
});

describe("startDocSkillProcess — spawns the real vendored sidecar", () => {
	it("spawns python3 -m server and becomes ready when the port is free", async () => {
		const { port, close } = await listenOnFreePort();
		await close(); // just reserving a free port number; must be closed before spawning

		const warn: string[] = [];
		const log: string[] = [];
		const proc = await startDocSkillProcess({
			warn: (message) => warn.push(message),
			log: (message) => log.push(message),
			host: "127.0.0.1",
			port,
		});

		expect(proc.spawned).toBe(true);
		expect(proc.pid).not.toBeNull();
		await expect(proc.ready).resolves.toBe(true);
		expect(warn).toHaveLength(0);

		await proc.close();
	}, 15_000);
});
