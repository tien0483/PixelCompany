// Storage for the single GitLab identity this runtime reviews as.
//
// Deliberately global, not per workspace and not per Claude seat: there is one
// GitLab account across every project here, and duplicating it per project
// would mean N tokens to revoke when it rotates. `host` is stored alongside the
// token so a credential minted against one instance is never replayed against
// another — a token for a self-hosted GitLab is worthless (and leaks) if sent
// to gitlab.com.
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { getRuntimeHomePath } from "../state/workspace-state";

export const GITLAB_CREDENTIAL_DIR_NAME = "gitlab";
export const GITLAB_CREDENTIAL_FILE_NAME = "credential.json";

export interface GitlabCredential {
	host: string;
	accessToken: string;
	refreshToken: string | null;
	/** Epoch ms, or null when the token endpoint reported no expiry. */
	expiresAt: number | null;
	username: string;
	name: string;
	userId: number;
	/** Set after a 401 that a refresh could not repair. */
	reauthRequired?: boolean;
}

export function getGitlabCredentialPath(): string {
	return join(getRuntimeHomePath(), GITLAB_CREDENTIAL_DIR_NAME, GITLAB_CREDENTIAL_FILE_NAME);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(source: Record<string, unknown>, key: string): string | null {
	const value = source[key];
	return typeof value === "string" && value.length > 0 ? value : null;
}

function readFiniteNumber(source: Record<string, unknown>, key: string): number | null {
	const value = source[key];
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function parseGitlabCredential(raw: unknown): GitlabCredential | null {
	if (!isRecord(raw)) {
		return null;
	}
	const host = readString(raw, "host");
	const accessToken = readString(raw, "accessToken");
	const username = readString(raw, "username");
	const userId = readFiniteNumber(raw, "userId");
	if (!host || !accessToken || !username || userId === null) {
		return null;
	}
	return {
		host,
		accessToken,
		refreshToken: readString(raw, "refreshToken"),
		expiresAt: readFiniteNumber(raw, "expiresAt"),
		username,
		name: readString(raw, "name") ?? username,
		userId,
		...(raw.reauthRequired === true ? { reauthRequired: true } : {}),
	};
}

export async function readGitlabCredential(): Promise<GitlabCredential | null> {
	try {
		const text = await readFile(getGitlabCredentialPath(), "utf-8");
		return parseGitlabCredential(JSON.parse(text) as unknown);
	} catch {
		// Absent or unreadable both mean "not connected". A parse failure is not
		// escalated: the recovery is the same Connect button either way.
		return null;
	}
}

export async function writeGitlabCredential(credential: GitlabCredential): Promise<void> {
	const path = getGitlabCredentialPath();
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `${JSON.stringify(credential, null, 2)}\n`, "utf-8");
	// Written after the fact rather than via the `mode` option: an existing file
	// keeps its old mode when rewritten, so `mode` alone would not tighten a file
	// created before this line existed.
	await chmod(path, 0o600);
}

export async function clearGitlabCredential(): Promise<void> {
	await rm(getGitlabCredentialPath(), { force: true });
}

/** Marks the stored credential as needing a fresh authorization, keeping the identity for display. */
export async function markGitlabCredentialReauthRequired(): Promise<void> {
	const existing = await readGitlabCredential();
	if (!existing || existing.reauthRequired === true) {
		return;
	}
	await writeGitlabCredential({ ...existing, reauthRequired: true });
}
