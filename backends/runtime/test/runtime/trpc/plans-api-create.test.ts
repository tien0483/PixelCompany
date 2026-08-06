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

describe("plansApi.create", () => {
	beforeEach(async () => {
		runtimeHome.path = await mkdtemp(join(tmpdir(), "kanban-plans-api-"));
	});

	afterEach(() => {
		runtimeHome.path = "";
	});

	it("creates a saved plan from name and content", async () => {
		const api = createPlansApi({ serverCwd: runtimeHome.path });
		const response = await api.create({
			name: "From Session",
			content: "# Captured plan\n",
		});

		expect(response.ok).toBe(true);
		expect(response.plan?.name).toBe("From-Session-1");
		expect(response.error).toBeUndefined();

		const listed = await listSavedPlans();
		expect(listed).toHaveLength(1);
		expect(listed[0]?.id).toBe(response.plan?.id);
	});

	it("rejects an empty plan name", async () => {
		const api = createPlansApi({ serverCwd: runtimeHome.path });
		const response = await api.create({
			name: "   ",
			content: "# Empty name\n",
		});

		expect(response.ok).toBe(false);
		expect(response.plan).toBeNull();
		expect(response.error).toMatch(/name is required/i);
	});
});
