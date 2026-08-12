import { afterEach, describe, expect, it } from "vitest";

import { resolveDocSkillBaseUrl, resolveDocSkillPort } from "../../../src/doc-skill/doc-skill-endpoint";

const ENV_KEYS = ["PIXELOFFICE_DOCSKILL_URL", "PIXELOFFICE_DOCSKILL_PORT"] as const;
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

afterEach(() => {
	for (const key of ENV_KEYS) {
		delete process.env[key];
	}
});

describe("resolveDocSkillBaseUrl", () => {
	it("uses an explicit override over any env var", () => {
		withEnv({ PIXELOFFICE_DOCSKILL_URL: "http://127.0.0.1:9999" }, () => {
			expect(resolveDocSkillBaseUrl("http://example.test:1234")).toBe("http://example.test:1234");
		});
	});

	it("uses PIXELOFFICE_DOCSKILL_URL verbatim (stripping a trailing slash) when no override is given", () => {
		withEnv({ PIXELOFFICE_DOCSKILL_URL: "http://example.test:9999/" }, () => {
			expect(resolveDocSkillBaseUrl(undefined)).toBe("http://example.test:9999");
		});
	});

	it("honours PIXELOFFICE_DOCSKILL_PORT when no URL is set — the client must match the process supervisor's ladder", () => {
		withEnv({ PIXELOFFICE_DOCSKILL_PORT: "9321" }, () => {
			expect(resolveDocSkillBaseUrl(undefined)).toBe("http://127.0.0.1:9321");
		});
	});

	it("falls back to the default port when nothing is set", () => {
		withEnv({}, () => {
			expect(resolveDocSkillBaseUrl(undefined)).toBe("http://127.0.0.1:8323");
		});
	});
});

describe("resolveDocSkillPort", () => {
	it("prefers an explicit configured value over any env var", () => {
		withEnv({ PIXELOFFICE_DOCSKILL_URL: "http://127.0.0.1:1", PIXELOFFICE_DOCSKILL_PORT: "2" }, () => {
			expect(resolveDocSkillPort(3)).toBe(3);
		});
	});

	it("prefers the URL's port over PIXELOFFICE_DOCSKILL_PORT", () => {
		withEnv({ PIXELOFFICE_DOCSKILL_URL: "http://127.0.0.1:4321", PIXELOFFICE_DOCSKILL_PORT: "1" }, () => {
			expect(resolveDocSkillPort(undefined)).toBe(4321);
		});
	});

	it("falls back to PIXELOFFICE_DOCSKILL_PORT when no URL is set", () => {
		withEnv({ PIXELOFFICE_DOCSKILL_PORT: "5555" }, () => {
			expect(resolveDocSkillPort(undefined)).toBe(5555);
		});
	});

	it("falls back to the default port when nothing is set", () => {
		withEnv({}, () => {
			expect(resolveDocSkillPort(undefined)).toBe(8323);
		});
	});
});
