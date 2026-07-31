import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { MANAGER_LABELS } from "./manager-labels";

const srcRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function collectSourceFiles(dir: string, files: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) {
			collectSourceFiles(path, files);
			continue;
		}
		if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
			files.push(path);
		}
	}
	return files;
}

/** Matches "Jacked" only inside a rendered string or JSX text, not in code identifiers. */
function findVisibleJackedCopy(source: string): string[] {
	const hits: string[] = [];
	for (const match of source.matchAll(/"([^"\n]*\bJacked\b[^"\n]*)"/g)) {
		const literal = match[1] ?? "";
		// Import paths, test ids and URLs are identifiers, not copy.
		if (/^[@./]/.test(literal) || literal.includes("jacked-") || literal.startsWith("http")) {
			continue;
		}
		hits.push(literal);
	}
	for (const match of source.matchAll(/>\s*([^<>{}\n]*\bJacked\b[^<>{}\n]*?)\s*</g)) {
		hits.push(match[1] ?? "");
	}
	return hits;
}

describe("Manager labels", () => {
	it("keeps the office framing on every visible surface", () => {
		expect(MANAGER_LABELS.section).toBe("Manager");
		expect(MANAGER_LABELS.seats).toBe("Seats");
		expect(MANAGER_LABELS.offline).toContain("Manager");
	});

	it("no view renders the vendor name", () => {
		const offenders: string[] = [];
		for (const file of collectSourceFiles(srcRoot)) {
			for (const hit of findVisibleJackedCopy(readFileSync(file, "utf8"))) {
				offenders.push(`${file.slice(srcRoot.length + 1)}: ${hit}`);
			}
		}
		// Internal identifiers keep the jacked name on purpose; only user-facing copy is
		// rethemed, so this guards the boundary between the two.
		expect(offenders).toEqual([]);
	});
});
