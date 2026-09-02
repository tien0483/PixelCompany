import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

const { mockOpenmaicStatus, mockOpenmaicHealth } = vi.hoisted(() => ({
	mockOpenmaicStatus: vi.fn(),
	mockOpenmaicHealth: vi.fn(),
}));

vi.mock("@/runtime/trpc-client", () => ({
	getRuntimeTrpcClient: () => ({
		openmaic: {
			status: { query: mockOpenmaicStatus },
			health: { query: mockOpenmaicHealth },
		},
	}),
}));

let currentThemeId = "light";
vi.mock("@/hooks/use-theme", () => ({
	useTheme: () => ({ themeId: currentThemeId, setThemeId: vi.fn() }),
	isLightUiTheme: (id: string) => id === "light",
}));

import { LearningView } from "./learning-view";

function flush(): Promise<void> {
	return act(async () => {
		await Promise.resolve();
		await Promise.resolve();
	});
}

describe("LearningView", () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
		mockOpenmaicStatus.mockReset();
		mockOpenmaicHealth.mockReset();
		currentThemeId = "light";
		window.localStorage.clear();
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		container.remove();
	});

	it("passes theme=light and themeId query parameter to classroom iframe when theme is light", async () => {
		mockOpenmaicStatus.mockResolvedValue({
			installed: true,
			built: true,
			online: true,
			embeddable: true,
			baseUrl: "http://127.0.0.1:3020",
		});
		mockOpenmaicHealth.mockResolvedValue({
			openmaicConfigured: true,
			asrReady: true,
			ttsReady: true,
			videoReady: false,
			asrVerified: true,
			ttsVerified: true,
			videoVerified: false,
			asrDetail: "Gemini models endpoint reachable.",
			ttsDetail: "Gemini models endpoint reachable.",
			videoDetail: "Gemini models probe failed (403).",
			subscriptionSeatRoutingReady: false,
			subscriptionSeatRoutingDetail: "OmniRoute: 401 unauthorized",
			missingKeys: ["Video: configure a video generation provider API key"],
		});

		await act(async () => {
			root.render(
				<TooltipProvider>
					<LearningView workspaceId="ws-1" onClose={vi.fn()} />
				</TooltipProvider>,
			);
		});
		await flush();

		const iframe = container.querySelector("iframe");
		expect(iframe).not.toBeNull();
		expect(iframe?.getAttribute("src")).toBe("http://127.0.0.1:3020?theme=light&themeId=light");
		expect(iframe?.getAttribute("allow")).toBe("microphone; autoplay; camera");
		expect(container.textContent).toContain("Speech recognition");
		expect(container.textContent).toContain("Text to speech");
		expect(container.textContent).toContain("Video generation");
		expect(container.textContent).toContain("Subscription routing");
		expect(container.textContent).toContain("Ready (verified)");
		expect(container.textContent).toContain("Needs provider setup");
		expect(container.textContent).toContain("Not auto-wired (OmniRoute proxy unreachable)");
	});

	it("passes theme=dark and themeId query parameter to classroom iframe when theme is dark", async () => {
		currentThemeId = "graphite";
		mockOpenmaicStatus.mockResolvedValue({
			installed: true,
			built: true,
			online: true,
			embeddable: true,
			baseUrl: "http://127.0.0.1:3020",
		});
		mockOpenmaicHealth.mockResolvedValue({
			openmaicConfigured: true,
			asrReady: true,
			ttsReady: true,
			videoReady: true,
			asrVerified: true,
			ttsVerified: true,
			videoVerified: true,
			subscriptionSeatRoutingReady: false,
			subscriptionSeatRoutingDetail: "OmniRoute: 401 unauthorized",
			missingKeys: [],
		});

		await act(async () => {
			root.render(
				<TooltipProvider>
					<LearningView workspaceId="ws-1" onClose={vi.fn()} />
				</TooltipProvider>,
			);
		});
		await flush();

		const iframe = container.querySelector("iframe");
		expect(iframe).not.toBeNull();
		expect(iframe?.getAttribute("src")).toBe("http://127.0.0.1:3020?theme=dark&themeId=graphite");
		expect(iframe?.getAttribute("allow")).toBe("microphone; autoplay; camera");
	});

	it("collapses and persists the learning health panel", async () => {
		mockOpenmaicStatus.mockResolvedValue({
			installed: true,
			built: true,
			online: true,
			embeddable: true,
			baseUrl: "http://127.0.0.1:3020",
		});
		mockOpenmaicHealth.mockResolvedValue({
			openmaicConfigured: true,
			asrReady: true,
			ttsReady: true,
			videoReady: true,
			asrVerified: true,
			ttsVerified: true,
			videoVerified: true,
			subscriptionSeatRoutingReady: true,
			subscriptionSeatRoutingDetail: "OmniRoute: ok",
			missingKeys: [],
		});

		await act(async () => {
			root.render(
				<TooltipProvider>
					<LearningView workspaceId="ws-1" onClose={vi.fn()} />
				</TooltipProvider>,
			);
		});
		await flush();

		const content = container.querySelector('[data-testid="learning-health-content"]');
		expect(content?.getAttribute("data-state")).toBe("open");

		await act(async () => {
			(container.querySelector('[data-testid="learning-health-toggle"]') as HTMLButtonElement).click();
		});
		await flush();

		expect(content?.getAttribute("data-state")).toBe("closed");
		expect(window.localStorage.getItem("kanban.learning-health-panel-expanded")).toBe("false");
	});

	it("rehydrates a collapsed health panel from localStorage", async () => {
		window.localStorage.setItem("kanban.learning-health-panel-expanded", "false");
		mockOpenmaicStatus.mockResolvedValue({
			installed: true,
			built: true,
			online: true,
			embeddable: true,
			baseUrl: "http://127.0.0.1:3020",
		});
		mockOpenmaicHealth.mockResolvedValue({
			openmaicConfigured: true,
			asrReady: true,
			ttsReady: true,
			videoReady: true,
			asrVerified: true,
			ttsVerified: true,
			videoVerified: true,
			subscriptionSeatRoutingReady: true,
			subscriptionSeatRoutingDetail: "OmniRoute: ok",
			missingKeys: [],
		});

		await act(async () => {
			root.render(
				<TooltipProvider>
					<LearningView workspaceId="ws-1" onClose={vi.fn()} />
				</TooltipProvider>,
			);
		});
		await flush();

		const content = container.querySelector('[data-testid="learning-health-content"]');
		expect(content?.getAttribute("data-state")).toBe("closed");
	});
});
