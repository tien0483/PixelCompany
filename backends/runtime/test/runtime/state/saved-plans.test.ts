import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtimeHome = { path: "" };

vi.mock("../../../src/state/workspace-state", () => ({
	getRuntimeHomePath: () => runtimeHome.path,
}));

import { composePromptWithAttachedPlan } from "../../../src/prompts/compose-prompt-with-plan";
import {
	backupSavedPlan,
	clearSavedPlans,
	createSavedPlan,
	importPlanFile,
	importPlansFromFolder,
	listSavedPlans,
	readSavedPlanAsset,
	readSavedPlanContent,
	readSavedPlanHtmlSource,
	removeSavedPlan,
	resolvePlanImageAssets,
	writeSavedPlanAsset,
	writeSavedPlanContent,
	writeSavedPlanHtmlSource,
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

	it("skips expansion backups on folder import but still imports one by explicit path", async () => {
		const folder = join(runtimeHome.path, "plans");
		await mkdir(folder, { recursive: true });
		await writeFile(join(folder, "roadmap.md"), "# Roadmap\n", "utf8");
		await writeFile(join(folder, "roadmap.bak-1.md"), "# Roadmap (old)\n", "utf8");
		await writeFile(join(folder, "roadmap.bak-12.md"), "# Roadmap (older)\n", "utf8");

		const imported = await importPlansFromFolder(folder);

		expect(imported.added.map((entry) => entry.name)).toEqual(["roadmap"]);
		expect(imported.skipped).toBe(0);

		// Recovering an old version is still possible — the exclusion is bulk-import only.
		const explicit = await importPlanFile(join(folder, "roadmap.bak-1.md"));
		expect(explicit.isNew).toBe(true);
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

	describe("html source snapshot", () => {
		it("round-trips the markdown a generated HTML came from", async () => {
			const created = await createSavedPlan({ name: "roadmap", content: "# Roadmap\n" });

			expect(await readSavedPlanHtmlSource(created.entry.id)).toBeNull();

			const sourcePath = await writeSavedPlanHtmlSource(created.entry.id, "# Roadmap\n\nv1\n");

			expect(sourcePath).toBe(join(dirname(created.entry.path), `${created.entry.name}.html.src.md`));
			expect(await readSavedPlanHtmlSource(created.entry.id)).toBe("# Roadmap\n\nv1\n");

			await writeSavedPlanHtmlSource(created.entry.id, "# Roadmap\n\nv2\n");
			expect(await readSavedPlanHtmlSource(created.entry.id)).toBe("# Roadmap\n\nv2\n");
		});

		it("resolves to the same file whether asked via the markdown plan or its html sibling", async () => {
			const created = await createSavedPlan({ name: "roadmap", content: "# Roadmap\n" });
			const sibling = await writeSavedPlanSibling(created.entry.id, ".html", "<html><body>x</body></html>");

			await writeSavedPlanHtmlSource(created.entry.id, "# Roadmap\n\nv1\n");

			expect(await readSavedPlanHtmlSource(sibling.entry.id)).toBe("# Roadmap\n\nv1\n");
		});

		it("stays out of the plan library and out of folder import", async () => {
			const folder = join(runtimeHome.path, "plans");
			await mkdir(folder, { recursive: true });
			await writeFile(join(folder, "roadmap.md"), "# Roadmap\n", "utf8");
			await writeFile(join(folder, "roadmap.html.src.md"), "# Roadmap\n", "utf8");

			const imported = await importPlansFromFolder(folder);

			expect(imported.added.map((entry) => entry.name)).toEqual(["roadmap"]);
			expect(imported.skipped).toBe(0);
			expect((await listSavedPlans()).map((plan) => plan.name)).toEqual(["roadmap"]);
		});
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

	it("clears all saved plans from library and leaves files on disk", async () => {
		const folder = join(runtimeHome.path, "plans");
		await mkdir(folder, { recursive: true });
		const file1 = join(folder, "plan1.md");
		const file2 = join(folder, "plan2.md");
		await writeFile(file1, "content 1", "utf8");
		await writeFile(file2, "content 2", "utf8");

		await importPlansFromFolder(folder);
		expect(await listSavedPlans()).toHaveLength(2);

		const clearedCount = await clearSavedPlans();
		expect(clearedCount).toBe(2);
		expect(await listSavedPlans()).toHaveLength(0);

		// Clearing library does not delete physical files
		expect(await readFile(file1, "utf8")).toBe("content 1");
		expect(await readFile(file2, "utf8")).toBe("content 2");

		// Clearing an empty library returns 0
		expect(await clearSavedPlans()).toBe(0);
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
		const asset = await readSavedPlanAsset(planId, relativePath);

		expect(asset.contentType).toBe("image/png");
		expect(asset.content).toEqual(Buffer.from(ONE_PIXEL_PNG_BASE64, "base64"));
	});

	it("reads an image that sits outside the assets folder but inside the plan folder", async () => {
		const folder = join(runtimeHome.path, "plans");
		await mkdir(join(folder, "images"), { recursive: true });
		await writeFile(join(folder, "roadmap.md"), "# Roadmap\n", "utf8");
		await writeFile(join(folder, "images", "hand-authored.png"), Buffer.from(ONE_PIXEL_PNG_BASE64, "base64"));
		const imported = await importPlansFromFolder(folder);
		const planId = imported.added.find((plan) => plan.name === "roadmap")!.id;

		const asset = await readSavedPlanAsset(planId, "images/hand-authored.png");

		expect(asset.contentType).toBe("image/png");
	});

	it("refuses to read a path that escapes the plan directory", async () => {
		const folder = join(runtimeHome.path, "plans");
		await mkdir(folder, { recursive: true });
		await writeFile(join(folder, "roadmap.md"), "# Roadmap\n", "utf8");
		const imported = await importPlansFromFolder(folder);
		const planId = imported.added[0]!.id;
		await writeSavedPlanAsset(planId, { data: ONE_PIXEL_PNG_BASE64, mimeType: "image/png" });

		await expect(readSavedPlanAsset(planId, "../../../etc/passwd")).rejects.toThrow(/access denied/i);
	});

	describe("backupSavedPlan", () => {
		it("copies the plan's bytes beside it without registering the copy as a plan", async () => {
			const created = await createSavedPlan({ name: "roadmap", content: "# Roadmap\n\noriginal\n" });

			const backupPath = await backupSavedPlan(created.entry.id);

			expect(backupPath).toBe(join(dirname(created.entry.path), `${created.entry.name}.bak-1.md`));
			expect(await readFile(backupPath, "utf8")).toBe("# Roadmap\n\noriginal\n");
			const listed = await listSavedPlans();
			expect(listed.map((plan) => plan.name)).toEqual([created.entry.name]);
		});

		it("suffixes repeated backups instead of overwriting the first one", async () => {
			const created = await createSavedPlan({ name: "roadmap", content: "first\n" });
			const first = await backupSavedPlan(created.entry.id);
			await writeSavedPlanContent(created.entry.id, "second\n");
			const second = await backupSavedPlan(created.entry.id);

			expect(first.endsWith(`${created.entry.name}.bak-1.md`)).toBe(true);
			expect(second.endsWith(`${created.entry.name}.bak-2.md`)).toBe(true);
			expect(await readFile(first, "utf8")).toBe("first\n");
			expect(await readFile(second, "utf8")).toBe("second\n");
		});

		it("fails when the plan file is gone rather than writing an empty backup", async () => {
			const created = await createSavedPlan({ name: "roadmap", content: "# Roadmap\n" });
			await rm(created.entry.path);

			await expect(backupSavedPlan(created.entry.id)).rejects.toThrow(/missing/i);
		});
	});

	describe("resolvePlanImageAssets", () => {
		async function importPlanWithMarkdown(markdown: string): Promise<{ planId: string; folder: string }> {
			const folder = join(runtimeHome.path, "plans");
			await mkdir(folder, { recursive: true });
			await writeFile(join(folder, "roadmap.md"), markdown, "utf8");
			const imported = await importPlansFromFolder(folder);
			return { planId: imported.added[0]!.id, folder };
		}

		it("returns the plan directory and the absolute path of each linked image", async () => {
			const { planId, folder } = await importPlanWithMarkdown("# Roadmap\n");
			const relativePath = await writeSavedPlanAsset(planId, {
				data: ONE_PIXEL_PNG_BASE64,
				mimeType: "image/png",
				name: "dashboard.png",
			});
			await writeSavedPlanContent(planId, `# Roadmap\n\n![old dashboard](${relativePath})\n`);

			const resolved = await resolvePlanImageAssets(planId, `![old dashboard](${relativePath})`);

			expect(resolved.planDir).toBe(folder);
			expect(resolved.assetPaths).toEqual([join(folder, "roadmap.assets", "dashboard-1.png")]);
		});

		it("resolves an image link that points outside the assets folder but inside the plan folder", async () => {
			const { planId, folder } = await importPlanWithMarkdown("# Roadmap\n");
			await mkdir(join(folder, "images"), { recursive: true });
			await writeFile(join(folder, "images", "shot.png"), Buffer.from(ONE_PIXEL_PNG_BASE64, "base64"));

			const resolved = await resolvePlanImageAssets(planId, "![sibling](images/shot.png)");

			expect(resolved.assetPaths).toEqual([join(folder, "images", "shot.png")]);
			expect(resolved.unresolvedLinks).toEqual([]);
		});

		it("drops links that escape the plan directory into unresolvedLinks, not assetPaths", async () => {
			const { planId } = await importPlanWithMarkdown("# Roadmap\n");
			await writeSavedPlanAsset(planId, { data: ONE_PIXEL_PNG_BASE64, mimeType: "image/png" });

			const resolved = await resolvePlanImageAssets(planId, "![escape](../../../etc/passwd.png)");

			expect(resolved.assetPaths).toEqual([]);
			expect(resolved.unresolvedLinks).toEqual(["../../../etc/passwd.png"]);
		});

		it("skips remote and inline links entirely, but reports a missing on-disk file as unresolved", async () => {
			const { planId } = await importPlanWithMarkdown("# Roadmap\n");

			const resolved = await resolvePlanImageAssets(
				planId,
				[
					"![remote](https://example.com/shot.png)",
					"![inline](data:image/png;base64,AAAA)",
					"![gone](roadmap.assets/never-written.png)",
				].join("\n"),
			);

			expect(resolved.assetPaths).toEqual([]);
			expect(resolved.unresolvedLinks).toEqual(["roadmap.assets/never-written.png"]);
		});

		it("does not report a duplicate missing link twice", async () => {
			const { planId } = await importPlanWithMarkdown("# Roadmap\n");

			const resolved = await resolvePlanImageAssets(
				planId,
				"![gone](roadmap.assets/never-written.png)\n![gone again](roadmap.assets/never-written.png)",
			);

			expect(resolved.unresolvedLinks).toEqual(["roadmap.assets/never-written.png"]);
		});

		it("lists a repeated image once", async () => {
			const { planId, folder } = await importPlanWithMarkdown("# Roadmap\n");
			const relativePath = await writeSavedPlanAsset(planId, {
				data: ONE_PIXEL_PNG_BASE64,
				mimeType: "image/png",
			});

			const resolved = await resolvePlanImageAssets(
				planId,
				`![a](${relativePath})\n![a again](${relativePath})`,
			);

			expect(resolved.assetPaths).toEqual([join(folder, "roadmap.assets", "pasted-1.png")]);
		});
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
