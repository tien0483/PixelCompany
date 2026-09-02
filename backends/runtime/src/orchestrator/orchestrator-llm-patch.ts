// Per-launch dsh patch overlay that points the harness's own LLM at PixelOffice's seat-backed
// proxy, so a Custom Agent card runs on the Manager seat it already pins instead of needing a
// DeepSeek key. dsh ships `@deepseek-ai/dsh-llm-pi-ai` mounted but unconfigured (it registers no
// routes), and `agent-default-model` points at `deepseek-official`; this overlay configures the
// first and repoints the second.
//
// Both ids already exist in the composed tree, so these are plain override rows — `insert:` is
// only for new ids (see orchestrator-flowise-patch.ts, which does add one).
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readBrandEnv } from "../brand";
import { isFlowiseLlmProxyEnabled, resolveFlowiseLlmProxyProviderUrl } from "../flowise/flowise-llm-proxy-config";

/** Seat-backed proxy routes, plus `deepseek` meaning "leave dsh's own default alone". */
export type OrchestratorLlmProvider = "cursor" | "openai" | "anthropic" | "gemini" | "deepseek";

/**
 * The proxy strips the caller's `authorization` and injects the seat credential, so this value is
 * never sent anywhere — but pi-ai resolves `apiKeyEnv` per request and fails a configured
 * reference that resolves to nothing, so the route needs *some* credential to exist.
 */
export const ORCHESTRATOR_LLM_PROXY_TOKEN_ENV = "PIXELOFFICE_DSH_LLM_PROXY_TOKEN";
const PROXY_TOKEN_PLACEHOLDER = "pixeloffice-seat-proxy";

interface ProviderWiring {
	/** pi-ai catalog route name — decides the wire protocol and model catalog. */
	piAiRoute: string;
	/** Appended to the proxy's `/{provider}` prefix to match that route's expected base. */
	baseUrlSuffix: string;
	defaultModel: string;
	/**
	 * Declared outright rather than inherited. The seat routes serve ids pi-ai's shipped catalog
	 * does not know (`auto/best-coding` is OmniRoute's, not OpenAI's), and an undeclared id fails
	 * at resolution with `UNKNOWN_MODEL: pi-ai provider "openai" has no configured model …`
	 * before any request goes out. Capacities are what `GET /v1/models` reports through the proxy.
	 */
	contextWindow: number;
	maxTokens: number;
}

/**
 * Verified against the live proxy on 2026-09-01: `/cursor` and `/openai` answer
 * `GET /v1/models` and `POST /v1/chat/completions` with 200 (both reach the same OmniRoute
 * upstream); `/anthropic` reaches Anthropic with the seat's bearer accepted; `/gemini` currently
 * fails upstream with `ACCESS_TOKEN_SCOPE_INSUFFICIENT` — the wiring is right, the seat token is
 * not scoped for generativelanguage.googleapis.com.
 */
const PROVIDER_WIRING: Record<Exclude<OrchestratorLlmProvider, "deepseek">, ProviderWiring> = {
	cursor: {
		piAiRoute: "openai",
		baseUrlSuffix: "/v1",
		defaultModel: "auto/best-coding",
		contextWindow: 1_000_000,
		maxTokens: 384_000,
	},
	openai: {
		piAiRoute: "openai",
		baseUrlSuffix: "/v1",
		defaultModel: "auto/best-coding",
		contextWindow: 1_000_000,
		maxTokens: 384_000,
	},
	anthropic: {
		piAiRoute: "anthropic",
		baseUrlSuffix: "",
		defaultModel: "claude-sonnet-4-5",
		contextWindow: 200_000,
		maxTokens: 64_000,
	},
	gemini: {
		piAiRoute: "google",
		baseUrlSuffix: "/v1beta",
		defaultModel: "gemini-2.5-flash",
		contextWindow: 1_048_576,
		maxTokens: 65_536,
	},
};

const DEFAULT_PROVIDER: OrchestratorLlmProvider = "cursor";

export function resolveOrchestratorLlmProvider(): OrchestratorLlmProvider {
	const raw = readBrandEnv("DSH_LLM_PROVIDER")?.trim().toLowerCase();
	if (raw === "deepseek" || raw === "off" || raw === "0") {
		return "deepseek";
	}
	if (raw === "cursor" || raw === "openai" || raw === "anthropic" || raw === "gemini") {
		return raw;
	}
	return DEFAULT_PROVIDER;
}

export interface PrepareOrchestratorLlmPatchInput {
	log?: (message: string) => void;
}

export interface PreparedOrchestratorLlmPatch {
	patchPath: string;
	provider: OrchestratorLlmProvider;
	model: string;
	/** Merged into the launch env so pi-ai's `apiKeyEnv` reference resolves. */
	env: Record<string, string>;
	cleanup: () => Promise<void>;
}

/**
 * Returns null when the card should keep dsh's shipped DeepSeek route — either the proxy is off
 * or the operator asked for `deepseek` explicitly. Never throws.
 */
export async function prepareOrchestratorLlmPatch(
	input: PrepareOrchestratorLlmPatchInput = {},
): Promise<PreparedOrchestratorLlmPatch | null> {
	const provider = resolveOrchestratorLlmProvider();
	if (provider === "deepseek") {
		return null;
	}
	if (!isFlowiseLlmProxyEnabled()) {
		return null;
	}
	const wiring = PROVIDER_WIRING[provider];
	const model = readBrandEnv("DSH_LLM_MODEL")?.trim() || wiring.defaultModel;
	const baseURL = `${resolveFlowiseLlmProxyProviderUrl(provider)}${wiring.baseUrlSuffix}`;

	const rows = [
		{
			id: "llm-pi-ai",
			config: {
				providers: {
					[wiring.piAiRoute]: {
						apiKeyEnv: ORCHESTRATOR_LLM_PROXY_TOKEN_ENV,
						baseURL,
						models: [
							{
								id: model,
								name: `PixelOffice ${provider} seat`,
								contextWindow: wiring.contextWindow,
								maxTokens: wiring.maxTokens,
							},
						],
					},
				},
			},
		},
		{ id: "agent-default-model", config: { provider: wiring.piAiRoute, model } },
	];

	// YAML is a superset of JSON, and the loader parses YAML — no serializer dependency needed.
	const dir = await mkdtemp(join(tmpdir(), "pixeloffice-dsh-llm-"));
	const patchPath = join(dir, "llm.patch.yml");
	await writeFile(patchPath, JSON.stringify(rows, null, 2), "utf8");
	input.log?.(`Custom Agent LLM: ${provider} seat via ${baseURL} (model ${model}).`);

	return {
		patchPath,
		provider,
		model,
		env: { [ORCHESTRATOR_LLM_PROXY_TOKEN_ENV]: PROXY_TOKEN_PLACEHOLDER },
		cleanup: async () => {
			await rm(dir, { recursive: true, force: true }).catch(() => {});
		},
	};
}
