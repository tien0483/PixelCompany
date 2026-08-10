import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PLAN_ASSET_MAX_BYTES, usePlanImagePaste } from "@/components/plan-editor/use-plan-image-paste";

const mockWriteAssetMutate = vi.fn();
vi.mock("@/runtime/trpc-client", () => ({
	getRuntimeTrpcClient: () => ({
		plans: { writeAsset: { mutate: mockWriteAssetMutate } },
	}),
}));

const mockShowAppToast = vi.fn();
vi.mock("@/components/app-toaster", () => ({
	showAppToast: (...args: unknown[]) => mockShowAppToast(...args),
}));

/** A `File` whose reported size we control, so the size guard can be exercised cheaply. */
function makeFile(name: string, type: string, size = 8): File {
	const file = new File([new Uint8Array(Math.min(size, 1024))], name, { type });
	Object.defineProperty(file, "size", { value: size });
	return file;
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

function pasteEventWith(files: File[]): { clipboardData: DataTransfer; preventDefault: () => void } {
	return {
		clipboardData: {
			items: files.map((file) => ({ kind: "file", getAsFile: () => file })),
			files,
		} as unknown as DataTransfer,
		preventDefault: () => {},
	};
}

describe("usePlanImagePaste", () => {
	let container: HTMLDivElement;
	let root: Root;
	let hook: ReturnType<typeof usePlanImagePaste>;
	const inserted: { path: string; name: string }[] = [];

	function Probe(): null {
		hook = usePlanImagePaste("plan-1", "workspace-1", (path, name) => {
			inserted.push({ path, name });
		});
		return null;
	}

	beforeEach(() => {
		(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
		inserted.length = 0;
		mockWriteAssetMutate.mockReset().mockResolvedValue({ ok: true, relativePath: "roadmap.assets/pasted-1.png" });
		mockShowAppToast.mockReset();
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

	function toastMessages(): string[] {
		return mockShowAppToast.mock.calls.map((call) => String((call[0] as { message?: string })?.message ?? ""));
	}

	it("uploads a pasted screenshot and hands back the relative path", async () => {
		await act(async () => {
			hook.handlePaste(pasteEventWith([makeFile("shot.png", "image/png")]) as never);
		});
		// The paste handler is fire-and-forget so it can stay synchronous for the browser's
		// DataTransfer window; the base64 read then resolves on a later tick.
		await waitFor(() => inserted.length > 0, "uploaded image");

		expect(mockWriteAssetMutate).toHaveBeenCalledTimes(1);
		expect(inserted).toEqual([{ path: "roadmap.assets/pasted-1.png", name: "shot.png" }]);
	});

	it("reports a rejected upload instead of failing silently", async () => {
		mockWriteAssetMutate.mockResolvedValue({ ok: false, relativePath: null, error: "disk full" });

		await act(async () => {
			await hook.uploadImageFile(makeFile("shot.png", "image/png"));
		});

		expect(toastMessages()).toContain("disk full");
		expect(inserted).toEqual([]);
	});

	it("reports a thrown upload — the old code swallowed it entirely", async () => {
		mockWriteAssetMutate.mockRejectedValue(new Error("Failed to fetch"));

		await act(async () => {
			await hook.uploadImageFile(makeFile("shot.png", "image/png"));
		});

		expect(toastMessages().some((message) => message.includes("Failed to fetch"))).toBe(true);
	});

	it("names the size limit rather than letting the wire schema reject the image", async () => {
		await act(async () => {
			await hook.uploadImageFile(makeFile("huge.png", "image/png", PLAN_ASSET_MAX_BYTES + 1));
		});

		expect(mockWriteAssetMutate).not.toHaveBeenCalled();
		expect(toastMessages().some((message) => message.includes("limit for a plan image"))).toBe(true);
	});

	it("explains an unsupported image format on paste", async () => {
		await act(async () => {
			hook.handlePaste(pasteEventWith([makeFile("diagram.bmp", "image/bmp")]) as never);
		});

		expect(mockWriteAssetMutate).not.toHaveBeenCalled();
		expect(toastMessages().some((message) => message.includes("image/bmp"))).toBe(true);
	});

	it("ignores a paste that carries no image at all", async () => {
		await act(async () => {
			hook.handlePaste(pasteEventWith([makeFile("notes.txt", "text/plain")]) as never);
		});

		expect(mockWriteAssetMutate).not.toHaveBeenCalled();
		expect(mockShowAppToast).not.toHaveBeenCalled();
	});
});
