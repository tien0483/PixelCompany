import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import {
	readPlanDeployState,
	resolvePlanDeployStatePath,
	writePlanDeployState,
} from "../../../src/deploy/deploy-state";
import {
	isPlanAuxiliaryFileName,
	isPlanDeployStateFileName,
	type SavedPlanEntry,
} from "../../../src/state/saved-plans";

describe("plan deploy state", () => {
	let planDir = "";
	let htmlEntry: SavedPlanEntry;

	beforeEach(async () => {
		planDir = await mkdtemp(join(tmpdir(), "kanban-deploy-state-"));
		htmlEntry = {
			id: "html-plan",
			name: "roadmap",
			path: join(planDir, "roadmap.html"),
			addedAt: 1,
		};
		await writeFile(htmlEntry.path, "<html></html>", "utf8");
	});

	it("keys the record on the full file name so md and html do not collide", () => {
		const mdEntry: SavedPlanEntry = { ...htmlEntry, id: "md-plan", path: join(planDir, "roadmap.md") };

		expect(resolvePlanDeployStatePath(htmlEntry)).toBe(join(planDir, "roadmap.html.deploy.json"));
		expect(resolvePlanDeployStatePath(mdEntry)).toBe(join(planDir, "roadmap.md.deploy.json"));
	});

	it("returns null before the first deploy", async () => {
		expect(await readPlanDeployState(htmlEntry)).toBeNull();
	});

	it("round-trips the ids a re-deploy needs", async () => {
		await writePlanDeployState(htmlEntry, {
			scriptId: "script-1",
			deploymentId: "AKfycbwId",
			webAppUrl: "https://script.google.com/a/macros/akselos.com/s/AKfycbwId/exec",
			deployedAt: 1234,
		});

		expect(await readPlanDeployState(htmlEntry)).toEqual({
			scriptId: "script-1",
			deploymentId: "AKfycbwId",
			webAppUrl: "https://script.google.com/a/macros/akselos.com/s/AKfycbwId/exec",
			deployedAt: 1234,
		});
	});

	it("treats a record with no script id as absent, so the next deploy creates a project", async () => {
		await writeFile(resolvePlanDeployStatePath(htmlEntry), JSON.stringify({ deploymentId: "x" }), "utf8");

		expect(await readPlanDeployState(htmlEntry)).toBeNull();
	});

	it("is an auxiliary file, never offered as a plan", () => {
		expect(isPlanDeployStateFileName("roadmap.html.deploy.json")).toBe(true);
		expect(isPlanDeployStateFileName("roadmap.html")).toBe(false);
		expect(isPlanAuxiliaryFileName("roadmap.html.deploy.json")).toBe(true);
	});
});
