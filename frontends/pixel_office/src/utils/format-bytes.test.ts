import { describe, expect, it } from "vitest";

import { formatBytes } from "@/utils/format-bytes";

describe("formatBytes", () => {
	it("keeps byte-scale values whole", () => {
		expect(formatBytes(0)).toBe("0 B");
		expect(formatBytes(999)).toBe("999 B");
	});

	it("scales past MB, which is where the cleanup surface actually lives", () => {
		expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
		// The case the old MB-capped formatter got wrong: a 3 GB worktree read as
		// "3072.0 MB".
		expect(formatBytes(3 * 1024 * 1024 * 1024)).toBe("3.0 GB");
		expect(formatBytes(1024 ** 4)).toBe("1.0 TB");
	});

	it("does not round a fractional GB up to the next whole unit", () => {
		expect(formatBytes(1.5 * 1024 * 1024 * 1024)).toBe("1.5 GB");
	});

	it("treats missing or nonsensical sizes as zero rather than NaN", () => {
		expect(formatBytes(Number.NaN)).toBe("0 B");
		expect(formatBytes(-1)).toBe("0 B");
	});
});
