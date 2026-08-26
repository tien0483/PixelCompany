import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import { ReviewImpactPanel } from "@/components/review/review-impact-panel";
import type { RuntimeReviewGraphImpactResponse } from "@/runtime/types";

function impactResponse(
	overrides: Partial<RuntimeReviewGraphImpactResponse> = {},
): RuntimeReviewGraphImpactResponse {
	return {
		ok: true,
		hasGraph: true,
		dataDir: "/repo/.ua",
		project: { name: "repo" },
		nodeCount: 100,
		edgeCount: 200,
		freshness: {
			graphCommit: "abc1234",
			headCommit: "abc1234",
			changedSinceGraph: [],
			changedSinceGraphCount: 0,
			isStale: false,
		},
		changed: [{ nodeId: "file:src/core.py", type: "file", name: "core.py", filePath: "src/core.py" }],
		affected: [
			{
				nodeId: "file:src/api.py",
				type: "file",
				name: "api.py",
				filePath: "src/api.py",
				via: "imports",
				direction: "dependent",
			},
		],
		affectedOmitted: 0,
		dependencies: [],
		dependenciesOmitted: 0,
		layers: [],
		unmatchedPaths: [],
		...overrides,
	};
}

const STALE_FRESHNESS: NonNullable<RuntimeReviewGraphImpactResponse["freshness"]> = {
	graphCommit: "abc1234",
	headCommit: "def5678",
	changedSinceGraph: ["src/core.py", "src/api.py"],
	changedSinceGraphCount: 2,
	isStale: true,
};

describe("ReviewImpactPanel", () => {
	let container: HTMLDivElement;
	let root: Root;
	let previousActEnvironment: boolean | undefined;
	// Typed explicitly: a bare `vi.fn()` widens to `Procedure | Constructable`, which
	// does not satisfy the panel's callback props.
	let onSelectPath: Mock<(path: string) => void>;
	let onRebuildGraph: Mock<() => void>;
	let onOpenDashboard: Mock<() => void>;
	let onRefresh: Mock<() => void>;

	beforeEach(() => {
		previousActEnvironment = (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
			.IS_REACT_ACT_ENVIRONMENT;
		(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
		onSelectPath = vi.fn<(path: string) => void>();
		onRebuildGraph = vi.fn<() => void>();
		onOpenDashboard = vi.fn<() => void>();
		onRefresh = vi.fn<() => void>();
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

	async function renderPanel(
		overrides: {
			impact?: RuntimeReviewGraphImpactResponse | null;
			isLoading?: boolean;
			projectPath?: string | undefined;
			isRebuilding?: boolean;
			canRebuild?: boolean;
		} = {},
	): Promise<void> {
		await act(async () => {
			root.render(
				<ReviewImpactPanel
					impact={overrides.impact === undefined ? impactResponse() : overrides.impact}
					isLoading={overrides.isLoading ?? false}
					projectPath={"projectPath" in overrides ? overrides.projectPath : "/repo"}
					isRebuilding={overrides.isRebuilding ?? false}
					canRebuild={overrides.canRebuild ?? true}
					onRefresh={onRefresh}
					onRebuildGraph={onRebuildGraph}
					onOpenDashboard={onOpenDashboard}
					onSelectPath={onSelectPath}
				/>,
			);
		});
	}

	function text(): string {
		return container.textContent ?? "";
	}

	function findButton(match: RegExp): HTMLButtonElement {
		const button = Array.from(container.querySelectorAll("button")).find((candidate) =>
			match.test(candidate.textContent ?? ""),
		);
		if (!button) {
			throw new Error(`No button matching ${String(match)}. Buttons: ${
				Array.from(container.querySelectorAll("button"))
					.map((candidate) => candidate.textContent)
					.join(" | ")
			}`);
		}
		return button;
	}

	function clickElementWithText(value: string): void {
		const node = Array.from(container.querySelectorAll("span")).find(
			(candidate) => candidate.textContent === value,
		);
		if (!node) {
			throw new Error(`No element with text ${value}.`);
		}
		act(() => {
			node.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});
	}

	it("labels dependents as what may break and dependencies as context", async () => {
		await renderPanel({
			impact: impactResponse({
				dependencies: [
					{
						nodeId: "file:src/types.py",
						type: "file",
						name: "types.py",
						filePath: "src/types.py",
						via: "imports",
						direction: "dependency",
					},
				],
			}),
		});

		expect(text()).toContain("this is what may break");
		expect(text()).toContain("context, not blast radius");
	});

	it("says nothing depends on the change rather than rendering an empty list", async () => {
		await renderPanel({ impact: impactResponse({ affected: [] }) });

		expect(text()).toContain("Nothing in the graph depends on the changed code.");
	});

	it("offers to build a graph, not an error, when the project has never been analyzed", async () => {
		await renderPanel({ impact: impactResponse({ hasGraph: false }) });

		expect(text()).toContain("no knowledge graph");
		// The reviewer has to know this does not come out of the review seat.
		expect(text()).toContain("Antigravity seat");
		act(() => {
			findButton(/Build knowledge graph/).dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});

		expect(onRebuildGraph).toHaveBeenCalledOnce();
	});

	it("blocks the build when no Antigravity seat exists, and says why", async () => {
		await renderPanel({ impact: impactResponse({ hasGraph: false }), canRebuild: false });

		expect(findButton(/Build knowledge graph/).disabled).toBe(true);
		expect(text()).toContain("No Antigravity seat is configured");
	});

	it("warns that the impact may be incomplete when the graph is stale", async () => {
		await renderPanel({ impact: impactResponse({ freshness: STALE_FRESHNESS }) });

		expect(text()).toContain("2 files changed since the graph was built");
		act(() => {
			findButton(/Rebuild graph/).dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});

		expect(onRebuildGraph).toHaveBeenCalledOnce();
	});

	it("does not offer a rebuild while one is already running", async () => {
		await renderPanel({ impact: impactResponse({ freshness: STALE_FRESHNESS }), isRebuilding: true });

		expect(findButton(/Rebuilding graph/).disabled).toBe(true);
	});

	it("opens a changed file in the diff pane but leaves a dependent alone", async () => {
		// A dependent lives outside the merge request by definition, so there is no diff
		// to jump to — offering the click would look broken.
		await renderPanel();

		clickElementWithText("src/core.py");
		expect(onSelectPath).toHaveBeenCalledWith("src/core.py");

		onSelectPath.mockClear();
		clickElementWithText("src/api.py");
		expect(onSelectPath).not.toHaveBeenCalled();
	});

	it("lists the paths the graph has no node for", async () => {
		await renderPanel({ impact: impactResponse({ unmatchedPaths: ["src/brand_new.py"] }) });

		expect(text()).toContain("Not in the graph (1)");
		expect(text()).toContain("src/brand_new.py");
	});

	it("explains the missing checkout instead of blaming the graph", async () => {
		await renderPanel({ projectPath: undefined });

		expect(text()).toContain("No local checkout is selected");
	});

	it("reports a read failure verbatim", async () => {
		await renderPanel({ impact: impactResponse({ ok: false, hasGraph: false, error: "boom" }) });

		expect(text()).toContain("could not be read: boom");
	});
});
