// Shared resolution for the DeepSeek Harness (dsh) orchestrator sidecar and headless task
// launches. Port 3020 is reserved for an optional `dsh web` instance; task cards normally
// invoke `dsh --profile headless` directly in the worktree PTY.
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_DSH_HOST = "127.0.0.1";
/** Clear of Flowise 3010, DevTools 3001, and CCR 3456/3460+. */
export const DEFAULT_DSH_WEB_PORT = 3020;

export function resolveDshWebPort(configured: number | undefined): number {
	if (configured !== undefined) {
		return configured;
	}
	const fromPortEnv = process.env.PIXELOFFICE_DSH_WEB_PORT?.trim();
	if (fromPortEnv && /^\d+$/.test(fromPortEnv)) {
		return Number(fromPortEnv);
	}
	return DEFAULT_DSH_WEB_PORT;
}

export function resolveDshWebBaseUrl(configured: string | undefined): string {
	const fromUrl = configured ?? process.env.PIXELOFFICE_DSH_WEB_URL?.trim();
	if (fromUrl) {
		return fromUrl.replace(/\/$/, "");
	}
	return `http://${DEFAULT_DSH_HOST}:${resolveDshWebPort(undefined)}`;
}

/** PixelOffice-owned harness state — not the user's interactive ~/.dsh. */
export function resolveDefaultDshHome(): string {
	const override = process.env.PIXELOFFICE_DSH_HOME?.trim();
	if (override) {
		return override;
	}
	const agentHome = process.env.AGENT_HOME?.trim() || join(process.env.HOME ?? "", ".agent");
	return join(agentHome, "dsh");
}

export function resolveOrchestratorPatchPath(): string | null {
	const override = process.env.PIXELOFFICE_DSH_PATCH?.trim();
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
