import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockProjectsList, mockCheckProjectsGraph, mockImportGraph } = vi.hoisted(() => ({
	mockProjectsList: vi.fn(),
	mockCheckProjectsGraph: vi.fn(),
	mockImportGraph: vi.fn(),
}));

vi.mock("@/runtime/trpc-client", () => ({
	getRuntimeTrpcClient: () => ({
		projects: {
			list: { query: mockProjectsList },
		},
		review: {
			checkProjectsGraph: { query: mockCheckProjectsGraph },
			importGraph: { mutate: mockImportGraph },
		},
	}),
}));

import { ImportUnderstandDialog } from "./import-understand-dialog";

function flush(): Promise<void> {
	return act(async () => {
		await Promise.resolve();
		await Promise.resolve();
	});
}

describe("ImportUnderstandDialog", () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
		mockProjectsList.mockReset();
		mockCheckProjectsGraph.mockReset();
		mockImportGraph.mockReset();
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		container.remove();
	});

	it("loads sibling projects and imports graph on confirmation", async () => {
		mockProjectsList.mockResolvedValue({
			projects: [
				{ id: "p1", name: "Source Project", path: "/source/repo" },
				{ id: "p2", name: "Current Project", path: "/target/repo" },
			],
		});
		mockCheckProjectsGraph.mockResolvedValue({
			available: {
				"/source/repo": true,
			},
		});
		mockImportGraph.mockResolvedValue({ ok: true, targetDataDir: "/target/repo/.ua" });

		const onImportSuccess = vi.fn();
		const onOpenChange = vi.fn();

		await act(async () => {
			root.render(
				<ImportUnderstandDialog
					open={true}
					onOpenChange={onOpenChange}
					workspaceId="ws-1"
					currentTargetProjectPath="/target/repo"
					onImportSuccess={onImportSuccess}
				/>
			);
		});
		await flush();

		expect(document.body.textContent).toContain("Import Understand folder");
		expect(document.body.textContent).toContain("Source Project");
		expect(document.body.textContent).toContain("Has .ua graph");

		// Click Import button
		const importBtn = Array.from(document.body.querySelectorAll("button")).find((b) =>
			b.textContent?.includes("Import & Copy .ua")
		);
		expect(importBtn).toBeDefined();

		await act(async () => {
			importBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});
		await flush();

		expect(mockImportGraph).toHaveBeenCalledWith({
			sourcePath: "/source/repo",
			targetPath: "/target/repo",
		});
		expect(onImportSuccess).toHaveBeenCalled();
		expect(onOpenChange).toHaveBeenCalledWith(false);
	});
});
