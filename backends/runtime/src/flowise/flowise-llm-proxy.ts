// Phase 3 stub: route Flowise canvas LLM nodes through the Manager/switchboard seat instead of
// hand-entered Flowise Credentials. Not implemented — flag + status only for now.
import type { RuntimeFlowiseLlmProxyStatus } from "../core/api-contract";

const PROXY_ENV = "PIXELOFFICE_FLOWISE_LLM_PROXY";

export function isFlowiseLlmProxyFlagEnabled(): boolean {
	return process.env[PROXY_ENV]?.trim() === "1";
}

/** Describes Phase 3 proxy readiness. `available` stays false until routing is implemented. */
export function resolveFlowiseLlmProxyStatus(): RuntimeFlowiseLlmProxyStatus {
	const enabled = isFlowiseLlmProxyFlagEnabled();
	const switchboardBaseUrl = process.env.ANTHROPIC_BASE_URL?.trim() || null;
	const hints: string[] = [
		"Phase 3 (not built): bill Flowise Anthropic nodes via Manager seats / switchboard.",
		"Today: add LLM API keys in the Agents tab → Flowise Credentials.",
	];
	if (enabled) {
		hints.unshift(
			`${PROXY_ENV}=1 is set but proxy routing is not implemented yet — studio LLM nodes still need Flowise Credentials.`,
		);
		if (switchboardBaseUrl) {
			hints.push(`Switchboard base URL detected (${switchboardBaseUrl}) — would be the upstream when Phase 3 lands.`);
		}
	}
	return {
		phase: 3,
		enabled,
		available: false,
		switchboardBaseUrl: enabled ? switchboardBaseUrl : null,
		hints,
	};
}
