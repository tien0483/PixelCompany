import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

const { mockOpenmaicStatus } = vi.hoisted(() => ({
	mockOpenmaicStatus: vi.fn(),
}));

vi.mock("@/runtime/trpc-client", () => ({
	getRuntimeTrpcClient: () => ({
		openmaic: {
			status: { query: mockOpenmaicStatus },
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
		currentThemeId = "light";
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		container.remove();
	});

	it("passes theme=light query parameter to classroom iframe when theme is light", async () => {
		mockOpenmaicStatus.mockResolvedValue({
			installed: true,
			built: true,
			online: true,
			embeddable: true,
			baseUrl: "http://127.0.0.1:3020",
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
		expect(iframe?.getAttribute("src")).toBe("http://127.0.0.1:3020?theme=light");
	});

	it("passes theme=dark query parameter to classroom iframe when theme is dark", async () => {
		currentThemeId = "graphite";
		mockOpenmaicStatus.mockResolvedValue({
			installed: true,
			built: true,
			online: true,
			embeddable: true,
			baseUrl: "http://127.0.0.1:3020",
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
		expect(iframe?.getAttribute("src")).toBe("http://127.0.0.1:3020?theme=dark");
	});
});
