// CLI entry for the standalone Review package. Boots only the slim review server —
// no Manager, no Stack switchboard, no OmniRoute, no HTML sidecar, no terminal /
// board / task-worktree machinery.
//
// Two external dependencies at runtime: a GitLab instance to authorize against, and
// whatever `claude` binary is already on PATH and logged in (see `runAgentOneShot` in
// `../terminal/agent-oneshot.ts`).
import { resolve } from "node:path";

import { createGitlabClient } from "../gitlab/gitlab-client";
import { createGitlabOauthSession } from "../gitlab/gitlab-oauth";
import { openGitlabAuthUrl } from "../server/browser";
import { createReviewStandaloneContext } from "./router";
import { startReviewServer } from "./server";

const DEFAULT_HOST = "127.0.0.1";
/**
 * Deliberately not the plan editor's 4173: both packages can be installed side by
 * side, and the first one started would otherwise own the port while the second
 * failed with a bare EADDRINUSE.
 */
const DEFAULT_PORT = 4183;

const warn = (message: string) => console.warn(`[review] ${message}`);
const log = (message: string) => console.log(`[review] ${message}`);

async function main(): Promise<void> {
	// The rules cache lives under `agent-data/`; the packaged layout puts it next to
	// the server bundle. Overridable for dev runs from source.
	const agentDataDir = process.env.REVIEW_AGENT_DATA ?? resolve(process.cwd(), "agent-data");
	process.env.PIXELOFFICE_AGENT_DATA = agentDataDir;

	const host = process.env.REVIEW_HOST ?? DEFAULT_HOST;
	const port = Number(process.env.REVIEW_PORT ?? DEFAULT_PORT);

	// The GitLab OAuth callback is fixed to port 14995 (see gitlab-oauth.ts
	// header) — independent of whatever port this review server runs on.
	const gitlabClient = createGitlabClient({ warn });
	const gitlabOauth = createGitlabOauthSession();
	const context = createReviewStandaloneContext({
		gitlabClient,
		gitlabOauth,
		openInBrowser: (url) => openGitlabAuthUrl(url, { warn }),
		warn,
	});

	const credential = await gitlabClient.getCredential();
	if (credential) {
		log(`GitLab credential found for ${credential.username} at ${credential.host}.`);
	} else {
		log("No GitLab credential yet — use Connect GitLab in the UI to authorize.");
	}

	const server = await startReviewServer({ context, host, port });
	log(`Review ready at ${server.url}`);

	let shuttingDown = false;
	const shutdown = async () => {
		if (shuttingDown) {
			return;
		}
		shuttingDown = true;
		log("Shutting down...");
		await server.close();
		process.exit(0);
	};
	process.on("SIGINT", () => void shutdown());
	process.on("SIGTERM", () => void shutdown());
}

main().catch((error) => {
	console.error("[review] fatal:", error);
	process.exit(1);
});
