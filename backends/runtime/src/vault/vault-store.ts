import { chmod, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { ZodType } from "zod";

import { getRuntimeHomePath } from "../state/workspace-state";
import { isPathWithinRoot } from "../workspace/path-sandbox";

export const VAULT_DIR_NAME = "vault";

export interface VaultCodec {
	encode(json: string): Buffer;
	decode(buf: Buffer): string;
}

export const plaintextCodec: VaultCodec = {
	encode: (json: string): Buffer => Buffer.from(json, "utf-8"),
	decode: (buf: Buffer): string => buf.toString("utf-8"),
};

export function getVaultDir(): string {
	return join(getRuntimeHomePath(), VAULT_DIR_NAME);
}

/**
 * Path separators and NUL — the only characters that can make a service id
 * address something other than one file directly inside the vault directory.
 *
 * Service ids arrive straight off the wire: `vault.setMcpSecret` takes
 * `serverId: z.string().min(1)` and `vault.delete` takes `service:
 * z.string().min(1)`, neither of which constrains a path. `join` normalizes
 * `..`, so `"../../../../.claude/settings.json"` left this directory entirely
 * and the writer and deleter below followed it. Only the *temp* filename was
 * ever sanitized; the target was not.
 *
 * Deliberately not a charset allowlist. An MCP service id is an `.mcp.json`
 * server *name*, which legitimately contains `@`, spaces and dots, and quietly
 * rejecting those would strand a secret that works today (`readVaultFile`
 * swallows every error and answers `null`). A name containing a separator, by
 * contrast, could never have been stored in the first place — `writeFile` would
 * have hit ENOENT on the implied subdirectory — so refusing it regresses
 * nothing.
 */
const PATH_UNSAFE_PATTERN = /[/\\\0]/;

export function getVaultFilePath(service: string): string {
	if (PATH_UNSAFE_PATTERN.test(service)) {
		throw new Error(`Invalid vault service id "${service}": must not contain a path separator.`);
	}
	const filename = service.endsWith(".json") ? service : `${service}.json`;
	const vaultDir = getVaultDir();
	// The check that actually holds if the pattern above is ever loosened, and
	// the one that catches a bare "." / ".." the pattern cannot see.
	if (!isPathWithinRoot(vaultDir, resolve(vaultDir, filename))) {
		throw new Error(`Invalid vault service id "${service}": resolves outside the vault directory.`);
	}
	return join(vaultDir, filename);
}

export async function ensureVaultDir(): Promise<string> {
	const dir = getVaultDir();
	await mkdir(dir, { recursive: true, mode: 0o700 });
	await chmod(dir, 0o700).catch(() => {});
	return dir;
}

export async function readVaultFile<T>(
	service: string,
	schema?: ZodType<T> | ((raw: unknown) => T | null),
	codec: VaultCodec = plaintextCodec,
): Promise<T | null> {
	try {
		const filePath = getVaultFilePath(service);
		const buf = await readFile(filePath);
		const text = codec.decode(buf);
		const json = JSON.parse(text) as unknown;
		if (!schema) {
			return json as T;
		}
		if (typeof schema === "function") {
			return schema(json);
		}
		if ("safeParse" in schema && typeof schema.safeParse === "function") {
			const result = schema.safeParse(json);
			return result.success ? result.data : null;
		}
		return null;
	} catch {
		// Absent, unparseable, or schema-invalid both mean null (tolerant like GitLab).
		return null;
	}
}

export async function writeVaultFile<T>(
	service: string,
	value: T,
	codec: VaultCodec = plaintextCodec,
): Promise<void> {
	const vaultDir = await ensureVaultDir();

	const targetPath = getVaultFilePath(service);
	const tempPath = join(
		vaultDir,
		`.${service.replace(/[/\\?%*:|"<>]/g, "_")}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`,
	);

	const jsonText = `${JSON.stringify(value, null, 2)}\n`;
	const buf = codec.encode(jsonText);

	// `mode` on create AND an explicit chmod, because neither alone is enough:
	// `mode` is masked by the process umask and does not tighten a file that
	// already exists, while chmod alone leaves the secret readable at the default
	// 0644 for the window between create and chmod — a race a co-tenant local
	// user can win. The temp name is unpredictable, but not secret.
	await writeFile(tempPath, buf, { mode: 0o600 });
	await chmod(tempPath, 0o600);
	await rename(tempPath, targetPath);
	await chmod(targetPath, 0o600).catch(() => {});
}

export async function deleteVaultFile(service: string): Promise<boolean> {
	try {
		await rm(getVaultFilePath(service), { force: true });
		return true;
	} catch {
		return false;
	}
}

export async function listVaultServices(): Promise<string[]> {
	try {
		const vaultDir = getVaultDir();
		const entries = await readdir(vaultDir);
		return entries
			.filter((entry) => entry.endsWith(".json") && !entry.startsWith("."))
			.map((entry) => entry.slice(0, -5));
	} catch {
		return [];
	}
}
