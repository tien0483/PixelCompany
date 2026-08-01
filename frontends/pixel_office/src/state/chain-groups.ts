// Chain grouping for the Backlog column.
//
// A "chain" is a set of Backlog tasks linked by `chain` dependencies: a follower
// (dependency.fromTaskId) waits on, and shares the git worktree of, its prerequisite
// (dependency.toTaskId). Followers resolve transitively up to a single chain root.
// The Backlog renders each chain as one collapsible guardrail group so the members read
// as a unit that runs sequentially in one worktree.

import type { BoardCard, BoardDependency } from "@/types";

export interface BacklogChainGroup {
	/** The chain root: the member that runs first and owns the shared worktree. */
	rootId: string;
	/** Root first, then followers in run order (breadth-first from the root). */
	memberIdsInOrder: string[];
}

export interface BacklogChainGrouping {
	/** One entry per chain root that has at least one follower present in Backlog. */
	groups: BacklogChainGroup[];
	/** Root id keyed by every non-root member id (followers), for quick lookup. */
	rootIdByMemberId: Map<string, string>;
	/** Group keyed by its root id. */
	groupByRootId: Map<string, BacklogChainGroup>;
}

/**
 * Walks `chain` dependencies from a task up to its chain root. A follower is the
 * `fromTaskId` of a chain dependency; its parent is the `toTaskId`. Returns the task's
 * own id when it is not a follower. Cycle-guarded.
 */
export function resolveChainRootId(dependencies: BoardDependency[], taskId: string): string {
	const seen = new Set<string>();
	let current = taskId;
	while (!seen.has(current)) {
		seen.add(current);
		const chainDependency = dependencies.find(
			(dependency) => dependency.chain === true && dependency.fromTaskId === current,
		);
		if (!chainDependency) {
			break;
		}
		current = chainDependency.toTaskId;
	}
	return current;
}

/**
 * Groups Backlog cards into chains. Only members present in `cards` (i.e. still in
 * Backlog) are grouped; a chain whose root has left Backlog is not grouped. A chain
 * group is emitted only when a root has at least one follower in Backlog.
 */
export function computeBacklogChainGroups(cards: BoardCard[], dependencies: BoardDependency[]): BacklogChainGrouping {
	const cardIndexById = new Map<string, number>();
	cards.forEach((card, index) => {
		cardIndexById.set(card.id, index);
	});

	// Adjacency: parent (prerequisite, toTaskId) -> children (followers, fromTaskId),
	// restricted to chain dependencies whose both endpoints are still in Backlog.
	const childIdsByParentId = new Map<string, string[]>();
	for (const dependency of dependencies) {
		if (dependency.chain !== true) {
			continue;
		}
		if (!cardIndexById.has(dependency.fromTaskId) || !cardIndexById.has(dependency.toTaskId)) {
			continue;
		}
		const children = childIdsByParentId.get(dependency.toTaskId) ?? [];
		children.push(dependency.fromTaskId);
		childIdsByParentId.set(dependency.toTaskId, children);
	}
	// Stable child order by Backlog position.
	for (const children of childIdsByParentId.values()) {
		children.sort((a, b) => (cardIndexById.get(a) ?? 0) - (cardIndexById.get(b) ?? 0));
	}

	const groups: BacklogChainGroup[] = [];
	const rootIdByMemberId = new Map<string, string>();
	const groupByRootId = new Map<string, BacklogChainGroup>();

	for (const card of cards) {
		// A root is a Backlog card that is not itself a follower but has followers.
		const isFollower = resolveChainRootId(dependencies, card.id) !== card.id;
		if (isFollower || !childIdsByParentId.has(card.id)) {
			continue;
		}
		const memberIdsInOrder: string[] = [];
		const visited = new Set<string>();
		const queue = [card.id];
		while (queue.length > 0) {
			const current = queue.shift() as string;
			if (visited.has(current)) {
				continue;
			}
			visited.add(current);
			memberIdsInOrder.push(current);
			for (const childId of childIdsByParentId.get(current) ?? []) {
				queue.push(childId);
			}
		}
		if (memberIdsInOrder.length < 2) {
			continue;
		}
		const group: BacklogChainGroup = { rootId: card.id, memberIdsInOrder };
		groups.push(group);
		groupByRootId.set(card.id, group);
		for (const memberId of memberIdsInOrder) {
			if (memberId !== card.id) {
				rootIdByMemberId.set(memberId, card.id);
			}
		}
	}

	return { groups, rootIdByMemberId, groupByRootId };
}
