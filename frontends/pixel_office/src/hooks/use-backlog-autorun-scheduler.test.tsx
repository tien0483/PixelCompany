import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useBacklogAutorunScheduler } from "@/hooks/use-backlog-autorun-scheduler";
import type { BoardCard, BoardData } from "@/types";

function card(id: string, autoRunAt: number | null): BoardCard {
	return {
		id,
		title: id,
		prompt: id,
		startInPlanMode: false,
		baseRef: "main",
		createdAt: 0,
		updatedAt: 0,
		...(autoRunAt != null ? { autoRunAt } : {}),
	};
}

function board(
	backlog: BoardCard[],
	inProgress: BoardCard[] = [],
	dependencies: BoardData["dependencies"] = [],
): BoardData {
	return {
		columns: [
			{ id: "backlog", title: "Backlog", cards: backlog },
			{ id: "in_progress", title: "In Progress", cards: inProgress },
			{ id: "review", title: "Review", cards: [] },
			{ id: "trash", title: "Done", cards: [] },
		],
		dependencies,
	};
}

function Harness({
	board: boardData,
	maxRunningTasks,
	onStartTask,
}: {
	board: BoardData;
	maxRunningTasks: number;
	onStartTask: (taskId: string) => void;
}) {
	useBacklogAutorunScheduler({ board: boardData, maxRunningTasks, onStartTask });
	return null;
}

let container: HTMLDivElement;
let root: Root;

function renderHarness(props: { board: BoardData; maxRunningTasks: number; onStartTask: (taskId: string) => void }) {
	act(() => {
		root.render(<Harness {...props} />);
	});
}

function tick() {
	act(() => {
		vi.advanceTimersByTime(1000);
	});
}

describe("useBacklogAutorunScheduler", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(1_000_000);
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});
	afterEach(() => {
		act(() => {
			root.unmount();
		});
		container.remove();
		vi.useRealTimers();
	});

	it("starts a due card when a slot is free", () => {
		const onStartTask = vi.fn();
		renderHarness({ board: board([card("a", 500_000)]), maxRunningTasks: 3, onStartTask });
		tick();
		expect(onStartTask).toHaveBeenCalledWith("a");
	});

	it("does not start a card whose countdown is still in the future", () => {
		const onStartTask = vi.fn();
		renderHarness({ board: board([card("a", 2_000_000)]), maxRunningTasks: 3, onStartTask });
		tick();
		expect(onStartTask).not.toHaveBeenCalled();
	});

	it("defers due cards past the max-running cap", () => {
		const onStartTask = vi.fn();
		renderHarness({
			board: board([card("a", 500_000), card("b", 500_000)], [card("r1", null)]),
			maxRunningTasks: 1,
			onStartTask,
		});
		tick();
		// One slot already used (r1) with cap 1 → no available slots → nothing starts.
		expect(onStartTask).not.toHaveBeenCalled();
	});

	it("starts only up to the available slots, earliest countdown first", () => {
		const onStartTask = vi.fn();
		renderHarness({
			board: board([card("late", 900_000), card("early", 500_000)]),
			maxRunningTasks: 1,
			onStartTask,
		});
		tick();
		expect(onStartTask).toHaveBeenCalledTimes(1);
		expect(onStartTask).toHaveBeenCalledWith("early");
	});

	it("respects the dependency gate (skips a card blocked by a backlog dependency)", () => {
		const onStartTask = vi.fn();
		// "a" depends on "b"; both in backlog → "a" is not startable.
		renderHarness({
			board: board([card("a", 500_000), card("b", null)], [], [{ id: "d1", fromTaskId: "a", toTaskId: "b" }]),
			maxRunningTasks: 3,
			onStartTask,
		});
		tick();
		expect(onStartTask).not.toHaveBeenCalledWith("a");
	});

	it("does not re-fire the same card within the grace window", () => {
		const onStartTask = vi.fn();
		// Board is not updated after start (simulating async move lag) — card stays due in backlog.
		renderHarness({ board: board([card("a", 500_000)]), maxRunningTasks: 3, onStartTask });
		tick();
		tick();
		tick();
		expect(onStartTask).toHaveBeenCalledTimes(1);
	});
});
