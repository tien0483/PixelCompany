import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readBrandEnv } from "../../src/brand";
import { readBrandEnv as readBrandEnvEsm } from "../../../../scripts/lib/brand-env.mjs";

describe("readBrandEnv (runtime src)", () => {
	const testKeySuffix = "TEST_SHIM_VAR";
	const pixtielKey = `PIXTIEL_${testKeySuffix}`;
	const pixelofficeKey = `PIXELOFFICE_${testKeySuffix}`;
	const pixelOfficeKey = `PIXEL_OFFICE_${testKeySuffix}`;

	afterEach(() => {
		delete process.env[pixtielKey];
		delete process.env[pixelofficeKey];
		delete process.env[pixelOfficeKey];
	});

	it("returns undefined when no variable is set", () => {
		expect(readBrandEnv(testKeySuffix)).toBeUndefined();
	});

	it("returns PIXTIEL_ value when set", () => {
		process.env[pixtielKey] = "new-value";
		expect(readBrandEnv(testKeySuffix)).toBe("new-value");
	});

	it("falls back to PIXELOFFICE_ value when PIXTIEL_ is absent", () => {
		process.env[pixelofficeKey] = "legacy-val-1";
		expect(readBrandEnv(testKeySuffix)).toBe("legacy-val-1");
	});

	it("falls back to PIXEL_OFFICE_ value when neither PIXTIEL_ nor PIXELOFFICE_ is set", () => {
		process.env[pixelOfficeKey] = "legacy-val-2";
		expect(readBrandEnv(testKeySuffix)).toBe("legacy-val-2");
	});

	it("prioritizes PIXTIEL_ over legacy PIXELOFFICE_ and PIXEL_OFFICE_", () => {
		process.env[pixtielKey] = "winner";
		process.env[pixelofficeKey] = "loser-1";
		process.env[pixelOfficeKey] = "loser-2";
		expect(readBrandEnv(testKeySuffix)).toBe("winner");
	});

	it("prioritizes PIXELOFFICE_ over PIXEL_OFFICE_ when PIXTIEL_ is absent", () => {
		process.env[pixelofficeKey] = "winner-legacy";
		process.env[pixelOfficeKey] = "loser-legacy";
		expect(readBrandEnv(testKeySuffix)).toBe("winner-legacy");
	});
});

describe("readBrandEnv (scripts/lib/brand-env.mjs)", () => {
	const testKeySuffix = "TEST_SHIM_ESM_VAR";
	const pixtielKey = `PIXTIEL_${testKeySuffix}`;
	const pixelofficeKey = `PIXELOFFICE_${testKeySuffix}`;
	const pixelOfficeKey = `PIXEL_OFFICE_${testKeySuffix}`;

	afterEach(() => {
		delete process.env[pixtielKey];
		delete process.env[pixelofficeKey];
		delete process.env[pixelOfficeKey];
	});

	it("returns undefined when no variable is set", () => {
		expect(readBrandEnvEsm(testKeySuffix)).toBeUndefined();
	});

	it("returns PIXTIEL_ value when set", () => {
		process.env[pixtielKey] = "esm-new";
		expect(readBrandEnvEsm(testKeySuffix)).toBe("esm-new");
	});

	it("falls back to PIXELOFFICE_ value when PIXTIEL_ is absent", () => {
		process.env[pixelofficeKey] = "esm-legacy";
		expect(readBrandEnvEsm(testKeySuffix)).toBe("esm-legacy");
	});

	it("prioritizes PIXTIEL_ over legacy", () => {
		process.env[pixtielKey] = "esm-winner";
		process.env[pixelofficeKey] = "esm-loser";
		expect(readBrandEnvEsm(testKeySuffix)).toBe("esm-winner");
	});
});
