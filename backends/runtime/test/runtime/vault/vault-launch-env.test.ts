import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtimeHome = { path: "" };

vi.mock("../../../src/state/workspace-state", () => ({
	getRuntimeHomePath: () => runtimeHome.path,
}));

import { writeVaultFile } from "../../../src/vault/vault-store";
import { collectVaultLaunchEnv } from "../../../src/vault/vault-launch-env";

describe("vault-launch-env", () => {
	beforeEach(async () => {
		runtimeHome.path = await mkdtemp(join(tmpdir(), "pixtiel-vault-launch-test-"));
	});

	afterEach(async () => {
		if (runtimeHome.path) {
			await rm(runtimeHome.path, { recursive: true, force: true });
			runtimeHome.path = "";
		}
	});

	it("empty vault returns empty env and empty mcpEnvByServerId (noop property)", async () => {
		const result = await collectVaultLaunchEnv(["github", "filesystem"]);
		expect(result).toEqual({
			env: {},
			mcpEnvByServerId: {},
		});
	});

	it("returns empty env and empty mcpEnvByServerId when mcpServerIds is empty or null", async () => {
		const resultEmpty = await collectVaultLaunchEnv([]);
		expect(resultEmpty).toEqual({ env: {}, mcpEnvByServerId: {} });

		const resultNull = await collectVaultLaunchEnv(null);
		expect(resultNull).toEqual({ env: {}, mcpEnvByServerId: {} });
	});

	it("collects GH_TOKEN when GitHub PAT entry is present in vault", async () => {
		await writeVaultFile("github", {
			authKind: "pat",
			accessToken: "ghp_1234567890abcdefghijklmnopqrstuvwxyz",
			username: "octocat",
			host: "github.com",
			updatedAt: new Date().toISOString(),
		});

		const result = await collectVaultLaunchEnv();
		expect(result.env).toEqual({
			GH_TOKEN: "ghp_1234567890abcdefghijklmnopqrstuvwxyz",
		});
		expect(result.mcpEnvByServerId).toEqual({});
	});

	it("ignores invalid or missing GitHub PAT entry gracefully", async () => {
		// Schema requires authKind: "pat" and non-empty accessToken
		await writeVaultFile("github", {
			authKind: "invalid",
			accessToken: "",
		});

		const result = await collectVaultLaunchEnv();
		expect(result.env.GH_TOKEN).toBeUndefined();
	});

	it("collects MCP secrets only for requested server IDs", async () => {
		await writeVaultFile("mcp:filesystem", {
			env: { FS_ROOT: "/allowed/path", DEBUG_FS: "1" },
			updatedAt: new Date().toISOString(),
		});
		await writeVaultFile("mcp:custom-tool", {
			env: { CUSTOM_API_KEY: "secret-key-123" },
			updatedAt: new Date().toISOString(),
		});
		await writeVaultFile("mcp:unrequested", {
			env: { UNREQUESTED_KEY: "should-not-appear" },
			updatedAt: new Date().toISOString(),
		});

		const result = await collectVaultLaunchEnv(["filesystem", "custom-tool"]);
		expect(result.mcpEnvByServerId).toEqual({
			filesystem: { FS_ROOT: "/allowed/path", DEBUG_FS: "1" },
			"custom-tool": { CUSTOM_API_KEY: "secret-key-123" },
		});
		expect(result.mcpEnvByServerId.unrequested).toBeUndefined();
	});

	it("tolerates corrupted or schema-invalid MCP vault entries without throwing", async () => {
		const vaultDir = join(runtimeHome.path, "vault");
		await import("node:fs/promises").then((fs) => fs.mkdir(vaultDir, { recursive: true }));
		await writeFile(join(vaultDir, "mcp:corrupt.json"), "{ invalid-json", "utf8");
		await writeVaultFile("mcp:invalid-schema", { notEnv: "bad" });

		const result = await collectVaultLaunchEnv(["corrupt", "invalid-schema"]);
		expect(result.mcpEnvByServerId).toEqual({});
	});

	it("collects both GH_TOKEN and MCP secrets simultaneously", async () => {
		await writeVaultFile("github", {
			authKind: "pat",
			accessToken: "ghp_full_access_token",
			username: "dev",
			host: "github.com",
			updatedAt: new Date().toISOString(),
		});
		await writeVaultFile("mcp:sentry", {
			env: { SENTRY_AUTH_TOKEN: "sntrys_xyz" },
			updatedAt: new Date().toISOString(),
		});

		const result = await collectVaultLaunchEnv(["sentry"]);
		expect(result.env).toEqual({ GH_TOKEN: "ghp_full_access_token" });
		expect(result.mcpEnvByServerId).toEqual({
			sentry: { SENTRY_AUTH_TOKEN: "sntrys_xyz" },
		});
	});
});
