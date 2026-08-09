// Generates a Claude Code Router config that serves exactly one API seat, for the
// per-task "subagents bill a different seat" split.
//
// Why one config (and one router) per seat: the CCR build vendored in
// `backends/agent_stack` routes **by category** only. A `"<provider>,<model>"` model
// string logs `Unknown model …, using default`, and `routing.rules` entries are ignored,
// so a single router cannot fan out to several seats at once. It can, however, be pinned
// to one provider by giving that provider every category — which is what this file writes.
//
// CCR merges its own shipped defaults (`codewhisperer-primary`, `shuaihong-openai`) into
// whatever config it loads, and those come first, so they win `default` unless they are
// explicitly overridden. Redeclaring them with all-false category mappings is what keeps a
// task's traffic off CodeWhisperer.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { findStackRoot } from "./stack-paths";

/** Every category CCR can route; the seat provider claims all of them. */
const CCR_CATEGORIES = ["default", "background", "thinking", "longcontext", "search"] as const;

/** CCR ships these two and merges them ahead of ours, so they are neutralized by name. */
const CCR_SHIPPED_PROVIDER_IDS = ["codewhisperer-primary", "shuaihong-openai"] as const;

export interface CcrSeatDefinition {
	/** Cline provider id of the API seat; also the CCR provider name and config folder. */
	providerId: string;
	/** Full chat-completions URL. CCR POSTs to this path verbatim, it appends nothing. */
	baseUrl: string;
	apiKey: string;
}

function categoryMappings(enabled: boolean): Record<string, boolean> {
	return Object.fromEntries(CCR_CATEGORIES.map((category) => [category, enabled]));
}

/**
 * CCR's `endpoint` is used verbatim — it does not append `/chat/completions` the way an
 * OpenAI SDK would, so a seat stored as a base ("https://host/v1") has to be completed
 * here or every request 404s.
 */
export function resolveCcrEndpoint(baseUrl: string): string {
	const trimmed = baseUrl.trim().replace(/\/+$/, "");
	if (trimmed.length === 0) {
		return trimmed;
	}
	return /\/(chat\/)?completions$/.test(trimmed) ? trimmed : `${trimmed}/chat/completions`;
}

export function buildCcrSeatConfig(seat: CcrSeatDefinition, port: number, logDir: string): unknown {
	const providers: Record<string, unknown> = {};
	for (const shippedId of CCR_SHIPPED_PROVIDER_IDS) {
		if (shippedId === seat.providerId) {
			continue;
		}
		providers[shippedId] = {
			type: "openai",
			endpoint: "http://127.0.0.1:1",
			authentication: { type: "bearer", credentials: { apiKey: "disabled" } },
			settings: { categoryMappings: categoryMappings(false) },
		};
	}
	providers[seat.providerId] = {
		type: "openai",
		endpoint: resolveCcrEndpoint(seat.baseUrl),
		authentication: { type: "bearer", credentials: { apiKey: seat.apiKey } },
		settings: { categoryMappings: categoryMappings(true) },
	};

	return {
		server: { port, host: "127.0.0.1" },
		routing: { rules: [], defaultProvider: seat.providerId, providers },
		debug: { enabled: false, logLevel: "info", traceRequests: false, saveRequests: false, logDir },
		hooks: [],
	};
}

/** Per-seat config path, kept out of the user's own `ccr-home/.claude-code-router`. */
export function resolveCcrSeatConfigPath(stackRoot: string, providerId: string): string {
	return join(stackRoot, "ccr-home", "seats", providerId, "config-router.json");
}

export interface EnsureCcrSeatConfigResult {
	configPath: string;
	/** False when the file already held this exact config, so a running router can be reused. */
	changed: boolean;
}

/**
 * Writes the seat's router config, returning whether anything actually changed.
 *
 * Idempotence is the point: a task relaunching on an unchanged seat must not force a
 * router restart, which would drop the in-flight sessions of every other task using it.
 */
export async function ensureCcrSeatConfig(input: {
	seat: CcrSeatDefinition;
	port: number;
	stackRoot?: string | null;
}): Promise<EnsureCcrSeatConfigResult | null> {
	const stackRoot = input.stackRoot === undefined ? findStackRoot() : input.stackRoot;
	if (stackRoot === null) {
		return null;
	}
	const configPath = resolveCcrSeatConfigPath(stackRoot, input.seat.providerId);
	const logDir = join(dirname(configPath), "logs");
	const desired = `${JSON.stringify(buildCcrSeatConfig(input.seat, input.port, logDir), null, 2)}\n`;

	const existing = await readFile(configPath, "utf8").catch(() => null);
	if (existing === desired) {
		return { configPath, changed: false };
	}
	await mkdir(dirname(configPath), { recursive: true });
	// The file holds a live API key, so keep it owner-readable even if the umask is loose.
	await writeFile(configPath, desired, { encoding: "utf8", mode: 0o600 });
	return { configPath, changed: true };
}
