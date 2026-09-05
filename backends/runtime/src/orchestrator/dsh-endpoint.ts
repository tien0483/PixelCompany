// Shared resolution for the DeepSeek Harness (dsh) orchestrator sidecar and headless task
// launches. Port 3020 is reserved for an optional `dsh web` instance; task cards normally
// invoke `dsh --profile headless` directly in the worktree PTY.
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { readBrandEnv } from "../brand";

export const DEFAULT_DSH_HOST = "127.0.0.1";
/** Clear of Flowise 3010, DevTools 3001, and CCR 3456/3460+. */
export const DEFAULT_DSH_WEB_PORT = 3020;

export function resolveDshWebPort(configured: number | undefined): number {
	if (configured !== undefined) {
		return configured;
	}
	const fromPortEnv = readBrandEnv("DSH_WEB_PORT")?.trim();
	if (fromPortEnv && /^\d+$/.test(fromPortEnv)) {
		return Number(fromPortEnv);
	}
	return DEFAULT_DSH_WEB_PORT;
}

export function resolveDshWebBaseUrl(configured: string | undefined): string {
	const fromUrl = configured ?? readBrandEnv("DSH_WEB_URL")?.trim();
	if (fromUrl) {
		return fromUrl.replace(/\/$/, "");
	}
	return `http://${DEFAULT_DSH_HOST}:${resolveDshWebPort(undefined)}`;
}

/** PixelOffice-owned harness state — not the user's interactive ~/.dsh. */
export function resolveDefaultDshHome(): string {
	const override = readBrandEnv("DSH_HOME")?.trim();
	if (override) {
		return override;
	}
	const agentHome = process.env.AGENT_HOME?.trim() || join(process.env.HOME ?? "", ".agent");
	return join(agentHome, "dsh");
}

/** Profile the Custom Agent card launches; `dsh --profile headless` auto-initializes it. */
export const DSH_TASK_PROFILE_NAME = "headless";

/**
 * Out-of-tree dsh plugins resolve from the dsh installation first and then from the *profile's*
 * own `node_modules` — `$DSH_HOME/profiles/<name>` — never from `$DSH_HOME` itself.
 */
export function resolveDshProfileDir(dshHome: string, profile: string = DSH_TASK_PROFILE_NAME): string {
	return join(dshHome, "profiles", profile);
}

/**
 * Repo-local dsh payload dir: `backends/dsh`, gitignored, the same posture as `backends/flowise`
 * and `backends/openmaic`. A fresh clone gets the harness from `scripts/install-dsh.mjs` instead
 * of requiring a global `npm i -g @deepseek-ai/dsh` on every machine.
 *
 * Returns null when the tree has not been installed — never a speculative path, because the caller
 * treats "resolved" as "runnable".
 */
export function resolveRepoLocalDshBinary(): string | null {
	const here = dirname(fileURLToPath(import.meta.url));
	const candidates = [
		// dist build: src/orchestrator → backends/runtime → backends
		resolve(here, "../../../dsh/node_modules/.bin/dsh"),
		// tsx from source: src/orchestrator → src → backends/runtime → backends
		resolve(here, "../../../../dsh/node_modules/.bin/dsh"),
	];
	for (const candidate of candidates) {
		if (existsSync(candidate)) {
			return candidate;
		}
	}
	return null;
}

/** Where `scripts/install-dsh.mjs` installs into; resolved from the repo root, not from here. */
export const DSH_REPO_LOCAL_DIR_NAME = "backends/dsh";

export function resolveOrchestratorPatchPath(): string | null {
	const override = readBrandEnv("DSH_PATCH")?.trim();
	if (override && existsSync(override)) {
		return override;
	}
	const here = dirname(fileURLToPath(import.meta.url));
	const candidates = [
		resolve(here, "../../config/orchestrator/pixeloffice.patch.yml"),
		resolve(here, "../../../config/orchestrator/pixeloffice.patch.yml"),
	];
	for (const candidate of candidates) {
		if (existsSync(candidate)) {
			return candidate;
		}
	}
	return null;
}
