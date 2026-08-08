import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CleanupDialog } from "@/components/cleanup-dialog";
import { TooltipProvider } from "@/components/ui/tooltip";

const mockGetClaudeCacheStatus = vi.fn();
const mockCleanClaudeCache = vi.fn();
const mockCleanMergedWorktrees = vi.fn();
const { mockNotifyError, mockShowAppToast } = vi.hoisted(() => ({
	mockNotifyError: vi.fn(),
	mockShowAppToast: vi.fn(),
}));

vi.mock("@/runtime/trpc-client", () => ({
	getRuntimeTrpcClient: () => ({
		runtime: {
			getClaudeCacheStatus: { query: mockGetClaudeCacheStatus },
			cleanClaudeCache: { mutate: mockCleanClaudeCache },
		},
		workspace: {
			cleanMergedWorktrees: { mutate: mockCleanMergedWorktrees },
		},
	}),
}));

vi.mock("@/components/app-toaster", () => ({
	notifyError: mockNotifyError,
	showAppToast: mockShowAppToast,
}));

function flush() {
	return act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
}

describe("CleanupDialog", () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
		mockGetClaudeCacheStatus.mockReset().mockResolvedValue({
			ok: true,
			safeItemCount: 12,
			safeSizeBytes: 2048,
			transcriptItemCount: 3,
			transcriptSizeBytes: 4096,
		});
		mockCleanClaudeCache.mockReset();
		mockCleanMergedWorktrees.mockReset().mockResolvedValue({ ok: true, cleanedTaskIds: [], skipped: [] });
		mockNotifyError.mockReset();
		mockShowAppToast.mockReset();
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		container.remove();
		document.body.innerHTML = "";
		delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
	});

	it("loads Claude cache status and worktree count when the dialog transitions from closed to open", async () => {
		await act(async () => {
			root.render(
				<TooltipProvider>
					<CleanupDialog open={false} onOpenChange={() => {}} workspaceId={null} />
				</TooltipProvider>,
			);
		});
		await flush();

		// Closed dialog must not have loaded anything yet.
		expect(mockGetClaudeCacheStatus).not.toHaveBeenCalled();
		expect(mockCleanMergedWorktrees).not.toHaveBeenCalled();

		// Parent flips `open` externally (this is how Task 5's useCleanupTools hook
		// opens this dialog — no Trigger involved), so the load must come from a
		// `useEffect` reacting to the `open` prop, not from `onOpenChange`.
		await act(async () => {
			root.render(
				<TooltipProvider>
					<CleanupDialog open={true} onOpenChange={() => {}} workspaceId={null} />
				</TooltipProvider>,
			);
		});
		await flush();

		expect(mockGetClaudeCacheStatus).toHaveBeenCalledTimes(1);
		expect(mockCleanMergedWorktrees).toHaveBeenCalledTimes(1);
	});

	it("disables the transcripts checkbox until the Claude row is checked, and Preview until something is checked", async () => {
		await act(async () => {
			root.render(
				<TooltipProvider>
					<CleanupDialog open={true} onOpenChange={() => {}} workspaceId={null} />
				</TooltipProvider>,
			);
		});
		await flush();

		// Dialog content is rendered via a Radix Portal directly under document.body,
		// not under `container` — query document.body like the repo's other dialog
		// tests do (see cline-add-provider-dialog.test.tsx).
		const transcriptsCheckbox = document.body.querySelector('[data-testid="cleanup-transcripts-checkbox"]');
		const previewButton = document.body.querySelector('[data-testid="cleanup-preview-button"]');
		// Radix sets `data-disabled=""` (an empty-string attribute value, which is
		// falsy under `toBeTruthy()`) as well as a real `disabled` DOM attribute on
		// the underlying button when the `disabled` prop is true — assert on
		// presence via `hasAttribute` rather than the attribute's string value.
		expect(transcriptsCheckbox?.hasAttribute("disabled")).toBe(true);
		expect((previewButton as HTMLButtonElement)?.disabled).toBe(true);

		const claudeCheckbox = document.body.querySelector('[data-testid="cleanup-claude-checkbox"]') as HTMLElement;
		await act(async () => {
			claudeCheckbox.click();
		});
		await flush();

		expect((previewButton as HTMLButtonElement)?.disabled).toBe(false);
	});

	it("runs dry-run preview then confirm, calling clean only for checked categories", async () => {
		mockCleanClaudeCache.mockResolvedValue({
			ok: true,
			cleaned: [{ path: "/home/x/.claude/cache/old.json", sizeBytes: 100, tier: "safe" }],
			skipped: [],
		});

		await act(async () => {
			root.render(
				<TooltipProvider>
					<CleanupDialog open={true} onOpenChange={() => {}} workspaceId={null} />
				</TooltipProvider>,
			);
		});
		await flush();
		mockCleanMergedWorktrees.mockClear(); // dialog-open already called this once for the worktree count

		const claudeCheckbox = document.body.querySelector('[data-testid="cleanup-claude-checkbox"]') as HTMLElement;
		await act(async () => {
			claudeCheckbox.click();
		});
		await flush();

		const previewButton = document.body.querySelector('[data-testid="cleanup-preview-button"]') as HTMLButtonElement;
		await act(async () => {
			previewButton.click();
		});
		await flush();

		expect(mockCleanClaudeCache).toHaveBeenCalledWith(
			expect.objectContaining({ dryRun: true, includeTranscripts: false }),
		);
		expect(mockCleanMergedWorktrees).not.toHaveBeenCalled(); // worktrees checkbox was never checked, so Preview must not touch it

		const confirmButton = document.body.querySelector('[data-testid="cleanup-confirm-button"]') as HTMLButtonElement;
		await act(async () => {
			confirmButton.click();
		});
		await flush();

		expect(mockCleanClaudeCache).toHaveBeenCalledWith(
			expect.objectContaining({ dryRun: false, includeTranscripts: false }),
		);
	});

	it("clears a shown preview when a checkbox changes afterward, instead of leaving it stale", async () => {
		mockCleanClaudeCache.mockResolvedValue({
			ok: true,
			cleaned: [{ path: "/home/x/.claude/cache/stale-preview-marker.json", sizeBytes: 100, tier: "safe" }],
			skipped: [],
		});

		await act(async () => {
			root.render(
				<TooltipProvider>
					<CleanupDialog open={true} onOpenChange={() => {}} workspaceId={null} />
				</TooltipProvider>,
			);
		});
		await flush();

		const claudeCheckbox = document.body.querySelector('[data-testid="cleanup-claude-checkbox"]') as HTMLElement;
		await act(async () => {
			claudeCheckbox.click();
		});
		await flush();

		const previewButton = document.body.querySelector('[data-testid="cleanup-preview-button"]') as HTMLButtonElement;
		await act(async () => {
			previewButton.click();
		});
		await flush();

		expect(document.body.textContent).toContain("stale-preview-marker.json");

		// Checking a second checkbox (transcripts) after the preview was shown
		// must invalidate it — Confirm would otherwise delete more than the
		// preview described.
		const transcriptsCheckbox = document.body.querySelector('[data-testid="cleanup-transcripts-checkbox"]') as HTMLElement;
		await act(async () => {
			transcriptsCheckbox.click();
		});
		await flush();

		expect(document.body.textContent).not.toContain("stale-preview-marker.json");
	});

	it("reports failure instead of a success toast when a checked category's backend call returns ok: false", async () => {
		mockCleanClaudeCache.mockResolvedValue({ ok: true, cleaned: [], skipped: [] });
		mockCleanMergedWorktrees.mockImplementation((input?: { dryRun?: boolean }) => {
			if (input?.dryRun) {
				return Promise.resolve({ ok: true, cleanedTaskIds: [], skipped: [] });
			}
			return Promise.resolve({ ok: false, cleanedTaskIds: [], skipped: [], error: "worktree cleanup boom" });
		});

		await act(async () => {
			root.render(
				<TooltipProvider>
					<CleanupDialog open={true} onOpenChange={() => {}} workspaceId={null} />
				</TooltipProvider>,
			);
		});
		await flush();

		const worktreesCheckbox = document.body.querySelector('[data-testid="cleanup-worktrees-checkbox"]') as HTMLElement;
		await act(async () => {
			worktreesCheckbox.click();
		});
		await flush();

		const confirmButton = document.body.querySelector('[data-testid="cleanup-confirm-button"]') as HTMLButtonElement;
		await act(async () => {
			confirmButton.click();
		});
		await flush();

		expect(mockNotifyError).toHaveBeenCalledWith(expect.stringContaining("worktree cleanup boom"));
		expect(mockShowAppToast).not.toHaveBeenCalledWith(expect.objectContaining({ message: "Cleanup complete" }));
	});
});
