import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";

import { describe, expect, it } from "vitest";
import {
	loadGlobalRuntimeConfig,
	loadRuntimeConfig,
	pickBestInstalledAgentIdFromDetected,
	saveRuntimeConfig,
	updateRuntimeConfig,
} from "../../../src/config/runtime-config";
import { RUNTIME_HOME_PARENT_DIR_NAME } from "../../../src/workspace/task-worktree-path";
import { createTempDir } from "../../utilities/temp-dir";

function withTemporaryEnv<T>(
	input: {
		home: string;
		pathPrefix?: string;
		replacePath?: boolean;
	},
	run: () => Promise<T>,
): Promise<T> {
	const previousHome = process.env.HOME;
	const previousUserProfile = process.env.USERPROFILE;
	const previousPath = process.env.PATH;
	process.env.HOME = input.home;
	process.env.USERPROFILE = input.home;
	if (input.pathPrefix) {
		process.env.PATH = input.replacePath
			? input.pathPrefix
			: previousPath
				? `${input.pathPrefix}${delimiter}${previousPath}`
				: input.pathPrefix;
	}
	return run().finally(() => {
		if (previousHome === undefined) {
			delete process.env.HOME;
		} else {
			process.env.HOME = previousHome;
		}
		if (previousUserProfile === undefined) {
			delete process.env.USERPROFILE;
		} else {
			process.env.USERPROFILE = previousUserProfile;
		}
		if (input.pathPrefix) {
			if (previousPath === undefined) {
				delete process.env.PATH;
			} else {
				process.env.PATH = previousPath;
			}
		}
	});
}

function writeFakeCommand(binDir: string, command: string): void {
	mkdirSync(binDir, { recursive: true });
	if (process.platform === "win32") {
		const scriptPath = join(binDir, `${command}.cmd`);
		writeFileSync(scriptPath, "@echo off\r\nexit /b 0\r\n", "utf8");
		return;
	}
	const scriptPath = join(binDir, command);
	writeFileSync(scriptPath, "#!/bin/sh\nexit 0\n", "utf8");
	chmodSync(scriptPath, 0o755);
}

describe.sequential("runtime-config auto agent selection", () => {
	// PixelOffice delta: the launch catalog is Claude-only, so detection resolves to
	// Claude Code or to nothing. Restoring other catalog entries restores this matrix.
	it("selects agents using the configured priority order", () => {
		expect(pickBestInstalledAgentIdFromDetected(["claude", "codex", "cline"])).toBe("claude");
		expect(pickBestInstalledAgentIdFromDetected(["claude", "droid"])).toBe("claude");
		expect(pickBestInstalledAgentIdFromDetected(["codex", "opencode", "gemini"])).toBeNull();
		expect(pickBestInstalledAgentIdFromDetected(["opencode", "droid", "gemini"])).toBeNull();
		expect(pickBestInstalledAgentIdFromDetected(["kiro-cli", "gemini"])).toBeNull();
		expect(pickBestInstalledAgentIdFromDetected(["gemini", "cline"])).toBeNull();
		expect(pickBestInstalledAgentIdFromDetected(["cline"])).toBeNull();
		expect(pickBestInstalledAgentIdFromDetected([])).toBeNull();
	});

	it("auto-selects and persists when unset", async () => {
		if (process.platform === "win32") {
			return;
		}
		const { path: tempHome, cleanup: cleanupHome } = createTempDir("kanban-home-runtime-config-");
		const { path: tempProject, cleanup: cleanupProject } = createTempDir("kanban-project-runtime-config-");
		const { path: tempBin, cleanup: cleanupBin } = createTempDir("kanban-bin-runtime-config-");

		try {
			// Claude plus gated CLIs on PATH: only Claude may be auto-selected.
			writeFakeCommand(tempBin, "claude");
			writeFakeCommand(tempBin, "opencode");
			writeFakeCommand(tempBin, "codex");
			writeFakeCommand(tempBin, "gemini");

			const previousShell = process.env.SHELL;
			try {
				process.env.SHELL = "/definitely-not-a-shell";
				const isolatedPath = `${tempBin}${delimiter}/usr/bin${delimiter}/bin`;
				await withTemporaryEnv({ home: tempHome, pathPrefix: isolatedPath, replacePath: true }, async () => {
					const state = await loadRuntimeConfig(tempProject);
					expect(state.selectedAgentId).toBe("claude");
					const persisted = JSON.parse(
						readFileSync(join(tempHome, RUNTIME_HOME_PARENT_DIR_NAME, "kanban", "config.json"), "utf8"),
					) as {
						selectedAgentId?: string;
						agentAutonomousModeEnabled?: boolean;
						readyForReviewNotificationsEnabled?: boolean;
						commitPromptTemplate?: string;
						openPrPromptTemplate?: string;
					};
					// Claude is now the default agent, and the writer omits default-valued
					// keys, so the auto-selected id is proven by the reload below.
					expect(persisted.selectedAgentId).toBeUndefined();
					expect(persisted.agentAutonomousModeEnabled).toBeUndefined();
					expect(persisted.readyForReviewNotificationsEnabled).toBeUndefined();
					expect(persisted.commitPromptTemplate).toBeUndefined();
					expect(persisted.openPrPromptTemplate).toBeUndefined();

					const reloadedState = await loadRuntimeConfig(tempProject);
					expect(reloadedState.selectedAgentId).toBe("claude");
				});
			} finally {
				if (previousShell === undefined) {
					delete process.env.SHELL;
				} else {
					process.env.SHELL = previousShell;
				}
			}
		} finally {
			cleanupBin();
			cleanupProject();
			cleanupHome();
		}
	});

	it("does not write config when no supported CLI is detected", async () => {
		if (process.platform === "win32") {
			return;
		}
		const { path: tempHome, cleanup: cleanupHome } = createTempDir("kanban-home-runtime-config-default-");
		const { path: tempProject, cleanup: cleanupProject } = createTempDir("kanban-project-runtime-config-default-");
		const { path: tempBin, cleanup: cleanupBin } = createTempDir("kanban-bin-runtime-config-default-");

		try {
			const previousShell = process.env.SHELL;
			try {
				process.env.SHELL = "/definitely-not-a-shell";
				await withTemporaryEnv({ home: tempHome, pathPrefix: tempBin, replacePath: true }, async () => {
					const state = await loadRuntimeConfig(tempProject);
					expect(state.selectedAgentId).toBe("claude");
					expect(existsSync(join(tempHome, RUNTIME_HOME_PARENT_DIR_NAME, "kanban", "config.json"))).toBe(false);
				});
			} finally {
				if (previousShell === undefined) {
					delete process.env.SHELL;
				} else {
					process.env.SHELL = previousShell;
				}
			}
		} finally {
			cleanupBin();
			cleanupProject();
			cleanupHome();
		}
	});

	it("treats the home directory as global-only config scope", async () => {
		const { path: tempHome, cleanup: cleanupHome } = createTempDir("kanban-home-runtime-config-home-scope-");

		try {
			await withTemporaryEnv({ home: tempHome }, async () => {
				const state = await loadRuntimeConfig(tempHome);
				expect(state.globalConfigPath).toBe(join(tempHome, RUNTIME_HOME_PARENT_DIR_NAME, "kanban", "config.json"));
				expect(state.projectConfigPath).toBeNull();
				expect(state.shortcuts).toEqual([]);

				// Codex is gated out of the launch catalog, so the runtime coerces the
				// request to Claude and omits the now-default key from the payload.
				const updated = await updateRuntimeConfig(tempHome, {
					selectedAgentId: "codex",
				});
				expect(updated.selectedAgentId).toBe("claude");
				expect(updated.projectConfigPath).toBeNull();

				const globalPayload = JSON.parse(
					readFileSync(join(tempHome, RUNTIME_HOME_PARENT_DIR_NAME, "kanban", "config.json"), "utf8"),
				) as {
					selectedAgentId?: string;
					shortcuts?: unknown;
				};
				expect(globalPayload.selectedAgentId).toBeUndefined();
				expect(globalPayload.shortcuts).toBeUndefined();
			});
		} finally {
			cleanupHome();
		}
	});

	it("loads global runtime config without a project scope", async () => {
		const { path: tempHome, cleanup: cleanupHome } = createTempDir("kanban-home-runtime-config-global-only-");

		try {
			await withTemporaryEnv({ home: tempHome }, async () => {
				const state = await loadGlobalRuntimeConfig();
				expect(state.globalConfigPath).toBe(join(tempHome, RUNTIME_HOME_PARENT_DIR_NAME, "kanban", "config.json"));
				expect(state.projectConfigPath).toBeNull();
				expect(state.shortcuts).toEqual([]);
			});
		} finally {
			cleanupHome();
		}
	});

	it("normalizes unsupported configured agents to the default launch agent", async () => {
		const { path: tempHome, cleanup: cleanupHome } = createTempDir("kanban-home-runtime-config-set-");
		const { path: tempProject, cleanup: cleanupProject } = createTempDir("kanban-project-runtime-config-set-");
		const { path: tempBin, cleanup: cleanupBin } = createTempDir("kanban-bin-runtime-config-set-");

		try {
			writeFakeCommand(tempBin, "claude");
			writeFakeCommand(tempBin, "codex");

			const runtimeConfigDir = join(tempHome, RUNTIME_HOME_PARENT_DIR_NAME, "kanban");
			mkdirSync(runtimeConfigDir, { recursive: true });
			writeFileSync(
				join(runtimeConfigDir, "config.json"),
				JSON.stringify(
					{
						selectedAgentId: "codex",
					},
					null,
					2,
				),
				"utf8",
			);

			await withTemporaryEnv({ home: tempHome, pathPrefix: tempBin }, async () => {
				const state = await loadRuntimeConfig(tempProject);
				expect(state.selectedAgentId).toBe("claude");
			});
		} finally {
			cleanupBin();
			cleanupProject();
			cleanupHome();
		}
	});

	it("does not auto-select when global config file already exists without selected agent", async () => {
		const { path: tempHome, cleanup: cleanupHome } = createTempDir("kanban-home-runtime-config-existing-");
		const { path: tempProject, cleanup: cleanupProject } = createTempDir("kanban-project-runtime-config-existing-");
		const { path: tempBin, cleanup: cleanupBin } = createTempDir("kanban-bin-runtime-config-existing-");

		try {
			writeFakeCommand(tempBin, "codex");

			const runtimeConfigDir = join(tempHome, RUNTIME_HOME_PARENT_DIR_NAME, "kanban");
			mkdirSync(runtimeConfigDir, { recursive: true });
			writeFileSync(
				join(runtimeConfigDir, "config.json"),
				JSON.stringify(
					{
						readyForReviewNotificationsEnabled: true,
					},
					null,
					2,
				),
				"utf8",
			);

			await withTemporaryEnv({ home: tempHome, pathPrefix: tempBin }, async () => {
				const state = await loadRuntimeConfig(tempProject);
				expect(state.selectedAgentId).toBe("claude");
			});
		} finally {
			cleanupBin();
			cleanupProject();
			cleanupHome();
		}
	});

	it("save omits default keys when they were not previously set", async () => {
		const { path: tempHome, cleanup: cleanupHome } = createTempDir("kanban-home-runtime-config-omit-defaults-");
		const { path: tempProject, cleanup: cleanupProject } = createTempDir(
			"kanban-project-runtime-config-omit-defaults-",
		);

		try {
			const runtimeConfigDir = join(tempHome, RUNTIME_HOME_PARENT_DIR_NAME, "kanban");
			mkdirSync(runtimeConfigDir, { recursive: true });
			writeFileSync(join(runtimeConfigDir, "config.json"), "{}", "utf8");

			await withTemporaryEnv({ home: tempHome }, async () => {
				const current = await loadRuntimeConfig(tempProject);
				await saveRuntimeConfig(tempProject, {
					// A gated agent normalizes back to the default, giving the writer a
					// default-valued key to omit. Cline is launchable now; codex is not.
					selectedAgentId: "codex",
					selectedShortcutLabel: null,
					defaultSubagentSeatProviderId: null,
					defaultSubagentSeatModelId: null,
					agentAutonomousModeEnabled: true,
					readyForReviewNotificationsEnabled: true,
					shortcuts: [],
					commitPromptTemplate: current.commitPromptTemplateDefault,
					openPrPromptTemplate: current.openPrPromptTemplateDefault,
					agentDisplayName: current.agentDisplayName,
					seamCommentTagTemplate: current.seamCommentTagTemplateDefault,
					commitTrailerMode: current.commitTrailerMode,
					commitTrailerTemplate: current.commitTrailerTemplateDefault,
				});

				const globalPayload = JSON.parse(
					readFileSync(join(tempHome, RUNTIME_HOME_PARENT_DIR_NAME, "kanban", "config.json"), "utf8"),
				) as {
					selectedAgentId?: string;
					agentAutonomousModeEnabled?: boolean;
					readyForReviewNotificationsEnabled?: boolean;
					commitPromptTemplate?: string;
					openPrPromptTemplate?: string;
					commitTrailerMode?: string;
					commitTrailerTemplate?: string;
				};
				expect(globalPayload.selectedAgentId).toBeUndefined();
				expect(globalPayload.agentAutonomousModeEnabled).toBeUndefined();
				expect(globalPayload.readyForReviewNotificationsEnabled).toBeUndefined();
				expect(globalPayload.commitPromptTemplate).toBeUndefined();
				expect(globalPayload.openPrPromptTemplate).toBeUndefined();
				expect(globalPayload.commitTrailerMode).toBeUndefined();
				expect(globalPayload.commitTrailerTemplate).toBeUndefined();
				expect(existsSync(join(tempProject, RUNTIME_HOME_PARENT_DIR_NAME, "kanban", "config.json"))).toBe(false);
			});
		} finally {
			cleanupProject();
			cleanupHome();
		}
	});

	it("removes an existing empty project config file when no shortcuts are saved", async () => {
		const { path: tempHome, cleanup: cleanupHome } = createTempDir("kanban-home-runtime-config-cleanup-empty-");
		const { path: tempProject, cleanup: cleanupProject } = createTempDir(
			"kanban-project-runtime-config-cleanup-empty-",
		);

		try {
			const runtimeProjectConfigDir = join(tempProject, RUNTIME_HOME_PARENT_DIR_NAME, "kanban");
			mkdirSync(runtimeProjectConfigDir, { recursive: true });
			writeFileSync(join(runtimeProjectConfigDir, "config.json"), "{}", "utf8");

			await withTemporaryEnv({ home: tempHome }, async () => {
				const current = await loadRuntimeConfig(tempProject);
				await saveRuntimeConfig(tempProject, {
					selectedAgentId: "cline",
					selectedShortcutLabel: null,
					defaultSubagentSeatProviderId: null,
					defaultSubagentSeatModelId: null,
					agentAutonomousModeEnabled: true,
					readyForReviewNotificationsEnabled: true,
					shortcuts: [],
					commitPromptTemplate: current.commitPromptTemplateDefault,
					openPrPromptTemplate: current.openPrPromptTemplateDefault,
					agentDisplayName: current.agentDisplayName,
					seamCommentTagTemplate: current.seamCommentTagTemplateDefault,
					commitTrailerMode: current.commitTrailerMode,
					commitTrailerTemplate: current.commitTrailerTemplateDefault,
				});

				expect(existsSync(join(tempProject, RUNTIME_HOME_PARENT_DIR_NAME, "kanban", "config.json"))).toBe(false);
			});
		} finally {
			cleanupProject();
			cleanupHome();
		}
	});

	it("removes the project config file when the last shortcut is deleted", async () => {
		const { path: tempHome, cleanup: cleanupHome } = createTempDir("kanban-home-runtime-config-remove-last-");
		const { path: tempProject, cleanup: cleanupProject } = createTempDir(
			"kanban-project-runtime-config-remove-last-",
		);

		try {
			await withTemporaryEnv({ home: tempHome }, async () => {
				const current = await loadRuntimeConfig(tempProject);
				await saveRuntimeConfig(tempProject, {
					selectedAgentId: "cline",
					selectedShortcutLabel: null,
					defaultSubagentSeatProviderId: null,
					defaultSubagentSeatModelId: null,
					agentAutonomousModeEnabled: true,
					readyForReviewNotificationsEnabled: true,
					shortcuts: [{ label: "Ship", command: "npm run ship", icon: "rocket" }],
					commitPromptTemplate: current.commitPromptTemplateDefault,
					openPrPromptTemplate: current.openPrPromptTemplateDefault,
					agentDisplayName: current.agentDisplayName,
					seamCommentTagTemplate: current.seamCommentTagTemplateDefault,
					commitTrailerMode: current.commitTrailerMode,
					commitTrailerTemplate: current.commitTrailerTemplateDefault,
				});
				expect(existsSync(join(tempProject, RUNTIME_HOME_PARENT_DIR_NAME, "kanban", "config.json"))).toBe(true);

				await updateRuntimeConfig(tempProject, {
					shortcuts: [],
				});

				expect(existsSync(join(tempProject, RUNTIME_HOME_PARENT_DIR_NAME, "kanban", "config.json"))).toBe(false);
			});
		} finally {
			cleanupProject();
			cleanupHome();
		}
	});

	it("updateRuntimeConfig supports partial updates", async () => {
		const { path: tempHome, cleanup: cleanupHome } = createTempDir("kanban-home-runtime-config-partial-");
		const { path: tempProject, cleanup: cleanupProject } = createTempDir("kanban-project-runtime-config-partial-");

		try {
			await withTemporaryEnv({ home: tempHome }, async () => {
				await loadRuntimeConfig(tempProject);

				// Gated agent ids collapse to Claude, so the partial update is observed
				// through the coerced state plus the untouched sibling keys.
				const updated = await updateRuntimeConfig(tempProject, {
					selectedAgentId: "codex",
				});
				expect(updated.selectedAgentId).toBe("claude");

				const globalPayload = JSON.parse(
					readFileSync(join(tempHome, RUNTIME_HOME_PARENT_DIR_NAME, "kanban", "config.json"), "utf8"),
				) as {
					selectedAgentId?: string;
					selectedShortcutLabel?: string;
					agentAutonomousModeEnabled?: boolean;
					readyForReviewNotificationsEnabled?: boolean;
				};
				expect(globalPayload.selectedAgentId).toBeUndefined();
				expect(globalPayload.selectedShortcutLabel).toBeUndefined();
				expect(globalPayload.agentAutonomousModeEnabled).toBeUndefined();
				expect(globalPayload.readyForReviewNotificationsEnabled).toBeUndefined();
			});
		} finally {
			cleanupProject();
			cleanupHome();
		}
	});

	it("persists autonomous mode when disabled", async () => {
		const { path: tempHome, cleanup: cleanupHome } = createTempDir("kanban-home-runtime-config-autonomous-disabled-");
		const { path: tempProject, cleanup: cleanupProject } = createTempDir(
			"kanban-project-runtime-config-autonomous-disabled-",
		);

		try {
			await withTemporaryEnv({ home: tempHome }, async () => {
				const updated = await updateRuntimeConfig(tempProject, {
					agentAutonomousModeEnabled: false,
				});
				expect(updated.agentAutonomousModeEnabled).toBe(false);

				const globalPayload = JSON.parse(
					readFileSync(join(tempHome, RUNTIME_HOME_PARENT_DIR_NAME, "kanban", "config.json"), "utf8"),
				) as {
					agentAutonomousModeEnabled?: boolean;
				};
				expect(globalPayload.agentAutonomousModeEnabled).toBe(false);

				const reloaded = await loadRuntimeConfig(tempProject);
				expect(reloaded.agentAutonomousModeEnabled).toBe(false);
			});
		} finally {
			cleanupProject();
			cleanupHome();
		}
	});

	it("preserves concurrent config updates across processes", async () => {
		const { path: tempHome, cleanup: cleanupHome } = createTempDir("kanban-home-runtime-config-concurrent-");
		const { path: tempProject, cleanup: cleanupProject } = createTempDir("kanban-project-runtime-config-concurrent-");

		try {
			await withTemporaryEnv({ home: tempHome }, async () => {
				await loadRuntimeConfig(tempProject);

				// Uses two non-default keys: with a Claude-only catalog, selectedAgentId
				// always reads back as "claude" and so could not prove a lost write.
				const [shortcutLabelState, autonomousModeState] = await Promise.all([
					updateRuntimeConfig(tempProject, {
						selectedShortcutLabel: "Ship",
					}),
					updateRuntimeConfig(tempProject, {
						agentAutonomousModeEnabled: false,
					}),
				]);

				expect(shortcutLabelState.selectedShortcutLabel).toBe("Ship");
				expect(autonomousModeState.agentAutonomousModeEnabled).toBe(false);

				const reloaded = await loadRuntimeConfig(tempProject);
				expect(reloaded.selectedShortcutLabel).toBe("Ship");
				expect(reloaded.agentAutonomousModeEnabled).toBe(false);
			});
		} finally {
			cleanupProject();
			cleanupHome();
		}
	});

	it("defaults commit trailer mode to omit and persists include mode plus custom text", async () => {
		const { path: tempHome, cleanup: cleanupHome } = createTempDir("kanban-home-runtime-config-trailer-");
		const { path: tempProject, cleanup: cleanupProject } = createTempDir(
			"kanban-project-runtime-config-trailer-",
		);

		try {
			await withTemporaryEnv({ home: tempHome }, async () => {
				const current = await loadRuntimeConfig(tempProject);
				expect(current.commitTrailerMode).toBe("omit");
				expect(current.commitTrailerTemplate).toBe("Co-Authored-By: Claude <noreply@anthropic.com>");
				expect(current.commitTrailerTemplateDefault).toBe(current.commitTrailerTemplate);

				const updated = await updateRuntimeConfig(tempProject, {
					commitTrailerMode: "include",
					commitTrailerTemplate: "Signed-off-by: {{agent_name}}",
				});
				expect(updated.commitTrailerMode).toBe("include");
				expect(updated.commitTrailerTemplate).toBe("Signed-off-by: {{agent_name}}");

				const reloaded = await loadRuntimeConfig(tempProject);
				expect(reloaded.commitTrailerMode).toBe("include");
				expect(reloaded.commitTrailerTemplate).toBe("Signed-off-by: {{agent_name}}");

				const globalPayload = JSON.parse(
					readFileSync(join(tempHome, RUNTIME_HOME_PARENT_DIR_NAME, "kanban", "config.json"), "utf8"),
				) as {
					commitTrailerMode?: string;
					commitTrailerTemplate?: string;
				};
				expect(globalPayload.commitTrailerMode).toBe("include");
				expect(globalPayload.commitTrailerTemplate).toBe("Signed-off-by: {{agent_name}}");
			});
		} finally {
			cleanupProject();
			cleanupHome();
		}
	});
});
