import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtimeHome = { path: "" };

vi.mock("../../../src/state/workspace-state", () => ({
	getRuntimeHomePath: () => runtimeHome.path,
}));

import {
	importPlansFromFolder,
	listSavedPlans,
	readSavedPlanContent,
	removeSavedPlan,
	writeSavedPlanContent,
} from "../../../src/state/saved-plans";
import { composePromptWithAttachedPlan } from "../../../src/prompts/compose-prompt-with-plan";

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
		await writeFile(join(folder, "skip.bin"), "nope", "utf8");

		const first = await importPlansFromFolder(folder);
		expect(first.added).toHaveLength(2);
		expect(first.skipped).toBe(0);

		const second = await importPlansFromFolder(folder);
		expect(second.added).toHaveLength(0);
		expect(second.skipped).toBe(2);

		const listed = await listSavedPlans();
		expect(listed.map((plan) => plan.name).sort()).toEqual(["alpha", "beta"]);
		expect(listed.every((plan) => plan.missing === false)).toBe(true);
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
