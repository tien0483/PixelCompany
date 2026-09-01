import { describe, expect, it } from "vitest";

import {
	areAgentLaunchOptionsEqual,
	buildAgentLaunchPreviewArgs,
	createDefaultAgentLaunchOptions,
	deriveLegacyAutonomousModeEnabled,
	normalizeAgentLaunchOptions,
	resolveAutonomousModeEnabledForLaunch,
} from "../../../src/config/agent-launch-options";

describe("agent-launch-options", () => {
	it("migrates legacy autonomous boolean into per-agent defaults", () => {
		const enabled = normalizeAgentLaunchOptions(undefined, true);
		expect(enabled.claude?.claudePermissionMode).toBe("auto");
		expect(enabled.gemini?.geminiSkipPermissions).toBe(true);
		expect(buildAgentLaunchPreviewArgs("claude", enabled)).toEqual(["--permission-mode", "auto"]);

		const disabled = normalizeAgentLaunchOptions(undefined, false);
		expect(disabled.claude?.claudePermissionMode).toBe("off");
		expect(buildAgentLaunchPreviewArgs("claude", disabled)).toEqual([]);
	});

	it("derives legacy autonomous flag from the selected agent entry", () => {
		const options = createDefaultAgentLaunchOptions(true);
		expect(deriveLegacyAutonomousModeEnabled("gemini", options)).toBe(true);
		options.gemini = { geminiSkipPermissions: false, geminiMode: "off" };
		expect(resolveAutonomousModeEnabledForLaunch("gemini", options)).toBe(false);
	});

	it("compares normalized agent launch options", () => {
		const left = createDefaultAgentLaunchOptions(true);
		const right = createDefaultAgentLaunchOptions(true);
		expect(areAgentLaunchOptionsEqual(left, right)).toBe(true);
		right.claude = { claudePermissionMode: "plan" };
		expect(areAgentLaunchOptionsEqual(left, right)).toBe(false);
	});
});
