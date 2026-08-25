import { describe, expect, it, vi } from "vitest";

import type { GitlabCredential } from "../../../src/gitlab/gitlab-credentials";
import { connectGitlabWithToken, parseTokenExpiry, parseTokenScopes } from "../../../src/gitlab/gitlab-pat";

const HOST = "https://code.example.com/repo";
const USER = { id: 7, username: "hoangtien.nguyen", name: "Hoang Tien Nguyen" };

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** Answers by URL suffix so a test only has to state the responses it cares about. */
function createHarness(routes: { user?: () => Response; self?: () => Response }) {
	const calls: Array<{ url: string; token: string | null }> = [];
	const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
		const url = String(input);
		calls.push({ url, token: new Headers(init?.headers).get("Authorization") });
		if (url.endsWith("/api/v4/user")) {
			return routes.user?.() ?? jsonResponse(USER);
		}
		if (url.endsWith("/personal_access_tokens/self")) {
			return routes.self?.() ?? jsonResponse({ scopes: ["api"], expires_at: null });
		}
		return new Response("", { status: 404 });
	}) as unknown as typeof fetch;

	const persisted: GitlabCredential[] = [];
	const persist = async (credential: GitlabCredential): Promise<void> => {
		persisted.push(credential);
	};
	return { fetchImpl, persist, persisted, calls };
}

describe("connectGitlabWithToken", () => {
	it("stores a pat credential with the identity the token resolves to", async () => {
		const harness = createHarness({ self: () => jsonResponse({ scopes: ["api"], expires_at: "2027-08-25" }) });
		const result = await connectGitlabWithToken(
			{ token: "  glpat-abc  ", host: `${HOST}/` },
			{ fetchImpl: harness.fetchImpl, persist: harness.persist },
		);

		expect(result.ok).toBe(true);
		if (!result.ok) {
			return;
		}
		expect(result.credential).toMatchObject({
			host: HOST,
			authKind: "pat",
			// Whitespace from GitLab's copy button is stripped, not sent.
			accessToken: "glpat-abc",
			refreshToken: null,
			username: "hoangtien.nguyen",
			userId: 7,
		});
		expect(result.credential.expiresAt).toBe(Date.parse("2027-08-25"));
		expect(harness.persisted).toHaveLength(1);
		expect(harness.calls[0]?.token).toBe("Bearer glpat-abc");
	});

	it("refuses a read-only token instead of failing later at the first comment", async () => {
		const harness = createHarness({ self: () => jsonResponse({ scopes: ["read_api", "read_user"] }) });
		const result = await connectGitlabWithToken(
			{ token: "glpat-readonly", host: HOST },
			{ fetchImpl: harness.fetchImpl, persist: harness.persist },
		);

		expect(result.ok).toBe(false);
		if (result.ok) {
			return;
		}
		expect(result.error).toContain("read_api");
		expect(result.error).toContain("api");
		expect(harness.persisted).toHaveLength(0);
	});

	it("accepts a token the instance will not introspect rather than blocking on it", async () => {
		const harness = createHarness({ self: () => jsonResponse({ message: "404 Not Found" }, 404) });
		const result = await connectGitlabWithToken(
			{ token: "glpat-group", host: HOST },
			{ fetchImpl: harness.fetchImpl, persist: harness.persist },
		);

		expect(result.ok).toBe(true);
		expect(harness.persisted[0]?.expiresAt).toBeNull();
	});

	it("names revocation on a 401 and missing api access on a 403", async () => {
		const rejected = createHarness({ user: () => jsonResponse({ message: "401 Unauthorized" }, 401) });
		const unauthorized = await connectGitlabWithToken(
			{ token: "glpat-dead", host: HOST },
			{ fetchImpl: rejected.fetchImpl, persist: rejected.persist },
		);
		expect(unauthorized.ok).toBe(false);
		if (!unauthorized.ok) {
			expect(unauthorized.error).toContain("revoked");
		}
		// The identity probe failing means nothing was learned; no scope call follows.
		expect(rejected.calls).toHaveLength(1);

		const scoped = createHarness({ user: () => jsonResponse({ error: "insufficient_scope" }, 403) });
		const forbidden = await connectGitlabWithToken(
			{ token: "glpat-mcp", host: HOST },
			{ fetchImpl: scoped.fetchImpl, persist: scoped.persist },
		);
		expect(forbidden.ok).toBe(false);
		if (!forbidden.ok) {
			expect(forbidden.error).toContain("api");
		}
	});

	it("rejects an empty paste without calling GitLab", async () => {
		const harness = createHarness({});
		const result = await connectGitlabWithToken(
			{ token: "   ", host: HOST },
			{ fetchImpl: harness.fetchImpl, persist: harness.persist },
		);
		expect(result.ok).toBe(false);
		expect(harness.calls).toHaveLength(0);
	});
});

describe("token introspection parsers", () => {
	it("distinguishes an unreadable introspection from an empty scope list", () => {
		expect(parseTokenScopes({ scopes: [] })).toEqual([]);
		expect(parseTokenScopes({ message: "404" })).toBeNull();
		expect(parseTokenScopes(null)).toBeNull();
	});

	it("reads a bare date expiry and tolerates a missing one", () => {
		expect(parseTokenExpiry({ expires_at: "2027-08-25" })).toBe(Date.parse("2027-08-25"));
		expect(parseTokenExpiry({ expires_at: null })).toBeNull();
		expect(parseTokenExpiry({})).toBeNull();
	});
});
