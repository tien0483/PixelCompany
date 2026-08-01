import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkHooksCoexistence } from "../doctor/hooks-coexistence";

describe("checkHooksCoexistence", () => {
	it("reports healthy when Kanban hooks are present and Pixel Agents are not", async () => {
		const dir = await mkdtemp(join(tmpdir(), "kanban-hooks-"));
		const settingsPath = join(dir, "settings.json");
		await writeFile(
			settingsPath,
			JSON.stringify({
				hooks: {
					Stop: [
						{
							hooks: [{ type: "command", command: "kanban hooks ingest --event to_review" }],
						},
						{
							hooks: [{ type: "command", command: "session_account_tracker" }],
						},
					],
				},
			}),
		);
		const report = await checkHooksCoexistence(settingsPath);
		expect(report.kanbanPresent).toBe(true);
		expect(report.managerPresent).toBe(true);
		expect(report.pixelAgentsPresent).toBe(false);
		expect(report.ok).toBe(true);
	});

	it("fails when Pixel Agents ingestion hooks remain", async () => {
		const dir = await mkdtemp(join(tmpdir(), "kanban-hooks-"));
		const settingsPath = join(dir, "settings.json");
		await writeFile(
			settingsPath,
			JSON.stringify({
				hooks: {
					Stop: [{ hooks: [{ type: "command", command: "pixel-agents/claude-hook.ts" }] }],
				},
			}),
		);
		const report = await checkHooksCoexistence(settingsPath);
		expect(report.ok).toBe(false);
		expect(report.pixelAgentsPresent).toBe(true);
	});
});
