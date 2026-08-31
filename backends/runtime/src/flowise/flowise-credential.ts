// The forked studio keeps its shipped account system (its schema and migrations are woven
// into the commercially-licensed `enterprise/` tree, so removing it means forking the
// schema). Instead of showing that login screen inside the Agents tab, the runtime seeds one
// local account and the fork's `?embed=1` bootstrap signs in with it server-side.
//
// The credential is a formality, not a boundary: the studio binds to loopback and only the
// runtime origin may call it or frame it. It is still written 0600 and gitignored, because
// the same directory holds the studio's credential-encryption key.
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { findFlowiseRoot } from "./flowise-endpoint";

const CREDENTIAL_FILE_NAME = "embed-credential.json";
const EMBED_ACCOUNT_NAME = "PixelOffice";
/** `.local` is reserved for local use, so this can never collide with a routable mailbox. */
const EMBED_ACCOUNT_EMAIL = "pixeloffice@pixeloffice.local";
const REQUEST_TIMEOUT_MS = 10_000;

export interface FlowiseEmbedCredential {
	email: string;
	password: string;
}

/**
 * The studio validates passwords with lower + upper + digit + special and a minimum of 8, so
 * a bare base64 string is rejected about half the time. The fixed prefix guarantees one of
 * each class; the entropy is all in the random tail.
 */
function generatePassword(): string {
	return `Px1!${randomBytes(24).toString("base64url")}`;
}

function parseCredential(raw: string): FlowiseEmbedCredential | null {
	try {
		const parsed: unknown = JSON.parse(raw);
		if (typeof parsed !== "object" || parsed === null) {
			return null;
		}
		const { email, password } = parsed as { email?: unknown; password?: unknown };
		if (typeof email !== "string" || email.length === 0 || typeof password !== "string" || password.length === 0) {
			return null;
		}
		return { email, password };
	} catch {
		return null;
	}
}

/** `<flowise root>/.flowise` — the same dir the supervisor points every `*_PATH` env at. */
export function resolveFlowiseDataDir(flowiseRoot?: string | null): string | null {
	const root = flowiseRoot === undefined ? findFlowiseRoot() : flowiseRoot;
	return root === null ? null : join(root, ".flowise");
}

/**
 * Reads the existing credential or writes a fresh one. Never rotates: the password is also
 * the studio account's password, so replacing the file without re-registering would lock the
 * embed out of its own account.
 */
export async function ensureFlowiseEmbedCredential(dataDir: string): Promise<FlowiseEmbedCredential> {
	const path = join(dataDir, CREDENTIAL_FILE_NAME);
	const existing = await readFile(path, "utf8")
		.then(parseCredential)
		.catch(() => null);
	if (existing !== null) {
		return existing;
	}
	const credential: FlowiseEmbedCredential = { email: EMBED_ACCOUNT_EMAIL, password: generatePassword() };
	await mkdir(dataDir, { recursive: true });
	await writeFile(path, `${JSON.stringify(credential, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
	return credential;
}

async function postJson(
	baseUrl: string,
	path: string,
	body: unknown,
): Promise<{ status: number; text: string } | null> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
	try {
		const response = await fetch(`${baseUrl}${path}`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
			signal: controller.signal,
		});
		return { status: response.status, text: await response.text() };
	} catch {
		return null;
	} finally {
		clearTimeout(timer);
	}
}

export interface SeedFlowiseEmbedAccountDependencies {
	baseUrl: string;
	dataDir: string;
	warn: (message: string) => void;
	log?: (message: string) => void;
}

/**
 * Idempotently makes the seeded account usable. Registration on an already-registered email
 * is a failure upstream, so success is defined by the *login* probe, not by the register
 * response — which also covers the case where the studio's database survived but this file
 * did not (there the login fails and the studio needs its data dir reset, so it is reported
 * rather than silently retried forever).
 */
export async function seedFlowiseEmbedAccount(deps: SeedFlowiseEmbedAccountDependencies): Promise<boolean> {
	const log = deps.log ?? (() => {});
	const credential = await ensureFlowiseEmbedCredential(deps.dataDir);

	const login = await postJson(deps.baseUrl, "/api/v1/auth/login", {
		email: credential.email,
		password: credential.password,
	});
	if (login !== null && login.status < 400) {
		return true;
	}

	const registered = await postJson(deps.baseUrl, "/api/v1/account/register", {
		user: { name: EMBED_ACCOUNT_NAME, email: credential.email, credential: credential.password },
	});
	if (registered === null) {
		deps.warn(
			"Could not reach the Flowise studio to seed its embed account — the Agents tab may show a login screen.",
		);
		return false;
	}
	if (registered.status < 400) {
		log("Seeded the Flowise studio's PixelOffice account.");
		return true;
	}

	const retry = await postJson(deps.baseUrl, "/api/v1/auth/login", {
		email: credential.email,
		password: credential.password,
	});
	if (retry !== null && retry.status < 400) {
		return true;
	}
	deps.warn(
		`Flowise studio rejected the seeded embed account (${registered.status}): ${registered.text.slice(0, 200)}`,
	);
	deps.warn(
		`  Its account exists with a different password. Delete ${join(deps.dataDir, CREDENTIAL_FILE_NAME)} and reset the studio's own database, or sign in once by hand.`,
	);
	return false;
}
