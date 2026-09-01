import { chmod, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ZodType } from "zod";

import { getRuntimeHomePath } from "../state/workspace-state";

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

export function getVaultFilePath(service: string): string {
	const filename = service.endsWith(".json") ? service : `${service}.json`;
	return join(getVaultDir(), filename);
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

	await writeFile(tempPath, buf);
	// Written after the fact rather than via the `mode` option: an existing file
	// keeps its old mode when rewritten, so `mode` alone would not tighten a file
	// created before this line existed.
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
