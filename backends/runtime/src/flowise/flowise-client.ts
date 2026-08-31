// HTTP client for the Flowise agent-studio sidecar. Read-only by design: authoring happens
// inside the embedded studio UI, so the runtime only needs "is it up" and "what flows exist"
// — the latter is what the Agents sidebar lists and (Phase 2) what a card can attach as an
// MCP tool.
import type { RuntimeFlowiseFlow, RuntimeFlowiseStatus } from "../core/api-contract";
import { resolveFlowiseBaseUrl } from "./flowise-endpoint";

const REQUEST_TIMEOUT_MS = 5_000;

export interface CreateFlowiseClientDependencies {
	warn: (message: string) => void;
	/** Overrides the resolved base URL; mainly for tests. */
	baseUrl?: string;
}

/** `installed` is decided by the API layer from the submodule on disk, not over HTTP. */
export type FlowiseLiveStatus = Omit<RuntimeFlowiseStatus, "installed">;

export interface FlowiseClient {
	baseUrl: string;
	status: () => Promise<FlowiseLiveStatus>;
	/** Null when the sidecar is unreachable or answered with something unparseable. */
	listFlows: () => Promise<RuntimeFlowiseFlow[] | null>;
}

async function fetchJson(baseUrl: string, path: string): Promise<unknown | null> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
	try {
		const response = await fetch(`${baseUrl}${path}`, { signal: controller.signal });
		if (!response.ok) {
			return null;
		}
		return (await response.json()) as unknown;
	} catch {
		return null;
	} finally {
		clearTimeout(timer);
	}
}

function readString(source: Record<string, unknown>, key: string): string | undefined {
	const value = source[key];
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Upstream's `type` column distinguishes a chatflow from an agentflow, and only an
 * agentflow is what this tab is for — but the column is absent on older rows, so an
 * unknown type is kept rather than filtered out. Deciding what to *show* is the UI's job.
 */
function toFlow(raw: unknown): RuntimeFlowiseFlow | null {
	if (typeof raw !== "object" || raw === null) {
		return null;
	}
	const source = raw as Record<string, unknown>;
	const id = readString(source, "id");
	if (id === undefined) {
		return null;
	}
	const deployed = source.deployed;
	return {
		id,
		name: readString(source, "name") ?? id,
		deployed: deployed === true,
		...(readString(source, "type") ? { type: readString(source, "type") as string } : {}),
		...(readString(source, "category") ? { category: readString(source, "category") as string } : {}),
		...(readString(source, "updatedDate") ? { updatedAt: readString(source, "updatedDate") as string } : {}),
	};
}

export function createFlowiseClient(deps: CreateFlowiseClientDependencies): FlowiseClient {
	const baseUrl = resolveFlowiseBaseUrl(deps.baseUrl);
	return {
		baseUrl,
		status: async (): Promise<FlowiseLiveStatus> => {
			const parsed = await fetchJson(baseUrl, "/api/v1/version");
			if (parsed === null) {
				return { online: false, baseUrl };
			}
			const version =
				typeof parsed === "object" && parsed !== null
					? readString(parsed as Record<string, unknown>, "version")
					: undefined;
			return { online: true, baseUrl, ...(version ? { version } : {}) };
		},
		listFlows: async (): Promise<RuntimeFlowiseFlow[] | null> => {
			const parsed = await fetchJson(baseUrl, "/api/v1/chatflows");
			if (parsed === null) {
				return null;
			}
			if (!Array.isArray(parsed)) {
				deps.warn("Flowise returned a non-array chatflow list — treating the studio as empty.");
				return [];
			}
			const flows: RuntimeFlowiseFlow[] = [];
			for (const entry of parsed) {
				const flow = toFlow(entry);
				if (flow !== null) {
					flows.push(flow);
				}
			}
			flows.sort((left, right) => left.name.localeCompare(right.name));
			return flows;
		},
	};
}
