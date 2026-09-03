import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { prepareTaskPromptWithImages, writeTaskSessionPasteImages } from "../../../src/terminal/task-image-prompt";

const PNG_BASE64 =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("writeTaskSessionPasteImages", () => {
	const taskId = "task-pty-paste-test";

	afterEach(async () => {
		await rm(join(tmpdir(), `kanban-pty-images-${taskId}`), { recursive: true, force: true });
	});

	it("writes images under a stable per-task tmp dir and returns absolute paths", async () => {
		const paths = await writeTaskSessionPasteImages(taskId, [
			{
				id: "img1",
				data: PNG_BASE64,
				mimeType: "image/png",
				name: "screenshot.png",
			},
		]);

		expect(paths).toHaveLength(1);
		expect(paths[0]).toMatch(new RegExp(`^${tmpdir().replaceAll("/", "\\/")}\\/kanban-pty-images-${taskId}\\/`));
		expect(paths[0]).toMatch(/screenshot\.png$/);
		const bytes = await readFile(paths[0] as string);
		expect(bytes.length).toBeGreaterThan(0);
	});

	it("rejects empty task ids", async () => {
		await expect(
			writeTaskSessionPasteImages("  ", [
				{
					id: "img1",
					data: PNG_BASE64,
					mimeType: "image/png",
				},
			]),
		).rejects.toThrow(/task id/i);
	});
});

describe("prepareTaskPromptWithImages", () => {
	it("substitutes each [image: name] marker with the staged path in place", async () => {
		const prompt = await prepareTaskPromptWithImages({
			prompt: "Fix the header [image: header.png] and then the footer [image: footer.png].",
			images: [
				{ id: "img1", data: PNG_BASE64, mimeType: "image/png", name: "header.png" },
				{ id: "img2", data: PNG_BASE64, mimeType: "image/png", name: "footer.png" },
			],
		});

		expect(prompt).not.toContain("Attached reference images:");
		expect(prompt).not.toContain("[image:");
		const match = prompt.match(/^Fix the header (\S+) and then the footer (\S+)\.$/);
		expect(match).not.toBeNull();
		const [, headerPath, footerPath] = match as RegExpMatchArray;
		expect(headerPath).toMatch(/kanban-task-images-.*\/01-header\.png$/);
		expect(footerPath).toMatch(/kanban-task-images-.*\/02-footer\.png$/);
		expect((await readFile(headerPath as string)).length).toBeGreaterThan(0);
	});

	it("keeps the prepended list for images with no marker in the prompt", async () => {
		const prompt = await prepareTaskPromptWithImages({
			prompt: "Match this [image: wanted.png] design.",
			images: [
				{ id: "img1", data: PNG_BASE64, mimeType: "image/png", name: "wanted.png" },
				{ id: "img2", data: PNG_BASE64, mimeType: "image/png", name: "extra.png" },
				{ id: "img3", data: PNG_BASE64, mimeType: "image/png" },
			],
		});

		const lines = prompt.split("\n");
		expect(lines[0]).toBe("Attached reference images:");
		expect(lines[1]).toMatch(/^1\. .*02-extra\.png \(extra\.png\)$/);
		expect(lines[2]).toMatch(/^2\. .*03-image-3\.png$/);
		expect(lines[3]).toBe("");
		expect(lines[4]).toBe("Task:");
		expect(lines[5]).toMatch(/^Match this .*01-wanted\.png design\.$/);
	});

	it("leaves a marker naming no attached image untouched", async () => {
		const prompt = await prepareTaskPromptWithImages({
			prompt: "Deleted one [image: gone.png] here.",
			images: [{ id: "img1", data: PNG_BASE64, mimeType: "image/png", name: "kept.png" }],
		});

		expect(prompt).toContain("[image: gone.png]");
		expect(prompt).toContain("Attached reference images:");
	});

	it("returns the prompt unchanged when there are no images", async () => {
		expect(await prepareTaskPromptWithImages({ prompt: "  no images here  " })).toBe("  no images here  ");
	});
});
