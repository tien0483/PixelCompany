import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { DOCS_LABELS } from "./docs-labels";

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

function findVisibleVendorCopy(source: string): string[] {
	const hits: string[] = [];
	for (const match of source.matchAll(/"([^"\n]*\b(?:doc_skill|harness_doc_site|harness|project-harness)\b[^"\n]*)"/gi)) {
		const literal = match[1] ?? "";
		if (/^[@./]/.test(literal) || literal.startsWith("http")) {
			continue;
		}
		hits.push(literal);
	}
	for (const match of source.matchAll(
		/>\s*([^<>{}\n]*\b(?:doc_skill|harness_doc_site|harness|project-harness)\b[^<>{}\n]*?)\s*</gi,
	)) {
		hits.push(match[1] ?? "");
	}
	return hits;
}

describe("Docs labels", () => {
	it("keeps product framing on the docs surface", () => {
		expect(DOCS_LABELS.section).toBe("Docs");
		expect(DOCS_LABELS.offline).toContain("Docs");
	});

	it("no view renders the vendor name", () => {
		const offenders: string[] = [];
		for (const file of collectSourceFiles(join(srcRoot, "docs"))) {
			for (const hit of findVisibleVendorCopy(readFileSync(file, "utf8"))) {
				offenders.push(`${file.slice(srcRoot.length + 1)}: ${hit}`);
			}
		}
		expect(offenders).toEqual([]);
	});
});
