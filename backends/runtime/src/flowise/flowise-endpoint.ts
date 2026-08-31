// Shared host/port/base-URL/root resolution for the Flowise agent-studio sidecar, so the
// process supervisor (which spawns it) and the HTTP client (which talks to it) never drift
// onto different env-var ladders. Same shape as `doc-skill/doc-skill-endpoint.ts`.
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_FLOWISE_HOST = "127.0.0.1";
/**
 * Upstream defaults to 3000, which is deliberately not used here: 3001 is the DevTools
 * daemon and 3456/3460+ belong to CCR (the user's router plus one per subagent seat), so
 * the studio stays clear of that whole block.
 */
export const DEFAULT_FLOWISE_PORT = 3010;

/**
 * Resolution order: an explicit `configured` value, then the port embedded in
 * `PIXELOFFICE_FLOWISE_URL`, then `PIXELOFFICE_FLOWISE_PORT`, then the default port.
 */
export function resolveFlowisePort(configured: number | undefined): number {
	if (configured !== undefined) {
		return configured;
	}
	const fromUrl = process.env.PIXELOFFICE_FLOWISE_URL?.trim();
	if (fromUrl) {
		try {
			const parsed = new URL(fromUrl);
			if (parsed.port) {
				return Number(parsed.port);
			}
		} catch {
			// fall through
		}
	}
	const fromPortEnv = process.env.PIXELOFFICE_FLOWISE_PORT?.trim();
	if (fromPortEnv && /^\d+$/.test(fromPortEnv)) {
		return Number(fromPortEnv);
	}
	return DEFAULT_FLOWISE_PORT;
}

/**
 * Resolution order: an explicit `configured` URL, then `PIXELOFFICE_FLOWISE_URL` verbatim,
 * then `http://127.0.0.1:<resolveFlowisePort()>` — so a bare `PIXELOFFICE_FLOWISE_PORT`
 * override (with no `_URL` set) reaches the client the same way it reaches the supervisor.
 *
 * This URL is also what the browser loads directly: the studio is embedded cross-origin
 * rather than through an `/api/*-proxy/` route, because those proxies buffer to text and
 * the runtime's WS-upgrade allowlist drops every path but its own — neither survives a SPA
 * bundle plus streaming.
 */
export function resolveFlowiseBaseUrl(configured: string | undefined): string {
	const fromUrl = configured ?? process.env.PIXELOFFICE_FLOWISE_URL?.trim();
	if (fromUrl) {
		return fromUrl.replace(/\/$/, "");
	}
	return `http://${DEFAULT_FLOWISE_HOST}:${resolveFlowisePort(undefined)}`;
}

/**
 * Locates the `backends/flowise` submodule next to the runtime. Mirrors `findHtmlRoot()`'s
 * candidate walk so the monorepo source layout and the bundled `dist/cli.js` layout both
 * resolve.
 *
 * Returns null when the submodule was never initialized — the common case on a fresh clone,
 * and the reason the studio is gated on presence instead of on a `stack-flags.json` key: an
 * unreadable flags file means *every* flag is on, which would auto-start a heavy service
 * nobody installed.
 */
export function findFlowiseRoot(): string | null {
	const override = process.env.PIXELOFFICE_FLOWISE_ROOT?.trim();
	if (override) {
		return existsSync(join(override, "packages", "server", "package.json")) ? override : null;
	}
	const here = dirname(fileURLToPath(import.meta.url));
	const candidates = [
		// Dev / monorepo: backends/runtime/src/flowise → backends/flowise
		resolve(here, "../../../flowise"),
		// tsc output: backends/runtime/dist/flowise → backends/flowise
		resolve(here, "../../../../flowise"),
		// Bundled dist/cli.js sitting in backends/runtime/dist
		resolve(here, "../../flowise"),
	];
	for (const candidate of candidates) {
		if (existsSync(join(candidate, "packages", "server", "package.json"))) {
			return candidate;
		}
	}
	return null;
}
