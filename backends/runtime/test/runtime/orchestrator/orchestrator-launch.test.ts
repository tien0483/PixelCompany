import { describe, expect, it, vi } from "vitest";

import { resolveOrchestratorPatchPath } from "../../../src/orchestrator/dsh-endpoint";
import { prepareOrchestratorLaunch } from "../../../src/orchestrator/orchestrator-launch";

vi.mock("../../../src/orchestrator/dsh-binary", () => ({
	resolveDshBinary: () => ({ path: "dsh", viaNpx: false }),
	buildDshArgv: (_binary: unknown, args: string[]) => ({ command: "dsh", args }),
}));

describe("prepareOrchestratorLaunch", () => {
	it("builds headless argv with prompt and DSH_HOME", async () => {
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
		expect(launch?.args).toContain("--profile");
		expect(launch?.args).toContain("headless");
		expect(launch?.args).toContain("--patch");
		expect(launch?.args).toContain(patchPath);
		expect(launch?.args).toContain("--cwd");
		expect(launch?.args).toContain("/tmp/worktree");
		expect(launch?.args).toContain("--force");
		const promptIndex = launch?.args.indexOf("--prompt") ?? -1;
		expect(promptIndex).toBeGreaterThan(-1);
		expect(launch?.args[promptIndex + 1]).toContain("Implement feature X");
		expect(launch?.env.DSH_HOME).toBeTruthy();
		expect(launch?.env.PIXELOFFICE_ORCHESTRATOR).toBe("1");
	});
});
