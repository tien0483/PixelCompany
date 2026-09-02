import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DocProjectMeta } from "@/docs/use-doc-projects";

const { mockToast, idleStream } = vi.hoisted(() => ({
	mockToast: vi.fn(),
	idleStream: { status: "idle" as const, error: null, log: [] as string[], doneAt: null, run: vi.fn() },
}));
vi.mock("@/components/app-toaster", () => ({
	showAppToast: mockToast,
}));

vi.mock("@/docs/use-doc-projects", () => ({
	useDocAudit: () => idleStream,
	useDocRound: () => idleStream,
}));

import { DocsRunPanel } from "@/components/docs/docs-run-panel";

const PROJECT: DocProjectMeta = {
	id: "proj-1",
	name: "Test Project",
	targetRepo: "/repo",
	workspaceDir: "/repo/.doc-workspace",
	tagline: "",
	createdAt: "2026-01-01T00:00:00.000Z",
	hasSite: false,
	docCount: 0,
	lastBuildAt: null,
};

function flush(): Promise<void> {
	return act(async () => {
		await Promise.resolve();
		await Promise.resolve();
	});
}

describe("DocsRunPanel build failure handling", () => {
	let container: HTMLDivElement;
	let root: Root;
	let fetchMock: ReturnType<typeof vi.fn>;
	let onBuildDone: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
		onBuildDone = vi.fn();
		mockToast.mockClear();
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		container.remove();
		vi.unstubAllGlobals();
	});

	async function clickBuild(): Promise<void> {
		const button = Array.from(container.querySelectorAll("button")).find((b) =>
			b.textContent?.includes("Build"),
		);
		if (!button) throw new Error("Build button not found");
		await act(async () => {
			button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
			await flush();
		});
	}

	it("treats a 200 response with a non-zero body-carried code as a failure, not success", async () => {
		fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ code: 1, stdout: "", stderr: "build_site.py blew up" }),
		});
		vi.stubGlobal("fetch", fetchMock);

		await act(async () => {
			root.render(<DocsRunPanel project={PROJECT} onBuildDone={onBuildDone as () => void} />);
			await flush();
		});
		await clickBuild();

		expect(onBuildDone).not.toHaveBeenCalled();
		expect(mockToast).toHaveBeenCalledWith(
			expect.objectContaining({ intent: "danger", message: "build_site.py blew up" }),
		);
	});

	it("calls onBuildDone when the body-carried code is 0", async () => {
		fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ code: 0, stdout: "ok", stderr: "" }),
		});
		vi.stubGlobal("fetch", fetchMock);

		await act(async () => {
			root.render(<DocsRunPanel project={PROJECT} onBuildDone={onBuildDone as () => void} />);
			await flush();
		});
		await clickBuild();

		expect(onBuildDone).toHaveBeenCalledTimes(1);
		expect(mockToast).not.toHaveBeenCalled();
	});
});
