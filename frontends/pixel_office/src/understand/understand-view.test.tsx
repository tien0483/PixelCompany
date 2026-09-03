import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

const {
	mockGetGraphImpact,
	mockOpenGraphDashboard,
	mockGetRebuildStatus,
	mockPauseRebuild,
	mockResumeRebuild,
	mockCancelRebuild,
	mockCheckProjectsGraph,
	mockProjectsList,
	mockImportGraph,
	mockRebuildStream,
} = vi.hoisted(() => ({
	mockGetGraphImpact: vi.fn(),
	mockOpenGraphDashboard: vi.fn(),
	mockGetRebuildStatus: vi.fn(),
	mockPauseRebuild: vi.fn(),
	mockResumeRebuild: vi.fn(),
	mockCancelRebuild: vi.fn(),
	mockCheckProjectsGraph: vi.fn(),
	mockProjectsList: vi.fn(),
	mockImportGraph: vi.fn(),
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
			getRebuildStatus: { query: mockGetRebuildStatus },
			pauseRebuild: { mutate: mockPauseRebuild },
			resumeRebuild: { mutate: mockResumeRebuild },
			cancelRebuild: { mutate: mockCancelRebuild },
			checkProjectsGraph: { query: mockCheckProjectsGraph },
			importGraph: { mutate: mockImportGraph },
		},
		projects: {
			list: { query: mockProjectsList },
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
		mockGetRebuildStatus.mockReset().mockResolvedValue({ status: "idle", ok: true });
		mockPauseRebuild.mockReset().mockResolvedValue({ ok: true });
		mockResumeRebuild.mockReset().mockResolvedValue({ ok: true });
		mockCancelRebuild.mockReset().mockResolvedValue({ ok: true });
		mockCheckProjectsGraph.mockReset().mockResolvedValue({ available: {} });
		mockProjectsList.mockReset().mockResolvedValue({ projects: [] });
		mockImportGraph.mockReset().mockResolvedValue({ ok: true });
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

	it("renders knowledge graph iframe with light theme params when theme is light and graph is present", async () => {
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

	it("renders 2 center buttons (Build graph and Import Understand folder) when .ua is missing", async () => {
		mockGetGraphImpact.mockResolvedValue({ ok: true, hasGraph: false });

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

		// Should NOT render an iframe (no blackout)
		const iframe = container.querySelector("iframe");
		expect(iframe).toBeNull();

		// Should show missing .ua description
		expect(container.textContent).toContain("No knowledge graph for this project");
		expect(container.textContent).toContain(".ua");

		// Should render the two center action buttons
		const buttons = Array.from(container.querySelectorAll("button"));
		const buildBtn = buttons.find((b) => b.textContent?.includes("Build graph"));
		const importBtn = buttons.find((b) => b.textContent?.includes("Import Understand folder"));

		expect(buildBtn).toBeDefined();
		expect(importBtn).toBeDefined();
	});

	it("renders loading progress and pause button when rebuild is running", async () => {
		mockGetGraphImpact.mockResolvedValue({ ok: true, hasGraph: false });
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

		expect(container.textContent).toContain("Building knowledge graph…");
		expect(container.textContent).toContain("Phase 1: Scanning project...");
		expect(container.textContent).toContain("Runs in background — safe to close browser");

		// Should render Pause button
		const pauseBtn = Array.from(container.querySelectorAll("button")).find((b) =>
			b.textContent?.includes("Pause"),
		);
		expect(pauseBtn).toBeDefined();

		// Clicking pause calls pauseRebuild
		await act(async () => {
			pauseBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});
		await flush();

		expect(mockPauseRebuild).toHaveBeenCalledWith({ projectPath: "/path/to/project" });
	});

	it("allows dismissing the bottom log pane via close button when build completes", async () => {
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
