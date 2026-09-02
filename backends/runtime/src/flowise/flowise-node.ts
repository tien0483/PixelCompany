// The studio needs a newer Node than the runtime itself runs on. Flowise 3.1.4 declares
// `engines.node: ^24` and means it: pnpm refuses to install or build under 22 with
// ERR_PNPM_UNSUPPORTED_ENGINE, and `.npmrc`'s `engine-strict = false` does not stop pnpm 11.
// PixelOffice itself runs on 22, so `process.execPath` is the wrong binary to hand the
// studio — hence this lookup.
import { homedir } from "node:os";

import { listNvmNodeVersionDirs } from "../workspace/nvm-versions";

/** Minimum major the studio's own manifest asks for. */
export const MIN_STUDIO_NODE_MAJOR = 24;
const NODE_BINARY_ENV = "PIXELOFFICE_FLOWISE_NODE";

function currentNodeMajor(): number {
	const parsed = Number.parseInt(process.version.replace(/^v/, ""), 10);
	return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Highest `~/.nvm/versions/node/v<major>.*` install that satisfies the minimum. nvm is how
 * node 24 gets onto a box whose default is older, and its layout is stable enough to scan;
 * anything else should be named explicitly through the env var.
 */
function findNvmNodeBinary(minMajor: number, home: string): string | null {
	const entries = listNvmNodeVersionDirs(home);
	const candidates: { major: number; minor: number; patch: number; path: string }[] = [];
	for (const entry of entries) {
		const match = /^v(\d+)\.(\d+)\.(\d+)$/.exec(entry.version);
		if (match === null) {
			continue;
		}
		const major = Number(match[1]);
		if (major < minMajor) {
			continue;
		}
		candidates.push({
			major,
			minor: Number(match[2]),
			patch: Number(match[3]),
			path: entry.nodeBinaryPath,
		});
	}
	if (candidates.length === 0) {
		return null;
	}
	candidates.sort((left, right) => right.major - left.major || right.minor - left.minor || right.patch - left.patch);
	return candidates[0]?.path ?? null;
}

export interface StudioNodeBinary {
	path: string;
	/** False when nothing new enough was found and the runtime's own node is the fallback. */
	satisfiesMinimum: boolean;
}

/**
 * Resolution order: `PIXELOFFICE_FLOWISE_NODE`, then the runtime's own node when it is new
 * enough, then the newest qualifying nvm install, then the runtime's node as a best-effort
 * fallback. The last case is reported rather than fatal — an unbuildable studio already
 * shows up as "not installed", and a studio that somehow runs on an older node is not worth
 * blocking a launch over.
 */
export function resolveStudioNodeBinary(options?: { home?: string; minMajor?: number }): StudioNodeBinary {
	const minMajor = options?.minMajor ?? MIN_STUDIO_NODE_MAJOR;
	const override = process.env[NODE_BINARY_ENV]?.trim();
	if (override) {
		return { path: override, satisfiesMinimum: true };
	}
	if (currentNodeMajor() >= minMajor) {
		return { path: process.execPath, satisfiesMinimum: true };
	}
	const fromNvm = findNvmNodeBinary(minMajor, options?.home ?? homedir());
	if (fromNvm !== null) {
		return { path: fromNvm, satisfiesMinimum: true };
	}
	return { path: process.execPath, satisfiesMinimum: false };
}

export function describeMissingStudioNode(minMajor = MIN_STUDIO_NODE_MAJOR): string[] {
	return [
		`Flowise needs Node ${minMajor}+, but this runtime is on ${process.version}.`,
		`  Install one: nvm install ${minMajor}   (PixelOffice keeps using its own Node)`,
		`  Or name a binary explicitly: ${NODE_BINARY_ENV}=/path/to/node`,
	];
}
