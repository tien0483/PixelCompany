import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
	ensureAuthDir,
	readAuthFile,
	readBrandEnv,
	resolveAuthMode,
	validateGoogleConfig,
	writeAuthFile,
} from "../../../src/security/auth-mode";

describe("security/auth-mode", () => {
	describe("readBrandEnv", () => {
		it("reads PIXTIEL_ prefixed env vars first", () => {
			const env = {
				PIXTIEL_AUTH_MODE: "google",
				PIXELOFFICE_AUTH_MODE: "passcode",
				AUTH_MODE: "off",
			};
			expect(readBrandEnv("AUTH_MODE", env)).toBe("google");
		});

		it("falls back to legacy PIXELOFFICE_ and PIXEL_OFFICE_ names", () => {
			const env1 = { PIXELOFFICE_AUTH_MODE: "passcode" };
			expect(readBrandEnv("AUTH_MODE", env1)).toBe("passcode");

			const env2 = { PIXEL_OFFICE_AUTH_MODE: "passcode" };
			expect(readBrandEnv("AUTH_MODE", env2)).toBe("passcode");
		});

		it("falls back to un-prefixed name", () => {
			const env = { AUTH_MODE: "off" };
			expect(readBrandEnv("AUTH_MODE", env)).toBe("off");
		});

		it("returns undefined for empty/absent vars", () => {
			expect(readBrandEnv("NONEXISTENT", {})).toBeUndefined();
			expect(readBrandEnv("EMPTY", { PIXTIEL_EMPTY: "  " })).toBeUndefined();
		});
	});

	describe("resolveAuthMode", () => {
		it("prefers CLI flag over env var and host default", () => {
			const mode = resolveAuthMode({
				cliFlag: "off",
				env: { PIXTIEL_AUTH_MODE: "google" },
				isRemote: true,
			});
			expect(mode).toBe("off");
		});

		it("resolves google and passcode from CLI flag", () => {
			expect(resolveAuthMode({ cliFlag: "google", isRemote: false })).toBe("google");
			expect(resolveAuthMode({ cliFlag: "passcode", isRemote: false })).toBe("passcode");
		});

		it("throws on invalid CLI flag", () => {
			expect(() => resolveAuthMode({ cliFlag: "invalid" })).toThrow(/Invalid --auth-mode/);
		});

		it("resolves from environment variable when CLI flag is absent", () => {
			expect(resolveAuthMode({ env: { PIXTIEL_AUTH_MODE: "google" }, isRemote: false })).toBe("google");
			expect(resolveAuthMode({ env: { PIXELOFFICE_AUTH_MODE: "passcode" }, isRemote: false })).toBe("passcode");
			expect(resolveAuthMode({ env: { PIXTIEL_AUTH_MODE: "off" }, isRemote: true })).toBe("off");
		});

		it("throws on invalid environment variable", () => {
			expect(() => resolveAuthMode({ env: { PIXTIEL_AUTH_MODE: "oauth" } })).toThrow(/Invalid PIXTIEL_AUTH_MODE/);
		});

		it("falls back to default based on isRemote", () => {
			expect(resolveAuthMode({ isRemote: false })).toBe("off");
			expect(resolveAuthMode({ isRemote: true })).toBe("passcode");
		});
	});

	describe("auth file store (0700 dir, 0600 file)", () => {
		let testHome: string;

		beforeEach(async () => {
			testHome = await mkdtemp(join(tmpdir(), "pixtiel-auth-test-"));
		});

		afterEach(async () => {
			await rm(testHome, { recursive: true, force: true });
		});

		it("creates auth directory with 0700 permissions and files with 0600", async () => {
			await writeAuthFile("test-config", { key: "secret-value" }, testHome);

			const dirStat = await stat(join(testHome, "auth"));
			const dirMode = (dirStat.mode & 0o777).toString(8);
			expect(dirMode).toBe("700");

			const fileStat = await stat(join(testHome, "auth", "test-config.json"));
			const fileMode = (fileStat.mode & 0o777).toString(8);
			expect(fileMode).toBe("600");

			const loaded = await readAuthFile<{ key: string }>("test-config", testHome);
			expect(loaded).toEqual({ key: "secret-value" });
		});

		it("returns null for non-existent auth file", async () => {
			const loaded = await readAuthFile("missing-file", testHome);
			expect(loaded).toBeNull();
		});
	});

	describe("validateGoogleConfig", () => {
		let testHome: string;

		beforeEach(async () => {
			testHome = await mkdtemp(join(tmpdir(), "pixtiel-google-cfg-test-"));
		});

		afterEach(async () => {
			await rm(testHome, { recursive: true, force: true });
		});

		it("returns invalid with missing items when no config is present", async () => {
			const result = await validateGoogleConfig({
				runtimeHome: testHome,
				env: {},
				publicOriginOverride: "http://localhost:3484",
			});

			expect(result.valid).toBe(false);
			expect(result.missing.length).toBeGreaterThan(0);
			expect(result.errorMessage).toContain("Google Client ID");
			expect(result.errorMessage).toContain("Google Client Secret");
			expect(result.errorMessage).toContain("Allowed users list");
			expect(result.errorMessage).toContain("http://localhost:3484/api/auth/google/callback");
		});

		it("validates successfully with environment variables and allowed-users file", async () => {
			await writeAuthFile("allowed-users", ["alice@example.com", "bob@example.com"], testHome);

			const result = await validateGoogleConfig({
				runtimeHome: testHome,
				env: {
					PIXTIEL_GOOGLE_CLIENT_ID: "client-id-123.apps.googleusercontent.com",
					PIXTIEL_GOOGLE_CLIENT_SECRET: "GOCSPX-secret456",
					PIXTIEL_PUBLIC_ORIGIN: "https://my-kanban.example.com",
				},
			});

			expect(result.valid).toBe(true);
			expect(result.config).toBeDefined();
			expect(result.config?.clientId).toBe("client-id-123.apps.googleusercontent.com");
			expect(result.config?.clientSecret).toBe("GOCSPX-secret456");
			expect(result.config?.publicOrigin).toBe("https://my-kanban.example.com");
			expect(result.config?.redirectUri).toBe("https://my-kanban.example.com/api/auth/google/callback");
			expect(result.config?.allowedEmails).toEqual(["alice@example.com", "bob@example.com"]);
		});

		it("validates successfully with google-oauth.json and allowed-users.json files", async () => {
			await writeAuthFile(
				"google-oauth",
				{
					web: {
						client_id: "file-client-id.apps.googleusercontent.com",
						client_secret: "file-client-secret",
					},
				},
				testHome,
			);
			await writeAuthFile("allowed-users", { allowed: ["dev@company.com"] }, testHome);

			const result = await validateGoogleConfig({
				runtimeHome: testHome,
				env: {
					PIXTIEL_PUBLIC_ORIGIN: "http://localhost:3484",
				},
			});

			expect(result.valid).toBe(true);
			expect(result.config?.clientId).toBe("file-client-id.apps.googleusercontent.com");
			expect(result.config?.clientSecret).toBe("file-client-secret");
			expect(result.config?.allowedEmails).toEqual(["dev@company.com"]);
		});

		it("rejects empty allowed-users list", async () => {
			await writeAuthFile("allowed-users", [], testHome);

			const result = await validateGoogleConfig({
				runtimeHome: testHome,
				env: {
					PIXTIEL_GOOGLE_CLIENT_ID: "client-id-123",
					PIXTIEL_GOOGLE_CLIENT_SECRET: "secret-456",
					PIXTIEL_PUBLIC_ORIGIN: "http://localhost:3484",
				},
			});

			expect(result.valid).toBe(false);
			expect(result.missing.some((m) => m.includes("Allowed users"))).toBe(true);
		});
	});
});
