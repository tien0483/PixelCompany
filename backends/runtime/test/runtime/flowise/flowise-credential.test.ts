import { mkdtempSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { ensureFlowiseEmbedCredential, seedFlowiseEmbedAccount } from "../../../src/flowise/flowise-credential";

function makeDataDir(): string {
	return mkdtempSync(join(tmpdir(), "flowise-cred-"));
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("ensureFlowiseEmbedCredential", () => {
	it("generates a password the studio's own rules accept", async () => {
		const credential = await ensureFlowiseEmbedCredential(makeDataDir());
		// Upstream's passwordSchema: >=8 chars, lower, upper, digit, special.
		expect(credential.password.length).toBeGreaterThanOrEqual(8);
		expect(credential.password).toMatch(/[a-z]/);
		expect(credential.password).toMatch(/[A-Z]/);
		expect(credential.password).toMatch(/\d/);
		expect(credential.password).toMatch(/[^a-zA-Z0-9]/);
	});

	it("writes the file 0600 and reuses it verbatim", async () => {
		const dataDir = makeDataDir();
		const first = await ensureFlowiseEmbedCredential(dataDir);
		const path = join(dataDir, "embed-credential.json");
		expect(statSync(path).mode & 0o777).toBe(0o600);

		// Rotating would lock the embed out of the account it already registered.
		const second = await ensureFlowiseEmbedCredential(dataDir);
		expect(second).toEqual(first);
	});

	it("replaces a malformed file instead of throwing", async () => {
		const dataDir = makeDataDir();
		const credential = await ensureFlowiseEmbedCredential(dataDir);
		expect(credential.email.endsWith(".local")).toBe(true);
		const stored: unknown = JSON.parse(await readFile(join(dataDir, "embed-credential.json"), "utf8"));
		expect(stored).toEqual(credential);
	});
});

describe("seedFlowiseEmbedAccount", () => {
	it("skips registration when the seeded account already logs in", async () => {
		const calls: string[] = [];
		vi.stubGlobal("fetch", async (url: string) => {
			calls.push(String(url));
			return new Response("{}", { status: 200 });
		});
		const seeded = await seedFlowiseEmbedAccount({
			baseUrl: "http://127.0.0.1:3010",
			dataDir: makeDataDir(),
			warn: () => {},
		});
		expect(seeded).toBe(true);
		expect(calls).toEqual(["http://127.0.0.1:3010/api/v1/auth/login"]);
	});

	it("registers when the login probe fails, then reports success", async () => {
		const calls: string[] = [];
		vi.stubGlobal("fetch", async (url: string) => {
			const path = String(url);
			calls.push(path);
			if (path.endsWith("/auth/login") && calls.length === 1) {
				return new Response("{}", { status: 401 });
			}
			return new Response("{}", { status: 200 });
		});
		const seeded = await seedFlowiseEmbedAccount({
			baseUrl: "http://127.0.0.1:3010",
			dataDir: makeDataDir(),
			warn: () => {},
		});
		expect(seeded).toBe(true);
		expect(calls[1]).toBe("http://127.0.0.1:3010/api/v1/account/register");
	});

	it("explains the drifted-account case rather than retrying forever", async () => {
		const warnings: string[] = [];
		vi.stubGlobal("fetch", async (url: string) => {
			// The studio's database outlived the credential file: login fails and the email is
			// already taken, so registration fails too.
			return new Response(String(url).endsWith("/account/register") ? "email exists" : "{}", { status: 401 });
		});
		const seeded = await seedFlowiseEmbedAccount({
			baseUrl: "http://127.0.0.1:3010",
			dataDir: makeDataDir(),
			warn: (message) => warnings.push(message),
		});
		expect(seeded).toBe(false);
		expect(warnings.some((message) => message.includes("different password"))).toBe(true);
	});

	it("returns false when the studio is unreachable", async () => {
		vi.stubGlobal("fetch", async () => {
			throw new Error("ECONNREFUSED");
		});
		const warnings: string[] = [];
		const seeded = await seedFlowiseEmbedAccount({
			baseUrl: "http://127.0.0.1:3010",
			dataDir: makeDataDir(),
			warn: (message) => warnings.push(message),
		});
		expect(seeded).toBe(false);
		expect(warnings.some((message) => message.includes("Could not reach"))).toBe(true);
	});
});
