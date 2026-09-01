import { describe, expect, it, vi } from "vitest";

import { resolveOrchestratorPatchPath } from "../../../src/orchestrator/dsh-endpoint";
import { collectCustomAgentFlowIds, prepareOrchestratorLaunch } from "../../../src/orchestrator/orchestrator-launch";

vi.mock("../../../src/orchestrator/dsh-binary", () => ({
	resolveDshBinary: () => ({ path: "dsh", viaNpx: false }),
	buildDshArgv: (_binary: unknown, args: string[]) => ({ command: "dsh", args }),
}));

describe("prepareOrchestratorLaunch", () => {
	it("passes the prompt as the trailing positional, with no launcher-unknown flags", async () => {
		const patchPath = resolveOrchestratorPatchPath();
		if (patchPath === null) {
			return;
		}
		const launch = await prepareOrchestratorLaunch({
			cwd: "/tmp/worktree",
			prompt: "Implement feature X",
			autonomousModeEnabled: true,
		});
		expect(launch).not.toBeNull();
		expect(launch?.command).toBe("dsh");
		expect(launch?.args.slice(0, 4)).toEqual(["--profile", "headless", "--patch", patchPath]);

		// The dsh launcher hands everything from the first token it does not recognize to the
		// booted profile, and the headless app reads the *positional* argument as its task. An
		// unknown flag here would silently become the task instead of the card's prompt.
		for (const rejected of ["--cwd", "--force", "--prompt", "/tmp/worktree"]) {
			expect(launch?.args).not.toContain(rejected);
		}
		expect(launch?.args.at(-1)).toContain("Implement feature X");
		expect(launch?.env.DSH_HOME).toBeTruthy();
		expect(launch?.env.PIXELOFFICE_ORCHESTRATOR).toBe("1");
	});

	it("refuses a blank prompt rather than letting dsh reject the task with no output", async () => {
		if (resolveOrchestratorPatchPath() === null) {
			return;
		}
		const launch = await prepareOrchestratorLaunch({ cwd: "/tmp/worktree", prompt: "   " });
		expect(launch).toBeNull();
	});
});

describe("collectCustomAgentFlowIds", () => {
	it("merges the Custom Agent picker with flowise ids attached as plain MCP servers", () => {
		expect(
			collectCustomAgentFlowIds({
				customAgentFlowIds: ["flowise-abc", " "],
				mcpServerIds: ["linear", "flowise-def", "flowise-abc"],
			}),
		).toEqual(["flowise-abc", "flowise-def"]);
	});

	it("is empty when the card selected nothing", () => {
		expect(collectCustomAgentFlowIds(undefined)).toEqual([]);
		expect(collectCustomAgentFlowIds({ mcpServerIds: ["linear"] })).toEqual([]);
	});
});
