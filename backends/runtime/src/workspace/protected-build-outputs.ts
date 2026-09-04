import { existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { findFlowiseRoot } from "../flowise/flowise-endpoint";
import { findOpenmaicRoot } from "../openmaic/openmaic-endpoint";
import { getWebUiDir } from "../server/assets";
import { findSiteDistDir, SITE_BUILD_COMMAND } from "../site/site-endpoint";

export interface ProtectedBuildOutput {
	path: string;
	/** Shown verbatim in the cleanup dialog's "Kept" list, so it names the rebuild command. */
	reason: string;
}

const FLOWISE_OUTPUT_DIR_NAMES = ["dist", "build"] as const;

const WEB_UI_REASON = "Serves the PixelOffice UI — rebuild with `pnpm build`.";
const RUNTIME_DIST_REASON = "The running runtime is loaded from here — rebuild with `pnpm --filter kanban build`.";
const SITE_DIST_REASON = `Serves the Docs tab — rebuild with \`${SITE_BUILD_COMMAND}\`.`;
const OPENMAIC_REASON = "Serves the Learning tab — rebuild with `CI=true npx pnpm@10.28.0 build` in backends/openmaic.";
const FLOWISE_REASON = "Serves the Agents tab — rebuild with `cd backends/flowise && pnpm build`.";

/**
 * Where a PixelOffice checkout keeps the outputs its own servers read from.
 *
 * The resolvers below answer "what is *this* process serving", which is authoritative
 * but only covers one checkout. A dev runtime started from a task worktree would
 * otherwise happily offer the home repo's live `dist` for deletion, so every scanned
 * root that looks like a PixelOffice checkout gets these withheld as well.
 */
const PIXELOFFICE_SERVED_OUTPUTS: { relativePath: string; reason: string }[] = [
	{ relativePath: join("frontends", "pixel_office", "dist"), reason: WEB_UI_REASON },
	{ relativePath: join("backends", "runtime", "dist"), reason: RUNTIME_DIST_REASON },
	{ relativePath: join("frontends", "pixtiel-site", "dist"), reason: SITE_DIST_REASON },
	{ relativePath: join("backends", "openmaic", ".next"), reason: OPENMAIC_REASON },
];

/** Present in a PixelOffice checkout and nowhere else, so unrelated projects are untouched. */
const PIXELOFFICE_CHECKOUT_MARKER = join("frontends", "pixel_office", "package.json");

/**
 * The runtime's own compiled output, which is what the process is running from
 * whenever it was started from a build rather than from `tsx`.
 *
 * `here` is `backends/runtime/src/workspace` in dev, `backends/runtime/dist/workspace`
 * after tsc, and `backends/runtime/dist` for the bundled `dist/cli.js` — so the first
 * candidate covers the first two and `here` itself covers the third.
 */
function findRuntimeDistDir(): string | null {
	const here = dirname(fileURLToPath(import.meta.url));
	for (const candidate of [resolve(here, "../../dist"), here]) {
		if (candidate.endsWith(`${sep}dist`) && existsSync(candidate)) {
			return candidate;
		}
	}
	return null;
}

function collectFlowisePackageOutputs(flowiseRoot: string | null): ProtectedBuildOutput[] {
	if (!flowiseRoot) {
		return [];
	}
	const packagesDir = join(flowiseRoot, "packages");
	let packageNames: string[];
	try {
		packageNames = readdirSync(packagesDir);
	} catch {
		return [];
	}
	const outputs: ProtectedBuildOutput[] = [];
	for (const packageName of packageNames) {
		for (const dirName of FLOWISE_OUTPUT_DIR_NAMES) {
			const path = join(packagesDir, packageName, dirName);
			if (!existsSync(path)) {
				continue;
			}
			outputs.push({ path, reason: FLOWISE_REASON });
		}
	}
	return outputs;
}

/**
 * Build outputs the runtime itself serves or spawns from, so cleanup can never blank
 * one of its own tabs.
 *
 * Every entry comes from the resolver the corresponding server uses, not from a
 * hardcoded path: the list cannot drift out of step with where those servers actually
 * read from, and it is empty for surfaces that were never built.
 *
 * These are all gitignored, so `git check-ignore` — the guard that protects vendored
 * `dist` directories — says nothing about them. This is the second, independent guard.
 */
export function listProtectedBuildOutputs(scannedRoots: readonly string[] = []): ProtectedBuildOutput[] {
	const outputs: ProtectedBuildOutput[] = [];

	outputs.push({ path: getWebUiDir(), reason: WEB_UI_REASON });

	const runtimeDist = findRuntimeDistDir();
	if (runtimeDist) {
		outputs.push({ path: runtimeDist, reason: RUNTIME_DIST_REASON });
	}

	const siteDist = findSiteDistDir();
	if (siteDist) {
		outputs.push({ path: siteDist, reason: SITE_DIST_REASON });
	}

	const openmaicRoot = findOpenmaicRoot();
	if (openmaicRoot) {
		// `.next` only, never `.next/cache`: the classroom keeps serving with its cache
		// gone, and that cache is the larger half of the directory.
		outputs.push({ path: join(openmaicRoot, ".next"), reason: OPENMAIC_REASON });
	}

	outputs.push(...collectFlowisePackageOutputs(findFlowiseRoot()));

	for (const root of scannedRoots) {
		if (!existsSync(join(root, PIXELOFFICE_CHECKOUT_MARKER))) {
			continue;
		}
		for (const served of PIXELOFFICE_SERVED_OUTPUTS) {
			outputs.push({ path: join(root, served.relativePath), reason: served.reason });
		}
		outputs.push(...collectFlowisePackageOutputs(join(root, "backends", "flowise")));
	}

	return outputs;
}

/**
 * The protected entry a candidate path would take with it, or null.
 *
 * Matches the candidate itself and any *ancestor* of a protected path — deleting
 * `backends/flowise/packages` would take every package's `dist` with it — but
 * deliberately not paths *inside* one, so `<openmaic>/.next/cache` stays reclaimable
 * while `<openmaic>/.next` does not.
 */
export function findProtectedBuildOutput(
	candidatePath: string,
	protectedOutputs: readonly ProtectedBuildOutput[],
): ProtectedBuildOutput | null {
	const candidate = resolve(candidatePath);
	for (const output of protectedOutputs) {
		const protectedPath = resolve(output.path);
		if (candidate === protectedPath || protectedPath.startsWith(candidate + sep)) {
			return output;
		}
	}
	return null;
}
