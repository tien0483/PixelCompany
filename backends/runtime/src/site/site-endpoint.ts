// Host/port/URL/root resolution for the product website sidecar — the built
// `frontends/pixtiel-site` output that the Docs tab frames. Same env-ladder shape as
// `flowise/flowise-endpoint.ts` and `openmaic/openmaic-endpoint.ts`, so the server (which
// serves it) and the API layer (which reports on it) can never drift apart.
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { readBrandEnv } from "../brand";

export const DEFAULT_SITE_HOST = "127.0.0.1";

/**
 * Where the static server binds.
 *
 * Loopback by default. When the runtime was deliberately bound to a reachable host — the
 * remote-access setup — the site follows it, because a frame pointed at `127.0.0.1` from
 * another machine resolves to the *viewer's* loopback and fails silently. What gets exposed
 * is the same marketing-and-docs build that ships publicly, so there is nothing here that
 * the public site does not already publish; the board itself keeps its own auth gate.
 */
export function resolveSiteBindHost(): string {
	const runtimeHost = process.env.KANBAN_RUNTIME_HOST?.trim();
	if (runtimeHost && runtimeHost.length > 0 && runtimeHost !== "localhost") {
		return runtimeHost;
	}
	return DEFAULT_SITE_HOST;
}
/**
 * Clear of every port already claimed here: 3000 is Flowise upstream's default, 3001 the
 * DevTools daemon, 3010 the Flowise studio, 3020 the OpenMAIC classroom, 3456/3460+ CCR
 * and the per-seat routers, 3484 the runtime, 5173 Vite, 5273+ the UA viewers, 8321
 * Manager, 8400 OmniRoute, 8787 Headroom.
 */
export const DEFAULT_SITE_PORT = 3030;

/** The page the Docs tab opens. The site's own nav takes over from there. */
export const SITE_DOCS_PATH = "/docs/getting-started";

/**
 * Resolution order: an explicit `configured` value, then the port embedded in
 * `PIXTIEL_WEBSITE_URL`, then `PIXTIEL_WEBSITE_PORT`, then the default port.
 */
export function resolveSitePort(configured?: number): number {
	if (configured !== undefined) {
		return configured;
	}
	const fromUrl = readBrandEnv("WEBSITE_URL")?.trim();
	if (fromUrl) {
		try {
			const parsed = new URL(fromUrl);
			if (parsed.port) {
				return Number(parsed.port);
			}
		} catch {
			// fall through to the port env var
		}
	}
	const fromPortEnv = readBrandEnv("WEBSITE_PORT")?.trim();
	if (fromPortEnv && /^\d+$/.test(fromPortEnv)) {
		return Number(fromPortEnv);
	}
	return DEFAULT_SITE_PORT;
}

/** Public Next.js docs/marketing host (v0 / Vercel). Docs tab frames this by default. */
export const DEFAULT_PUBLIC_SITE_URL = "https://pixtiel.vercel.app";

/**
 * Resolution order: an explicit `configured` URL, then `PIXTIEL_WEBSITE_URL` verbatim,
 * then the public Vercel host. Set `PIXTIEL_WEBSITE_URL=http://127.0.0.1:3030` to frame a
 * local `next start` instead.
 */
export function resolveSiteBaseUrl(configured?: string): string {
	const fromUrl = configured ?? readBrandEnv("WEBSITE_URL")?.trim();
	if (fromUrl) {
		return fromUrl.replace(/\/$/, "");
	}
	return DEFAULT_PUBLIC_SITE_URL;
}

/** True when Docs should treat the site as the hosted Vercel/v0 deploy (no local dist). */
export function isHostedSiteUrl(url: string): boolean {
	try {
		const host = new URL(url).hostname;
		return host !== "127.0.0.1" && host !== "localhost";
	} catch {
		return false;
	}
}

/**
 * Locates the built site. Returns null when it has not been built — the common case on a
 * fresh clone, and the reason the Docs tab has an explicit "not built" state instead of
 * an iframe pointed at a dead port.
 */
export function findSiteDistDir(): string | null {
	const override = readBrandEnv("WEBSITE_DIST")?.trim();
	if (override) {
		return existsSync(join(override, "index.html")) ? override : null;
	}
	const here = dirname(fileURLToPath(import.meta.url));
	const candidates = [
		// Bundled output (dist/cli.js) ships the site next to the web UI.
		resolve(here, "site-www"),
		resolve(here, "../site-www"),
		// Dev / monorepo: backends/runtime/src/site → frontends/pixtiel-site/dist
		resolve(here, "../../../../frontends/pixtiel-site/dist"),
		resolve(here, "../../../frontends/pixtiel-site/dist"),
	];
	for (const candidate of candidates) {
		if (existsSync(join(candidate, "index.html"))) {
			return candidate;
		}
	}
	return null;
}

/** The command that produces what `findSiteDistDir()` looks for. */
export const SITE_BUILD_COMMAND = "pnpm --filter pixtiel-site build";
