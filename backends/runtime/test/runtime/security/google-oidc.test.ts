import { createSign, generateKeyPairSync } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";

import type { GoogleAuthConfig } from "../../../src/security/auth-mode";
import {
	clearOidcMemory,
	createAuthorizationUrl,
	type GoogleOidcDiscovery,
	type GoogleOidcOptions,
	handleCallback,
	type JwkKey,
	type JwksResponse,
	verifyIdToken,
} from "../../../src/security/google-oidc";

describe("security/google-oidc", () => {
	const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
	const exportedJwk = publicKey.export({ format: "jwk" }) as unknown as JwkKey;
	const testJwk: JwkKey = {
		...exportedJwk,
		kid: "test-google-kid-1",
		alg: "RS256",
		use: "sig",
	};

	const testDiscovery: GoogleOidcDiscovery = {
		issuer: "https://accounts.google.com",
		authorization_endpoint: "https://accounts.google.com/o/oauth2/v2/auth",
		token_endpoint: "https://oauth2.googleapis.com/token",
		jwks_uri: "https://www.googleapis.com/oauth2/v3/certs",
	};

	const testConfig: GoogleAuthConfig = {
		clientId: "test-client-id.apps.googleusercontent.com",
		clientSecret: "test-client-secret-12345",
		publicOrigin: "http://localhost:3484",
		allowedEmails: ["allowed@company.com", "admin@company.com"],
		redirectUri: "http://localhost:3484/api/auth/google/callback",
	};

	function createSignedJwt(
		payload: Record<string, unknown>,
		headerOverrides?: Record<string, unknown>,
		key = privateKey,
	): string {
		const header = {
			alg: "RS256",
			kid: testJwk.kid,
			typ: "JWT",
			...headerOverrides,
		};
		const headerB64 = Buffer.from(JSON.stringify(header)).toString("base64url");
		const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
		const data = `${headerB64}.${payloadB64}`;

		const signer = createSign("RSA-SHA256");
		signer.update(data);
		const signatureB64 = signer.sign(key).toString("base64url");

		return `${data}.${signatureB64}`;
	}

	function createMockFetch(tokenResponseOrIdToken?: string | Record<string, unknown>) {
		return async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
			const urlStr = url.toString();

			if (urlStr.includes(".well-known/openid-configuration")) {
				return new Response(JSON.stringify(testDiscovery), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				});
			}

			if (urlStr.includes("/certs") || urlStr.includes("jwks")) {
				const body: JwksResponse = { keys: [testJwk] };
				return new Response(JSON.stringify(body), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				});
			}

			if (urlStr.includes("/token")) {
				const idToken =
					typeof tokenResponseOrIdToken === "string"
						? tokenResponseOrIdToken
						: "dummy-id-token";
				const responseObj =
					typeof tokenResponseOrIdToken === "object"
						? tokenResponseOrIdToken
						: {
								access_token: "mock-access-token",
								id_token: idToken,
								expires_in: 3600,
								token_type: "Bearer",
							};
				return new Response(JSON.stringify(responseObj), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				});
			}

			return new Response("Not found", { status: 404 });
		};
	}

	beforeEach(() => {
		clearOidcMemory();
	});

	it("creates authorization URL with PKCE parameters, state, and nonce", async () => {
		const mockFetch = createMockFetch();
		const options: GoogleOidcOptions = { fetchImpl: mockFetch as unknown as typeof fetch };

		const { url, state } = await createAuthorizationUrl(testConfig, options);

		expect(state).toHaveLength(64); // 32 hex bytes
		const parsedUrl = new URL(url);
		expect(parsedUrl.origin).toBe("https://accounts.google.com");
		expect(parsedUrl.searchParams.get("client_id")).toBe(testConfig.clientId);
		expect(parsedUrl.searchParams.get("redirect_uri")).toBe(testConfig.redirectUri);
		expect(parsedUrl.searchParams.get("response_type")).toBe("code");
		expect(parsedUrl.searchParams.get("scope")).toBe("openid email profile");
		expect(parsedUrl.searchParams.get("state")).toBe(state);
		expect(parsedUrl.searchParams.get("nonce")).toBeTruthy();
		expect(parsedUrl.searchParams.get("code_challenge")).toBeTruthy();
		expect(parsedUrl.searchParams.get("code_challenge_method")).toBe("S256");
	});

	it("successfully handles full OAuth callback and verifies user subject", async () => {
		const mockFetchRef: { current?: typeof fetch } = {};
		const options: GoogleOidcOptions = {
			fetchImpl: ((...args: [string | URL | Request, RequestInit?]) => mockFetchRef.current!(...args)) as typeof fetch,
		};

		// 1. Initial auth URL generation
		mockFetchRef.current = createMockFetch() as unknown as typeof fetch;
		const { state } = await createAuthorizationUrl(testConfig, options);

		// Extract nonce from stored state by extracting state
		// We'll prepare an ID token with the expected nonce
		// Let's create a signed ID token
		let capturedNonce = "";
		const testPayload = {
			iss: "https://accounts.google.com",
			aud: testConfig.clientId,
			exp: Math.floor(Date.now() / 1000) + 3600,
			iat: Math.floor(Date.now() / 1000),
			email: "allowed@company.com",
			email_verified: true,
			name: "Allowed User",
			picture: "https://example.com/avatar.png",
		};

		// Mock token exchange that inspects request or delivers JWT with matching nonce
		const dynamicMockFetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
			const urlStr = url.toString();
			if (urlStr.includes(".well-known/openid-configuration")) {
				return new Response(JSON.stringify(testDiscovery), { status: 200, headers: { "Content-Type": "application/json" } });
			}
			if (urlStr.includes("/certs")) {
				return new Response(JSON.stringify({ keys: [testJwk] }), { status: 200, headers: { "Content-Type": "application/json" } });
			}
			if (urlStr.includes("/token")) {
				// To sign with the matching nonce, we can verify with state's nonce:
				// We create a helper to sign right here
				const jwt = createSignedJwt({ ...testPayload, nonce: capturedNonce });
				return new Response(JSON.stringify({ id_token: jwt, access_token: "at-123" }), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				});
			}
			return new Response("Not found", { status: 404 });
		};

		mockFetchRef.current = dynamicMockFetch as unknown as typeof fetch;

		// Recreate to capture nonce
		const auth = await createAuthorizationUrl(testConfig, options);
		// Parse auth URL to get nonce
		const authParams = new URL(auth.url).searchParams;
		capturedNonce = authParams.get("nonce")!;

		const user = await handleCallback({
			code: "valid-auth-code",
			state: auth.state,
			config: testConfig,
			options,
		});

		expect(user.email).toBe("allowed@company.com");
		expect(user.name).toBe("Allowed User");
		expect(user.picture).toBe("https://example.com/avatar.png");
	});

	describe("claims and signature validation", () => {
		const validBasePayload = {
			iss: "https://accounts.google.com",
			aud: testConfig.clientId,
			exp: Math.floor(Date.now() / 1000) + 3600,
			iat: Math.floor(Date.now() / 1000),
			nonce: "test-nonce-123",
			email: "allowed@company.com",
			email_verified: true,
			name: "Test User",
		};

		const options: GoogleOidcOptions = {
			fetchImpl: createMockFetch() as unknown as typeof fetch,
		};

		it("verifies valid id_token successfully", async () => {
			const jwt = createSignedJwt(validBasePayload);
			const user = await verifyIdToken(jwt, "test-nonce-123", testConfig, options);
			expect(user.email).toBe("allowed@company.com");
			expect(user.name).toBe("Test User");
		});

		it("accepts accounts.google.com issuer without https://", async () => {
			const jwt = createSignedJwt({ ...validBasePayload, iss: "accounts.google.com" });
			const user = await verifyIdToken(jwt, "test-nonce-123", testConfig, options);
			expect(user.email).toBe("allowed@company.com");
		});

		it("rejects expired token", async () => {
			const jwt = createSignedJwt({
				...validBasePayload,
				exp: Math.floor(Date.now() / 1000) - 3600,
			});
			await expect(verifyIdToken(jwt, "test-nonce-123", testConfig, options)).rejects.toThrow("expired_token");
		});

		it("rejects wrong audience", async () => {
			const jwt = createSignedJwt({
				...validBasePayload,
				aud: "different-client-id.apps.googleusercontent.com",
			});
			await expect(verifyIdToken(jwt, "test-nonce-123", testConfig, options)).rejects.toThrow("invalid_audience");
		});

		it("rejects wrong issuer", async () => {
			const jwt = createSignedJwt({
				...validBasePayload,
				iss: "https://untrusted-issuer.com",
			});
			await expect(verifyIdToken(jwt, "test-nonce-123", testConfig, options)).rejects.toThrow("invalid_issuer");
		});

		it("rejects unverified email (email_verified: false)", async () => {
			const jwt = createSignedJwt({
				...validBasePayload,
				email_verified: false,
			});
			await expect(verifyIdToken(jwt, "test-nonce-123", testConfig, options)).rejects.toThrow("unverified_email");
		});

		it("rejects email not in allowlist", async () => {
			const jwt = createSignedJwt({
				...validBasePayload,
				email: "unauthorized-user@other.com",
			});
			await expect(verifyIdToken(jwt, "test-nonce-123", testConfig, options)).rejects.toThrow("email_not_allowed");
		});

		it("rejects invalid nonce", async () => {
			const jwt = createSignedJwt({
				...validBasePayload,
				nonce: "wrong-nonce",
			});
			await expect(verifyIdToken(jwt, "test-nonce-123", testConfig, options)).rejects.toThrow("invalid_nonce");
		});

		it("rejects invalid cryptographic signature", async () => {
			const otherKeypair = generateKeyPairSync("rsa", { modulusLength: 2048 });
			const jwt = createSignedJwt(validBasePayload, undefined, otherKeypair.privateKey);
			await expect(verifyIdToken(jwt, "test-nonce-123", testConfig, options)).rejects.toThrow("invalid_signature");
		});

		it("rejects unknown signing key (kid)", async () => {
			const jwt = createSignedJwt(validBasePayload, { kid: "non-existent-kid" });
			await expect(verifyIdToken(jwt, "test-nonce-123", testConfig, options)).rejects.toThrow("unknown_signing_key");
		});
	});

	describe("single-use state security", () => {
		it("rejects reused/replayed state", async () => {
			const options: GoogleOidcOptions = {
				fetchImpl: createMockFetch() as unknown as typeof fetch,
			};

			const { state, url } = await createAuthorizationUrl(testConfig, options);
			const nonce = new URL(url).searchParams.get("nonce")!;
			const jwt = createSignedJwt({
				iss: "https://accounts.google.com",
				aud: testConfig.clientId,
				exp: Math.floor(Date.now() / 1000) + 3600,
				nonce,
				email: "allowed@company.com",
				email_verified: true,
			});

			const tokenMockFetch = createMockFetch(jwt);
			const testOptions: GoogleOidcOptions = { fetchImpl: tokenMockFetch as unknown as typeof fetch };

			// First callback consumption succeeds
			const firstUser = await handleCallback({
				code: "code-1",
				state,
				config: testConfig,
				options: testOptions,
			});
			expect(firstUser.email).toBe("allowed@company.com");

			// Replay of same state fails immediately
			await expect(
				handleCallback({
					code: "code-2",
					state,
					config: testConfig,
					options: testOptions,
				}),
			).rejects.toThrow("invalid_state");
		});
	});
});
