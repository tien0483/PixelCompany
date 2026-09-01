import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it } from "vitest";

import {
	ORCHESTRATOR_LLM_PROXY_TOKEN_ENV,
	prepareOrchestratorLlmPatch,
	resolveOrchestratorLlmProvider,
} from "../../../src/orchestrator/orchestrator-llm-patch";

interface OverrideRow {
	id: string;
	config: Record<string, unknown>;
}

function readRows(patchPath: string): OverrideRow[] {
	return JSON.parse(readFileSync(patchPath, "utf8")) as OverrideRow[];
}

const SAVED = {
	provider: process.env.PIXELOFFICE_DSH_LLM_PROVIDER,
	model: process.env.PIXELOFFICE_DSH_LLM_MODEL,
	proxy: process.env.PIXELOFFICE_FLOWISE_LLM_PROXY,
};

function restore(name: keyof typeof SAVED, envName: string): void {
	const saved = SAVED[name];
	if (saved === undefined) {
		delete process.env[envName];
	} else {
		process.env[envName] = saved;
	}
}

describe("prepareOrchestratorLlmPatch", () => {
	afterEach(() => {
		restore("provider", "PIXELOFFICE_DSH_LLM_PROVIDER");
		restore("model", "PIXELOFFICE_DSH_LLM_MODEL");
		restore("proxy", "PIXELOFFICE_FLOWISE_LLM_PROXY");
	});

	it("defaults to the cursor seat and overrides both existing rows", async () => {
		delete process.env.PIXELOFFICE_DSH_LLM_PROVIDER;
		delete process.env.PIXELOFFICE_DSH_LLM_MODEL;
		delete process.env.PIXELOFFICE_FLOWISE_LLM_PROXY;

		const prepared = await prepareOrchestratorLlmPatch();
		expect(prepared).not.toBeNull();
		expect(prepared?.provider).toBe("cursor");
		expect(prepared?.model).toBe("auto/best-coding");
		expect(prepared?.env[ORCHESTRATOR_LLM_PROXY_TOKEN_ENV]).toBeTruthy();

		const rows = readRows(prepared?.patchPath ?? "");
		// `llm-pi-ai` and `agent-default-model` both already exist in the composed tree, so these
		// are overrides — a bare entry is correct here and `insert:` would be wrong.
		expect(rows.map((row) => row.id)).toEqual(["llm-pi-ai", "agent-default-model"]);

		const openai = (rows[0]?.config.providers as Record<string, Record<string, unknown>>).openai;
		expect(openai.apiKeyEnv).toBe(ORCHESTRATOR_LLM_PROXY_TOKEN_ENV);
		expect(String(openai.baseURL)).toMatch(/\/api\/flowise-llm-proxy\/cursor\/v1$/);
		// Declared outright: `auto/best-coding` is OmniRoute's id, absent from pi-ai's openai
		// catalog, and an undeclared id fails with UNKNOWN_MODEL before any request goes out.
		expect(openai.models).toEqual([expect.objectContaining({ id: "auto/best-coding", contextWindow: 1_000_000 })]);
		expect(rows[1]?.config).toEqual({ provider: "openai", model: "auto/best-coding" });

		await prepared?.cleanup();
	});

	it("maps gemini onto pi-ai's google route with the /v1beta base", async () => {
		process.env.PIXELOFFICE_DSH_LLM_PROVIDER = "gemini";
		delete process.env.PIXELOFFICE_DSH_LLM_MODEL;

		const prepared = await prepareOrchestratorLlmPatch();
		const rows = readRows(prepared?.patchPath ?? "");
		const google = (rows[0]?.config.providers as Record<string, Record<string, unknown>>).google;
		expect(String(google.baseURL)).toMatch(/\/api\/flowise-llm-proxy\/gemini\/v1beta$/);
		expect(rows[1]?.config).toEqual({ provider: "google", model: "gemini-2.5-flash" });

		await prepared?.cleanup();
	});

	it("honours an explicit model override", async () => {
		process.env.PIXELOFFICE_DSH_LLM_PROVIDER = "anthropic";
		process.env.PIXELOFFICE_DSH_LLM_MODEL = "claude-opus-4-6";

		const prepared = await prepareOrchestratorLlmPatch();
		expect(prepared?.model).toBe("claude-opus-4-6");
		const rows = readRows(prepared?.patchPath ?? "");
		expect(rows[1]?.config).toEqual({ provider: "anthropic", model: "claude-opus-4-6" });

		await prepared?.cleanup();
	});

	it("keeps dsh's own DeepSeek route when asked, or when the proxy is off", async () => {
		process.env.PIXELOFFICE_DSH_LLM_PROVIDER = "deepseek";
		expect(resolveOrchestratorLlmProvider()).toBe("deepseek");
		expect(await prepareOrchestratorLlmPatch()).toBeNull();

		delete process.env.PIXELOFFICE_DSH_LLM_PROVIDER;
		process.env.PIXELOFFICE_FLOWISE_LLM_PROXY = "0";
		expect(await prepareOrchestratorLlmPatch()).toBeNull();
	});
});
