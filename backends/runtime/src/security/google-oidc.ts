import { createHash, createPublicKey, randomBytes, verify } from "node:crypto";
import { type GoogleAuthConfig, readBrandEnv } from "./auth-mode.js";

const DEFAULT_DISCOVERY_URL = "https://accounts.google.com/.well-known/openid-configuration";
const STATE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const JWKS_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

export interface GoogleOidcDiscovery {
	issuer: string;
	authorization_endpoint: string;
	token_endpoint: string;
	jwks_uri: string;
}

export interface JwkKey {
	kty: string;
	alg?: string;
	use?: string;
	kid: string;
	n: string;
	e: string;
	[key: string]: unknown;
}

export interface JwksResponse {
	keys: JwkKey[];
}

export interface OidcStateEntry {
	codeVerifier: string;
	nonce: string;
	redirectUri: string;
	createdAt: number;
}

export interface OidcUserSubject {
	email: string;
	name?: string;
	picture?: string;
}

export interface GoogleOidcOptions {
	discoveryUrl?: string;
	fetchImpl?: typeof fetch;
}

// In-memory state store (single use, 5 min TTL)
const stateMap = new Map<string, OidcStateEntry>();

// In-memory cached discovery and JWKS
let cachedDiscovery: { doc: GoogleOidcDiscovery; fetchedAt: number; url: string } | null = null;
let cachedJwks: { keys: JwkKey[]; fetchedAt: number; uri: string } | null = null;

export function clearOidcMemory(): void {
	stateMap.clear();
	cachedDiscovery = null;
	cachedJwks = null;
}

function cleanExpiredStates(): void {
	const now = Date.now();
	for (const [key, entry] of stateMap.entries()) {
		if (now - entry.createdAt > STATE_TTL_MS) {
			stateMap.delete(key);
		}
	}
}

/**
 * Fetch and cache OpenID Connect discovery document.
 */
export async function getGoogleDiscovery(options?: GoogleOidcOptions): Promise<GoogleOidcDiscovery> {
	const discoveryUrl = options?.discoveryUrl ?? readBrandEnv("GOOGLE_DISCOVERY_URL") ?? DEFAULT_DISCOVERY_URL;
	const fetchFn = options?.fetchImpl ?? fetch;
	const now = Date.now();

	if (cachedDiscovery && cachedDiscovery.url === discoveryUrl && now - cachedDiscovery.fetchedAt < 24 * 60 * 60 * 1000) {
		return cachedDiscovery.doc;
	}

	const response = await fetchFn(discoveryUrl);
	if (!response.ok) {
		throw new Error(`discovery_fetch_failed: HTTP ${response.status}`);
	}

	const doc = (await response.json()) as GoogleOidcDiscovery;
	if (!doc.authorization_endpoint || !doc.token_endpoint || !doc.jwks_uri) {
		throw new Error("invalid_discovery_document");
	}

	cachedDiscovery = { doc, fetchedAt: now, url: discoveryUrl };
	return doc;
}

/**
 * Fetch and cache JWKS keys. Refetches when forced or cache expired.
 */
export async function getGoogleJwks(jwksUri: string, forceFresh = false, options?: GoogleOidcOptions): Promise<JwkKey[]> {
	const fetchFn = options?.fetchImpl ?? fetch;
	const now = Date.now();

	if (!forceFresh && cachedJwks && cachedJwks.uri === jwksUri && now - cachedJwks.fetchedAt < JWKS_CACHE_TTL_MS) {
		return cachedJwks.keys;
	}

	const response = await fetchFn(jwksUri);
	if (!response.ok) {
		throw new Error(`jwks_fetch_failed: HTTP ${response.status}`);
	}

	const jwks = (await response.json()) as JwksResponse;
	if (!Array.isArray(jwks.keys)) {
		throw new Error("invalid_jwks_response");
	}

	cachedJwks = { keys: jwks.keys, fetchedAt: now, uri: jwksUri };
	return jwks.keys;
}

/**
 * Generate PKCE S256 pair: code_verifier and code_challenge.
 */
export function generatePkce(): { codeVerifier: string; codeChallenge: string } {
	const codeVerifier = randomBytes(32).toString("base64url");
	const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
	return { codeVerifier, codeChallenge };
}

/**
 * Create Google OIDC Authorization URL with PKCE and state+nonce storage.
 */
export async function createAuthorizationUrl(
	config: GoogleAuthConfig,
	options?: GoogleOidcOptions,
): Promise<{ url: string; state: string }> {
	cleanExpiredStates();
	const discovery = await getGoogleDiscovery(options);

	const state = randomBytes(32).toString("hex");
	const nonce = randomBytes(32).toString("hex");
	const { codeVerifier, codeChallenge } = generatePkce();

	stateMap.set(state, {
		codeVerifier,
		nonce,
		redirectUri: config.redirectUri,
		createdAt: Date.now(),
	});

	const params = new URLSearchParams({
		client_id: config.clientId,
		redirect_uri: config.redirectUri,
		response_type: "code",
		scope: "openid email profile",
		state,
		nonce,
		code_challenge: codeChallenge,
		code_challenge_method: "S256",
		access_type: "offline",
		prompt: "select_account",
	});

	const url = `${discovery.authorization_endpoint}?${params.toString()}`;
	return { url, state };
}

interface JwtParts {
	header: {
		alg?: string;
		kid?: string;
		typ?: string;
	};
	payload: {
		iss?: string;
		aud?: string;
		exp?: number;
		iat?: number;
		nonce?: string;
		email?: string;
		email_verified?: boolean;
		name?: string;
		picture?: string;
		[key: string]: unknown;
	};
	headerB64: string;
	payloadB64: string;
	signatureB64: string;
}

function parseJwt(token: string): JwtParts {
	const parts = token.split(".");
	if (parts.length !== 3) {
		throw new Error("invalid_token_format");
	}
	const [headerB64, payloadB64, signatureB64] = parts;
	if (!headerB64 || !payloadB64 || !signatureB64) {
		throw new Error("invalid_token_format");
	}

	try {
		const header = JSON.parse(Buffer.from(headerB64, "base64url").toString("utf-8")) as JwtParts["header"];
		const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf-8")) as JwtParts["payload"];
		return { header, payload, headerB64, payloadB64, signatureB64 };
	} catch {
		throw new Error("invalid_token_json");
	}
}

/**
 * Verifies an id_token against JWKS keys and validates required claims.
 */
export async function verifyIdToken(
	idToken: string,
	expectedNonce: string,
	config: GoogleAuthConfig,
	options?: GoogleOidcOptions,
): Promise<OidcUserSubject> {
	const discovery = await getGoogleDiscovery(options);
	const { header, payload, headerB64, payloadB64, signatureB64 } = parseJwt(idToken);

	if (header.alg !== "RS256") {
		throw new Error("unsupported_algorithm");
	}
	if (!header.kid) {
		throw new Error("missing_kid_in_header");
	}

	// Fetch JWKS and locate matching key by kid
	let keys = await getGoogleJwks(discovery.jwks_uri, false, options);
	let key = keys.find((k) => k.kid === header.kid);

	// Refetch once if key not found (key rotation)
	if (!key) {
		keys = await getGoogleJwks(discovery.jwks_uri, true, options);
		key = keys.find((k) => k.kid === header.kid);
	}

	if (!key) {
		throw new Error("unknown_signing_key");
	}

	// Verify cryptographic signature via node:crypto
	const signedData = `${headerB64}.${payloadB64}`;
	const signature = Buffer.from(signatureB64, "base64url");
	const publicKey = createPublicKey({
		key: key as unknown as import("node:crypto").JsonWebKey,
		format: "jwk",
	});

	const isSignatureValid = verify("RSA-SHA256", Buffer.from(signedData, "utf-8"), publicKey, signature);
	if (!isSignatureValid) {
		throw new Error("invalid_signature");
	}

	// ── Enforce claims (Verified fact 4) ──────────────────────────────────
	// 1. Issuer
	const validIssuers = ["https://accounts.google.com", "accounts.google.com"];
	if (discovery.issuer && !validIssuers.includes(discovery.issuer)) {
		validIssuers.push(discovery.issuer);
	}
	if (!payload.iss || !validIssuers.includes(payload.iss)) {
		throw new Error("invalid_issuer");
	}

	// 2. Audience
	if (payload.aud !== config.clientId) {
		throw new Error("invalid_audience");
	}

	// 3. Expiration (with 60s clock skew tolerance)
	const now = Date.now();
	if (typeof payload.exp !== "number" || payload.exp * 1000 < now - 60_000) {
		throw new Error("expired_token");
	}

	// 4. Nonce
	if (!payload.nonce || payload.nonce !== expectedNonce) {
		throw new Error("invalid_nonce");
	}

	// 5. Email verified
	if (payload.email_verified !== true) {
		throw new Error("unverified_email");
	}

	// 6. Email presence
	if (!payload.email || typeof payload.email !== "string") {
		throw new Error("missing_email");
	}

	// 7. Allowed users check
	const email = payload.email.trim().toLowerCase();
	const isAllowed = config.allowedEmails.some((allowed) => allowed.trim().toLowerCase() === email);
	if (!isAllowed) {
		throw new Error("email_not_allowed");
	}

	return {
		email,
		name: typeof payload.name === "string" ? payload.name : undefined,
		picture: typeof payload.picture === "string" ? payload.picture : undefined,
	};
}

export interface HandleCallbackParams {
	code: string;
	state: string;
	config: GoogleAuthConfig;
	options?: GoogleOidcOptions;
}

/**
 * Handles the OAuth callback:
 * 1. Checks and single-use consumes state
 * 2. Exchanges code for tokens
 * 3. Verifies id_token against JWKS & claims
 * 4. Checks email allowlist
 *
 * Never logs tokens or secret values (PXT-6).
 */
export async function handleCallback(params: {
	code: string;
	state: string;
	config: GoogleAuthConfig;
	options?: GoogleOidcOptions;
}): Promise<OidcUserSubject> {
	cleanExpiredStates();
	const { code, state, config, options } = params;

	// 1. Validate & consume state
	const stateEntry = stateMap.get(state);
	if (!stateEntry) {
		throw new Error("invalid_state");
	}
	// Immediately delete state (single-use guarantee)
	stateMap.delete(state);

	const now = Date.now();
	if (now - stateEntry.createdAt > STATE_TTL_MS) {
		throw new Error("expired_state");
	}

	// 2. Token exchange
	const discovery = await getGoogleDiscovery(options);
	const fetchFn = options?.fetchImpl ?? fetch;

	const bodyParams = new URLSearchParams({
		client_id: config.clientId,
		client_secret: config.clientSecret,
		code,
		code_verifier: stateEntry.codeVerifier,
		grant_type: "authorization_code",
		redirect_uri: config.redirectUri,
	});

	const tokenResponse = await fetchFn(discovery.token_endpoint, {
		method: "POST",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
		},
		body: bodyParams.toString(),
	});

	if (!tokenResponse.ok) {
		throw new Error("token_exchange_failed");
	}

	const tokenJson = (await tokenResponse.json()) as { id_token?: string };
	if (!tokenJson.id_token || typeof tokenJson.id_token !== "string") {
		throw new Error("missing_id_token");
	}

	// 3. Verify id_token & claims
	return await verifyIdToken(tokenJson.id_token, stateEntry.nonce, config, options);
}
