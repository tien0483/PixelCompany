import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import { ReviewRepoLockChip } from "@/components/review/review-repo-lock-chip";
import type { RuntimeProjectSummary } from "@/runtime/types";

function project(id: string, name: string, path: string): RuntimeProjectSummary {
	return {
		id,
		name,
		path,
		taskCounts: { backlog: 0, in_progress: 0, review: 0, trash: 0 },
	};
}

const PROJECTS = [project("a", "alpha", "/repos/alpha"), project("b", "beta", "/repos/beta")];

describe("ReviewRepoLockChip", () => {
	let container: HTMLDivElement;
	let root: Root;
	let previousActEnvironment: boolean | undefined;
	let onLock: Mock<(path: string) => void>;
	let onUnlock: Mock<() => void>;

	beforeEach(() => {
		previousActEnvironment = (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
			.IS_REACT_ACT_ENVIRONMENT;
		(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
		onLock = vi.fn<(path: string) => void>();
		onUnlock = vi.fn<() => void>();
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		vi.restoreAllMocks();
		container.remove();
		if (previousActEnvironment === undefined) {
			delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
		} else {
			(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
				previousActEnvironment;
		}
	});

	async function renderChip(
		overrides: {
			projects?: RuntimeProjectSummary[];
			lockedPath?: string | null;
			shellRepoPath?: string | undefined;
		} = {},
	): Promise<void> {
		await act(async () => {
			root.render(
				<ReviewRepoLockChip
					projects={overrides.projects ?? PROJECTS}
					lockedPath={"lockedPath" in overrides ? (overrides.lockedPath ?? null) : "/repos/alpha"}
					shellRepoPath={"shellRepoPath" in overrides ? overrides.shellRepoPath : "/repos/alpha"}
					onLock={onLock}
					onUnlock={onUnlock}
				/>,
			);
		});
	}

	function select(): HTMLSelectElement {
		const element = container.querySelector<HTMLSelectElement>("[data-testid='review-repo-lock-select']");
		if (!element) {
			throw new Error("The repository pin select is not rendered.");
		}
		return element;
	}

	it("shows the pinned project as the selected option", async () => {
		await renderChip();
		expect(select().value).toBe("/repos/alpha");
		expect([...select().options].map((option) => option.textContent)).toEqual([
			"Follow sidebar project",
			"alpha",
			"beta",
		]);
	});

	it("renders nothing when there is neither a project list nor a pin", async () => {
		await renderChip({ projects: [], lockedPath: null });
		expect(container.querySelector("[data-testid='review-repo-lock-chip']")).toBeNull();
	});

	it("keeps a pin whose project has left the sidebar list", async () => {
		await renderChip({ lockedPath: "/repos/gone" });
		// Silently resolving back to the shell's project is the bug this fixes, so the
		// removed checkout stays selected and gets its own option.
		expect(select().value).toBe("/repos/gone");
		expect([...select().options].map((option) => option.textContent)).toContain("gone (not in project list)");
	});

	it("says so when the pin is not the project the sidebar points at", async () => {
		await renderChip({ lockedPath: "/repos/beta", shellRepoPath: "/repos/alpha" });
		const chip = container.querySelector("[data-testid='review-repo-lock-chip']");
		expect(chip?.getAttribute("title")).toBe("Review is reading /repos/beta, not your selected project /repos/alpha.");
	});

	it("locks onto the picked project", async () => {
		await renderChip();
		await act(async () => {
			const element = select();
			element.value = "/repos/beta";
			element.dispatchEvent(new Event("change", { bubbles: true }));
		});
		expect(onLock).toHaveBeenCalledWith("/repos/beta");
		expect(onUnlock).not.toHaveBeenCalled();
	});

	it("unlocks back to following the sidebar", async () => {
		await renderChip();
		await act(async () => {
			const element = select();
			element.value = "";
			element.dispatchEvent(new Event("change", { bubbles: true }));
		});
		expect(onUnlock).toHaveBeenCalledTimes(1);
		expect(onLock).not.toHaveBeenCalled();
	});
});
