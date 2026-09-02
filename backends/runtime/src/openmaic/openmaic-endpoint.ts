// Shared host/port/base-URL/root resolution for the OpenMAIC learning sidecar, so the
// process supervisor (which spawns it) and the API layer (which reports on it) never drift
// onto different env-var ladders. Same shape as `flowise/flowise-endpoint.ts`.
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { readBrandEnv } from "../brand";
import { resolvePixelOfficeEmbedOrigins } from "../flowise/flowise-embed-origins";

export const DEFAULT_OPENMAIC_HOST = "127.0.0.1";
/**
 * Clear of every port already claimed here: 3000 is Flowise upstream's default, 3001 the
 * DevTools daemon, 3010 the Flowise studio, 3456/3460+ CCR and the per-seat routers,
 * 5273+ the UA viewers, 8321 Manager, 8400 OmniRoute, 8787 Headroom.
 */
export const DEFAULT_OPENMAIC_PORT = 3020;

/**
 * Resolution order: an explicit `configured` value, then the port embedded in
 * `PIXTIEL_OPENMAIC_URL` / `PIXELOFFICE_OPENMAIC_URL`, then `PIXTIEL_OPENMAIC_PORT` / `PIXELOFFICE_OPENMAIC_PORT`, then the default port.
 */
export function resolveOpenmaicPort(configured: number | undefined): number {
	if (configured !== undefined) {
		return configured;
	}
	const fromUrl = readBrandEnv("OPENMAIC_URL")?.trim();
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
	const fromPortEnv = readBrandEnv("OPENMAIC_PORT")?.trim();
	if (fromPortEnv && /^\d+$/.test(fromPortEnv)) {
		return Number(fromPortEnv);
	}
	return DEFAULT_OPENMAIC_PORT;
}

/**
 * Resolution order: an explicit `configured` URL, then `PIXTIEL_OPENMAIC_URL` / `PIXELOFFICE_OPENMAIC_URL` verbatim,
 * then `http://127.0.0.1:<resolveOpenmaicPort()>` — so a bare `PIXTIEL_OPENMAIC_PORT` / `PIXELOFFICE_OPENMAIC_PORT`
 * override (with no `_URL` set) reaches the API layer the same way it reaches the supervisor.
 *
 * This URL is also what the browser loads: the classroom is embedded cross-origin rather
 * than through an `/api/*-proxy/` route, for the reason `flowise-endpoint.ts` records —
 * those proxies buffer to text and the WS-upgrade allowlist drops every path but the
 * runtime's own, and Next.js serves a bundle plus streaming responses.
 */
export function resolveOpenmaicBaseUrl(configured: string | undefined): string {
	const fromUrl = configured ?? readBrandEnv("OPENMAIC_URL")?.trim();
	if (fromUrl) {
		return fromUrl.replace(/\/$/, "");
	}
	return `http://${DEFAULT_OPENMAIC_HOST}:${resolveOpenmaicPort(undefined)}`;
}

/**
 * Locates the `backends/openmaic` submodule next to the runtime. Mirrors
 * `findFlowiseRoot()`'s candidate walk so the monorepo source layout and the bundled
 * `dist/cli.js` layout both resolve.
 *
 * Returns null when the submodule was never initialized — the common case on a fresh
 * clone, and the reason Learning is gated on presence instead of on a `stack-flags.json`
 * key: an unreadable flags file means *every* flag is on, which would auto-start a heavy
 * service nobody installed.
 */
export function findOpenmaicRoot(): string | null {
	const override = readBrandEnv("OPENMAIC_ROOT")?.trim();
	if (override) {
		return existsSync(join(override, "package.json")) ? override : null;
	}
	const here = dirname(fileURLToPath(import.meta.url));
	const candidates = [
		// Dev / monorepo: backends/runtime/src/openmaic → backends/openmaic
		resolve(here, "../../../openmaic"),
		// tsc output: backends/runtime/dist/openmaic → backends/openmaic
		resolve(here, "../../../../openmaic"),
		// Bundled dist/cli.js sitting in backends/runtime/dist
		resolve(here, "../../openmaic"),
	];
	for (const candidate of candidates) {
		if (existsSync(join(candidate, "package.json"))) {
			return candidate;
		}
	}
	return null;
}

/**
 * OpenMAIC is a Next.js app started with `next start`, which serves the prebuilt `.next`
 * and exits immediately if it is missing. Presence of the submodule is therefore not
 * enough to launch on — "cloned but never built" is its own state, and the Learning tab
 * names the two commands that fix it.
 */
export function isOpenmaicBuilt(openmaicRoot: string): boolean {
	return existsSync(join(openmaicRoot, ".next", "BUILD_ID"));
}

/**
 * The env var upstream reads to allow embedding: when set it drops `X-Frame-Options` and
 * widens the CSP to `frame-ancestors 'self' <value>` (`next.config.ts` `headers()`).
 *
 * It must be present at **build** time, not at `next start` — Next evaluates `headers()`
 * while building and bakes the result into `.next/routes-manifest.json`. Setting it in the
 * spawn env does nothing, which is why the supervisor cannot repair a bad build and checks
 * for one instead.
 */
export const OPENMAIC_FRAME_ANCESTORS_ENV = "ALLOWED_FRAME_ANCESTORS";

/**
 * The origins allowed to frame the classroom, space-separated as CSP requires.
 *
 * Deliberately the same host set the Flowise studio embeds from, so the two sidecars cannot
 * disagree about what "this PixelOffice" means — the only difference is the separator, since
 * Flowise's env takes commas and `frame-ancestors` takes spaces.
 */
export function resolveOpenmaicFrameAncestors(pixelOfficePort: string): string {
	return resolvePixelOfficeEmbedOrigins(pixelOfficePort).split(",").join(" ");
}

/**
 * Whether the build allows this PixelOffice to frame it.
 *
 * A classroom built without `ALLOWED_FRAME_ANCESTORS` serves `X-Frame-Options: SAMEORIGIN`,
 * and PixelOffice is a different origin (`:3484` vs `:3020`) — so the browser silently
 * renders a blank frame with no server-side error anywhere. Reading the baked manifest is
 * the only way to tell before a human sees the blank box.
 *
 * Substring rather than a schema walk on purpose: the manifest's header shape is Next's
 * private contract, and the question here is only "was this header baked in at all".
 */
export function isOpenmaicBuiltForEmbedding(openmaicRoot: string): boolean {
	const manifest = join(openmaicRoot, ".next", "routes-manifest.json");
	if (!existsSync(manifest)) {
		return false;
	}
	try {
		return !readFileSync(manifest, "utf8").includes('"X-Frame-Options"');
	} catch {
		return false;
	}
}

/** Where this supervisor writes — currently just `classroom.log`. */
export const OPENMAIC_DATA_DIR_NAME = ".openmaic";

export function resolveOpenmaicDataDir(openmaicRoot: string): string {
	return join(openmaicRoot, OPENMAIC_DATA_DIR_NAME);
}

/**
 * Keeps `.openmaic/` from showing up as a dirty submodule forever.
 *
 * The repo-root `.gitignore` cannot do this: git refuses to evaluate ignore rules for a
 * path inside a submodule ("Pathspec ... is in submodule"), and upstream's own `.gitignore`
 * has never heard of this directory. `.git/info/exclude` is the one place a superproject
 * can ignore something inside a submodule without editing a file that belongs to upstream.
 *
 * Best-effort throughout: failing to write an exclude is cosmetic, and must never stop the
 * classroom from starting.
 */
export function ensureOpenmaicDataDirExcluded(openmaicRoot: string): void {
	const entry = `/${OPENMAIC_DATA_DIR_NAME}/`;
	try {
		// A submodule's `.git` is a file holding `gitdir: <path>`, relative to the submodule.
		const dotGit = join(openmaicRoot, ".git");
		if (!existsSync(dotGit)) {
			return;
		}
		let gitDir = dotGit;
		if (statSync(dotGit).isFile()) {
			const pointer = readFileSync(dotGit, "utf8").trim();
			const match = /^gitdir:\s*(.+)$/.exec(pointer);
			if (match?.[1] === undefined) {
				return;
			}
			gitDir = resolve(openmaicRoot, match[1]);
		}
		const infoDir = join(gitDir, "info");
		const excludePath = join(infoDir, "exclude");
		const existing = existsSync(excludePath) ? readFileSync(excludePath, "utf8") : "";
		if (existing.split("\n").some((line) => line.trim() === entry)) {
			return;
		}
		mkdirSync(infoDir, { recursive: true });
		const prefix = existing.length === 0 || existing.endsWith("\n") ? "" : "\n";
		appendFileSync(excludePath, `${prefix}# PixelOffice: the runtime's classroom log lives here.\n${entry}\n`);
	} catch {
		// Cosmetic only — see above.
	}
}
