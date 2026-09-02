import { getKanbanRuntimeOrigin } from "../core/runtime-endpoint";
import {
	isFlowiseLlmProxyEnabled,
	resolveFlowiseLlmProxyProviderUrl,
} from "../flowise/flowise-llm-proxy-config";

/** Placeholder key OpenMAIC sends; the loopback proxy strips it and injects the Manager seat. */
export const OPENMAIC_SEAT_PLACEHOLDER_KEY = "pixeloffice-seat";

/**
 * Server-managed subscription + media env for the OpenMAIC classroom supervisor.
 * OpenMAIC reads these at process start via `provider-config.ts` (LLM_ENV_MAP / TTS_ENV_MAP).
 */
export function applyOpenmaicClassroomProxyEnv(env: NodeJS.ProcessEnv): void {
	if (!isFlowiseLlmProxyEnabled()) {
		return;
	}
	const openaiBase = `${resolveFlowiseLlmProxyProviderUrl("openai")}/v1`;

	env.OMNIROUTE_API_KEY = OPENMAIC_SEAT_PLACEHOLDER_KEY;
	env.OMNIROUTE_BASE_URL = openaiBase;

	env.ASR_OPENAI_BASE_URL = openaiBase;
	env.ASR_OPENAI_API_KEY = OPENMAIC_SEAT_PLACEHOLDER_KEY;

	env.TTS_OPENAI_BASE_URL = openaiBase;
	env.TTS_OPENAI_API_KEY = OPENMAIC_SEAT_PLACEHOLDER_KEY;
}

/**
 * `ANTHROPIC_*` is stripped on purpose. `scripts/solo.mjs` exports `ANTHROPIC_BASE_URL`
 * for *task agents*; inheriting it would route every OpenMAIC LLM call through the
 * switchboard, and `ANTHROPIC_API_KEY` may be the `sk-dummy-key-*` placeholder.
 */
export function buildOpenmaicClassroomEnv(host: string, port: number): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = {
		...process.env,
		NODE_ENV: "production",
		PORT: String(port),
		PIXTIEL_RUNTIME_ORIGIN: getKanbanRuntimeOrigin(),
		PIXELOFFICE_RUNTIME_ORIGIN: getKanbanRuntimeOrigin(),
		HOSTNAME: host,
		ASR_BROWSER_NATIVE_ENABLED: "true",
	};
	delete env.ANTHROPIC_BASE_URL;
	delete env.ANTHROPIC_API_KEY;
	applyOpenmaicClassroomProxyEnv(env);
	return env;
}
