import { describe, expect, it } from "vitest";

import {
	probeGhCliStatus,
	validateGithubPat,
	type GhCommandRunner,
} from "../../../src/vault/vault-github";

describe("vault-github", () => {
	describe("validateGithubPat", () => {
		it("returns ok: true with login on 200 OK from GitHub API", async () => {
			const mockFetch: typeof fetch = async (input, init) => {
				expect(String(input)).toBe("https://api.github.com/user");
				const headers = new Headers(init?.headers);
				expect(headers.get("Authorization")).toBe("Bearer ghp_validtoken123");
				expect(headers.get("User-Agent")).toBe("PIXTiel");

				return new Response(JSON.stringify({ login: "monalisa", id: 12345 }), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				});
			};

			const result = await validateGithubPat("ghp_validtoken123", mockFetch);
			expect(result).toEqual({ ok: true, login: "monalisa" });
		});

		it("returns ok: false on 401 Unauthorized", async () => {
			const mockFetch: typeof fetch = async () => {
				return new Response(JSON.stringify({ message: "Bad credentials" }), {
					status: 401,
					headers: { "Content-Type": "application/json" },
				});
			};

			const result = await validateGithubPat("ghp_expired_token", mockFetch);
			expect(result).toEqual({
				ok: false,
				reason: "Invalid or expired GitHub personal access token.",
			});
		});

		it("returns ok: false on 403 Forbidden", async () => {
			const mockFetch: typeof fetch = async () => {
				return new Response(JSON.stringify({ message: "API rate limit exceeded" }), {
					status: 403,
					headers: { "Content-Type": "application/json" },
				});
			};

			const result = await validateGithubPat("ghp_ratelimited", mockFetch);
			expect(result).toEqual({
				ok: false,
				reason: "GitHub API access forbidden or rate limit exceeded.",
			});
		});

		it("returns ok: false when 200 response lacks login", async () => {
			const mockFetch: typeof fetch = async () => {
				return new Response(JSON.stringify({}), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				});
			};

			const result = await validateGithubPat("ghp_weird_response", mockFetch);
			expect(result.ok).toBe(false);
		});

		it("returns ok: false for empty PAT without calling fetch", async () => {
			let called = false;
			const mockFetch: typeof fetch = async () => {
				called = true;
				return new Response("", { status: 200 });
			};

			const result = await validateGithubPat("   ", mockFetch);
			expect(result).toEqual({
				ok: false,
				reason: "Personal access token cannot be empty.",
			});
			expect(called).toBe(false);
		});

		it("handles timeout / AbortError gracefully without throwing", async () => {
			const mockFetch: typeof fetch = async () => {
				const error = new Error("The operation was aborted");
				error.name = "AbortError";
				throw error;
			};

			const result = await validateGithubPat("ghp_slow_token", mockFetch);
			expect(result).toEqual({
				ok: false,
				reason: "GitHub API request timed out after 10 seconds.",
			});
		});

		it("handles network failure gracefully without throwing", async () => {
			const mockFetch: typeof fetch = async () => {
				throw new Error("getaddrinfo ENOTFOUND api.github.com");
			};

			const result = await validateGithubPat("ghp_offline_token", mockFetch);
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.reason).toContain("getaddrinfo ENOTFOUND");
			}
		});
	});

	describe("probeGhCliStatus", () => {
		it("returns authenticated when gh auth status exits cleanly", async () => {
			const mockRunner: GhCommandRunner = async (args) => {
				expect(args).toEqual(["auth", "status"]);
				return { stdout: "Logged in to github.com account monalisa", stderr: "" };
			};

			const status = await probeGhCliStatus(mockRunner);
			expect(status).toBe("authenticated");
		});

		it("returns unauthenticated when gh auth status exits with non-zero code", async () => {
			const mockRunner: GhCommandRunner = async () => {
				const error = new Error("Command failed: gh auth status");
				Object.assign(error, { code: 1, stderr: "You are not logged into any GitHub hosts." });
				throw error;
			};

			const status = await probeGhCliStatus(mockRunner);
			expect(status).toBe("unauthenticated");
		});

		it("returns not-installed when gh binary is missing (ENOENT)", async () => {
			const mockRunner: GhCommandRunner = async () => {
				const error = new Error("spawn gh ENOENT");
				Object.assign(error, { code: "ENOENT" });
				throw error;
			};

			const status = await probeGhCliStatus(mockRunner);
			expect(status).toBe("not-installed");
		});
	});
});
