import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	type UseOpenWorkspaceResult,
	useOpenWorkspace,
} from "@/hooks/use-open-workspace";

const fetchHostEnvMock = vi.hoisted(() => vi.fn());
const runCommandMutateMock = vi.hoisted(() => vi.fn());

vi.mock("@/runtime/runtime-config-query", () => ({
	fetchRuntimeHostEnvironment: fetchHostEnvMock,
}));

vi.mock("@/runtime/trpc-client", () => ({
	getRuntimeTrpcClient: () => ({
		runtime: { runCommand: { mutate: runCommandMutateMock } },
	}),
}));

vi.mock("@/components/app-toaster", () => ({ showAppToast: vi.fn() }));

function Harness({
	onSnapshot,
}: {
	onSnapshot: (r: UseOpenWorkspaceResult) => void;
}): null {
	const result = useOpenWorkspace({
		currentProjectId: "p1",
		workspacePath: "/repo",
	});
	useEffect(() => {
		onSnapshot(result);
	});
	return null;
}

describe("useOpenWorkspace", () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		(
			globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
		).IS_REACT_ACT_ENVIRONMENT = true;
		fetchHostEnvMock.mockReset();
		runCommandMutateMock.mockReset();
		runCommandMutateMock.mockResolvedValue({ exitCode: 0, combinedOutput: "" });
		localStorage.clear();
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => root.unmount());
		vi.restoreAllMocks();
		container.remove();
		localStorage.clear();
	});

	async function mount(): Promise<{ latest: () => UseOpenWorkspaceResult }> {
		let latest: UseOpenWorkspaceResult | null = null;
		await act(async () => {
			root.render(<Harness onSnapshot={(r) => (latest = r)} />);
			await Promise.resolve();
			await Promise.resolve();
		});
		return { latest: () => latest as UseOpenWorkspaceResult };
	}

	it("adopts the runtime-reported WSL host platform", async () => {
		fetchHostEnvMock.mockResolvedValue({ platform: "linux", isWsl: true });
		const { latest } = await mount();
		expect(latest().detectedOpenPlatform).toBe("wsl");
		// WSL exposes the file manager labelled as File Explorer.
		expect(
			latest().openTargetOptions.some(
				(o) => o.id === "finder" && o.label === "File Explorer",
			),
		).toBe(true);
	});

	it("builds a WSL command via wslpath for the file manager", async () => {
		fetchHostEnvMock.mockResolvedValue({ platform: "linux", isWsl: true });
		const { latest } = await mount();

		await act(async () => {
			latest().onSelectOpenTarget("finder");
			await Promise.resolve();
		});
		await act(async () => {
			latest().onOpenWorkspace();
			await Promise.resolve();
			await Promise.resolve();
		});

		expect(runCommandMutateMock).toHaveBeenCalledWith({
			command: `explorer.exe "$(wslpath -w '/repo')"`,
		});
	});

	it("lets a manual override win over the detected host platform", async () => {
		fetchHostEnvMock.mockResolvedValue({ platform: "linux", isWsl: true });
		const { latest } = await mount();

		await act(async () => {
			latest().onSelectOpenPlatform("windows");
			await Promise.resolve();
		});
		await act(async () => {
			latest().onSelectOpenTarget("finder");
			await Promise.resolve();
		});
		await act(async () => {
			latest().onOpenWorkspace();
			await Promise.resolve();
			await Promise.resolve();
		});

		// Windows file explorer, not the WSL wslpath form.
		expect(runCommandMutateMock).toHaveBeenCalledWith({
			command: 'explorer "/repo"',
		});
		expect(latest().openPlatformOverride).toBe("windows");
	});

	it("falls back gracefully when host-env detection fails", async () => {
		fetchHostEnvMock.mockRejectedValue(new Error("offline"));
		const { latest } = await mount();
		expect(latest().detectedOpenPlatform).toBeNull();
	});
});
