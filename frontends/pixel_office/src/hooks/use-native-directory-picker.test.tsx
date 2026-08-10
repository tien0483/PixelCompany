import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	useNativeDirectoryPicker,
	type UseNativeDirectoryPickerResult,
} from "@/hooks/use-native-directory-picker";

const pickDirectoryMutateMock = vi.hoisted(() => vi.fn());

vi.mock("@/runtime/trpc-client", () => ({
	getRuntimeTrpcClient: () => ({
		projects: { pickDirectory: { mutate: pickDirectoryMutateMock } },
	}),
}));

function Harness({
	onSnapshot,
}: {
	onSnapshot: (r: UseNativeDirectoryPickerResult) => void;
}): null {
	const result = useNativeDirectoryPicker(null);
	useEffect(() => {
		onSnapshot(result);
	});
	return null;
}

describe("useNativeDirectoryPicker", () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
		pickDirectoryMutateMock.mockReset();
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => root.unmount());
		vi.restoreAllMocks();
		container.remove();
	});

	async function mount(): Promise<{ latest: () => UseNativeDirectoryPickerResult }> {
		let latest: UseNativeDirectoryPickerResult | null = null;
		await act(async () => {
			root.render(<Harness onSnapshot={(r) => (latest = r)} />);
			await Promise.resolve();
		});
		return { latest: () => latest as UseNativeDirectoryPickerResult };
	}

	it("returns the path on success", async () => {
		pickDirectoryMutateMock.mockResolvedValue({ ok: true, path: "/tmp/my-repo" });
		const { latest } = await mount();
		await expect(latest().pickDirectory()).resolves.toEqual({ path: "/tmp/my-repo" });
	});

	it("treats a clean cancellation as { path: null } with no unavailable flag", async () => {
		pickDirectoryMutateMock.mockResolvedValue({
			ok: false,
			path: null,
			error: "No directory was selected.",
		});
		const { latest } = await mount();
		await expect(latest().pickDirectory()).resolves.toEqual({ path: null });
	});

	it("treats the exact 'install zenity/kdialog' message as unavailable", async () => {
		pickDirectoryMutateMock.mockResolvedValue({
			ok: false,
			path: null,
			error: 'Could not open directory picker. Install "zenity" or "kdialog" and try again.',
		});
		const { latest } = await mount();
		await expect(latest().pickDirectory()).resolves.toEqual({ path: null, unavailable: true });
	});

	it("treats the exact osascript-unavailable message as unavailable", async () => {
		pickDirectoryMutateMock.mockResolvedValue({
			ok: false,
			path: null,
			error: 'Could not open directory picker. Command "osascript" is not available.',
		});
		const { latest } = await mount();
		await expect(latest().pickDirectory()).resolves.toEqual({ path: null, unavailable: true });
	});

	it("treats the exact PowerShell-unavailable message as unavailable", async () => {
		pickDirectoryMutateMock.mockResolvedValue({
			ok: false,
			path: null,
			error: 'Could not open directory picker. Install PowerShell ("powershell" or "pwsh") and try again.',
		});
		const { latest } = await mount();
		await expect(latest().pickDirectory()).resolves.toEqual({ path: null, unavailable: true });
	});

	it("does NOT classify a real dialog failure sharing the same prefix as unavailable - it throws", async () => {
		pickDirectoryMutateMock.mockResolvedValue({
			ok: false,
			path: null,
			error: "Could not open directory picker via zenity: Gtk warning",
		});
		const { latest } = await mount();
		await expect(latest().pickDirectory()).rejects.toThrow(
			"Could not open directory picker via zenity: Gtk warning",
		);
	});

	it("throws on a signal-terminated command instead of silently treating it as cancellation", async () => {
		pickDirectoryMutateMock.mockResolvedValue({
			ok: false,
			path: null,
			error: "Directory picker command zenity terminated by signal: SIGTERM",
		});
		const { latest } = await mount();
		await expect(latest().pickDirectory()).rejects.toThrow(
			"Directory picker command zenity terminated by signal: SIGTERM",
		);
	});

	it("propagates a rejected tRPC mutation (e.g. network failure)", async () => {
		pickDirectoryMutateMock.mockRejectedValue(new Error("Failed to fetch"));
		const { latest } = await mount();
		await expect(latest().pickDirectory()).rejects.toThrow("Failed to fetch");
	});
});
