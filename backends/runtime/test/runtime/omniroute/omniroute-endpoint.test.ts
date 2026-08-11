import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	clearOmniRouteModelCache,
	fetchOmniRouteModelIds,
	OMNIROUTE_FALLBACK_MODEL_ID,
	resolveOmniRouteApiKey,
	resolveOmniRouteBaseUrl,
	resolveOmniRouteHostProviderId,
	resolveOmniRouteModelSelection,
} from "../../../src/omniroute/omniroute-endpoint";

const ENV_KEYS = ["OMNIROUTE_PORT", "OMNIROUTE_BASE_URL", "OMNIROUTE_API_KEY", "OMNIROUTE_HOST_PROVIDER_ID"] as const;

describe("omniroute endpoint resolution", () => {
	const savedEnv = new Map<string, string | undefined>();

	beforeEach(() => {
		for (const key of ENV_KEYS) {
			savedEnv.set(key, process.env[key]);
			delete process.env[key];
		}
		clearOmniRouteModelCache();
	});

	afterEach(() => {
		for (const key of ENV_KEYS) {
			const value = savedEnv.get(key);
			if (value === undefined) {
				delete process.env[key];
			} else {
				process.env[key] = value;
			}
		}
		vi.restoreAllMocks();
	});

	it("defaults to the local router and honours OMNIROUTE_PORT", () => {
		expect(resolveOmniRouteBaseUrl(null)).toBe("http://127.0.0.1:8400/v1");
		process.env.OMNIROUTE_PORT = "9400";
		expect(resolveOmniRouteBaseUrl(null)).toBe("http://127.0.0.1:9400/v1");
	});

	it("prefers saved settings over env over the default base URL", () => {
		process.env.OMNIROUTE_BASE_URL = "http://router.local/v1";
		expect(resolveOmniRouteBaseUrl(null)).toBe("http://router.local/v1");
		expect(resolveOmniRouteBaseUrl({ baseUrl: "http://saved/v1" })).toBe("http://saved/v1");
	});

	it("resolves the API key from settings, oauth slot, then env, else null", () => {
		expect(resolveOmniRouteApiKey(null)).toBeNull();
		process.env.OMNIROUTE_API_KEY = "sk-env";
		expect(resolveOmniRouteApiKey(null)).toBe("sk-env");
		expect(resolveOmniRouteApiKey({ auth: { apiKey: "sk-auth" } })).toBe("sk-auth");
		expect(resolveOmniRouteApiKey({ apiKey: "sk-saved", auth: { apiKey: "sk-auth" } })).toBe("sk-saved");
	});

	it("treats a blank saved key as unset so the launch fails loudly instead of 401ing", () => {
		expect(resolveOmniRouteApiKey({ apiKey: "   " })).toBeNull();
	});

	it("streams under a built-in host provider id, overridable by env", () => {
		expect(resolveOmniRouteHostProviderId()).toBe("openrouter");
		process.env.OMNIROUTE_HOST_PROVIDER_ID = "  LiteLLM ";
		expect(resolveOmniRouteHostProviderId()).toBe("litellm");
	});
});

describe("fetchOmniRouteModelIds", () => {
	beforeEach(() => {
		clearOmniRouteModelCache();
	});

	afterEach(() => {
		vi.restoreAllMocks();
		clearOmniRouteModelCache();
	});

	it("reads ids from an OpenAI-compatible catalog, dedupes, and sends the key", async () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(
				JSON.stringify({
					data: [{ id: "auto/best-coding" }, { id: "dva/claude-opus-4-6" }, { id: "auto/best-coding" }],
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			),
		);

		const modelIds = await fetchOmniRouteModelIds({ baseUrl: "http://127.0.0.1:8400/v1/", apiKey: "sk-test" });

		expect(modelIds).toEqual(["auto/best-coding", "dva/claude-opus-4-6"]);
		const [url, init] = fetchSpy.mock.calls[0] ?? [];
		expect(url).toBe("http://127.0.0.1:8400/v1/models");
		expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer sk-test");
	});

	it("caches within the TTL so a seat listing does not re-poll the router", async () => {
		const fetchSpy = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(new Response(JSON.stringify({ data: [{ id: "auto/best-coding" }] }), { status: 200 }));

		await fetchOmniRouteModelIds({ baseUrl: "http://127.0.0.1:8400/v1", apiKey: "sk-test" });
		await fetchOmniRouteModelIds({ baseUrl: "http://127.0.0.1:8400/v1", apiKey: "sk-test" });

		expect(fetchSpy).toHaveBeenCalledTimes(1);
	});

	it("returns an empty list (never throws) when the router rejects or is offline", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(JSON.stringify({ error: { code: "invalid_api_key" } }), { status: 401 }),
		);
		const warn = vi.fn();
		expect(await fetchOmniRouteModelIds({ baseUrl: "http://127.0.0.1:8400/v1", apiKey: null, onWarn: warn })).toEqual(
			[],
		);
		expect(warn).toHaveBeenCalled();

		clearOmniRouteModelCache();
		vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));
		expect(await fetchOmniRouteModelIds({ baseUrl: "http://127.0.0.1:8400/v1", apiKey: "sk-test" })).toEqual([]);
	});
});

describe("resolveOmniRouteModelSelection", () => {
	it("keeps a saved model the router still serves", () => {
		expect(
			resolveOmniRouteModelSelection({
				savedModelId: "dva/claude-opus-4-6",
				modelIds: ["auto/best-coding", "dva/claude-opus-4-6"],
			}),
		).toEqual({ modelId: "dva/claude-opus-4-6", warning: null });
	});

	it("replaces an unpinned saved model the router no longer serves, and says so", () => {
		const selection = resolveOmniRouteModelSelection({
			savedModelId: "anthropic/claude-sonnet-4-5",
			modelIds: ["auto/best-coding", "oc/deepseek-v4-flash-free"],
		});
		expect(selection.modelId).toBe(OMNIROUTE_FALLBACK_MODEL_ID);
		expect(selection.warning).toContain("anthropic/claude-sonnet-4-5");
	});

	it("never replaces an explicitly pinned model, even when unlisted", () => {
		const selection = resolveOmniRouteModelSelection({
			savedModelId: "anthropic/claude-sonnet-4-5",
			modelIds: ["auto/best-coding", "oc/deepseek-v4-flash-free"],
			pinned: true,
		});
		expect(selection.modelId).toBe("anthropic/claude-sonnet-4-5");
		expect(selection.warning).toContain("anthropic/claude-sonnet-4-5");
	});

	it("falls back to the first live id when no auto alias exists", () => {
		expect(resolveOmniRouteModelSelection({ savedModelId: null, modelIds: ["oc/deepseek-v4-flash-free"] })).toEqual({
			modelId: "oc/deepseek-v4-flash-free",
			warning: null,
		});
	});

	it("keeps the saved model when the catalog is unreachable", () => {
		expect(resolveOmniRouteModelSelection({ savedModelId: "oc/whatever", modelIds: [] })).toEqual({
			modelId: "oc/whatever",
			warning: null,
		});
		expect(resolveOmniRouteModelSelection({ savedModelId: null, modelIds: [] })).toEqual({
			modelId: OMNIROUTE_FALLBACK_MODEL_ID,
			warning: null,
		});
	});
});
