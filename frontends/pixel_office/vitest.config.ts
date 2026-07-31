import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const runtimePkg = JSON.parse(
	readFileSync(resolve(__dirname, "../../backends/runtime/package.json"), "utf-8"),
) as { version: string };

const runtimeSrc = resolve(__dirname, "../../backends/runtime/src");

export default defineConfig({
	plugins: [react()],
	define: {
		__APP_VERSION__: JSON.stringify(runtimePkg.version),
	},
	resolve: {
		alias: {
			"@": resolve(__dirname, "src"),
			"@runtime-agent-catalog": resolve(runtimeSrc, "core/agent-catalog.ts"),
			"@runtime-cline-tool-call-display": resolve(runtimeSrc, "cline-sdk/cline-tool-call-display.ts"),
			"@runtime-home-agent-session": resolve(runtimeSrc, "core/home-agent-session.ts"),
			"@runtime-shortcuts": resolve(runtimeSrc, "config/shortcut-utils.ts"),
			"@runtime-task-id": resolve(runtimeSrc, "core/task-id.ts"),
			"@runtime-task-title": resolve(runtimeSrc, "core/task-title.ts"),
			"@runtime-task-worktree-path": resolve(runtimeSrc, "workspace/task-worktree-path.ts"),
			"@runtime-task-state": resolve(runtimeSrc, "core/task-board-mutations.ts"),
		},
		conditions: ["import", "module", "browser", "default"],
	},
	test: {
		environment: "jsdom",
		include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
		passWithNoTests: true,
		setupFiles: ["./vitest.setup.ts"],
	},
});
