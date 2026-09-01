import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createSign, generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket, WebSocketServer } from "ws";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
	checkRateLimit,
	clearRateLimit,
	deleteSession,
	extractBearerToken,
	extractSessionTokenFromCookie,
	getSessionSubject,
	isPasscodeEnabled,
	issueSession,
	issueSessionForSubject,
	recordFailedAttempt,
	validateInternalToken,
	validatePasscode,
	validateSession,
} from "../../../src/security/passcode-manager";
import {
	type GoogleAuthConfig,
	readAuthFile,
	resolveAuthMode,
	validateGoogleConfig,
	writeAuthFile,
} from "../../../src/security/auth-mode";
import {
	createAuthorizationUrl,
	getGoogleDiscovery,
	handleCallback,
	type JwkKey,
} from "../../../src/security/google-oidc";

describe("Gate 4 & 5: Full Google OIDC manual round-trip integration", () => {
	let testHome: string;
	let mockOidcServer: import("node:http").Server;
	let mockOidcPort: number;
	let testServer: import("node:http").Server;
	let testPort: number;
	let testBaseUrl: string;

	const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
	const exportedJwk = publicKey.export({ format: "jwk" }) as unknown as JwkKey;
	const testJwk: JwkKey = {
		...exportedJwk,
		kid: "mock-google-kid-roundtrip",
		alg: "RS256",
		use: "sig",
	};

	let lastNonce = "";
	let tokenIssuerEmail = "authorized.user@company.com";
	const logLines: string[] = [];

	// Intercept console.log/warn/error to verify Gate 5 (no secrets logged)
	const origLog = console.log;
	const origWarn = console.warn;
	const origError = console.error;

	function createSignedIdToken(email: string, nonce: string): string {
		const header = {
			alg: "RS256",
			kid: testJwk.kid,
			typ: "JWT",
		};
		const payload = {
			iss: `http://127.0.0.1:${mockOidcPort}`,
			aud: "roundtrip-client-id.apps.googleusercontent.com",
			exp: Math.floor(Date.now() / 1000) + 3600,
			iat: Math.floor(Date.now() / 1000),
			nonce,
			email,
			email_verified: true,
			name: "Authorized Engineer",
			picture: "https://lh3.googleusercontent.com/avatar-test.jpg",
		};

		const headerB64 = Buffer.from(JSON.stringify(header)).toString("base64url");
		const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
		const data = `${headerB64}.${payloadB64}`;

		const signer = createSign("RSA-SHA256");
		signer.update(data);
		const signatureB64 = signer.sign(privateKey).toString("base64url");

		return `${data}.${signatureB64}`;
	}

	beforeAll(async () => {
		console.log = (...args) => {
			logLines.push(args.map(String).join(" "));
			origLog(...args);
		};
		console.warn = (...args) => {
			logLines.push(args.map(String).join(" "));
			origWarn(...args);
		};
		console.error = (...args) => {
			logLines.push(args.map(String).join(" "));
			origError(...args);
		};

		testHome = await mkdtemp(join(tmpdir(), "pixtiel-roundtrip-test-"));
		process.env.KANBAN_HOME = testHome;

		// 1. Mock Google OIDC Discovery & Endpoints
		mockOidcServer = createHttpServer((req, res) => {
			const url = new URL(req.url ?? "/", `http://127.0.0.1:${mockOidcPort}`);
			if (url.pathname === "/.well-known/openid-configuration") {
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(
					JSON.stringify({
						issuer: `http://127.0.0.1:${mockOidcPort}`,
						authorization_endpoint: `http://127.0.0.1:${mockOidcPort}/o/oauth2/v2/auth`,
						token_endpoint: `http://127.0.0.1:${mockOidcPort}/token`,
						jwks_uri: `http://127.0.0.1:${mockOidcPort}/certs`,
					}),
				);
				return;
			}
			if (url.pathname === "/certs") {
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ keys: [testJwk] }));
				return;
			}
			if (url.pathname === "/token" && req.method === "POST") {
				let body = "";
				req.on("data", (chunk) => (body += chunk));
				req.on("end", () => {
					const idToken = createSignedIdToken(tokenIssuerEmail, lastNonce);
					res.writeHead(200, { "Content-Type": "application/json" });
					res.end(
						JSON.stringify({
							access_token: "mock-access-token-xyz-secret-token",
							id_token: idToken,
							token_type: "Bearer",
							expires_in: 3600,
						}),
					);
				});
				return;
			}
			res.writeHead(404);
			res.end();
		});

		await new Promise<void>((resolve) => {
			mockOidcServer.listen(0, "127.0.0.1", () => {
				const addr = mockOidcServer.address() as import("node:net").AddressInfo;
				mockOidcPort = addr.port;
				resolve();
			});
		});

		// 2. Configure auth files & environment variables
		await writeAuthFile("allowed-users", ["authorized.user@company.com"], testHome);

		process.env.PIXTIEL_AUTH_MODE = "google";
		process.env.PIXTIEL_GOOGLE_CLIENT_ID = "roundtrip-client-id.apps.googleusercontent.com";
		process.env.PIXTIEL_GOOGLE_CLIENT_SECRET = "roundtrip-client-secret-999";
		process.env.PIXTIEL_GOOGLE_DISCOVERY_URL = `http://127.0.0.1:${mockOidcPort}/.well-known/openid-configuration`;

		// 3. Start Test HTTP Server with exact runtime-server auth gate implementation
		const getRemoteIp = (req: IncomingMessage): string => req.socket.remoteAddress ?? "unknown";

		const requestHandler = async (req: IncomingMessage, res: ServerResponse) => {
			const requestUrl = new URL(req.url ?? "/", `http://127.0.0.1:${testPort}`);
			const pathname = requestUrl.pathname;
			const authMode = resolveAuthMode({ isRemote: true, env: process.env });

			let googleConfig: GoogleAuthConfig | null = null;
			const getGoogleConfig = async (): Promise<GoogleAuthConfig | null> => {
				if (googleConfig) return googleConfig;
				const validation = await validateGoogleConfig({
					runtimeHome: testHome,
					env: process.env,
					publicOriginOverride: testBaseUrl,
				});
				if (validation.valid && validation.config) {
					googleConfig = validation.config;
					return googleConfig;
				}
				return null;
			};

			// ── Auth gate (off | passcode | google) ───────────────────────────
			if (pathname === "/api/auth/status" || pathname === "/api/passcode/status") {
				if (authMode === "off") {
					res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
					res.end(JSON.stringify({
						mode: "off",
						required: false,
						authenticated: true,
						passcodeAvailable: false,
						google: { configured: false },
					}));
				} else {
					const sessionToken = extractSessionTokenFromCookie(req.headers.cookie);
					const sessionAuth = sessionToken !== null && validateSession(sessionToken);
					const bearerToken = extractBearerToken(req.headers.authorization);
					const internalAuth = bearerToken !== null && validateInternalToken(bearerToken);
					const authenticated = sessionAuth || internalAuth;
					const subject = sessionToken ? getSessionSubject(sessionToken) ?? undefined : undefined;
					res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
					res.end(JSON.stringify({
						mode: authMode,
						required: true,
						authenticated,
						passcodeAvailable: isPasscodeEnabled(),
						google: { configured: authMode === "google" },
						...(subject ? { subject } : {}),
					}));
				}
				return;
			}

			if (pathname === "/api/auth/google/start") {
				if (authMode !== "google") {
					res.writeHead(400, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
					res.end(JSON.stringify({ error: "Google authentication is not enabled." }));
					return;
				}
				const config = await getGoogleConfig();
				if (!config) {
					res.writeHead(500, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
					res.end(JSON.stringify({ error: "Google OAuth configuration is incomplete." }));
					return;
				}
				try {
					const { url } = await createAuthorizationUrl(config);
					res.writeHead(302, {
						Location: url,
						"Cache-Control": "no-store",
					});
					res.end();
				} catch {
					res.writeHead(500, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
					res.end(JSON.stringify({ error: "Failed to initiate Google login." }));
				}
				return;
			}

			if (pathname === "/api/auth/google/callback") {
				const ip = getRemoteIp(req);
				const rateLimit = checkRateLimit(ip);
				if (!rateLimit.allowed) {
					const retryAfterSec = rateLimit.lockedUntilMs
						? Math.ceil((rateLimit.lockedUntilMs - Date.now()) / 1000)
						: 30;
					res.writeHead(429, {
						"Content-Type": "application/json; charset=utf-8",
						"Cache-Control": "no-store",
						"Retry-After": String(retryAfterSec),
					});
					res.end(JSON.stringify({ error: "Too many attempts. Please wait before trying again." }));
					return;
				}

				if (authMode !== "google") {
					res.writeHead(400, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
					res.end(JSON.stringify({ error: "Google authentication is not enabled." }));
					return;
				}

				const config = await getGoogleConfig();
				if (!config) {
					res.writeHead(500, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
					res.end(JSON.stringify({ error: "Google OAuth configuration is incomplete." }));
					return;
				}

				const error = requestUrl.searchParams.get("error");
				if (error) {
					recordFailedAttempt(ip);
					res.writeHead(302, {
						Location: `/?auth_error=${encodeURIComponent(error)}`,
						"Cache-Control": "no-store",
					});
					res.end();
					return;
				}

				const code = requestUrl.searchParams.get("code");
				const state = requestUrl.searchParams.get("state");
				if (!code || !state) {
					recordFailedAttempt(ip);
					res.writeHead(302, {
						Location: "/?auth_error=missing_code_or_state",
						"Cache-Control": "no-store",
					});
					res.end();
					return;
				}

				try {
					const user = await handleCallback({ code, state, config });
					clearRateLimit(ip);
					const token = issueSessionForSubject(user);
					const cookieFlags = [
						`kanban_session=${token}`,
						"HttpOnly",
						"SameSite=Strict",
						"Path=/",
						`Max-Age=${24 * 60 * 60}`,
					].join("; ");
					res.writeHead(302, {
						Location: "/",
						"Set-Cookie": cookieFlags,
						"Cache-Control": "no-store",
					});
					res.end();
				} catch (err) {
					recordFailedAttempt(ip);
					const reason = err instanceof Error ? err.message : "auth_failed";
					res.writeHead(302, {
						Location: `/?auth_error=${encodeURIComponent(reason)}`,
						"Cache-Control": "no-store",
					});
					res.end();
				}
				return;
			}

			if (req.method === "POST" && pathname === "/api/auth/logout") {
				const sessionToken = extractSessionTokenFromCookie(req.headers.cookie);
				if (sessionToken) {
					deleteSession(sessionToken);
				}
				const cookieFlags = [
					"kanban_session=",
					"HttpOnly",
					"SameSite=Strict",
					"Path=/",
					"Max-Age=0",
				].join("; ");
				res.writeHead(200, {
					"Content-Type": "application/json; charset=utf-8",
					"Cache-Control": "no-store",
					"Set-Cookie": cookieFlags,
				});
				res.end(JSON.stringify({ ok: true }));
				return;
			}

			if (authMode !== "off") {
				const sessionToken = extractSessionTokenFromCookie(req.headers.cookie);
				const sessionAuth = sessionToken !== null && validateSession(sessionToken);
				const bearerToken = extractBearerToken(req.headers.authorization);
				const internalAuth = bearerToken !== null && validateInternalToken(bearerToken);
				const authenticated = sessionAuth || internalAuth;
				if (!authenticated) {
					if (pathname.startsWith("/api/")) {
						res.writeHead(401, {
							"Content-Type": "application/json; charset=utf-8",
							"Cache-Control": "no-store",
						});
						res.end(JSON.stringify({ error: "Authentication required." }));
						return;
					}
				}
			}

			// Example protected API endpoint
			if (pathname === "/api/trpc/workspace.list") {
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ result: { data: [] } }));
				return;
			}

			res.writeHead(200, { "Content-Type": "text/html" });
			res.end("<!DOCTYPE html><html><body>PIXTiel App</body></html>");
		};

		testServer = createHttpServer(requestHandler);

		const wss = new WebSocketServer({ noServer: true });
		wss.on("connection", (ws) => {
			ws.send("connected");
		});

		testServer.on("upgrade", (request, socket, head) => {
			const authMode = resolveAuthMode({ isRemote: true, env: process.env });
			if (authMode !== "off") {
				const sessionToken = extractSessionTokenFromCookie(request.headers.cookie);
				const sessionAuth = sessionToken !== null && validateSession(sessionToken);
				const bearerToken = extractBearerToken(request.headers.authorization);
				const internalAuth = bearerToken !== null && validateInternalToken(bearerToken);
				if (!sessionAuth && !internalAuth) {
					socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
					socket.destroy();
					return;
				}
			}
			wss.handleUpgrade(request, socket, head, (ws) => {
				wss.emit("connection", ws, request);
			});
		});

		await new Promise<void>((resolve) => {
			testServer.listen(0, "127.0.0.1", () => {
				const addr = testServer.address() as import("node:net").AddressInfo;
				testPort = addr.port;
				testBaseUrl = `http://127.0.0.1:${testPort}`;
				process.env.PIXTIEL_PUBLIC_ORIGIN = testBaseUrl;
				resolve();
			});
		});
	});

	afterAll(async () => {
		console.log = origLog;
		console.warn = origWarn;
		console.error = origError;

		delete process.env.PIXTIEL_AUTH_MODE;
		delete process.env.PIXTIEL_GOOGLE_CLIENT_ID;
		delete process.env.PIXTIEL_GOOGLE_CLIENT_SECRET;
		delete process.env.PIXTIEL_GOOGLE_DISCOVERY_URL;
		delete process.env.PIXTIEL_PUBLIC_ORIGIN;
		delete process.env.KANBAN_HOME;

		await new Promise<void>((resolve) => testServer.close(() => resolve()));
		await new Promise<void>((resolve) => mockOidcServer.close(() => resolve()));
		await rm(testHome, { recursive: true, force: true });
	});

	it("executes full Gate 4 round-trip: status -> gate 401 -> login -> cookie -> WS -> logout -> 401", async () => {
		// 1. Initial status check -> unauthenticated
		const statusRes1 = await fetch(`${testBaseUrl}/api/auth/status`);
		expect(statusRes1.status).toBe(200);
		const status1 = await statusRes1.json();
		expect(status1).toMatchObject({
			mode: "google",
			required: true,
			authenticated: false,
			google: { configured: true },
		});
		expect(status1.subject).toBeUndefined();

		// Legacy status alias
		const legacyStatusRes = await fetch(`${testBaseUrl}/api/passcode/status`);
		const legacyStatus = await legacyStatusRes.json();
		expect(legacyStatus.required).toBe(true);
		expect(legacyStatus.authenticated).toBe(false);

		// 2. Blanket 401 gate blocks unauthenticated API calls
		const apiRes = await fetch(`${testBaseUrl}/api/trpc/workspace.list`);
		expect(apiRes.status).toBe(401);
		const apiBody = await apiRes.json();
		expect(apiBody.error).toBe("Authentication required.");

		// 3. Start Google login -> HTTP 302 to Google auth URL
		// Pre-populate discovery endpoint with mock OIDC discovery
		await getGoogleDiscovery({ discoveryUrl: `http://127.0.0.1:${mockOidcPort}/.well-known/openid-configuration` });

		const startRes = await fetch(`${testBaseUrl}/api/auth/google/start`, {
			redirect: "manual",
		});
		expect(startRes.status).toBe(302);
		const location = startRes.headers.get("location");
		expect(location).toBeTruthy();

		const authUrl = new URL(location!);
		const state = authUrl.searchParams.get("state")!;
		lastNonce = authUrl.searchParams.get("nonce")!;
		expect(state).toBeTruthy();
		expect(lastNonce).toBeTruthy();

		// 4. Callback with authorized user -> 302 to / and Set-Cookie
		tokenIssuerEmail = "authorized.user@company.com";
		const callbackRes = await fetch(`${testBaseUrl}/api/auth/google/callback?code=mock-code-1&state=${state}`, {
			redirect: "manual",
		});
		expect(callbackRes.status).toBe(302);
		expect(callbackRes.headers.get("location")).toBe("/");
		const cookieHeader = callbackRes.headers.get("set-cookie");
		expect(cookieHeader).toBeTruthy();
		expect(cookieHeader).toContain("kanban_session=");
		expect(cookieHeader).toContain("HttpOnly");
		expect(cookieHeader).toContain("SameSite=Strict");

		const sessionCookie = cookieHeader!.split(";")[0]!;

		// 5. /api/auth/status with session cookie shows authenticated user subject
		const statusRes2 = await fetch(`${testBaseUrl}/api/auth/status`, {
			headers: { Cookie: sessionCookie },
		});
		expect(statusRes2.status).toBe(200);
		const status2 = await statusRes2.json();
		expect(status2.authenticated).toBe(true);
		expect(status2.subject).toEqual({
			email: "authorized.user@company.com",
			name: "Authorized Engineer",
			picture: "https://lh3.googleusercontent.com/avatar-test.jpg",
		});

		// 6. WebSocket connects with session cookie
		const wsUrl = `ws://127.0.0.1:${testPort}/api/runtime/ws`;
		const wsSuccess = await new Promise<boolean>((resolve) => {
			const ws = new WebSocket(wsUrl, {
				headers: { Cookie: sessionCookie },
			});
			ws.on("open", () => {
				ws.close();
				resolve(true);
			});
			ws.on("error", (err) => {
				console.error("WS error:", err);
				resolve(false);
			});
		});
		expect(wsSuccess).toBe(true);

		// WebSocket without cookie is rejected with 401
		const wsFail = await new Promise<boolean>((resolve) => {
			const ws = new WebSocket(wsUrl);
			ws.on("open", () => {
				ws.close();
				resolve(false);
			});
			ws.on("error", () => {
				resolve(true); // Expected 401 rejection
			});
		});
		expect(wsFail).toBe(true);

		// 7. Disallowed email rejected with reason
		const startRes2 = await fetch(`${testBaseUrl}/api/auth/google/start`, { redirect: "manual" });
		const authUrl2 = new URL(startRes2.headers.get("location")!);
		const state2 = authUrl2.searchParams.get("state")!;
		lastNonce = authUrl2.searchParams.get("nonce")!;

		tokenIssuerEmail = "disallowed.attacker@otherdomain.com";
		const callbackRes2 = await fetch(`${testBaseUrl}/api/auth/google/callback?code=mock-code-2&state=${state2}`, {
			redirect: "manual",
		});
		expect(callbackRes2.status).toBe(302);
		expect(callbackRes2.headers.get("location")).toBe("/?auth_error=email_not_allowed");

		// 8. Logout deletes session and clears cookie
		const logoutRes = await fetch(`${testBaseUrl}/api/auth/logout`, {
			method: "POST",
			headers: { Cookie: sessionCookie },
		});
		expect(logoutRes.status).toBe(200);
		const logoutCookie = logoutRes.headers.get("set-cookie");
		expect(logoutCookie).toContain("Max-Age=0");

		// 9. After logout, session is invalidated -> 401
		const statusRes3 = await fetch(`${testBaseUrl}/api/auth/status`, {
			headers: { Cookie: sessionCookie },
		});
		const status3 = await statusRes3.json();
		expect(status3.authenticated).toBe(false);

		// 10. Gate 5: verify no secrets/tokens/codes leaked in logs
		const combinedLogs = logLines.join("\n");
		expect(combinedLogs).not.toContain("mock-access-token-xyz-secret-token");
		expect(combinedLogs).not.toContain("roundtrip-client-secret-999");
		expect(combinedLogs).not.toContain("mock-code-1");
		expect(combinedLogs).not.toContain("mock-code-2");
	});
});
