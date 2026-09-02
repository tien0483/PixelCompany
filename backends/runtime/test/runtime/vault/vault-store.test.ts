import { execFileSync } from "node:child_process";
import { chmod, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const runtimeHome = { path: "" };

vi.mock("../../../src/state/workspace-state", () => ({
	getRuntimeHomePath: () => runtimeHome.path,
}));

import {
	deleteVaultFile,
	getVaultDir,
	getVaultFilePath,
	listVaultServices,
	plaintextCodec,
	readVaultFile,
	writeVaultFile,
	type VaultCodec,
} from "../../../src/vault/vault-store";

describe("vault-store", () => {
	beforeEach(async () => {
		runtimeHome.path = await mkdtemp(join(tmpdir(), "pixtiel-vault-test-"));
	});

	afterEach(async () => {
		if (runtimeHome.path) {
			await rm(runtimeHome.path, { recursive: true, force: true });
			runtimeHome.path = "";
		}
	});

	it("round-trips arbitrary JSON data and asserts file mode 0600 and dir mode 0700", async () => {
		const payload = { key: "secret-value", count: 42, nested: { ok: true } };
		await writeVaultFile("test-service", payload);

		const vaultDir = getVaultDir();
		const filePath = getVaultFilePath("test-service");

		// Dir permissions assert: 0700
		const dirStat = await stat(vaultDir);
		const dirMode = dirStat.mode & 0o777;
		expect(dirMode).toBe(0o700);
		expect(dirMode.toString(8)).toBe("700");

		const dirStatCli = execFileSync("stat", ["-c", "%a", vaultDir], { encoding: "utf8" }).trim();
		expect(dirStatCli).toBe("700");

		// File permissions assert: 0600
		const fileStat = await stat(filePath);
		const fileMode = fileStat.mode & 0o777;
		expect(fileMode).toBe(0o600);
		expect(fileMode.toString(8)).toBe("600");

		const fileStatCli = execFileSync("stat", ["-c", "%a", filePath], { encoding: "utf8" }).trim();
		expect(fileStatCli).toBe("600");

		// Read back
		const readBack = await readVaultFile<typeof payload>("test-service");
		expect(readBack).toEqual(payload);
	});

	it("returns null for non-existent vault files", async () => {
		const result = await readVaultFile("non-existent-service");
		expect(result).toBeNull();
	});

	it("returns null for corrupted/unparseable JSON files", async () => {
		const filePath = getVaultFilePath("corrupted-service");
		// Ensure dir exists
		await writeVaultFile("temp", { tmp: true });
		await writeFile(filePath, "invalid-json-content{", "utf-8");

		const result = await readVaultFile("corrupted-service");
		expect(result).toBeNull();
	});

	it("returns null when schema validation fails", async () => {
		const schema = z.object({
			requiredField: z.string(),
			numberField: z.number(),
		});

		await writeVaultFile("schema-service", { requiredField: "hello", numberField: "not-a-number" });

		const result = await readVaultFile("schema-service", schema);
		expect(result).toBeNull();

		// Custom function validator returning null on invalid input
		const customValidator = (raw: unknown) => {
			if (typeof raw === "object" && raw !== null && "requiredField" in raw) {
				return raw as { requiredField: string };
			}
			return null;
		};
		const validResult = await readVaultFile("schema-service", customValidator);
		expect(validResult).toEqual({ requiredField: "hello", numberField: "not-a-number" });
	});

	it("deletes a vault file and lists remaining services", async () => {
		await writeVaultFile("service-a", { id: "a" });
		await writeVaultFile("service-b", { id: "b" });
		await writeVaultFile("mcp:server-1", { id: "mcp1" });

		let services = await listVaultServices();
		expect(services.sort()).toEqual(["mcp:server-1", "service-a", "service-b"].sort());

		const deleted = await deleteVaultFile("service-a");
		expect(deleted).toBe(true);

		services = await listVaultServices();
		expect(services.sort()).toEqual(["mcp:server-1", "service-b"].sort());

		const deletedAgain = await deleteVaultFile("service-a");
		expect(deletedAgain).toBe(true);
	});

	it("supports custom VaultCodec for encoding and decoding", async () => {
		const base64Codec: VaultCodec = {
			encode: (json: string) => Buffer.from(Buffer.from(json, "utf-8").toString("base64"), "utf-8"),
			decode: (buf: Buffer) => Buffer.from(buf.toString("utf-8"), "base64").toString("utf-8"),
		};

		const payload = { encrypted: true, data: "classified" };
		await writeVaultFile("encoded-service", payload, base64Codec);

		// Reading with plaintext codec should fail to parse JSON because it is base64 encoded
		const plainRead = await readVaultFile("encoded-service", undefined, plaintextCodec);
		expect(plainRead).toBeNull();

		// Reading with base64 codec succeeds
		const codecRead = await readVaultFile<typeof payload>("encoded-service", undefined, base64Codec);
		expect(codecRead).toEqual(payload);
	});
});
