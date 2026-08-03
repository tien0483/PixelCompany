import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	BoardCardReviewGitActions,
	type ReviewGitBranchedSubmit,
} from "@/components/board-card-review-git-actions";

describe("BoardCardReviewGitActions", () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		container.remove();
	});

	it("renders Commit and does not render Open PR", async () => {
		await act(async () => {
			root.render(
				<BoardCardReviewGitActions
					disabled={false}
					isCommitLoading={false}
					baseRefHint="main"
					branchSuggestions={["main"]}
					onCommit={() => {}}
					onSubmitBranched={() => {}}
					onCancelForm={() => {}}
				/>,
			);
		});

		expect(container.textContent).toContain("Commit");
		expect(container.textContent).not.toContain("Open PR");
	});

	it("submits on-card branch form for an existing branch", async () => {
		const onSubmitBranched = vi.fn<(input: ReviewGitBranchedSubmit) => void>();

		await act(async () => {
			root.render(
				<BoardCardReviewGitActions
					disabled={false}
					isCommitLoading={false}
					baseRefHint="main"
					branchSuggestions={["main", "develop"]}
					initialFormMode="commit-with-branch"
					onCommit={() => {}}
					onSubmitBranched={onSubmitBranched}
					onCancelForm={() => {}}
				/>,
			);
		});

		expect(container.textContent).toContain("Commit with branch name");
		expect(container.textContent).toContain("Branch already exists");

		const onto = Array.from(container.querySelectorAll("button")).find((button) =>
			button.textContent?.includes("Commit onto that branch"),
		);
		expect(onto).toBeTruthy();
		await act(async () => {
			onto?.click();
		});

		const go = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Go");
		expect(go).toBeTruthy();
		expect((go as HTMLButtonElement).disabled).toBe(false);
		await act(async () => {
			go?.click();
		});

		expect(onSubmitBranched).toHaveBeenCalledWith({
			mode: "commit-with-branch",
			officialBranch: "main",
			existingMode: "onto-branch",
		});
	});
});
