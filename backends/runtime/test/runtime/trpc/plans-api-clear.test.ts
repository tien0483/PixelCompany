import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtimeHome = { path: "" };

vi.mock("../../../src/state/workspace-state", () => ({
	getRuntimeHomePath: () => runtimeHome.path,
}));

import { listSavedPlans } from "../../../src/state/saved-plans";
import { createPlansApi } from "../../../src/trpc/plans-api";

describe("plansApi.clearAll", () => {
	beforeEach(async () => {
		runtimeHome.path = await mkdtemp(join(tmpdir(), "kanban-plans-api-clear-"));
	});

	afterEach(() => {
		runtimeHome.path = "";
	});

	it("clears all registered plans via the API", async () => {
		const api = createPlansApi({ serverCwd: runtimeHome.path });

		await api.create({ name: "Plan A", content: "# Plan A\n" });
		await api.create({ name: "Plan B", content: "# Plan B\n" });

		const before = await listSavedPlans();
		expect(before).toHaveLength(2);

		const response = await api.clearAll();
		expect(response.ok).toBe(true);
		expect(response.clearedCount).toBe(2);
		expect(response.error).toBeUndefined();

		const after = await listSavedPlans();
		expect(after).toHaveLength(0);
	});

	it("returns clearedCount 0 when no plans are registered", async () => {
		const api = createPlansApi({ serverCwd: runtimeHome.path });

		const response = await api.clearAll();
		expect(response.ok).toBe(true);
		expect(response.clearedCount).toBe(0);
	});
});
