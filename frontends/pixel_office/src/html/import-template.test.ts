import { afterEach, describe, expect, it, vi } from "vitest";

import { importTemplateFile, TEMPLATE_ZIP_MAX_BYTES } from "@/html/import-template";

/** Stands in for a picked file; only `size`, `name` and `arrayBuffer` are read. */
function fakeFile(bytes: Uint8Array, name = "template.zip"): File {
	return {
		name,
		size: bytes.byteLength,
		arrayBuffer: () => Promise.resolve(bytes.buffer.slice(0) as ArrayBuffer),
	} as unknown as File;
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("importTemplateFile", () => {
	it("posts the zip as base64 through the sidecar proxy", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ id: "papp-rollup", replaced: false }), {
				status: 200,
			}),
		);
		vi.stubGlobal("fetch", fetchMock);

		const result = await importTemplateFile(fakeFile(new Uint8Array([80, 75, 3, 4])));

		expect(result).toEqual({ id: "papp-rollup", replaced: false });
		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe("/api/html-proxy/api/templates/import");
		const body = JSON.parse(init.body as string) as {
			fileName: string;
			dataBase64: string;
		};
		expect(body.fileName).toBe("template.zip");
		expect(Array.from(atob(body.dataBase64), (char) => char.charCodeAt(0))).toEqual([80, 75, 3, 4]);
	});

	it("surfaces the reason the sidecar refused the archive", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				new Response(
					JSON.stringify({
						error: "SKILL.md has no YAML frontmatter",
						code: "skill_md_no_frontmatter",
					}),
					{
						status: 400,
					},
				),
			),
		);

		await expect(importTemplateFile(fakeFile(new Uint8Array([1])))).rejects.toThrow(
			"SKILL.md has no YAML frontmatter",
		);
	});

	it("rejects an oversized file before uploading anything", async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);

		await expect(
			importTemplateFile({
				name: "big.zip",
				size: TEMPLATE_ZIP_MAX_BYTES + 1,
				arrayBuffer: () => Promise.reject(new Error("should not be read")),
			} as unknown as File),
		).rejects.toThrow(/limit is 8 MB/);
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
