import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// vi.hoisted runs before the module's own imports, so this path is built from env only.
const settingsDir = vi.hoisted(() => `${process.env.TMPDIR ?? "/tmp"}/omniroute-provider-registration-test`);

const providerMocks = vi.hoisted(() => ({
	getProviderSettings: vi.fn(),
	getLastUsedProviderSettings: vi.fn(),
	addLocalProvider: vi.fn(),
	hasProvider: vi.fn(() => false),
}));

vi.mock("@clinebot/core", () => ({
	addLocalProvider: providerMocks.addLocalProvider,
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

const OMNIROUTE_SETTINGS = {
	provider: "omniroute",
	model: "auto/best-coding",
	baseUrl: "http://127.0.0.1:8400/v1",
	apiKey: "sk-omniroute-test",
};

describe("resolveLaunchConfig – custom provider registration", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		// An OmniRoute key or host id inherited from the developer's shell would mask the
		// keyless case and pin the host provider to something other than the default.
		delete process.env.OMNIROUTE_API_KEY;
		delete process.env.OMNIROUTE_HOST_PROVIDER_ID;
		mkdirSync(settingsDir, { recursive: true });
		providerMocks.hasProvider.mockReturnValue(false);
		providerMocks.getLastUsedProviderSettings.mockReturnValue(OMNIROUTE_SETTINGS);
		providerMocks.getProviderSettings.mockImplementation((providerId: string) =>
			providerId === "omniroute" ? OMNIROUTE_SETTINGS : undefined,
		);
		writeFileSync(
			join(settingsDir, "models.json"),
			JSON.stringify({
				version: 1,
				providers: {
					omniroute: {
						provider: {
							name: "OmniRoute",
							baseUrl: "http://127.0.0.1:8400/v1",
							defaultModelId: "auto/best-coding",
						},
						models: { "auto/best-coding": { id: "auto/best-coding", name: "auto/best-coding" } },
					},
				},
			}),
		);
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response(JSON.stringify({ data: [{ id: "auto/best-coding" }] }), { status: 200 })),
		);
	});

	it("re-registers a stored seat the SDK registry has not seen this process", async () => {
		const service = createClineProviderService();

		const launchConfig = await service.resolveLaunchConfig({ providerIdOverride: "omniroute" });

		// The agent gateway only resolves built-in ids, so the seat streams under one.
		expect(launchConfig.providerId).toBe("openrouter");
		expect(providerMocks.addLocalProvider).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				providerId: "omniroute",
				name: "OmniRoute",
				baseUrl: "http://127.0.0.1:8400/v1",
				apiKey: "sk-omniroute-test",
				models: ["auto/best-coding"],
				defaultModelId: "auto/best-coding",
			}),
		);
	});

	it("does not touch the registry when the seat is already registered", async () => {
		providerMocks.hasProvider.mockReturnValue(true);
		const service = createClineProviderService();

		await service.resolveLaunchConfig({ providerIdOverride: "omniroute" });

		expect(providerMocks.addLocalProvider).not.toHaveBeenCalled();
	});

	// Home chat and task chat resolve with no overrides at all, so the selected seat — not
	// an override — has to decide whether the OmniRoute path runs.
	it("takes the OmniRoute path for the selected seat when no override is passed", async () => {
		const service = createClineProviderService();

		const launchConfig = await service.resolveLaunchConfig();

		expect(launchConfig.providerId).toBe("openrouter");
		expect(launchConfig.baseUrl).toBe("http://127.0.0.1:8400/v1");
		expect(launchConfig.apiKey).toBe("sk-omniroute-test");
		expect(launchConfig.modelId).toBe("auto/best-coding");
	});

	it("fails a keyless OmniRoute seat instead of starting a chat that 401s", async () => {
		const { apiKey: _apiKey, ...keyless } = OMNIROUTE_SETTINGS;
		providerMocks.getLastUsedProviderSettings.mockReturnValue(keyless);
		providerMocks.getProviderSettings.mockImplementation((providerId: string) =>
			providerId === "omniroute" ? keyless : undefined,
		);
		const service = createClineProviderService();

		await expect(service.resolveLaunchConfig()).rejects.toThrow(/OmniRoute requires an API key/);
	});
});
