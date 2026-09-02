import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getRuntimeHomePath } from "../state/workspace-state.js";
import { getKanbanRuntimeHost, getKanbanRuntimePort, isKanbanRuntimeHttps } from "../core/runtime-endpoint.js";

export type AuthMode = "off" | "passcode" | "google";

const AUTH_DIR_NAME = "auth";

/**
 * Reads an environment variable honoring the PIXTIEL_* brand prefix with
 * fallback to legacy PIXELOFFICE_* and PIXEL_OFFICE_* names (PXT-5).
 */
export function readBrandEnv(key: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
	const suffix = key.replace(/^(PIXTIEL_|PIXELOFFICE_|PIXEL_OFFICE_)/, "");
	const val =
		env[`PIXTIEL_${suffix}`] ??
		env[`PIXELOFFICE_${suffix}`] ??
		env[`PIXEL_OFFICE_${suffix}`] ??
		env[key];
	const trimmed = val?.trim();
	return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

export interface ResolveAuthModeOptions {
	env?: NodeJS.ProcessEnv;
	cliFlag?: string;
	isRemote?: boolean;
}

/**
 * Resolves the active authentication mode with strict precedence:
 * CLI flag > environment variable > default (remote => passcode, loopback => off).
 */
export function resolveAuthMode(options?: ResolveAuthModeOptions): AuthMode {
	const env = options?.env ?? process.env;

	// 1. CLI flag
	if (options?.cliFlag !== undefined && options.cliFlag.trim().length > 0) {
		const rawFlag = options.cliFlag.trim().toLowerCase();
		if (rawFlag === "off" || rawFlag === "passcode" || rawFlag === "google") {
			return rawFlag;
		}
		throw new Error(`Invalid --auth-mode value "${options.cliFlag}". Allowed modes: off, passcode, google.`);
	}

	// 2. Environment variable
	const envMode = readBrandEnv("AUTH_MODE", env);
	if (envMode) {
		const rawEnv = envMode.toLowerCase();
		if (rawEnv === "off" || rawEnv === "passcode" || rawEnv === "google") {
			return rawEnv;
		}
		throw new Error(`Invalid PIXTIEL_AUTH_MODE value "${envMode}". Allowed modes: off, passcode, google.`);
	}

	// 3. Default based on host binding
	return options?.isRemote ? "passcode" : "off";
}

export function getAuthDir(runtimeHome?: string): string {
	return join(runtimeHome ?? getRuntimeHomePath(), AUTH_DIR_NAME);
}

export async function ensureAuthDir(runtimeHome?: string): Promise<string> {
	const dir = getAuthDir(runtimeHome);
	await mkdir(dir, { recursive: true, mode: 0o700 });
	await chmod(dir, 0o700).catch(() => {});
	return dir;
}

export function getAuthFilePath(filename: string, runtimeHome?: string): string {
	const name = filename.endsWith(".json") ? filename : `${filename}.json`;
	return join(getAuthDir(runtimeHome), name);
}

export async function readAuthFile<T>(filename: string, runtimeHome?: string): Promise<T | null> {
	try {
		const filePath = getAuthFilePath(filename, runtimeHome);
		const buf = await readFile(filePath);
		return JSON.parse(buf.toString("utf-8")) as T;
	} catch {
		return null;
	}
}

export async function writeAuthFile<T>(filename: string, value: T, runtimeHome?: string): Promise<void> {
	const authDir = await ensureAuthDir(runtimeHome);
	const targetPath = getAuthFilePath(filename, runtimeHome);
	const tempPath = join(
		authDir,
		`.${filename.replace(/[/\\?%*:|"<>]/g, "_")}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`,
	);

	const jsonText = `${JSON.stringify(value, null, 2)}\n`;
	await writeFile(tempPath, Buffer.from(jsonText, "utf-8"));
	await chmod(tempPath, 0o600);
	await rename(tempPath, targetPath);
	await chmod(targetPath, 0o600).catch(() => {});
}

export interface GoogleAuthConfig {
	clientId: string;
	clientSecret: string;
	publicOrigin: string;
	allowedEmails: string[];
	redirectUri: string;
}

export interface ValidateGoogleConfigResult {
	valid: boolean;
	config?: GoogleAuthConfig;
	missing: string[];
	redirectUri: string;
	errorMessage?: string;
}

interface GoogleOAuthJson {
	clientId?: string;
	clientSecret?: string;
	client_id?: string;
	client_secret?: string;
	web?: {
		client_id?: string;
		client_secret?: string;
	};
	installed?: {
		client_id?: string;
		client_secret?: string;
	};
}

type AllowedUsersJson = string[] | { allowed?: string[]; users?: string[]; emails?: string[] };

/**
 * Collects and validates Google OIDC configuration.
 *
 * Checks:
 * - Client ID (env PIXTIEL_GOOGLE_CLIENT_ID or <runtimeHome>/auth/google-oauth.json)
 * - Client Secret (env PIXTIEL_GOOGLE_CLIENT_SECRET or <runtimeHome>/auth/google-oauth.json)
 * - Public Origin (env PIXTIEL_PUBLIC_ORIGIN)
 * - Allowed users (non-empty <runtimeHome>/auth/allowed-users.json)
 */
export async function validateGoogleConfig(options?: {
	runtimeHome?: string;
	env?: NodeJS.ProcessEnv;
	publicOriginOverride?: string;
}): Promise<ValidateGoogleConfigResult> {
	const env = options?.env ?? process.env;
	const runtimeHome = options?.runtimeHome ?? getRuntimeHomePath();
	const authDir = getAuthDir(runtimeHome);

	// 1. Client ID and Secret
	let clientId = readBrandEnv("GOOGLE_CLIENT_ID", env);
	let clientSecret = readBrandEnv("GOOGLE_CLIENT_SECRET", env);

	const oauthFile = await readAuthFile<GoogleOAuthJson>("google-oauth", runtimeHome);
	if (oauthFile) {
		clientId = clientId ?? oauthFile.clientId ?? oauthFile.client_id ?? oauthFile.web?.client_id ?? oauthFile.installed?.client_id;
		clientSecret = clientSecret ?? oauthFile.clientSecret ?? oauthFile.client_secret ?? oauthFile.web?.client_secret ?? oauthFile.installed?.client_secret;
	}

	clientId = clientId?.trim();
	clientSecret = clientSecret?.trim();

	// 2. Public origin
	let publicOrigin =
		options?.publicOriginOverride?.trim() ??
		readBrandEnv("PUBLIC_ORIGIN", env) ??
		readBrandEnv("PUBLIC_URL", env);

	if (publicOrigin) {
		// Strip trailing slashes
		publicOrigin = publicOrigin.replace(/\/+$/, "");
	}

	// Calculate display redirect URI
	const fallbackOrigin = `${isKanbanRuntimeHttps() ? "https" : "http"}://${getKanbanRuntimeHost()}:${getKanbanRuntimePort()}`;
	const effectiveOrigin = publicOrigin || fallbackOrigin;
	const redirectUri = `${effectiveOrigin}/api/auth/google/callback`;

	// 3. Allowed users
	const allowedUsersData = await readAuthFile<AllowedUsersJson>("allowed-users", runtimeHome);
	let allowedEmails: string[] = [];
	if (Array.isArray(allowedUsersData)) {
		allowedEmails = allowedUsersData.filter((e): e is string => typeof e === "string" && e.trim().length > 0);
	} else if (allowedUsersData && typeof allowedUsersData === "object") {
		const candidates = allowedUsersData.allowed ?? allowedUsersData.users ?? allowedUsersData.emails;
		if (Array.isArray(candidates)) {
			allowedEmails = candidates.filter((e): e is string => typeof e === "string" && e.trim().length > 0);
		}
	}
	allowedEmails = allowedEmails.map((e) => e.trim().toLowerCase());

	const missing: string[] = [];
	if (!clientId) {
		missing.push(`Google Client ID (set PIXTIEL_GOOGLE_CLIENT_ID or ${join(authDir, "google-oauth.json")})`);
	}
	if (!clientSecret) {
		missing.push(`Google Client Secret (set PIXTIEL_GOOGLE_CLIENT_SECRET or ${join(authDir, "google-oauth.json")})`);
	}
	if (!publicOrigin) {
		missing.push("Public origin (set PIXTIEL_PUBLIC_ORIGIN, e.g. http://localhost:3484 or https://your-domain.com)");
	}
	if (allowedEmails.length === 0) {
		missing.push(`Allowed users list (create non-empty ${join(authDir, "allowed-users.json")} with email strings)`);
	}

	if (missing.length > 0) {
		const message = [
			"Google OIDC authentication is enabled (--auth-mode google), but the configuration is incomplete:",
			"",
			"Missing configuration:",
			...missing.map((item) => `  - ${item}`),
			"",
			"Required redirect URI to register in Google Cloud Console:",
			`  ${redirectUri}`,
		].join("\n");

		return {
			valid: false,
			missing,
			redirectUri,
			errorMessage: message,
		};
	}

	return {
		valid: true,
		config: {
			clientId: clientId!,
			clientSecret: clientSecret!,
			publicOrigin: publicOrigin!,
			allowedEmails,
			redirectUri,
		},
		missing: [],
		redirectUri,
	};
}
