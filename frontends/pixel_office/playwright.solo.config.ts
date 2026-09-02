import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";
import { readBrandEnv } from "./src/brand";

const currentDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(currentDir, "..", "..");

/**
 * Solo-mode E2E: drives the real single-URL stack instead of the Vite dev server.
 *
 * `npm run solo` builds the UI and starts one Node runtime that serves the app,
 * the board, PTY sessions and the Jacked bridge on a single origin, spawning the
 * headless jacked child itself. These specs assert exactly that: board, office
 * and Claude Accounts all reachable from one URL with no second origin.
 *
 * Jacked itself may or may not be installed on the machine, so the account specs
 * stub the `manager.*` tRPC procedures rather than mutating real credentials.
 */
const soloPort = readBrandEnv("SOLO_PORT") ?? "3499";
const soloUrl = `http://127.0.0.1:${soloPort}`;

export default defineConfig({
	testDir: "./tests/solo",
	timeout: 90_000,
	expect: {
		timeout: 20_000,
	},
	use: {
		baseURL: soloUrl,
		headless: true,
		viewport: { width: 1600, height: 1000 },
		screenshot: "only-on-failure",
		trace: "retain-on-failure",
	},
	outputDir: join(currentDir, "test-results-solo"),
	webServer: {
		// --build so specs never run against a stale bundle after a UI source change.
		command: `node scripts/solo.mjs --no-open --restart --build`,
		cwd: repoRoot,
		url: soloUrl,
		reuseExistingServer: !process.env.CI,
		// The first run builds the UI, which dominates startup.
		timeout: 300_000,
		env: {
			PIXTIEL_PORT: soloPort,
			PIXELOFFICE_PORT: soloPort,
		},
	},
});
