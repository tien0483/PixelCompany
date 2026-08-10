import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtimeHome = { path: "" };

vi.mock("../../../src/state/workspace-state", () => ({
	getRuntimeHomePath: () => runtimeHome.path,
}));

import {
	attachPlanHtmlSource,
	diffPlanVersionAgainstCurrent,
	listPlanVersions,
	redoPlanVersion,
	resetPlanHistoryAvailabilityCache,
	resetPlanHistoryRepoCache,
	restorePlanVersion,
	snapshotPlanVersion,
	undoPlanVersion,
} from "../../../src/state/plan-history";
import { createSavedPlan, writeSavedPlanContent, writeSavedPlanSibling } from "../../../src/state/saved-plans";

/**
 * Exercises the real `git` binary: the whole point of the store is that git holds the blobs and
 * produces the diffs, so mocking it away would test nothing worth testing.
 */
describe("plan history", () => {
	beforeEach(async () => {
		runtimeHome.path = await mkdtemp(join(tmpdir(), "kanban-plan-history-"));
		resetPlanHistoryRepoCache();
		resetPlanHistoryAvailabilityCache();
	});

	afterEach(() => {
		runtimeHome.path = "";
		resetPlanHistoryRepoCache();
		resetPlanHistoryAvailabilityCache();
	});

	async function newPlan(content = "# Roadmap\n"): Promise<string> {
		const { entry } = await createSavedPlan({ name: "roadmap", content });
		return entry.id;
	}

	it("records a markdown version and reads it back byte-for-byte", async () => {
		const planId = await newPlan("# Roadmap\n\ntrailing newlines matter\n\n\n");

		const entry = await snapshotPlanVersion({ planId, target: "md", label: "manual" });
		expect(entry).not.toBeNull();

		await writeSavedPlanContent(planId, "# Roadmap\n\nrewritten\n");
		const restored = await restorePlanVersion(planId, entry?.id ?? "");

		expect(restored?.content).toBe("# Roadmap\n\ntrailing newlines matter\n\n\n");
		expect(await readFile(restored?.path ?? "", "utf8")).toBe("# Roadmap\n\ntrailing newlines matter\n\n\n");
	});

	it("records a baseline only while the document has no versions yet", async () => {
		const planId = await newPlan("# Roadmap\n\nas opened\n");

		const baseline = await snapshotPlanVersion({ planId, target: "md", label: "autosave", mode: "baseline" });
		expect(baseline).not.toBeNull();

		await writeSavedPlanContent(planId, "# Roadmap\n\nedited\n");
		// A second baseline attempt is a no-op — otherwise every save would add one.
		expect(await snapshotPlanVersion({ planId, target: "md", label: "autosave", mode: "baseline" })).toBeNull();
		await snapshotPlanVersion({ planId, target: "md", label: "manual" });

		// The state the plan was opened in is reachable, which is what the baseline buys.
		const undone = await undoPlanVersion(planId, "md");
		expect(undone?.content).toBe("# Roadmap\n\nas opened\n");
	});

	it("skips a snapshot whose bytes are already the current version", async () => {
		const planId = await newPlan();

		expect(await snapshotPlanVersion({ planId, target: "md", label: "manual" })).not.toBeNull();
		expect(await snapshotPlanVersion({ planId, target: "md", label: "manual" })).toBeNull();

		const listing = await listPlanVersions(planId);
		expect(listing.entries).toHaveLength(1);
	});

	it("throttles autosave snapshots but never a labelled milestone", async () => {
		const planId = await newPlan();
		await snapshotPlanVersion({ planId, target: "md", label: "autosave" });

		await writeSavedPlanContent(planId, "# Roadmap\n\nsecond\n");
		expect(await snapshotPlanVersion({ planId, target: "md", label: "autosave" })).toBeNull();
		expect(await snapshotPlanVersion({ planId, target: "md", label: "ai-edit" })).not.toBeNull();

		const listing = await listPlanVersions(planId);
		expect(listing.entries.map((entry) => entry.label)).toEqual(["autosave", "ai-edit"]);
	});

	it("walks back and forward through generated pages, keeping redo alive", async () => {
		const planId = await newPlan();
		await writeSavedPlanSibling(planId, ".html", "<h1>v1</h1>");
		const first = await snapshotPlanVersion({ planId, target: "html", label: "generate" });
		await writeSavedPlanSibling(planId, ".html", "<h1>v2</h1>");
		const second = await snapshotPlanVersion({ planId, target: "html", label: "refine" });
		expect(first?.id).not.toBe(second?.id);

		const undone = await undoPlanVersion(planId, "html");
		expect(undone?.content).toBe("<h1>v1</h1>");
		expect(await readFile(undone?.path ?? "", "utf8")).toBe("<h1>v1</h1>");
		// Nothing older than the first version.
		expect(await undoPlanVersion(planId, "html")).toBeNull();

		const redone = await redoPlanVersion(planId, "html");
		expect(redone?.content).toBe("<h1>v2</h1>");
		expect(await redoPlanVersion(planId, "html")).toBeNull();
	});

	it("restores the requirement a page was generated from alongside the page", async () => {
		const planId = await newPlan("# Roadmap\n\nfirst requirement\n");
		await writeSavedPlanSibling(planId, ".html", "<h1>v1</h1>");
		const htmlEntry = await snapshotPlanVersion({ planId, target: "html", label: "generate" });
		const sourcePath = join(runtimeHome.path, "plans", "roadmap-1.html.src.md");
		await writeFile(sourcePath, "# Roadmap\n\nfirst requirement\n", "utf8");
		await attachPlanHtmlSource(planId);

		// A later run moves both the page and the recorded requirement on.
		await writeSavedPlanSibling(planId, ".html", "<h1>v2</h1>");
		await snapshotPlanVersion({ planId, target: "html", label: "refine" });
		await writeFile(sourcePath, "# Roadmap\n\nsecond requirement\n", "utf8");
		await attachPlanHtmlSource(planId);

		await restorePlanVersion(planId, htmlEntry?.id ?? "");

		expect(await readFile(sourcePath, "utf8")).toBe("# Roadmap\n\nfirst requirement\n");
	});

	it("diffs a version against the file as it stands now", async () => {
		const planId = await newPlan("# Roadmap\n\nQ2 revenue: 1.2M\n");
		const entry = await snapshotPlanVersion({ planId, target: "md", label: "manual" });

		expect(await diffPlanVersionAgainstCurrent(planId, entry?.id ?? "")).toEqual({ diff: "", changed: false });

		await writeSavedPlanContent(planId, "# Roadmap\n\nQ2 revenue: 1.4M\n");
		const diff = await diffPlanVersionAgainstCurrent(planId, entry?.id ?? "");

		expect(diff?.changed).toBe(true);
		expect(diff?.diff).toContain("-Q2 revenue: 1.2M");
		expect(diff?.diff).toContain("+Q2 revenue: 1.4M");
		// Object ids as "file names" are noise in the version list, so the preamble is dropped.
		expect(diff?.diff.startsWith("@@")).toBe(true);
		expect(diff?.diff).not.toContain("diff --git");
	});

	it("has no history for a plan that was never snapshotted", async () => {
		const planId = await newPlan();
		const listing = await listPlanVersions(planId);

		expect(listing).toMatchObject({ available: true, entries: [] });
		expect(await undoPlanVersion(planId, "html")).toBeNull();
	});

	it("ignores an unknown plan instead of throwing", async () => {
		expect(await snapshotPlanVersion({ planId: "nope", target: "md", label: "manual" })).toBeNull();
		expect(await restorePlanVersion("nope", "whatever")).toBeNull();
	});
});
