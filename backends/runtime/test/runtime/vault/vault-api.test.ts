import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtimeHome = { path: "" };

vi.mock("../../../src/state/workspace-state", () => ({
	getRuntimeHomePath: () => runtimeHome.path,
}));

const mockGitlabCred = { cred: null as unknown };

vi.mock("../../../src/gitlab/gitlab-credentials", () => ({
	readGitlabCredential: vi.fn().mockImplementation(() => Promise.resolve(mockGitlabCred.cred)),
	clearGitlabCredential: vi.fn().mockImplementation(() => Promise.resolve()),
}));

import { createVaultApi } from "../../../src/trpc/vault-api";
import {
	GithubVaultEntrySchema,
	McpVaultEntrySchema,
	readVaultFile,
	writeVaultFile,
} from "../../../src/vault";

describe("vault-api tRPC service", () => {
	beforeEach(async () => {
		runtimeHome.path = await mkdtemp(join(tmpdir(), "vault-api-test-"));
		mockGitlabCred.cred = null;
	});

	afterEach(async () => {
		if (runtimeHome.path) {
			await rm(runtimeHome.path, { recursive: true, force: true });
			runtimeHome.path = "";
		}
		vi.restoreAllMocks();
	});

	describe("vault.list redaction and summary properties", () => {
		it("returns redacted GitHub shapes and NEVER leaks stored PAT in JSON.stringify", async () => {
			const SECRET_PAT = "ghp_VERY_SECRET_TOKEN_9999888877776666";

			// Store a secret token in vault
			await writeVaultFile("github", {
				authKind: "pat",
				accessToken: SECRET_PAT,
				username: "octocat",
				host: "github.com",
				updatedAt: "2026-09-01T00:00:00.000Z",
			});

			// Store an MCP secret in vault
			const SECRET_MCP_KEY = "sk-super-secret-mcp-api-key-123456";
			await writeVaultFile("mcp:postgres", {
				env: {
					DATABASE_URL: "postgres://user:secretpw@localhost:5432/db",
					OPENAI_API_KEY: SECRET_MCP_KEY,
				},
				updatedAt: "2026-09-01T00:00:00.000Z",
			});

			const api = createVaultApi();
			const list = await api.list();

			// 1. Check GitHub entry shape
			const ghEntry = list.find((e) => e.service === "github");
			expect(ghEntry).toBeDefined();
			expect(ghEntry?.source).toBe("vault");
			expect(ghEntry?.username).toBe("octocat");
			expect(ghEntry?.last4).toBe("6666");

			// 2. Check MCP entry shape
			const mcpEntry = list.find((e) => e.service === "mcp:postgres");
			expect(mcpEntry).toBeDefined();
			expect(mcpEntry?.source).toBe("vault");
			expect(mcpEntry?.kind).toBe("mcp");
			expect(mcpEntry?.keys).toEqual(["DATABASE_URL", "OPENAI_API_KEY"]);

			// 3. CRITICAL REDACTION PROPERTY: No secret token appears in serialized list output
			const serialized = JSON.stringify(list);
			expect(serialized).not.toContain(SECRET_PAT);
			expect(serialized).not.toContain("VERY_SECRET_TOKEN");
			expect(serialized).not.toContain(SECRET_MCP_KEY);
			expect(serialized).not.toContain("secretpw");
		});

		it("probes gh-cli when no GitHub PAT exists in vault", async () => {
			const mockProbeGh = vi.fn().mockResolvedValue("authenticated");
			const api = createVaultApi({ probeGh: mockProbeGh });

			const list = await api.list();
			const ghEntry = list.find((e) => e.service === "github");

			expect(ghEntry).toBeDefined();
			expect(ghEntry?.source).toBe("gh-cli");
			expect(ghEntry?.status).toBe("authenticated");
			expect(mockProbeGh).toHaveBeenCalled();
		});

		it("includes GitLab adapter summary from credential file", async () => {
			mockGitlabCred.cred = {
				host: "code.akselos.com",
				username: "gitlab-user",
				expiresAt: 1725200000000,
			};

			const api = createVaultApi();
			const list = await api.list();

			const gitlabEntry = list.find((e) => e.service === "gitlab");
			expect(gitlabEntry).toBeDefined();
			expect(gitlabEntry?.source).toBe("gitlab-file");
			expect(gitlabEntry?.username).toBe("gitlab-user");
			expect(gitlabEntry?.host).toBe("code.akselos.com");
		});
	});

	describe("vault.setGithubPat", () => {
		it("validates and stores valid PAT with login as username", async () => {
			const mockValidatePat = vi.fn().mockResolvedValue({
				ok: true,
				login: "monalisa",
			});

			const api = createVaultApi({ validatePat: mockValidatePat });
			const result = await api.setGithubPat({
				token: "ghp_valid_token_1234",
				host: "github.com",
			});

			expect(result.ok).toBe(true);
			expect(result.login).toBe("monalisa");
			expect(result.entry?.username).toBe("monalisa");
			expect(result.entry?.last4).toBe("1234");
			expect(result.entry?.source).toBe("vault");

			// Verify written file in vault
			const stored = await readVaultFile("github", GithubVaultEntrySchema);
			expect(stored).toBeDefined();
			expect(stored?.accessToken).toBe("ghp_valid_token_1234");
			expect(stored?.username).toBe("monalisa");
		});

		it("rejects invalid PAT and returns typed error without writing to vault", async () => {
			const mockValidatePat = vi.fn().mockResolvedValue({
				ok: false,
				reason: "Invalid or expired GitHub personal access token.",
			});

			const api = createVaultApi({ validatePat: mockValidatePat });
			const result = await api.setGithubPat({
				token: "ghp_invalid_token",
			});

			expect(result.ok).toBe(false);
			expect(result.error).toBe("Invalid or expired GitHub personal access token.");

			// Verify no file was written to vault
			const stored = await readVaultFile("github", GithubVaultEntrySchema);
			expect(stored).toBeNull();
		});
	});

	describe("vault.setMcpSecret", () => {
		it("stores MCP secrets under mcp:<serverId> and returns redacted keys", async () => {
			const api = createVaultApi();
			const result = await api.setMcpSecret({
				serverId: "brave-search",
				env: {
					BRAVE_API_KEY: "secret-brave-key-xyz",
				},
			});

			expect(result.ok).toBe(true);
			expect(result.entry?.service).toBe("mcp:brave-search");
			expect(result.entry?.kind).toBe("mcp");
			expect(result.entry?.keys).toEqual(["BRAVE_API_KEY"]);

			// Verify in vault file
			const stored = await readVaultFile("mcp:brave-search", McpVaultEntrySchema);
			expect(stored?.env.BRAVE_API_KEY).toBe("secret-brave-key-xyz");
		});
	});

	describe("vault.delete", () => {
		it("deletes specified vault file", async () => {
			await writeVaultFile("mcp:custom-server", {
				env: { FOO: "bar" },
				updatedAt: new Date().toISOString(),
			});

			const api = createVaultApi();
			const result = await api.delete({ service: "mcp:custom-server" });

			expect(result.ok).toBe(true);
			const stored = await readVaultFile("mcp:custom-server", McpVaultEntrySchema);
			expect(stored).toBeNull();
		});
	});

	describe("vault.testGithub", () => {
		it("tests stored token when no token passed", async () => {
			await writeVaultFile("github", {
				authKind: "pat",
				accessToken: "ghp_stored_token",
				username: "octocat",
				host: "github.com",
				updatedAt: new Date().toISOString(),
			});

			const mockValidatePat = vi.fn().mockResolvedValue({
				ok: true,
				login: "octocat",
			});

			const api = createVaultApi({ validatePat: mockValidatePat });
			const result = await api.testGithub();

			expect(result.ok).toBe(true);
			expect(result.login).toBe("octocat");
			expect(mockValidatePat).toHaveBeenCalledWith("ghp_stored_token");
		});

		it("returns error when no token exists in vault to test", async () => {
			const api = createVaultApi();
			const result = await api.testGithub();

			expect(result.ok).toBe(false);
			expect(result.reason).toContain("No GitHub PAT configured");
		});
	});
});
