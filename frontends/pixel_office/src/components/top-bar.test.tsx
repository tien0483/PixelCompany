import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TopBar } from "@/components/top-bar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { setHomeGitSummary } from "@/stores/workspace-metadata-store";

function findButtonByText(
	container: HTMLElement,
	text: string,
): HTMLButtonElement | null {
	return (Array.from(container.querySelectorAll("button")).find(
		(button) => button.textContent?.trim() === text,
	) ?? null) as HTMLButtonElement | null;
}

describe("TopBar action cluster", () => {
	let container: HTMLDivElement;
	let root: Root;
	let previousActEnvironment: boolean | undefined;

	beforeEach(() => {
		previousActEnvironment = (
			globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
		).IS_REACT_ACT_ENVIRONMENT;
		(
			globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
		).IS_REACT_ACT_ENVIRONMENT = true;
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		container.remove();
		if (previousActEnvironment === undefined) {
			delete (
				globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
			).IS_REACT_ACT_ENVIRONMENT;
		} else {
			(
				globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
			).IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
		}
	});

	it("groups the labelled view toggles ahead of the icon-only tools", async () => {
		await act(async () => {
			root.render(
				<TooltipProvider>
					<TopBar
						openTargetOptions={[]}
						selectedOpenTargetId="vscode"
						onSelectOpenTarget={() => {}}
						openPlatformOverride="auto"
						onSelectOpenPlatform={() => {}}
						detectedOpenPlatform={null}
						onOpenWorkspace={() => {}}
						canOpenWorkspace={false}
						isOpeningWorkspace={false}
						onToggleOffice={() => {}}
						onToggleDocs={() => {}}
						onToggleLearning={() => {}}
						onToggleUnderstand={() => {}}
						onOpenStack={() => {}}
						onOpenCleanup={() => {}}
						onToggleTerminal={() => {}}
					/>
				</TooltipProvider>,
			);
		});

		const labels = Array.from(container.querySelectorAll("button"))
			.map((button) => button.getAttribute("aria-label"))
			.filter((label): label is string => label !== null);

		expect(labels).toEqual([
			"Show watch and office column",
			"Show docs",
			"Show learning",
			"Show understand",
			"Agent stack",
			"Cleanup",
			"Open terminal",
			"Settings",
		]);
	});

	it("does not render a Run button", async () => {
		await act(async () => {
			root.render(
				<TooltipProvider>
					<TopBar
						openTargetOptions={[]}
						selectedOpenTargetId="vscode"
						onSelectOpenTarget={() => {}}
						openPlatformOverride="auto"
						onSelectOpenPlatform={() => {}}
						detectedOpenPlatform={null}
						onOpenWorkspace={() => {}}
						canOpenWorkspace={false}
						isOpeningWorkspace={false}
						onToggleTerminal={() => {}}
					/>
				</TooltipProvider>,
			);
		});

		expect(findButtonByText(container, "Run")).toBeNull();
	});

	it("opens settings when the runtime hint is clicked", async () => {
		const onOpenSettings = vi.fn();

		await act(async () => {
			root.render(
				<TopBar
					openTargetOptions={[]}
					selectedOpenTargetId="vscode"
					onSelectOpenTarget={() => {}}
					openPlatformOverride="auto"
					onSelectOpenPlatform={() => {}}
					detectedOpenPlatform={null}
					onOpenWorkspace={() => {}}
					canOpenWorkspace={false}
					isOpeningWorkspace={false}
					runtimeHint="No agent configured"
					onOpenSettings={onOpenSettings}
				/>,
			);
		});

		const runtimeHintButton = findButtonByText(
			container,
			"No agent configured",
		);
		expect(runtimeHintButton).toBeInstanceOf(HTMLButtonElement);

		await act(async () => {
			runtimeHintButton?.dispatchEvent(
				new MouseEvent("mousedown", { bubbles: true }),
			);
			runtimeHintButton?.click();
		});

		expect(onOpenSettings).toHaveBeenCalledTimes(1);
	});

	it("renders the Cleanup button when onOpenCleanup is provided", async () => {
		const onOpenCleanup = vi.fn();

		await act(async () => {
			root.render(
				<TooltipProvider>
					<TopBar
						openTargetOptions={[]}
						selectedOpenTargetId="vscode"
						onSelectOpenTarget={() => {}}
						openPlatformOverride="auto"
						onSelectOpenPlatform={() => {}}
						detectedOpenPlatform={null}
						onOpenWorkspace={() => {}}
						canOpenWorkspace={false}
						isOpeningWorkspace={false}
						onOpenCleanup={onOpenCleanup}
					/>
				</TooltipProvider>,
			);
		});

		const cleanupButton = container.querySelector('[aria-label="Cleanup"]') as HTMLButtonElement | null;
		expect(cleanupButton).not.toBeNull();

		await act(async () => {
			cleanupButton?.click();
		});
		expect(onOpenCleanup).toHaveBeenCalledTimes(1);
	});
});

describe("TopBar home git cluster", () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		(
			globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
		).IS_REACT_ACT_ENVIRONMENT = true;
		setHomeGitSummary({
			currentBranch: "main",
			upstreamBranch: "origin/main",
			changedFiles: 2,
			additions: 3,
			deletions: 1,
			aheadCount: 0,
			behindCount: 0,
		});
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => root.unmount());
		setHomeGitSummary(null);
		container.remove();
	});

	async function renderCluster(handlers: {
		onGitStash?: () => void;
		onGitStashPop?: () => void;
		onGitCommit?: () => void;
		onGitPullRequest?: () => void;
		onGitWorktrees?: () => void;
		onGitConflicts?: () => void;
	}): Promise<void> {
		await act(async () => {
			root.render(
				<TooltipProvider>
					<TopBar
						openTargetOptions={[]}
						selectedOpenTargetId="vscode"
						onSelectOpenTarget={() => {}}
						openPlatformOverride="auto"
						onSelectOpenPlatform={() => {}}
						detectedOpenPlatform={null}
						onOpenWorkspace={() => {}}
						canOpenWorkspace={false}
						isOpeningWorkspace={false}
						showHomeGitSummary
						{...handlers}
					/>
				</TooltipProvider>,
			);
		});
	}

	function clickByLabel(label: string): void {
		const button = document.querySelector(
			`[aria-label="${label}"]`,
		) as HTMLButtonElement | null;
		button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
	}

	it("wires the stash, commit, PR, worktree, and conflict buttons", async () => {
		const onGitStash = vi.fn();
		const onGitStashPop = vi.fn();
		const onGitCommit = vi.fn();
		const onGitPullRequest = vi.fn();
		const onGitWorktrees = vi.fn();
		const onGitConflicts = vi.fn();

		await renderCluster({
			onGitStash,
			onGitStashPop,
			onGitCommit,
			onGitPullRequest,
			onGitWorktrees,
			onGitConflicts,
		});

		await act(async () => {
			clickByLabel("Stash working changes");
			clickByLabel("Pop stashed changes");
			clickByLabel("Commit changes");
			clickByLabel("Create pull request");
			clickByLabel("List worktrees");
			clickByLabel("Resolve merge conflicts");
		});

		expect(onGitStash).toHaveBeenCalledTimes(1);
		expect(onGitStashPop).toHaveBeenCalledTimes(1);
		expect(onGitCommit).toHaveBeenCalledTimes(1);
		expect(onGitPullRequest).toHaveBeenCalledTimes(1);
		expect(onGitWorktrees).toHaveBeenCalledTimes(1);
		expect(onGitConflicts).toHaveBeenCalledTimes(1);
	});

	it("disables stash and commit when the tree is clean", async () => {
		setHomeGitSummary({
			currentBranch: "main",
			upstreamBranch: "origin/main",
			changedFiles: 0,
			additions: 0,
			deletions: 0,
			aheadCount: 0,
			behindCount: 0,
		});
		await renderCluster({ onGitStash: vi.fn(), onGitCommit: vi.fn() });

		const stash = document.querySelector(
			'[aria-label="Stash working changes"]',
		) as HTMLButtonElement;
		const commit = document.querySelector(
			'[aria-label="Commit changes"]',
		) as HTMLButtonElement;
		expect(stash.disabled).toBe(true);
		expect(commit.disabled).toBe(true);
	});
});
