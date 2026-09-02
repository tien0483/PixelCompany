import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CleanupDialog } from "@/components/cleanup-dialog";
import { TooltipProvider } from "@/components/ui/tooltip";

const mockGetClaudeCacheStatus = vi.fn();
const mockCleanClaudeCache = vi.fn();
const mockCleanMergedWorktrees = vi.fn();
const mockEmptyRecycleBin = vi.fn();
const { mockNotifyError, mockShowAppToast } = vi.hoisted(() => ({
	mockNotifyError: vi.fn(),
	mockShowAppToast: vi.fn(),
}));

vi.mock("@/runtime/trpc-client", () => ({
	getRuntimeTrpcClient: () => ({
		runtime: {
			getClaudeCacheStatus: { query: mockGetClaudeCacheStatus },
			cleanClaudeCache: { mutate: mockCleanClaudeCache },
			emptyRecycleBin: { mutate: mockEmptyRecycleBin },
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
			tmpItemCount: 2,
			tmpSizeBytes: 1024,
			npmCacheItemCount: 1,
			npmCacheSizeBytes: 512,
			nvmCacheItemCount: 1,
			nvmCacheSizeBytes: 256,
			nvmVersions: [{ version: "v22.0.0", path: "/home/x/.nvm/versions/node/v22.0.0", sizeBytes: 1000, inUse: false }],
			recycleBinItemCount: 1,
			recycleBinSizeBytes: 128,
			recycleBinPath: "/home/x/.agent/recycle-bin",
		});
		mockCleanClaudeCache.mockReset();
		mockEmptyRecycleBin.mockReset().mockResolvedValue({ ok: true, cleaned: [], skipped: [] });
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

	describe("worktree categories", () => {
		const RECLAIMABLE = [
			{
				taskId: "aaa11",
				branch: "kanban/task-aaa11",
				repoLabel: "akselos-dev",
				worktreePath: "/w/aaa11/akselos-dev",
				category: "unused" as const,
				sizeBytes: 3 * 1024 * 1024 * 1024,
				reason: "Clean and still on its base commit.",
			},
			{
				taskId: "bbb22",
				branch: "kanban/task-bbb22",
				repoLabel: "akselos-dev",
				worktreePath: "/w/bbb22/akselos-dev",
				category: "orphaned" as const,
				sizeBytes: 1024 * 1024,
				reason: "No card on any board owns this worktree.",
			},
		];

		beforeEach(() => {
			mockCleanMergedWorktrees.mockReset().mockResolvedValue({
				ok: true,
				cleanedTaskIds: [],
				skipped: [],
				reclaimable: RECLAIMABLE,
				reclaimableBytes: RECLAIMABLE.reduce((sum, entry) => sum + entry.sizeBytes, 0),
			});
		});

		async function openDialog() {
			await act(async () => {
				root.render(
					<TooltipProvider>
						<CleanupDialog open={true} onOpenChange={() => {}} workspaceId={null} />
					</TooltipProvider>,
				);
			});
			await flush();
		}

		it("scans every category on open so nothing is hidden behind the merged-only default", async () => {
			await openDialog();

			expect(mockCleanMergedWorktrees).toHaveBeenCalledWith(
				expect.objectContaining({
					dryRun: true,
					categories: expect.arrayContaining(["merged", "unused", "orphaned", "missing", "unregistered", "stale-branch"]),
				}),
			);
		});

		it("shows a GB-scale total for the selected worktrees rather than a bare count", async () => {
			await openDialog();

			const worktreesCheckbox = document.body.querySelector('[data-testid="cleanup-worktrees-checkbox"]') as HTMLElement;
			await act(async () => {
				worktreesCheckbox.click();
			});
			await flush();

			expect(document.body.querySelector('[data-testid="cleanup-total-estimate"]')?.textContent).toContain("3.0 GB");
		});

		it("sends only the categories still selected after a category is unchecked", async () => {
			await openDialog();

			const worktreesCheckbox = document.body.querySelector('[data-testid="cleanup-worktrees-checkbox"]') as HTMLElement;
			await act(async () => {
				worktreesCheckbox.click();
			});
			await flush();

			// Deselecting the 3 GB "unused" category must leave the orphaned one
			// selected, and must narrow the request rather than silently sending
			// everything.
			const unusedCategory = document.body.querySelector(
				'[data-testid="cleanup-worktree-category-unused"]',
			) as HTMLElement;
			await act(async () => {
				unusedCategory.click();
			});
			await flush();

			mockCleanMergedWorktrees.mockClear();
			const confirmButton = document.body.querySelector('[data-testid="cleanup-confirm-button"]') as HTMLButtonElement;
			await act(async () => {
				confirmButton.click();
			});
			await flush();

			expect(mockCleanMergedWorktrees).toHaveBeenCalledWith(
				expect.objectContaining({ dryRun: false, categories: ["orphaned"], taskIds: ["bbb22"] }),
			);
		});

		it("cleans legacy leftovers without touching the age-gated Claude tier", async () => {
			mockCleanClaudeCache.mockResolvedValue({ ok: true, cleaned: [], skipped: [] });
			await openDialog();

			const legacyCheckbox = document.body.querySelector('[data-testid="cleanup-legacy-checkbox"]') as HTMLElement;
			await act(async () => {
				legacyCheckbox.click();
			});
			await flush();

			const confirmButton = document.body.querySelector('[data-testid="cleanup-confirm-button"]') as HTMLButtonElement;
			await act(async () => {
				confirmButton.click();
			});
			await flush();

		expect(mockCleanClaudeCache).toHaveBeenCalledWith(
			expect.objectContaining({ includeLegacy: true, includeSafe: false, includeTranscripts: false }),
		);
		});

		it("renders tmp/npm/nvm controls and recycle-bin disposal mode", async () => {
			await openDialog();

			expect(document.body.querySelector('[data-testid="cleanup-tmp-checkbox"]')).not.toBeNull();
			expect(document.body.querySelector('[data-testid="cleanup-npm-cache-checkbox"]')).not.toBeNull();
			expect(document.body.querySelector('[data-testid="cleanup-nvm-cache-checkbox"]')).not.toBeNull();
			expect(document.body.querySelector('[data-testid="cleanup-dispose-recycle-bin"]')).not.toBeNull();
			expect(document.body.querySelector('[data-testid="cleanup-empty-recycle-bin-button"]')).not.toBeNull();
		});
	});
});
