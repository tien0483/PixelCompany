import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DEFAULT_CLIENT_ID = "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com";
const DEFAULT_CLIENT_SECRET = "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";
const FALLBACK_CLIENT_PAIRS: ReadonlyArray<[string, string]> = [
	[DEFAULT_CLIENT_ID, DEFAULT_CLIENT_SECRET],
	[
		"681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com",
		"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",
	],
];

interface GeminiOAuthCreds {
	access_token?: string;
	refresh_token?: string;
	expiry_date?: number;
}

function resolveGeminiHome(): string {
	const fromEnv = process.env.GEMINI_HOME?.trim();
	return fromEnv && fromEnv.length > 0 ? fromEnv.replace(/^~/, homedir()) : join(homedir(), ".gemini");
}

async function readOAuthCredsFile(): Promise<GeminiOAuthCreds | null> {
	try {
		const parsed: unknown = JSON.parse(await readFile(join(resolveGeminiHome(), "oauth_creds.json"), "utf8"));
		return parsed && typeof parsed === "object" ? (parsed as GeminiOAuthCreds) : null;
	} catch {
		return null;
	}
}

async function refreshAccessToken(creds: GeminiOAuthCreds): Promise<GeminiOAuthCreds> {
	const refresh = creds.refresh_token?.trim();
	if (!refresh) {
		throw new Error("oauth_creds.json has no refresh_token");
	}
	const envId = process.env.GEMINI_OAUTH_CLIENT_ID?.trim();
	const envSecret = process.env.GEMINI_OAUTH_CLIENT_SECRET?.trim();
	const candidates: Array<[string, string]> = [];
	if (envId && envSecret) {
		candidates.push([envId, envSecret]);
	}
	for (const pair of FALLBACK_CLIENT_PAIRS) {
		if (!candidates.some(([id]) => id === pair[0])) {
			candidates.push(pair);
		}
	}
	let body: Record<string, unknown> | null = null;
	for (const [clientId, clientSecret] of candidates) {
		const response = await fetch(TOKEN_URL, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				client_id: clientId,
				client_secret: clientSecret,
				refresh_token: refresh,
				grant_type: "refresh_token",
			}),
		});
		if (response.ok) {
			body = (await response.json()) as Record<string, unknown>;
			break;
		}
	}
	if (body === null || typeof body.access_token !== "string") {
		throw new Error("Gemini token refresh failed");
	}
	const merged: GeminiOAuthCreds = { ...creds, access_token: body.access_token };
	if (typeof body.refresh_token === "string" && body.refresh_token.length > 0) {
		merged.refresh_token = body.refresh_token;
	}
	if (typeof body.expires_in === "number") {
		merged.expiry_date = Date.now() + body.expires_in * 1000;
	}
	try {
		await writeFile(join(resolveGeminiHome(), "oauth_creds.json"), `${JSON.stringify(merged, null, 2)}\n`, "utf8");
	} catch {
		// Best-effort persist — in-memory token is enough for this request.
	}
	return merged;
}

/** Returns a live Antigravity/Gemini CLI OAuth access token from ~/.gemini/oauth_creds.json. */
export async function resolveGeminiAccessToken(): Promise<string | null> {
	const creds = await readOAuthCredsFile();
	if (creds === null) {
		return null;
	}
	const skewMs = 120_000;
	const expiry = creds.expiry_date;
	const accessToken = creds.access_token?.trim();
	const needsRefresh =
		!accessToken ||
		(typeof expiry === "number" && expiry <= Date.now() + skewMs);
	if (!needsRefresh && accessToken) {
		return accessToken;
	}
	try {
		const refreshed = await refreshAccessToken(creds);
		return refreshed.access_token?.trim() ?? null;
	} catch {
		return accessToken ?? null;
	}
}
