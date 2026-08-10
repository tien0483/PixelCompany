// CLI entry for the standalone Plan Editor package. Boots only the HTML sidecar
// (`backends/html_anything`) and the slim plan-editor server — no Manager, no
// Stack switchboard, no OmniRoute, no terminal/board/task-worktree machinery.
// HTML generation shells out to whatever `claude` binary is already on PATH and
// logged in (see `runAgentOneShot` in `../terminal/agent-oneshot.ts`).
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createHtmlClient } from "../html/html-client";
import { startHtmlProcess } from "../html/html-process";
import { startPlanEditorServer } from "./server";

const DEFAULT_HTML_HOST = "127.0.0.1";
const DEFAULT_HTML_PORT = 8322;
const DEFAULT_SERVER_PORT = 4173;

const warn = (message: string) => console.warn(`[plan-editor] ${message}`);
const log = (message: string) => console.log(`[plan-editor] ${message}`);

async function main(): Promise<void> {
	const bundleDir = dirname(fileURLToPath(import.meta.url));

	// Packaged layout: <install>/server/index.js (this bundle), <install>/agent-data,
	// <install>/html_anything. Both are overridable for dev/test runs from source.
	const agentDataDir = process.env.PLAN_EDITOR_AGENT_DATA ?? resolve(bundleDir, "../agent-data");
	process.env.PIXELOFFICE_AGENT_DATA = agentDataDir;

	const htmlRoot = process.env.PLAN_EDITOR_HTML_ROOT ?? resolve(bundleDir, "../html_anything");
	const htmlHost = process.env.PLAN_EDITOR_HTML_HOST ?? DEFAULT_HTML_HOST;
	const htmlPort = Number(process.env.PLAN_EDITOR_HTML_PORT ?? DEFAULT_HTML_PORT);

	const htmlProcess = await startHtmlProcess({ warn, log, htmlRoot, host: htmlHost, port: htmlPort });
	const htmlReady = await htmlProcess.ready;
	if (!htmlReady) {
		warn("HTML sidecar did not start — template list/generation will stay unavailable until it is running.");
	}

	const htmlClient = createHtmlClient({ baseUrl: `http://${htmlHost}:${htmlPort}`, warn });

	const serverHost = process.env.PLAN_EDITOR_HOST ?? DEFAULT_HTML_HOST;
	const serverPort = Number(process.env.PLAN_EDITOR_PORT ?? DEFAULT_SERVER_PORT);
	const server = await startPlanEditorServer({ htmlClient, host: serverHost, port: serverPort });
	log(`Plan Editor ready at ${server.url}`);

	let shuttingDown = false;
	const shutdown = async () => {
		if (shuttingDown) return;
		shuttingDown = true;
		log("Shutting down...");
		await server.close();
		await htmlProcess.close();
		process.exit(0);
	};
	process.on("SIGINT", () => void shutdown());
	process.on("SIGTERM", () => void shutdown());
}

main().catch((error) => {
	console.error("[plan-editor] fatal:", error);
	process.exit(1);
});
