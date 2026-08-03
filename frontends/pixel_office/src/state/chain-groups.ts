// Chain grouping for board columns.
//
// A "chain" is a set of tasks linked by `chain` dependencies: a follower
// (dependency.fromTaskId) waits on, and shares the git worktree of, its prerequisite
// (dependency.toTaskId). Followers resolve transitively up to a single chain root.
// Backlog renders each chain as one collapsible guardrail; In Progress renders the
// same members as a queue stack (live head + queued followers) after Run chain.

import type { BoardCard, BoardDependency } from "@/types";

export interface BacklogChainGroup {
	/** Ultimate chain root (worktree owner), even if that task has left this column. */
	rootId: string;
	/**
	 * Members present in the column, in run order (breadth-first from the ultimate root).
	 * The first id is the stack head for this column.
	 */
	memberIdsInOrder: string[];
	/** First member still in this column — used as the group anchor when rendering. */
	stackHeadId: string;
}

export interface BacklogChainGrouping {
	/** One entry per chain that has at least two members present in the column. */
	groups: BacklogChainGroup[];
	/** Stack-head id keyed by every non-head member id, for quick lookup. */
	rootIdByMemberId: Map<string, string>;
	/** Group keyed by its stack-head id (first member still in the column). */
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
 * True when `taskId` participates in a chain dependency (as follower or prerequisite).
 */
function isChainParticipant(dependencies: BoardDependency[], taskId: string): boolean {
	return dependencies.some(
		(dependency) =>
			dependency.chain === true && (dependency.fromTaskId === taskId || dependency.toTaskId === taskId),
	);
}

/**
 * Groups cards in a single column into chains. Members may be a subset of the full chain
 * (e.g. root already Done, followers still In Progress). A group is emitted only when
 * two or more chain members are present in `cards`.
 */
export function computeChainGroups(cards: BoardCard[], dependencies: BoardDependency[]): BacklogChainGrouping {
	const cardIndexById = new Map<string, number>();
	cards.forEach((card, index) => {
		cardIndexById.set(card.id, index);
	});
	const cardIds = new Set(cardIndexById.keys());

	// Full chain adjacency (parent → children) for run-order BFS, not limited to this column.
	const childIdsByParentId = new Map<string, string[]>();
	for (const dependency of dependencies) {
		if (dependency.chain !== true) {
			continue;
		}
		const children = childIdsByParentId.get(dependency.toTaskId) ?? [];
		children.push(dependency.fromTaskId);
		childIdsByParentId.set(dependency.toTaskId, children);
	}
	for (const children of childIdsByParentId.values()) {
		children.sort((a, b) => (cardIndexById.get(a) ?? 0) - (cardIndexById.get(b) ?? 0));
	}

	const membersByUltimateRoot = new Map<string, string[]>();
	for (const card of cards) {
		if (!isChainParticipant(dependencies, card.id)) {
			continue;
		}
		const ultimateRoot = resolveChainRootId(dependencies, card.id);
		const members = membersByUltimateRoot.get(ultimateRoot) ?? [];
		members.push(card.id);
		membersByUltimateRoot.set(ultimateRoot, members);
	}

	const groups: BacklogChainGroup[] = [];
	const rootIdByMemberId = new Map<string, string>();
	const groupByRootId = new Map<string, BacklogChainGroup>();

	for (const [ultimateRoot, _members] of membersByUltimateRoot) {
		const memberIdsInOrder: string[] = [];
		const visited = new Set<string>();
		const queue = [ultimateRoot];
		while (queue.length > 0) {
			const current = queue.shift() as string;
			if (visited.has(current)) {
				continue;
			}
			visited.add(current);
			if (cardIds.has(current)) {
				memberIdsInOrder.push(current);
			}
			for (const childId of childIdsByParentId.get(current) ?? []) {
				queue.push(childId);
			}
		}
		if (memberIdsInOrder.length < 2) {
			continue;
		}
		const stackHeadId = memberIdsInOrder[0] as string;
		const group: BacklogChainGroup = {
			rootId: ultimateRoot,
			memberIdsInOrder,
			stackHeadId,
		};
		groups.push(group);
		groupByRootId.set(stackHeadId, group);
		for (const memberId of memberIdsInOrder) {
			if (memberId !== stackHeadId) {
				rootIdByMemberId.set(memberId, stackHeadId);
			}
		}
	}

	return { groups, rootIdByMemberId, groupByRootId };
}

/**
 * Groups Backlog cards into chains. Alias of {@link computeChainGroups} for callers that
 * only pass Backlog cards.
 */
export function computeBacklogChainGroups(cards: BoardCard[], dependencies: BoardDependency[]): BacklogChainGrouping {
	return computeChainGroups(cards, dependencies);
}
