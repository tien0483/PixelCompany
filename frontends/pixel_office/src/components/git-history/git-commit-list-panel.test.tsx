import { act } from "react";
import type { ReactElement, ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GitCommitListPanel } from "@/components/git-history/git-commit-list-panel";
import type { RuntimeGitCommit } from "@/runtime/types";

vi.mock("react-virtuoso", () => ({
	Virtuoso: ({
		data,
		itemContent,
	}: {
		data: RuntimeGitCommit[];
		itemContent: (index: number, commit: RuntimeGitCommit) => ReactNode;
	}) => (
		<div data-testid="virtuoso-mock">
			{data.map((commit, index) => (
				<div key={commit.hash}>{itemContent(index, commit)}</div>
			))}
		</div>
	),
}));

let container: HTMLDivElement;
let root: Root;

function renderUi(element: ReactElement): void {
	root.render(element);
}

const COMMIT: RuntimeGitCommit = {
	hash: "abcdef1234567890",
	shortHash: "abcdef1",
	message: "Fix login",
	authorName: "Ada",
	authorEmail: "ada@example.com",
	date: new Date().toISOString(),
	parentHashes: [],
};

beforeEach(() => {
	(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(() => {
	act(() => root.unmount());
	container.remove();
	vi.clearAllMocks();
});

describe("GitCommitListPanel cherry-pick context menu", () => {
	it("opens cherry-pick menu on right-click when HEAD is available", () => {
		const onCherryPickCommit = vi.fn();
		act(() => {
			renderUi(
				<GitCommitListPanel
					commits={[COMMIT]}
					totalCount={1}
					selectedCommitHash={null}
					isLoading={false}
					isLoadingMore={false}
					canLoadMore={false}
					refs={[]}
					panelWidth={360}
					onSelectCommit={() => undefined}
					headBranchName="main"
					onCherryPickCommit={onCherryPickCommit}
				/>,
			);
		});

		const row = container.querySelector(".kb-git-commit-row") as HTMLElement;
		expect(row).toBeTruthy();
		act(() => {
			row.dispatchEvent(
				new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 12, clientY: 24 }),
			);
		});

		expect(container.querySelector('[role="menu"]')).not.toBeNull();
		const item = Array.from(container.querySelectorAll('[role="menuitem"]')).find((el) =>
			(el.textContent ?? "").includes("Cherry pick"),
		);
		expect(item).toBeTruthy();
		act(() => {
			item!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
		});
		expect(onCherryPickCommit).toHaveBeenCalledWith(COMMIT.hash);
	});

	it("does not open cherry-pick menu when HEAD is unavailable", () => {
		act(() => {
			renderUi(
				<GitCommitListPanel
					commits={[COMMIT]}
					totalCount={1}
					selectedCommitHash={null}
					isLoading={false}
					isLoadingMore={false}
					canLoadMore={false}
					refs={[]}
					panelWidth={360}
					onSelectCommit={() => undefined}
					headBranchName={null}
					onCherryPickCommit={() => undefined}
				/>,
			);
		});

		const row = container.querySelector(".kb-git-commit-row") as HTMLElement;
		expect(row).toBeTruthy();
		act(() => {
			row.dispatchEvent(
				new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 12, clientY: 24 }),
			);
		});
		expect(container.querySelector('[role="menu"]')).toBeNull();
	});
});
