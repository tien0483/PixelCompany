import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { writeTaskSessionPasteImages } from "../../../src/terminal/task-image-prompt";

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
