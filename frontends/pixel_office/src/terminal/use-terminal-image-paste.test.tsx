import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useTerminalImagePaste } from "@/terminal/use-terminal-image-paste";

const mockStagePasteImagesMutate = vi.fn();

vi.mock("@/runtime/trpc-client", () => ({
	getRuntimeTrpcClient: () => ({
		runtime: {
			stageTaskSessionPasteImages: {
				mutate: mockStagePasteImagesMutate,
			},
		},
	}),
}));

vi.mock("@/components/app-toaster", () => ({
	showAppToast: vi.fn(),
}));

function makeFile(name: string, type: string, size = 8): File {
	const file = new File([new Uint8Array(Math.min(size, 1024))], name, { type });
	Object.defineProperty(file, "size", { value: size });
	return file;
}

function pasteEventWith(files: File[]): {
	clipboardData: DataTransfer;
	preventDefault: () => void;
	stopPropagation: () => void;
} {
	return {
		clipboardData: {
			items: files.map((file) => ({ kind: "file", getAsFile: () => file })),
			files,
		} as unknown as DataTransfer,
		preventDefault: () => {},
		stopPropagation: () => {},
	};
}

async function waitFor(check: () => boolean, description: string): Promise<void> {
	for (let attempt = 0; attempt < 40; attempt += 1) {
		if (check()) {
			return;
		}
		await act(async () => {
			await new Promise((resolveWait) => setTimeout(resolveWait, 25));
		});
	}
	throw new Error(`timed out waiting for ${description}`);
}

describe("useTerminalImagePaste", () => {
	let container: HTMLDivElement;
	let root: Root;
	let hook: ReturnType<typeof useTerminalImagePaste>;
	const pastedPaths: string[][] = [];

	function Probe(): null {
		hook = useTerminalImagePaste({
			taskId: "task-1",
			workspaceId: "workspace-1",
			onPastePaths: (paths) => {
				pastedPaths.push(paths);
			},
		});
		return null;
	}

	beforeEach(() => {
		(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
		mockStagePasteImagesMutate.mockReset();
		mockStagePasteImagesMutate.mockResolvedValue({
			ok: true,
			paths: ["/tmp/kanban-pty-images-task-1/1700000000-01-shot.png"],
		});
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
		pastedPaths.length = 0;
		act(() => {
			root.render(<Probe />);
		});
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		container.remove();
	});

	it("uploads a pasted image and forwards staged paths to the terminal", async () => {
		await act(async () => {
			hook.handlePaste(pasteEventWith([makeFile("shot.png", "image/png")]) as never);
		});
		await waitFor(() => pastedPaths.length > 0, "staged terminal image paths");

		expect(mockStagePasteImagesMutate).toHaveBeenCalledTimes(1);
		expect(pastedPaths).toEqual([["/tmp/kanban-pty-images-task-1/1700000000-01-shot.png"]]);
	});
});
