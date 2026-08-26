import { describe, expect, it, vi } from "vitest";

import type { RuntimeSkillInventory } from "../../../src/core/api-contract";
import { runtimeAppRouter } from "../../../src/trpc/app-router";

describe("runtimeAppRouter.listSkillInventory", () => {
	it("preserves project-local skills, agents, and commands even if disabled globally in Manager", async () => {
		const mockInventory: RuntimeSkillInventory = {
			skills: [
				{
					id: "checkpoint",
					displayName: "checkpoint",
					source: "disk",
					origin: "project",
					root: "claude",
				},
				{
					id: "global-skill",
					displayName: "global-skill",
					source: "disk",
					origin: "global",
				},
			],
			agents: [
				{
					id: "code-simplicity-reviewer",
					displayName: "code-simplicity-reviewer",
					source: "disk",
					origin: "project",
					root: "claude",
				},
				{
					id: "global-agent",
					displayName: "global-agent",
					source: "disk",
					origin: "global",
				},
			],
			commands: [
				{
					id: "ship",
					displayName: "ship",
					source: "disk",
					origin: "project",
					root: "claude",
				},
				{
					id: "global-cmd",
					displayName: "global-cmd",
					source: "disk",
					origin: "global",
				},
			],
			workflows: [],
		};

		// Manager global state: all catalog features are NOT installed globally (installed: false)
		const mockManagerState = {
			features: [
				{ category: "knowledge", name: "skill_checkpoint", installed: false },
				{ category: "knowledge", name: "skill_global-skill", installed: false },
				{ category: "agents", name: "code-simplicity-reviewer", installed: false },
				{ category: "agents", name: "global-agent", installed: false },
				{ category: "commands", name: "ship", installed: false },
				{ category: "commands", name: "global-cmd", installed: false },
			],
		};

		const ctx = {
			requestedWorkspaceId: "pixelcompany",
			workspaceScope: { workspaceId: "pixelcompany", workspacePath: "/test/path" },
			runtimeApi: {
				listSkillInventory: vi.fn(async () => mockInventory),
			},
			managerApi: {
				getState: vi.fn(async () => mockManagerState),
			},
		};

		const caller = runtimeAppRouter.createCaller(ctx as never);
		const result = await caller.runtime.listSkillInventory({ workspaceId: "pixelcompany" });

		// Project items must be preserved!
		expect(result.skills.map((s) => s.id)).toEqual(["checkpoint"]);
		expect(result.agents.map((a) => a.id)).toEqual(["code-simplicity-reviewer"]);
		expect(result.commands.map((c) => c.id)).toEqual(["ship"]);

		// Global items that are disabled in global manager must be filtered out
		expect(result.skills.some((s) => s.id === "global-skill")).toBe(false);
		expect(result.agents.some((a) => a.id === "global-agent")).toBe(false);
		expect(result.commands.some((c) => c.id === "global-cmd")).toBe(false);
	});
});
