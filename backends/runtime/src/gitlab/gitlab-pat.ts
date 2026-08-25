// Personal-access-token connect path for the Review surface.
//
// This is the *primary* way to connect, not a fallback. The OAuth flow in
// `gitlab-oauth.ts` is pinned to the GitLab MCP client id, and that client can
// only ever be granted the `mcp` scope — which authorizes `/api/v4/mcp` and
// nothing else. Every call this app makes is REST v4, so an OAuth credential
// 403s with `insufficient_scope` on the very first request, including the
// identity probe inside the flow itself. A PAT with `api` is the only
// credential that actually works against code.akselos.com today; OAuth stays
// available for instances that expose a properly scoped application.
import { type GitlabCredential, writeGitlabCredential } from "./gitlab-credentials";
import { DEFAULT_GITLAB_HOST } from "./gitlab-oauth";

const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Write scopes the Review surface needs: posting diff discussions, replying,
 * resolving threads and approving all go through endpoints that reject
 * `read_api`. A token that only reads is refused at connect time rather than
 * left to fail per-button later.
 */
export const REQUIRED_PAT_SCOPE = "api";

export type GitlabTokenConnectResult = { ok: true; credential: GitlabCredential } | { ok: false; error: string };

function normalizeHost(host: string): string {
	return host.replace(/\/+$/, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(source: Record<string, unknown>, key: string): string | null {
	const value = source[key];
	return typeof value === "string" && value.length > 0 ? value : null;
}

interface ProbeResponse {
	status: number;
	body: string;
}

async function probe(
	url: string,
	token: string,
	fetchImpl: typeof fetch,
): Promise<{ ok: true; response: ProbeResponse } | { ok: false; error: string }> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
	try {
		const response = await fetchImpl(url, {
			method: "GET",
			headers: { Authorization: `Bearer ${token}` },
			signal: controller.signal,
		});
		return { ok: true, response: { status: response.status, body: await response.text() } };
	} catch (error) {
		if (controller.signal.aborted) {
			return { ok: false, error: `GitLab did not respond within ${REQUEST_TIMEOUT_MS} ms.` };
		}
		// `fetch` reports connection problems as a generic "fetch failed"; the cause
		// carries the ECONNREFUSED/ENOTFOUND that actually names the problem.
		const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : null;
		return { ok: false, error: cause ?? (error instanceof Error ? error.message : String(error)) };
	} finally {
		clearTimeout(timeout);
	}
}

function parseJson(body: string): unknown {
	try {
		return JSON.parse(body) as unknown;
	} catch {
		return null;
	}
}

/**
 * Scopes of the presented token, or null when the instance will not introspect
 * it. Project/group access tokens and older instances both fall into that
 * second case, which is why an unreadable answer is not treated as a refusal.
 */
export function parseTokenScopes(raw: unknown): string[] | null {
	if (!isRecord(raw) || !Array.isArray(raw.scopes)) {
		return null;
	}
	return raw.scopes.filter((scope): scope is string => typeof scope === "string");
}

/** GitLab reports PAT expiry as a bare `YYYY-MM-DD`; null when the token never expires. */
export function parseTokenExpiry(raw: unknown): number | null {
	if (!isRecord(raw)) {
		return null;
	}
	const expiresAt = readString(raw, "expires_at");
	if (!expiresAt) {
		return null;
	}
	const parsed = Date.parse(expiresAt);
	return Number.isFinite(parsed) ? parsed : null;
}

export interface ConnectGitlabWithTokenInput {
	token: string;
	host?: string;
}

export interface ConnectGitlabWithTokenDependencies {
	fetchImpl?: typeof fetch;
	/** Injected in tests; production stores under the runtime home. */
	persist?: (credential: GitlabCredential) => Promise<void>;
}

/**
 * Verifies a pasted token and stores it. Verification is two calls because they
 * answer different questions: `/user` proves the token is live and names the
 * identity to review as, `/personal_access_tokens/self` proves it carries `api`.
 * A token that reads but cannot write is rejected here — discovering that at the
 * moment someone submits a review comment loses the comment.
 */
export async function connectGitlabWithToken(
	input: ConnectGitlabWithTokenInput,
	deps?: ConnectGitlabWithTokenDependencies,
): Promise<GitlabTokenConnectResult> {
	const fetchImpl = deps?.fetchImpl ?? fetch;
	const persist = deps?.persist ?? writeGitlabCredential;
	// Pasting from GitLab's copy button drags whitespace along often enough to be
	// worth handling; a surrounding space otherwise reads as "token rejected".
	const token = input.token.trim();
	if (token.length === 0) {
		return { ok: false, error: "Paste a GitLab personal access token." };
	}
	const host = normalizeHost(input.host ?? DEFAULT_GITLAB_HOST);

	const identityProbe = await probe(`${host}/api/v4/user`, token, fetchImpl);
	if (!identityProbe.ok) {
		return { ok: false, error: `GitLab at ${host} is unreachable: ${identityProbe.error}` };
	}
	const { status, body } = identityProbe.response;
	if (status === 401) {
		return { ok: false, error: "GitLab rejected this token. Check that it was copied whole and is not revoked." };
	}
	if (status === 403) {
		return {
			ok: false,
			error: `This token was accepted but carries no API access. Generate one with the \`${REQUIRED_PAT_SCOPE}\` scope.`,
		};
	}
	if (status < 200 || status >= 300) {
		return { ok: false, error: `GitLab rejected the request (${status}): ${body.slice(0, 200)}` };
	}
	const identity = parseJson(body);
	if (!isRecord(identity)) {
		return { ok: false, error: `GitLab returned an unexpected response: ${body.slice(0, 200)}` };
	}
	const username = readString(identity, "username");
	const userId = typeof identity.id === "number" && Number.isFinite(identity.id) ? identity.id : null;
	if (!username || userId === null) {
		return { ok: false, error: "GitLab returned no username for this token." };
	}

	let expiresAt: number | null = null;
	const scopeProbe = await probe(`${host}/api/v4/personal_access_tokens/self`, token, fetchImpl);
	if (scopeProbe.ok && scopeProbe.response.status >= 200 && scopeProbe.response.status < 300) {
		const introspection = parseJson(scopeProbe.response.body);
		const scopes = parseTokenScopes(introspection);
		if (scopes && !scopes.includes(REQUIRED_PAT_SCOPE)) {
			return {
				ok: false,
				error: `This token has ${scopes.join(", ") || "no"} scope${scopes.length === 1 ? "" : "s"}. Reviewing needs \`${REQUIRED_PAT_SCOPE}\` to post comments, resolve threads and approve.`,
			};
		}
		expiresAt = parseTokenExpiry(introspection);
	}

	const credential: GitlabCredential = {
		host,
		authKind: "pat",
		accessToken: token,
		// A PAT cannot be refreshed. Storing null here is what keeps the client from
		// attempting a refresh round-trip that can only ever fail.
		refreshToken: null,
		expiresAt,
		username,
		name: readString(identity, "name") ?? username,
		userId,
	};
	await persist(credential);
	return { ok: true, credential };
}
