import { describe, expect, it } from "vitest";

import {
	formatMcpServiceId,
	GithubVaultEntrySchema,
	isMcpServiceId,
	McpVaultEntrySchema,
	parseMcpServerId,
	redactEntry,
	redactGithubEntry,
	redactMcpEntry,
	type GithubVaultEntry,
	type McpVaultEntry,
} from "../../../src/vault/vault-services";

describe("vault-services", () => {
	describe("GithubVaultEntrySchema", () => {
		it("validates a complete GitHub PAT entry with default host", () => {
			const raw = {
				authKind: "pat",
				accessToken: "ghp_0123456789abcdefghijklmnopqrstuvwxyz",
				username: "octocat",
				updatedAt: "2026-09-01T00:00:00.000Z",
			};

			const parsed = GithubVaultEntrySchema.parse(raw);
			expect(parsed.host).toBe("github.com");
			expect(parsed.username).toBe("octocat");
			expect(parsed.accessToken).toBe(raw.accessToken);
			expect(parsed.authKind).toBe("pat");
		});

		it("rejects invalid GitHub PAT entries", () => {
			expect(GithubVaultEntrySchema.safeParse({ authKind: "oauth" }).success).toBe(false);
			expect(
				GithubVaultEntrySchema.safeParse({
					authKind: "pat",
					accessToken: "",
					username: "octocat",
					updatedAt: "2026-09-01T00:00:00.000Z",
				}).success,
			).toBe(false);
			expect(
				GithubVaultEntrySchema.safeParse({
					authKind: "pat",
					accessToken: "valid-token",
					username: "",
					updatedAt: "2026-09-01T00:00:00.000Z",
				}).success,
			).toBe(false);
		});
	});

	describe("McpVaultEntrySchema and ID utilities", () => {
		it("validates MCP vault entry schema", () => {
			const raw = {
				env: {
					OPENAI_API_KEY: "sk-secret-key-123456789",
					DATABASE_URL: "postgres://user:pass@localhost/db",
				},
				updatedAt: "2026-09-01T00:00:00.000Z",
			};

			const parsed = McpVaultEntrySchema.parse(raw);
			expect(parsed.env.OPENAI_API_KEY).toBe("sk-secret-key-123456789");
		});

		it("formats, checks, and parses MCP service IDs", () => {
			const serverId = "postgres-prod";
			const serviceId = formatMcpServiceId(serverId);
			expect(serviceId).toBe("mcp:postgres-prod");
			expect(isMcpServiceId(serviceId)).toBe(true);
			expect(isMcpServiceId("github")).toBe(false);
			expect(parseMcpServerId(serviceId)).toBe(serverId);
			expect(parseMcpServerId("github")).toBeNull();
		});
	});

	describe("redaction (PXT-6 secret protection)", () => {
		it("redacts GitHub entry ensuring full token never appears in output", () => {
			const pat = "ghp_VERY_SECRET_LONG_PAT_VALUE_9988776655";
			const entry: GithubVaultEntry = {
				authKind: "pat",
				accessToken: pat,
				username: "octocat",
				host: "github.com",
				updatedAt: "2026-09-01T12:00:00.000Z",
			};

			const redacted = redactGithubEntry(entry);
			expect(redacted).toEqual({
				kind: "github",
				username: "octocat",
				host: "github.com",
				last4: "6655",
				updatedAt: "2026-09-01T12:00:00.000Z",
			});

			const jsonString = JSON.stringify(redacted);
			expect(jsonString).not.toContain(pat);

			// Generic redactEntry dispatch
			const dispatchedRedacted = redactEntry(entry);
			expect(dispatchedRedacted).toEqual(redacted);
			expect(JSON.stringify(dispatchedRedacted)).not.toContain(pat);
		});

		it("redacts MCP entry keeping only keys and never secret values", () => {
			const secretVal1 = "super-secret-password-xyz";
			const secretVal2 = "another-confidential-token-abc";
			const entry: McpVaultEntry = {
				env: {
					SECRET_KEY_ONE: secretVal1,
					SECRET_KEY_TWO: secretVal2,
				},
				updatedAt: "2026-09-01T12:00:00.000Z",
			};

			const redacted = redactMcpEntry(entry);
			expect(redacted).toEqual({
				kind: "mcp",
				keys: ["SECRET_KEY_ONE", "SECRET_KEY_TWO"],
				updatedAt: "2026-09-01T12:00:00.000Z",
			});

			const jsonString = JSON.stringify(redacted);
			expect(jsonString).not.toContain(secretVal1);
			expect(jsonString).not.toContain(secretVal2);

			// Generic redactEntry dispatch
			const dispatchedRedacted = redactEntry(entry);
			expect(dispatchedRedacted).toEqual(redacted);
			expect(JSON.stringify(dispatchedRedacted)).not.toContain(secretVal1);
			expect(JSON.stringify(dispatchedRedacted)).not.toContain(secretVal2);
		});
	});
});
