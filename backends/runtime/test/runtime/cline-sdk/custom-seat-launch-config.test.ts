// Launch-config resolution for user-added (models.json) seats such as FPT.AI.
// These seats are NOT OmniRoute: OmniRoute is just the first one that needed the
// borrowed-built-in-host swap. See src/cline-sdk/custom-seat-host.ts.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// vi.hoisted runs before the module's own imports, so this path is built from env only.
const settingsDir = vi.hoisted(() => `${process.env.TMPDIR ?? "/tmp"}/custom-seat-launch-config-test`);

const providerMocks = vi.hoisted(() => ({
	getProviderSettings: vi.fn(),
	getLastUsedProviderSettings: vi.fn(),
	addLocalProvider: vi.fn(),
	hasProvider: vi.fn(() => false),
}));

const BUILT_IN_PROVIDER_IDS = new Set(["anthropic", "cline", "openrouter", "litellm", "groq", "openai-native"]);

vi.mock("@clinebot/core", () => ({
	addLocalProvider: providerMocks.addLocalProvider,
	isBuiltInProviderId: (providerId: string) => BUILT_IN_PROVIDER_IDS.has(providerId),
	normalizeProviderId: (providerId: string) => providerId,
	ensureCustomProvidersLoaded: vi.fn(),
	getLocalProviderModels: vi.fn(async () => ({ providerId: "", models: [] })),
	getValidClineCredentials: vi.fn(),
	getValidOcaCredentials: vi.fn(),
	getValidOpenAICodexCredentials: vi.fn(),
	loginClineOAuth: vi.fn(),
	loginOcaOAuth: vi.fn(),
	loginOpenAICodex: vi.fn(),
	resolveDefaultMcpSettingsPath: vi.fn(),
	resolveClineDataDir: vi.fn(() => settingsDir),
	loadMcpSettingsFile: vi.fn(),
	ClineAccountService: class {},
	ProviderSettingsManager: class {
		saveProviderSettings = vi.fn();
		getProviderSettings = providerMocks.getProviderSettings;
		getLastUsedProviderSettings = providerMocks.getLastUsedProviderSettings;
		getProviderConfig = vi.fn(() => undefined);
		getFilePath = vi.fn(() => join(settingsDir, "providers.json"));
		read = vi.fn(() => ({ providers: {} }));
		write = vi.fn();
	},
	Llms: {
		hasProvider: providerMocks.hasProvider,
		getAllProviders: vi.fn(() => []),
		getModelsForProvider: vi.fn(() => []),
		unregisterProvider: vi.fn(),
	},
	LlmsModels: {
		CLINE_DEFAULT_MODEL: "anthropic/claude-sonnet-4.6",
		getAllProviders: vi.fn(() => []),
		getModelsForProvider: vi.fn(() => []),
	},
	LlmsProviders: { supportsModelThinking: vi.fn(() => false) },
	InMemoryMcpManager: class {},
	createMcpTools: vi.fn(async () => []),
	DEFAULT_EXTERNAL_IDCS_CLIENT_ID: "",
	DEFAULT_EXTERNAL_IDCS_SCOPES: "",
	DEFAULT_EXTERNAL_IDCS_URL: "",
	DEFAULT_INTERNAL_IDCS_CLIENT_ID: "",
	DEFAULT_INTERNAL_IDCS_SCOPES: "",
	DEFAULT_INTERNAL_IDCS_URL: "",
}));

vi.mock("../../../src/server/browser.js", () => ({
	openInBrowser: vi.fn(),
}));

import { createClineProviderService } from "../../../src/cline-sdk/cline-provider-service";

describe("resolveLaunchConfig – generic custom seats", () => {
	const FPT_SETTINGS = {
		provider: "fpt-ai",
		model: "fpt/llama-3.3-70b",
		baseUrl: "https://mkp-api.fptcloud.com/v1",
		apiKey: "sk-fpt-test",
	};

	beforeEach(() => {
		vi.clearAllMocks();
		delete process.env.CLINE_CUSTOM_SEAT_HOST_PROVIDER_ID;
		providerMocks.hasProvider.mockReturnValue(true);
		providerMocks.getLastUsedProviderSettings.mockReturnValue(FPT_SETTINGS);
		providerMocks.getProviderSettings.mockImplementation((providerId: string) =>
			providerId === "fpt-ai" ? FPT_SETTINGS : undefined,
		);
	});

	// Without the swap the first turn dies with `Unknown or disabled provider "fpt-ai"`: the SDK
	// gateway is built with providerConfigs only, so it never sees a models.json seat.
	it("streams a user-added seat under a built-in host id while keeping the seat identity", async () => {
		const service = createClineProviderService();

		const launchConfig = await service.resolveLaunchConfig({ providerIdOverride: "fpt-ai" });

		expect(launchConfig.providerId).toBe("openrouter");
		expect(launchConfig.seatProviderId).toBe("fpt-ai");
		expect(launchConfig.baseUrl).toBe("https://mkp-api.fptcloud.com/v1");
		expect(launchConfig.apiKey).toBe("sk-fpt-test");
		expect(launchConfig.modelId).toBe("fpt/llama-3.3-70b");
	});

	it("leaves a built-in seat on its own id", async () => {
		providerMocks.getProviderSettings.mockImplementation((providerId: string) =>
			providerId === "anthropic"
				? { provider: "anthropic", model: "claude-sonnet-4-6", apiKey: "sk-anthropic-test" }
				: undefined,
		);
		const service = createClineProviderService();

		const launchConfig = await service.resolveLaunchConfig({ providerIdOverride: "anthropic" });

		expect(launchConfig.providerId).toBe("anthropic");
		expect(launchConfig.seatProviderId).toBe("anthropic");
	});

	// The borrowed manifest carries the *host's* endpoint, so a seat with no base URL would
	// send the user's key to openrouter.ai.
	it("refuses a custom seat with no base URL", async () => {
		const { baseUrl: _baseUrl, ...withoutBaseUrl } = FPT_SETTINGS;
		providerMocks.getProviderSettings.mockImplementation((providerId: string) =>
			providerId === "fpt-ai" ? withoutBaseUrl : undefined,
		);
		const service = createClineProviderService();

		await expect(service.resolveLaunchConfig({ providerIdOverride: "fpt-ai" })).rejects.toThrow(
			/Custom provider "fpt-ai" has no base URL/,
		);
	});
});
