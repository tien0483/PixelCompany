// Builds the launch environment that makes a Claude Code session's *subagents* bill an
// API seat while the session itself keeps its own (usually OAuth) seat.
//
// How the split works, end to end:
//
//   claude  ANTHROPIC_BASE_URL=http://127.0.0.1:<switchboard>   (no ANTHROPIC_API_KEY, so
//           CLAUDE_CODE_SUBAGENT_MODEL=ccr-<port>,<modelId>      Claude Code keeps sending
//              │                                                its own OAuth bearer)
//              ├─ parent turns   → model is a normal Anthropic id → switchboard forwards
//              │                   to api.anthropic.com with that bearer untouched
//              └─ subagent turns → model is the marker above → switchboard rewrites the
//                                  model to <modelId> and proxies to the seat's router
//
// Claude Code sends `CLAUDE_CODE_SUBAGENT_MODEL` verbatim as the `model` of every subagent
// request, which is the only per-turn signal distinguishing the two, and it is Claude-only
// — no other supported CLI reads that variable.

import { createClineProviderService } from "../cline-sdk/cline-provider-service";
import type { RuntimeTaskLaunchSettings } from "../core/api-contract";
import { ensureCcrSeatRouter } from "../stack/ccr-process";
import { probePort } from "../stack/stack-ports";
import { resolveStackPort } from "../stack/stack-process";

const SWITCHBOARD_HOST = "127.0.0.1";

export interface SubagentSeatEnv {
	ANTHROPIC_BASE_URL: string;
	CLAUDE_CODE_SUBAGENT_MODEL: string;
}

export interface ResolveSubagentSeatEnvDependencies {
	warn: (message: string) => void;
	log?: (message: string) => void;
	/** Injected in tests; defaults to the shared provider facade. */
	resolveSeatCredentials?: (input: {
		providerId: string;
		modelId?: string | null;
	}) => Promise<{ providerId: string; name: string; baseUrl: string; modelId: string; apiKey: string } | null>;
}

/** The marker the switchboard parses back apart. Port first so the split needs no shared state. */
export function buildSubagentModelMarker(port: number, modelId: string): string {
	return `ccr-${String(port)},${modelId}`;
}

let sharedProviderService: ReturnType<typeof createClineProviderService> | null = null;

function getProviderService(): ReturnType<typeof createClineProviderService> {
	sharedProviderService ??= createClineProviderService();
	return sharedProviderService;
}

/**
 * Resolves the env for a card's pinned subagent seat, or null when the split cannot be
 * set up.
 *
 * Null is always a degrade, never a failure: the task still launches, its subagents just
 * bill the card's own seat as they did before. Refusing to start would trade a token-
 * accounting preference for the user's actual work, so every failure path here warns and
 * returns null instead of throwing.
 */
export async function resolveSubagentSeatEnv(
	settings: RuntimeTaskLaunchSettings | undefined,
	deps: ResolveSubagentSeatEnvDependencies,
): Promise<SubagentSeatEnv | null> {
	const providerId = settings?.subagentSeatProviderId?.trim();
	if (!providerId) {
		return null;
	}

	const resolveSeatCredentials =
		deps.resolveSeatCredentials ??
		((input: { providerId: string; modelId?: string | null }) =>
			getProviderService().resolveApiSeatCredentials(input));
	const seat = await resolveSeatCredentials({
		providerId,
		modelId: settings?.subagentSeatModelId ?? null,
	}).catch((error: unknown) => {
		deps.warn(
			`Could not read the ${providerId} API seat (${error instanceof Error ? error.message : String(error)}) — subagents fall back to this task's seat.`,
		);
		return null;
	});
	if (seat === null) {
		deps.warn(
			`API seat ${providerId} has no usable key, endpoint, or model — subagents fall back to this task's seat.`,
		);
		return null;
	}

	// The switchboard performs the parent/subagent split, so without it the marker would
	// reach api.anthropic.com as a nonsense model id and every subagent turn would fail.
	const stackPort = resolveStackPort();
	if (!(await probePort(SWITCHBOARD_HOST, stackPort))) {
		deps.warn(
			`Agent stack switchboard is not listening on ${SWITCHBOARD_HOST}:${String(stackPort)} — subagents fall back to this task's seat.`,
		);
		return null;
	}

	const router = await ensureCcrSeatRouter(
		{ providerId: seat.providerId, baseUrl: seat.baseUrl, apiKey: seat.apiKey },
		{ warn: deps.warn, ...(deps.log ? { log: deps.log } : {}) },
	);
	if (router === null) {
		return null;
	}

	deps.log?.(`Subagents for this task run on API seat ${seat.name} (${seat.modelId}).`);
	return {
		ANTHROPIC_BASE_URL: `http://${SWITCHBOARD_HOST}:${String(stackPort)}`,
		CLAUDE_CODE_SUBAGENT_MODEL: buildSubagentModelMarker(router.port, seat.modelId),
	};
}
