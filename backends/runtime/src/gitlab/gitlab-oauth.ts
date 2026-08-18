// Loopback OAuth (authorization code + PKCE) against a GitLab instance.
//
// The callback is handled by the runtime server itself at
// `/api/gitlab/oauth/callback` — NOT by a sidecar HTTP server on port 14995.
// This matters on WSL: a Windows browser redirects to 127.0.0.1, which is the
// Windows loopback, not WSL's. The runtime server's port IS forwarded by WSL2,
// so the callback reaches the right process.
//
// The MCP client id comment is kept for history:
//   host          https://code.akselos.com/repo
//   metadata      <host>/.well-known/oauth-authorization-server/api/v4/mcp
//   fallback id   c323cb730c…
//
// We register our own client via RFC 7591 when the instance supports it, and
// cache client.json under the runtime home so re-starts skip re-registration.
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { getRuntimeHomePath } from "../state/workspace-state";
import { GITLAB_CREDENTIAL_DIR_NAME, type GitlabCredential, writeGitlabCredential } from "./gitlab-credentials";

export const DEFAULT_GITLAB_HOST = "https://code.akselos.com/repo";
/** API path registered as the redirect URI on the runtime / standalone server. */
export const GITLAB_OAUTH_CALLBACK_API_PATH = "/api/gitlab/oauth/callback";

/**
 * Client id from `akselos-dev/.mcp.json`. Only tried when the instance offers no
 * registration endpoint — see the file header for why it is not the first choice.
 */
export const GITLAB_MCP_FALLBACK_CLIENT_ID = "c323cb730c221cb5c186fbd51d8e193f0be912aa12a97c06682d5fdb4185ab79";

/**
 * `api` is required: posting discussions and approving are writes.
 * `read_api`/`ai_workflows` are required by code.akselos.com's MCP-registered
 * client even for plain REST v4 calls — omitting them gets a 403
 * insufficient_scope on every call despite holding `api`/`read_user`.
 */
const REQUESTED_SCOPES = ["api", "read_user", "read_api", "ai_workflows"] as const;

const METADATA_TIMEOUT_MS = 8000;
const TOKEN_TIMEOUT_MS = 15_000;
/** How long a started flow waits for the browser round-trip before giving up. */
const AUTHORIZE_TIMEOUT_MS = 5 * 60_000;

export interface GitlabOauthMetadata {
	authorizationEndpoint: string;
	tokenEndpoint: string;
	registrationEndpoint: string | null;
	scopesSupported: string[];
}

export type GitlabOauthFlowState =
	| { state: "pending" }
	| { state: "connected"; credential: GitlabCredential }
	| { state: "failed"; error: string };

export interface GitlabOauthFlow {
	flowId: string;
	authorizeUrl: string;
}

function normalizeHost(host: string): string {
	return host.replace(/\/+$/, "");
}

function base64Url(input: Buffer): string {
	return input.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(source: Record<string, unknown>, key: string): string | null {
	const value = source[key];
	return typeof value === "string" && value.length > 0 ? value : null;
}

function readStringArray(source: Record<string, unknown>, key: string): string[] {
	const value = source[key];
	if (!Array.isArray(value)) {
		return [];
	}
	return value.filter((item): item is string => typeof item === "string");
}

async function fetchJson(url: string, init: RequestInit, timeoutMs: number): Promise<unknown> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const response = await fetch(url, { ...init, signal: controller.signal });
		const body = await response.text();
		if (!response.ok) {
			throw new Error(`${response.status} ${body.slice(0, 300)}`);
		}
		return JSON.parse(body) as unknown;
	} finally {
		clearTimeout(timeout);
	}
}

/**
 * The MCP config points at the resource-scoped metadata document; instances that
 * predate that layout only publish the root one, so both are tried in order.
 */
export function buildMetadataUrls(host: string): string[] {
	const base = normalizeHost(host);
	return [
		`${base}/.well-known/oauth-authorization-server/api/v4/mcp`,
		`${base}/.well-known/oauth-authorization-server`,
	];
}

export function parseOauthMetadata(raw: unknown): GitlabOauthMetadata | null {
	if (!isRecord(raw)) {
		return null;
	}
	const authorizationEndpoint = readString(raw, "authorization_endpoint");
	const tokenEndpoint = readString(raw, "token_endpoint");
	if (!authorizationEndpoint || !tokenEndpoint) {
		return null;
	}
	return {
		authorizationEndpoint,
		tokenEndpoint,
		registrationEndpoint: readString(raw, "registration_endpoint"),
		scopesSupported: readStringArray(raw, "scopes_supported"),
	};
}

export async function discoverOauthMetadata(host: string): Promise<GitlabOauthMetadata> {
	const failures: string[] = [];
	for (const url of buildMetadataUrls(host)) {
		try {
			const metadata = parseOauthMetadata(await fetchJson(url, { method: "GET" }, METADATA_TIMEOUT_MS));
			if (metadata) {
				return metadata;
			}
			failures.push(`${url}: response missing authorization/token endpoint`);
		} catch (error) {
			failures.push(`${url}: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	throw new Error(`Could not read GitLab OAuth metadata. ${failures.join("; ")}`);
}

/**
 * Only scopes the instance admits to supporting are requested. GitLab rejects the
 * whole authorization when one scope is unknown, so asking for `api` on an
 * instance that only exposes `mcp` would make the flow unusable rather than
 * degraded.
 */
export function selectScopes(metadata: GitlabOauthMetadata): string[] {
	if (metadata.scopesSupported.length === 0) {
		return [...REQUESTED_SCOPES];
	}
	const supported = new Set(metadata.scopesSupported);
	const selected = REQUESTED_SCOPES.filter((scope) => supported.has(scope));
	return selected.length > 0 ? selected : [...REQUESTED_SCOPES];
}

interface GitlabOauthClient {
	host: string;
	clientId: string;
	clientSecret: string | null;
	redirectUri: string;
}

function getClientPath(): string {
	return join(getRuntimeHomePath(), GITLAB_CREDENTIAL_DIR_NAME, "client.json");
}

function parseClient(raw: unknown, host: string, redirectUri: string): GitlabOauthClient | null {
	if (!isRecord(raw)) {
		return null;
	}
	const clientId = readString(raw, "clientId");
	if (!clientId || readString(raw, "host") !== host || readString(raw, "redirectUri") !== redirectUri) {
		return null;
	}
	return { host, clientId, clientSecret: readString(raw, "clientSecret"), redirectUri };
}

/** Reads client.json without checking the redirect URI — used for token refresh. */
function parseClientLoose(raw: unknown, host: string): GitlabOauthClient | null {
	if (!isRecord(raw)) {
		return null;
	}
	const clientId = readString(raw, "clientId");
	const redirectUri = readString(raw, "redirectUri");
	if (!clientId || readString(raw, "host") !== host || !redirectUri) {
		return null;
	}
	return { host, clientId, clientSecret: readString(raw, "clientSecret"), redirectUri };
}

async function readCachedClient(host: string, redirectUri: string): Promise<GitlabOauthClient | null> {
	try {
		const text = await readFile(getClientPath(), "utf-8");
		return parseClient(JSON.parse(text) as unknown, host, redirectUri);
	} catch {
		return null;
	}
}

async function readAnyCachedClient(host: string): Promise<GitlabOauthClient | null> {
	try {
		const text = await readFile(getClientPath(), "utf-8");
		return parseClientLoose(JSON.parse(text) as unknown, host);
	} catch {
		return null;
	}
}

async function writeCachedClient(client: GitlabOauthClient): Promise<void> {
	const path = getClientPath();
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `${JSON.stringify(client, null, 2)}\n`, "utf-8");
}

async function registerClient(
	metadata: GitlabOauthMetadata,
	host: string,
	redirectUri: string,
	scopes: string[],
): Promise<GitlabOauthClient | null> {
	if (!metadata.registrationEndpoint) {
		return null;
	}
	try {
		const parsed = await fetchJson(
			metadata.registrationEndpoint,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					client_name: "PixelOffice Review",
					redirect_uris: [redirectUri],
					scope: scopes.join(" "),
					grant_types: ["authorization_code", "refresh_token"],
					response_types: ["code"],
					token_endpoint_auth_method: "none",
				}),
			},
			METADATA_TIMEOUT_MS,
		);
		if (!isRecord(parsed)) {
			return null;
		}
		const clientId = readString(parsed, "client_id");
		if (!clientId) {
			return null;
		}
		return { host, clientId, clientSecret: readString(parsed, "client_secret"), redirectUri };
	} catch {
		return null;
	}
}

async function resolveOauthClient(
	metadata: GitlabOauthMetadata,
	host: string,
	redirectUri: string,
	scopes: string[],
): Promise<GitlabOauthClient> {
	const cached = await readCachedClient(host, redirectUri);
	if (cached) {
		return cached;
	}
	const registered = await registerClient(metadata, host, redirectUri, scopes);
	if (registered) {
		await writeCachedClient(registered);
		return registered;
	}
	return { host, clientId: GITLAB_MCP_FALLBACK_CLIENT_ID, clientSecret: null, redirectUri };
}

interface TokenResponse {
	accessToken: string;
	refreshToken: string | null;
	expiresAt: number | null;
}

export function parseTokenResponse(raw: unknown, now: number): TokenResponse | null {
	if (!isRecord(raw)) {
		return null;
	}
	const accessToken = readString(raw, "access_token");
	if (!accessToken) {
		return null;
	}
	const expiresIn = raw.expires_in;
	const expiresAt =
		typeof expiresIn === "number" && Number.isFinite(expiresIn) && expiresIn > 0 ? now + expiresIn * 1000 : null;
	return { accessToken, refreshToken: readString(raw, "refresh_token"), expiresAt };
}

async function exchangeToken(
	metadata: GitlabOauthMetadata,
	client: GitlabOauthClient,
	body: Record<string, string>,
): Promise<TokenResponse> {
	const params = new URLSearchParams({ client_id: client.clientId, ...body });
	if (client.clientSecret) {
		params.set("client_secret", client.clientSecret);
	}
	const parsed = await fetchJson(
		metadata.tokenEndpoint,
		{
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: params.toString(),
		},
		TOKEN_TIMEOUT_MS,
	);
	const token = parseTokenResponse(parsed, Date.now());
	if (!token) {
		throw new Error("GitLab token endpoint returned no access token.");
	}
	return token;
}

interface GitlabIdentity {
	username: string;
	name: string;
	userId: number;
}

async function fetchIdentity(host: string, accessToken: string): Promise<GitlabIdentity> {
	const parsed = await fetchJson(
		`${normalizeHost(host)}/api/v4/user`,
		{ method: "GET", headers: { Authorization: `Bearer ${accessToken}` } },
		METADATA_TIMEOUT_MS,
	);
	if (!isRecord(parsed)) {
		throw new Error("GitLab /user returned an unexpected response.");
	}
	const username = readString(parsed, "username");
	const id = parsed.id;
	if (!username || typeof id !== "number") {
		throw new Error("GitLab /user returned no username.");
	}
	return { username, name: readString(parsed, "name") ?? username, userId: id };
}

const CALLBACK_SUCCESS_HTML = `<!doctype html><meta charset="utf-8"><title>GitLab connected</title>
<body style="font-family:system-ui;background:#1F2428;color:#E6EDF3;padding:3rem">
<h1 style="font-size:1.1rem">GitLab connected</h1>
<p style="color:#8B949E">You can close this tab and return to PixelOffice.</p>`;

function buildCallbackErrorHtml(message: string): string {
	return `<!doctype html><meta charset="utf-8"><title>GitLab connect failed</title>
<body style="font-family:system-ui;background:#1F2428;color:#E6EDF3;padding:3rem">
<h1 style="font-size:1.1rem;color:#F85149">GitLab connect failed</h1>
<p style="color:#8B949E">${message.replace(/</g, "&lt;")}</p>
<p style="color:#8B949E;margin-top:1rem">Close this tab and press <b>Connect GitLab</b> again.</p>`;
}

export interface StartGitlabOauthDependencies {
	host?: string;
	warn?: (message: string) => void;
	/** Injected in tests; production stores under the runtime home. */
	persist?: (credential: GitlabCredential) => Promise<void>;
}

interface PendingFlowContext {
	flowId: string;
	codeVerifier: string;
	metadata: GitlabOauthMetadata;
	client: GitlabOauthClient;
	redirectUri: string;
	warn: (message: string) => void;
	persist: (credential: GitlabCredential) => Promise<void>;
}

export interface GitlabOauthSession {
	start: (deps?: StartGitlabOauthDependencies) => Promise<GitlabOauthFlow>;
	/**
	 * Called by the runtime server's `/api/gitlab/oauth/callback` GET handler.
	 * Returns HTML to write directly to the browser response.
	 */
	handleCallback: (code: string | null, state: string | null, error: string | null) => Promise<string>;
	getState: (flowId: string) => GitlabOauthFlowState;
}

/**
 * Flows are tracked in memory: an interrupted runtime loses a half-finished
 * authorization, which is the correct outcome — the code in the browser's URL is
 * single-use and the user simply presses Connect again.
 *
 * `callbackBaseUrl` is the base URL of the server handling the OAuth callback,
 * e.g. `http://127.0.0.1:3484`. The redirect URI registered with GitLab is
 * `${callbackBaseUrl}/api/gitlab/oauth/callback`.
 * On WSL this must be the main runtime/standalone port, not a sidecar port,
 * because WSL2 forwards the runtime port to Windows localhost but not arbitrary
 * additional ports.
 */
export function createGitlabOauthSession(callbackBaseUrl: string): GitlabOauthSession {
	const flows = new Map<string, GitlabOauthFlowState>();
	// Keyed by stateToken (the CSRF token) so handleCallback can find the flow.
	const pendingFlows = new Map<string, PendingFlowContext>();

	const start = async (deps?: StartGitlabOauthDependencies): Promise<GitlabOauthFlow> => {
		const host = normalizeHost(deps?.host ?? DEFAULT_GITLAB_HOST);
		const warn = deps?.warn ?? (() => {});
		const persist = deps?.persist ?? writeGitlabCredential;
		const redirectUri = `${callbackBaseUrl}${GITLAB_OAUTH_CALLBACK_API_PATH}`;

		const metadata = await discoverOauthMetadata(host);
		const scopes = selectScopes(metadata);
		const client = await resolveOauthClient(metadata, host, redirectUri, scopes);

		const flowId = base64Url(randomBytes(12));
		const stateToken = base64Url(randomBytes(16));
		const codeVerifier = base64Url(randomBytes(32));
		const codeChallenge = base64Url(createHash("sha256").update(codeVerifier).digest());

		const context: PendingFlowContext = { flowId, codeVerifier, metadata, client, redirectUri, warn, persist };
		pendingFlows.set(stateToken, context);
		flows.set(flowId, { state: "pending" });

		const timeout = setTimeout(() => {
			if (flows.get(flowId)?.state === "pending") {
				flows.set(flowId, { state: "failed", error: "Authorization timed out." });
			}
			pendingFlows.delete(stateToken);
		}, AUTHORIZE_TIMEOUT_MS);
		timeout.unref();

		const authorizeUrl = new URL(metadata.authorizationEndpoint);
		authorizeUrl.searchParams.set("client_id", client.clientId);
		authorizeUrl.searchParams.set("redirect_uri", redirectUri);
		authorizeUrl.searchParams.set("response_type", "code");
		authorizeUrl.searchParams.set("state", stateToken);
		authorizeUrl.searchParams.set("code_challenge", codeChallenge);
		authorizeUrl.searchParams.set("code_challenge_method", "S256");
		authorizeUrl.searchParams.set("scope", scopes.join(" "));

		return { flowId, authorizeUrl: authorizeUrl.toString() };
	};

	const handleCallback = async (
		code: string | null,
		state: string | null,
		error: string | null,
	): Promise<string> => {
		if (error) {
			return buildCallbackErrorHtml(`GitLab denied the authorization: ${error}`);
		}
		if (!state) {
			return buildCallbackErrorHtml("Authorization state is missing.");
		}
		const context = pendingFlows.get(state);
		if (!context) {
			return buildCallbackErrorHtml("Unknown or expired authorization state. Start the connection again.");
		}
		// A mismatched state is the CSRF signal; we already verified by Map lookup.
		pendingFlows.delete(state);
		if (!code) {
			flows.set(context.flowId, { state: "failed", error: "GitLab returned no authorization code." });
			return buildCallbackErrorHtml("GitLab returned no authorization code.");
		}
		try {
			const token = await exchangeToken(context.metadata, context.client, {
				grant_type: "authorization_code",
				code,
				redirect_uri: context.redirectUri,
				code_verifier: context.codeVerifier,
			});
			const identity = await fetchIdentity(context.client.host, token.accessToken);
			const credential: GitlabCredential = {
				host: context.client.host,
				accessToken: token.accessToken,
				refreshToken: token.refreshToken,
				expiresAt: token.expiresAt,
				username: identity.username,
				name: identity.name,
				userId: identity.userId,
			};
			await context.persist(credential);
			flows.set(context.flowId, { state: "connected", credential });
			return CALLBACK_SUCCESS_HTML;
		} catch (exchangeError) {
			const message = exchangeError instanceof Error ? exchangeError.message : String(exchangeError);
			context.warn(`GitLab token exchange failed: ${message}`);
			flows.set(context.flowId, { state: "failed", error: message });
			return buildCallbackErrorHtml(message);
		}
	};

	return {
		start,
		handleCallback,
		getState: (flowId) => flows.get(flowId) ?? { state: "failed", error: "Unknown authorization flow." },
	};
}

/**
 * Refreshes an expiring credential in place. Returns null when there is no
 * refresh token or the instance refuses — the caller then marks the credential
 * as needing re-authorization instead of retrying forever.
 */
export async function refreshGitlabCredential(
	credential: GitlabCredential,
	deps?: { persist?: (next: GitlabCredential) => Promise<void> },
): Promise<GitlabCredential | null> {
	if (!credential.refreshToken) {
		return null;
	}
	try {
		const metadata = await discoverOauthMetadata(credential.host);
		// Refresh token grants don't need the redirect_uri in the body. We read
		// any cached client for this host (ignoring redirect URI) so the same
		// registered client_id is reused instead of triggering a new registration.
		const anyClient = await readAnyCachedClient(credential.host);
		const client: GitlabOauthClient = anyClient ?? {
			host: credential.host,
			clientId: GITLAB_MCP_FALLBACK_CLIENT_ID,
			clientSecret: null,
			redirectUri: "",
		};
		const token = await exchangeToken(metadata, client, {
			grant_type: "refresh_token",
			refresh_token: credential.refreshToken,
		});
		const next: GitlabCredential = {
			...credential,
			accessToken: token.accessToken,
			// GitLab rotates refresh tokens; keeping the old one on a response that
			// omits it is correct, replacing it with undefined is not.
			refreshToken: token.refreshToken ?? credential.refreshToken,
			expiresAt: token.expiresAt,
			reauthRequired: false,
		};
		await (deps?.persist ?? writeGitlabCredential)(next);
		return next;
	} catch {
		return null;
	}
}
