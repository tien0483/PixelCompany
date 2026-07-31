import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

const currentDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	testDir: "./tests",
	// tests/solo drives the single-URL runtime instead of this Vite dev server;
	// it has its own config (playwright.solo.config.ts).
	testIgnore: ["solo/**"],
	timeout: 60_000,
	expect: {
		timeout: 15_000,
	},
	use: {
		baseURL: "http://127.0.0.1:4173",
		headless: true,
		viewport: { width: 1440, height: 900 },
		screenshot: "only-on-failure",
		trace: "retain-on-failure",
	},
	outputDir: join(currentDir, "test-results"),
	webServer: {
		command: "npm run dev -- --host 127.0.0.1 --port 4173",
		cwd: currentDir,
		url: "http://127.0.0.1:4173",
		reuseExistingServer: !process.env.CI,
		timeout: 120_000,
	},
});
