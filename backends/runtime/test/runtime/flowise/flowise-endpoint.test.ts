import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
	DEFAULT_FLOWISE_PORT,
	findFlowiseRoot,
	resolveFlowiseBaseUrl,
	resolveFlowisePort,
} from "../../../src/flowise/flowise-endpoint";

const ENV_KEYS = ["PIXELOFFICE_FLOWISE_URL", "PIXELOFFICE_FLOWISE_PORT", "PIXELOFFICE_FLOWISE_ROOT"] as const;
type EnvKey = (typeof ENV_KEYS)[number];

function withEnv<T>(overrides: Partial<Record<EnvKey, string | undefined>>, fn: () => T): T {
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
		return fn();
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

describe("resolveFlowisePort", () => {
	it("prefers an explicit value over every env var", () => {
		withEnv({ PIXELOFFICE_FLOWISE_URL: "http://127.0.0.1:9999", PIXELOFFICE_FLOWISE_PORT: "8888" }, () => {
			expect(resolveFlowisePort(3011)).toBe(3011);
		});
	});

	it("reads the port out of the URL before the port env var", () => {
		withEnv({ PIXELOFFICE_FLOWISE_URL: "http://127.0.0.1:9999", PIXELOFFICE_FLOWISE_PORT: "8888" }, () => {
			expect(resolveFlowisePort(undefined)).toBe(9999);
		});
	});

	it("falls back to the port env var, then to the default", () => {
		withEnv({ PIXELOFFICE_FLOWISE_PORT: "8888" }, () => {
			expect(resolveFlowisePort(undefined)).toBe(8888);
		});
		withEnv({}, () => {
			expect(resolveFlowisePort(undefined)).toBe(DEFAULT_FLOWISE_PORT);
		});
	});

	it("ignores a non-numeric port env var rather than yielding NaN", () => {
		withEnv({ PIXELOFFICE_FLOWISE_PORT: "not-a-port" }, () => {
			expect(resolveFlowisePort(undefined)).toBe(DEFAULT_FLOWISE_PORT);
		});
	});

	it("stays clear of the DevTools and CCR ports", () => {
		// 3000 is upstream's default and 3001/3456/3460+ are taken by other daemons here, so
		// a change to DEFAULT_FLOWISE_PORT that collides should fail loudly.
		expect([3000, 3001, 3456, 3457, 3458, 3459, 3460, 3484, 5173]).not.toContain(DEFAULT_FLOWISE_PORT);
	});
});

describe("resolveFlowiseBaseUrl", () => {
	it("uses the configured URL verbatim, minus a trailing slash", () => {
		withEnv({}, () => {
			expect(resolveFlowiseBaseUrl("http://127.0.0.1:4000/")).toBe("http://127.0.0.1:4000");
		});
	});

	it("honours a bare port override so the client and the supervisor agree", () => {
		withEnv({ PIXELOFFICE_FLOWISE_PORT: "8888" }, () => {
			expect(resolveFlowiseBaseUrl(undefined)).toBe("http://127.0.0.1:8888");
		});
	});
});

describe("findFlowiseRoot", () => {
	it("accepts an explicit root that holds the server package", () => {
		const root = mkdtempSync(join(tmpdir(), "flowise-root-"));
		mkdirSync(join(root, "packages", "server"), { recursive: true });
		writeFileSync(join(root, "packages", "server", "package.json"), "{}", "utf8");
		withEnv({ PIXELOFFICE_FLOWISE_ROOT: root }, () => {
			expect(findFlowiseRoot()).toBe(root);
		});
	});

	it("rejects an explicit root that is an empty submodule dir", () => {
		// The uninitialized-submodule case: the dir exists but has no server package, and the
		// Agents tab must read that as "not installed" rather than trying to spawn it.
		const root = mkdtempSync(join(tmpdir(), "flowise-empty-"));
		withEnv({ PIXELOFFICE_FLOWISE_ROOT: root }, () => {
			expect(findFlowiseRoot()).toBeNull();
		});
	});
});
