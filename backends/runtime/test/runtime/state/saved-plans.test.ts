import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtimeHome = { path: "" };

vi.mock("../../../src/state/workspace-state", () => ({
	getRuntimeHomePath: () => runtimeHome.path,
}));

import { composePromptWithAttachedPlan } from "../../../src/prompts/compose-prompt-with-plan";
import {
	createSavedPlan,
	importPlanFile,
	importPlansFromFolder,
	listSavedPlans,
	readSavedPlanAsset,
	readSavedPlanContent,
	removeSavedPlan,
	writeSavedPlanAsset,
	writeSavedPlanContent,
	writeSavedPlanSibling,
} from "../../../src/state/saved-plans";

describe("saved-plans library", () => {
	beforeEach(async () => {
		runtimeHome.path = await mkdtemp(join(tmpdir(), "kanban-saved-plans-"));
	});

	afterEach(() => {
		runtimeHome.path = "";
	});

	it("imports markdown plans from a folder and dedupes by path", async () => {
		const folder = join(runtimeHome.path, "plans");
		await mkdir(folder, { recursive: true });
		await writeFile(join(folder, "alpha.md"), "# Alpha\n", "utf8");
		await writeFile(join(folder, "beta.txt"), "Beta\n", "utf8");
		await writeFile(join(folder, "gamma.html"), "<html></html>\n", "utf8");
		await writeFile(join(folder, "skip.bin"), "nope", "utf8");

		const first = await importPlansFromFolder(folder);
		expect(first.added).toHaveLength(3);
		expect(first.skipped).toBe(0);

		const second = await importPlansFromFolder(folder);
		expect(second.added).toHaveLength(0);
		expect(second.skipped).toBe(3);

		const listed = await listSavedPlans();
		expect(listed.map((plan) => plan.name).sort()).toEqual(["alpha", "beta", "gamma"]);
		expect(listed.every((plan) => plan.missing === false)).toBe(true);
	});

	it("writes an html sibling beside a plan and sandboxes the path", async () => {
		const created = await createSavedPlan({ name: "roadmap", content: "# Roadmap\n" });
		const sibling = await writeSavedPlanSibling(created.entry.id, ".html", "<html><body>x</body></html>");
		expect(sibling.isNew).toBe(true);
		expect(sibling.entry.path.endsWith("roadmap-1.html") || sibling.entry.path.endsWith(".html")).toBe(true);
		const disk = await readFile(sibling.entry.path, "utf8");
		expect(disk).toContain("<html>");

		await expect(writeSavedPlanSibling(created.entry.id, ".exe", "nope")).rejects.toThrow(
			/unsupported plan sibling extension/i,
		);
	});

	it("imports a single file via importPlanFile and dedupes on repeat", async () => {
		const folder = join(runtimeHome.path, "plans");
		await mkdir(folder, { recursive: true });
		const filePath = join(folder, "solo.md");
		await writeFile(filePath, "# Solo\n", "utf8");

		const first = await importPlanFile(filePath);
		expect(first.isNew).toBe(true);
		expect(first.entry.name).toBe("solo");

		const second = await importPlanFile(filePath);
		expect(second.isNew).toBe(false);
		expect(second.entry.id).toBe(first.entry.id);

		const listed = await listSavedPlans();
		expect(listed).toHaveLength(1);
	});

	it("rejects importing a file with an unsupported extension", async () => {
		const folder = join(runtimeHome.path, "plans");
		await mkdir(folder, { recursive: true });
		const filePath = join(folder, "skip.bin");
		await writeFile(filePath, "nope", "utf8");

		await expect(importPlanFile(filePath)).rejects.toThrow(/not a supported plan file/i);
	});

	it("lists saved plans newest-added first", async () => {
		const folder = join(runtimeHome.path, "plans");
		await mkdir(folder, { recursive: true });
		await writeFile(join(folder, "older.md"), "# Older\n", "utf8");
		await writeFile(join(folder, "newer.md"), "# Newer\n", "utf8");

		await importPlanFile(join(folder, "older.md"));
		await new Promise((resolve) => setTimeout(resolve, 2));
		await importPlanFile(join(folder, "newer.md"));

		const listed = await listSavedPlans();
		expect(listed.map((plan) => plan.name)).toEqual(["newer", "older"]);
	});

	it("reads and writes plan content and removes library entries", async () => {
		const folder = join(runtimeHome.path, "plans");
		await mkdir(folder, { recursive: true });
		const planPath = join(folder, "note.md");
		await writeFile(planPath, "v1\n", "utf8");
		const imported = await importPlansFromFolder(folder);
		const planId = imported.added[0]!.id;

		const read = await readSavedPlanContent(planId);
		expect(read.content).toBe("v1\n");

		await writeSavedPlanContent(planId, "v2\n");
		expect(await readFile(planPath, "utf8")).toBe("v2\n");

		expect(await removeSavedPlan(planId)).toBe(true);
		expect(await listSavedPlans()).toHaveLength(0);
		expect(await readFile(planPath, "utf8")).toBe("v2\n");
	});

	it("creates a saved plan from content and avoids clobbering existing files", async () => {
		const first = await createSavedPlan({
			name: "Ship Feature",
			content: "# First plan\n",
		});
		expect(first.isNew).toBe(true);
		expect(first.entry.name).toBe("Ship-Feature-1");
		expect(await readFile(first.entry.path, "utf8")).toBe("# First plan\n");

		const second = await createSavedPlan({
			name: "Ship Feature",
			content: "# Second plan\n",
		});
		expect(second.isNew).toBe(true);
		expect(second.entry.path).not.toBe(first.entry.path);
		expect(second.entry.name).toBe("Ship-Feature-2");

		const listed = await listSavedPlans();
		expect(listed).toHaveLength(2);
		expect(listed.every((plan) => plan.missing === false)).toBe(true);
	});
});

const ONE_PIXEL_PNG_BASE64 =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("plan assets", () => {
	beforeEach(async () => {
		runtimeHome.path = await mkdtemp(join(tmpdir(), "kanban-saved-plans-assets-"));
	});

	afterEach(() => {
		runtimeHome.path = "";
	});

	it("writes a pasted image into a sibling <stem>.assets directory", async () => {
		const folder = join(runtimeHome.path, "plans");
		await mkdir(folder, { recursive: true });
		await writeFile(join(folder, "roadmap.md"), "# Roadmap\n", "utf8");
		const imported = await importPlansFromFolder(folder);
		const planId = imported.added[0]!.id;

		const relativePath = await writeSavedPlanAsset(planId, {
			data: ONE_PIXEL_PNG_BASE64,
			mimeType: "image/png",
		});

		expect(relativePath).toBe("roadmap.assets/pasted-1.png");
		const bytes = await readFile(join(folder, "roadmap.assets", "pasted-1.png"));
		expect(bytes).toEqual(Buffer.from(ONE_PIXEL_PNG_BASE64, "base64"));
	});

	it("suffixes the filename on collision instead of overwriting", async () => {
		const folder = join(runtimeHome.path, "plans");
		await mkdir(folder, { recursive: true });
		await writeFile(join(folder, "roadmap.md"), "# Roadmap\n", "utf8");
		const imported = await importPlansFromFolder(folder);
		const planId = imported.added[0]!.id;

		const first = await writeSavedPlanAsset(planId, { data: ONE_PIXEL_PNG_BASE64, mimeType: "image/png" });
		const second = await writeSavedPlanAsset(planId, { data: ONE_PIXEL_PNG_BASE64, mimeType: "image/png" });

		expect(first).toBe("roadmap.assets/pasted-1.png");
		expect(second).toBe("roadmap.assets/pasted-2.png");
	});

	it("rejects unsupported mime types", async () => {
		const folder = join(runtimeHome.path, "plans");
		await mkdir(folder, { recursive: true });
		await writeFile(join(folder, "roadmap.md"), "# Roadmap\n", "utf8");
		const imported = await importPlansFromFolder(folder);
		const planId = imported.added[0]!.id;

		await expect(
			writeSavedPlanAsset(planId, { data: ONE_PIXEL_PNG_BASE64, mimeType: "image/svg+xml" }),
		).rejects.toThrow(/unsupported/i);
	});

	it("reads back a written asset with the correct content type", async () => {
		const folder = join(runtimeHome.path, "plans");
		await mkdir(folder, { recursive: true });
		await writeFile(join(folder, "roadmap.md"), "# Roadmap\n", "utf8");
		const imported = await importPlansFromFolder(folder);
		const planId = imported.added[0]!.id;

		const relativePath = await writeSavedPlanAsset(planId, { data: ONE_PIXEL_PNG_BASE64, mimeType: "image/png" });
		const assetFileName = relativePath.split("/").pop()!;
		const asset = await readSavedPlanAsset(planId, assetFileName);

		expect(asset.contentType).toBe("image/png");
		expect(asset.content).toEqual(Buffer.from(ONE_PIXEL_PNG_BASE64, "base64"));
	});

	it("refuses to read a path that escapes the assets directory", async () => {
		const folder = join(runtimeHome.path, "plans");
		await mkdir(folder, { recursive: true });
		await writeFile(join(folder, "roadmap.md"), "# Roadmap\n", "utf8");
		const imported = await importPlansFromFolder(folder);
		const planId = imported.added[0]!.id;
		await writeSavedPlanAsset(planId, { data: ONE_PIXEL_PNG_BASE64, mimeType: "image/png" });

		await expect(readSavedPlanAsset(planId, "../../../etc/passwd")).rejects.toThrow(/access denied/i);
	});
});

describe("composePromptWithAttachedPlan", () => {
	it("leaves the prompt unchanged when no plan is attached", async () => {
		await expect(composePromptWithAttachedPlan({ prompt: "Do the thing" })).resolves.toBe("Do the thing");
	});

	it("prepends a read-and-follow instruction for an existing plan file", async () => {
		const dir = await mkdtemp(join(tmpdir(), "kanban-plan-prompt-"));
		const planPath = join(dir, "plan.md");
		await writeFile(planPath, "# Plan\n", "utf8");
		const composed = await composePromptWithAttachedPlan({
			prompt: "Implement it",
			planFilePath: planPath,
		});
		expect(composed).toContain(`Read and follow the implementation plan at: ${planPath}`);
		expect(composed).toContain("Implement it");
	});

	it("throws when the attached plan file is missing", async () => {
		await expect(
			composePromptWithAttachedPlan({
				prompt: "Implement it",
				planFilePath: join(tmpdir(), "missing-plan-file.md"),
			}),
		).rejects.toThrow(/missing/i);
	});
});
