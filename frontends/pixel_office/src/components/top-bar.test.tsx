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

function setInputValue(input: HTMLInputElement, value: string): void {
	const descriptor = Object.getOwnPropertyDescriptor(
		window.HTMLInputElement.prototype,
		"value",
	);
	descriptor?.set?.call(input, value);
	input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("TopBar script shortcut onboarding", () => {
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

	it("opens first-shortcut dialog from Run and saves when command is provided", async () => {
		const onCreateFirstShortcut = vi.fn(async () => ({ ok: true }));
		const onRunShortcut = vi.fn();

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
					shortcuts={[]}
					onRunShortcut={onRunShortcut}
					onCreateFirstShortcut={onCreateFirstShortcut}
				/>,
			);
		});

		const runButton = findButtonByText(container, "Run");
		expect(runButton).toBeInstanceOf(HTMLButtonElement);

		await act(async () => {
			runButton?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
			runButton?.click();
		});

		expect(document.body.textContent).toContain(
			"Set up your first script shortcut",
		);

		const commandInput = Array.from(
			document.body.querySelectorAll("input"),
		).find((input) => input.placeholder === "npm run dev") as
			| HTMLInputElement
			| undefined;
		expect(commandInput).toBeDefined();
		expect(commandInput?.value).toBe("");

		const saveButton = findButtonByText(document.body, "Save");
		expect(saveButton).toBeInstanceOf(HTMLButtonElement);
		expect(saveButton?.disabled).toBe(true);

		await act(async () => {
			if (!commandInput) {
				return;
			}
			setInputValue(commandInput, "pnpm dev");
		});
		expect(saveButton?.disabled).toBe(false);

		await act(async () => {
			saveButton?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
			saveButton?.click();
		});

		expect(onCreateFirstShortcut).toHaveBeenCalledWith({
			label: "Run",
			command: "pnpm dev",
			icon: "play",
		});
		expect(onRunShortcut).not.toHaveBeenCalled();
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
						shortcuts={[]}
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
