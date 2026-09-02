// Which Flowise nodes the Agents tab offers. The list lives in this repo rather than in the
// fork so curating it is a normal PixelOffice change, not a submodule bump.
//
// The fork reads `ENABLED_NODE_CATEGORIES` / `ENABLED_NODES` alongside its own `DISABLED_NODES`
// (`packages/server/src/utils/nodeFilter.ts`). Everything else — `/api/v1/nodes`, the palette,
// the AgentFlow v2 generator — reads the already-filtered pool, so this is the only gate.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { readBrandEnv } from "../brand";

export interface FlowiseNodeAllowlist {
	categories: string[];
	nodes: string[];
	disabledNodes: string[];
}

const EMPTY_ALLOWLIST: FlowiseNodeAllowlist = { categories: [], nodes: [], disabledNodes: [] };

function readStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}
	return value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
}

/**
 * `config/` sits at the package root. The candidates mirror `findFlowiseRoot`'s, because this
 * module ships in the same three layouts: `src/flowise`, `dist/flowise`, and the bundled
 * `dist/cli.js`.
 */
export function resolveFlowiseNodeAllowlistPath(): string | null {
	const override = readBrandEnv("FLOWISE_NODE_ALLOWLIST")?.trim();
	if (override) {
		return override;
	}
	const here = dirname(fileURLToPath(import.meta.url));
	for (const candidate of [resolve(here, "../.."), resolve(here, "../../.."), resolve(here, "..")]) {
		const path = join(candidate, "config", "flowise", "node-allowlist.json");
		if (existsSync(path)) {
			return path;
		}
	}
	return null;
}

/**
 * Missing or malformed file means **no filtering** — the studio comes up with every upstream
 * node. That direction is deliberate: an unreadable list must not be able to hide a node an
 * existing flow depends on. (The opposite of `stack-flags.json`, where unreadable means all
 * flags ON, because there the cost of guessing wrong is only a service that starts.)
 */
export function readFlowiseNodeAllowlist(
	path: string | null = resolveFlowiseNodeAllowlistPath(),
): FlowiseNodeAllowlist {
	if (path === null) {
		return EMPTY_ALLOWLIST;
	}
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
		if (typeof parsed !== "object" || parsed === null) {
			return EMPTY_ALLOWLIST;
		}
		const record = parsed as Record<string, unknown>;
		return {
			categories: readStringArray(record.categories),
			nodes: readStringArray(record.nodes),
			disabledNodes: readStringArray(record.disabledNodes),
		};
	} catch {
		return EMPTY_ALLOWLIST;
	}
}

/** The three env vars the studio reads, omitted entirely when the list says nothing. */
export function buildFlowiseNodeFilterEnv(allowlist: FlowiseNodeAllowlist): Record<string, string> {
	const env: Record<string, string> = {};
	if (allowlist.categories.length > 0) {
		env.ENABLED_NODE_CATEGORIES = allowlist.categories.join(",");
	}
	if (allowlist.nodes.length > 0) {
		env.ENABLED_NODES = allowlist.nodes.join(",");
	}
	if (allowlist.disabledNodes.length > 0) {
		env.DISABLED_NODES = allowlist.disabledNodes.join(",");
	}
	return env;
}
