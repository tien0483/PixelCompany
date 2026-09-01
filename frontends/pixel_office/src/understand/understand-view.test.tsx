import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

const { mockGetGraphImpact, mockOpenGraphDashboard, mockRebuildStream } = vi.hoisted(() => ({
	mockGetGraphImpact: vi.fn(),
	mockOpenGraphDashboard: vi.fn(),
	mockRebuildStream: {
		status: "idle" as "idle" | "running" | "done" | "error",
		text: "",
		error: null as string | null,
		log: [] as string[],
		notices: [] as string[],
		startedAt: null as number | null,
		firstByteAt: null as number | null,
		doneAt: null as number | null,
		run: vi.fn(),
		cancel: vi.fn(),
		reset: vi.fn(),
	},
}));

vi.mock("@/runtime/trpc-client", () => ({
	getRuntimeTrpcClient: () => ({
		review: {
			getGraphImpact: { query: mockGetGraphImpact },
			openGraphDashboard: { mutate: mockOpenGraphDashboard },
		},
	}),
}));

vi.mock("@/html/use-html-agent-stream", () => ({
	useHtmlAgentStream: (_endpoint: string, onMeta?: (key: string, value: unknown) => void) => {
		useEffect(() => {
			if (onMeta && mockRebuildStream.status === "running") {
				onMeta("step", { stepType: "scan-project", state: "RUNNING" });
			}
		}, [onMeta]);
		return mockRebuildStream;
	},
}));

let currentThemeId = "light";
vi.mock("@/hooks/use-theme", () => ({
	useTheme: () => ({ themeId: currentThemeId, setThemeId: vi.fn() }),
	isLightUiTheme: (id: string) => id === "light",
}));

import { UnderstandView } from "./understand-view";

function flush(): Promise<void> {
	return act(async () => {
		await Promise.resolve();
		await Promise.resolve();
	});
}

describe("UnderstandView", () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
		mockGetGraphImpact.mockReset();
		mockOpenGraphDashboard.mockReset();
		mockRebuildStream.status = "idle";
		mockRebuildStream.text = "";
		mockRebuildStream.error = null;
		mockRebuildStream.log = [];
		mockRebuildStream.notices = [];
		mockRebuildStream.run.mockReset();
		currentThemeId = "light";
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		container.remove();
	});

	it("renders knowledge graph iframe with light theme params when theme is light", async () => {
		mockGetGraphImpact.mockResolvedValue({ ok: true, hasGraph: true });
		mockOpenGraphDashboard.mockResolvedValue({ ok: true, url: "http://127.0.0.1:5273/?token=test-tok" });

		await act(async () => {
			root.render(
				<TooltipProvider>
					<UnderstandView
						workspaceId="ws-1"
						projectPath="/path/to/project"
						onClose={vi.fn()}
					/>
				</TooltipProvider>,
			);
		});
		await flush();

		const iframe = container.querySelector("iframe");
		expect(iframe).not.toBeNull();
		expect(iframe?.getAttribute("src")).toContain("theme=light");
		expect(iframe?.getAttribute("src")).toContain("preset=light-minimal");
	});

	it("renders streamed text and step status when rebuild is running", async () => {
		mockGetGraphImpact.mockResolvedValue({ ok: true, hasGraph: true });
		mockOpenGraphDashboard.mockResolvedValue({ ok: true, url: "http://127.0.0.1:5273/?token=test-tok" });
		mockRebuildStream.status = "running";
		mockRebuildStream.text = "Phase 1: Scanning project...\nAnalyzed 42 files.";

		await act(async () => {
			root.render(
				<TooltipProvider>
					<UnderstandView
						workspaceId="ws-1"
						projectPath="/path/to/project"
						onClose={vi.fn()}
					/>
				</TooltipProvider>,
			);
		});
		await flush();

		expect(container.textContent).toContain("Phase 1: Scanning project...");
		expect(container.textContent).toContain("Analyzed 42 files.");
		expect(container.textContent).toContain("scan-project");
	});

	it("allows dismissing the log pane via close button", async () => {
		mockGetGraphImpact.mockResolvedValue({ ok: true, hasGraph: true });
		mockOpenGraphDashboard.mockResolvedValue({ ok: true, url: "http://127.0.0.1:5273/?token=test-tok" });
		mockRebuildStream.status = "done";
		mockRebuildStream.text = "Build completed successfully.";

		await act(async () => {
			root.render(
				<TooltipProvider>
					<UnderstandView
						workspaceId="ws-1"
						projectPath="/path/to/project"
						onClose={vi.fn()}
					/>
				</TooltipProvider>,
			);
		});
		await flush();

		expect(container.textContent).toContain("Build completed successfully.");

		const closeLogBtn = Array.from(container.querySelectorAll("button")).find(
			(b) => b.getAttribute("aria-label") === "Close build log",
		);
		expect(closeLogBtn).toBeDefined();

		await act(async () => {
			closeLogBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});
		await flush();

		expect(container.textContent).not.toContain("Build completed successfully.");
	});
});
