import type {
	RuntimeAgentId,
	RuntimeBoardCard,
	RuntimeBoardColumnId,
	RuntimeBoardData,
	RuntimeBoardDependency,
	RuntimeTaskAutoReviewMode,
	RuntimeTaskClineSettings,
	RuntimeTaskImage,
	RuntimeTaskLaunchSettings,
} from "./api-contract";
import { createUniqueTaskId } from "./task-id";
import { resolveTaskTitle } from "./task-title";

export interface RuntimeCreateTaskInput {
	taskId?: string;
	title?: string;
	prompt: string;
	startInPlanMode?: boolean;
	autoReviewEnabled?: boolean;
	autoReviewMode?: RuntimeTaskAutoReviewMode;
	images?: RuntimeTaskImage[];
	agentId?: RuntimeAgentId;
	managerAccountId?: number;
	clineSettings?: RuntimeTaskClineSettings;
	taskLaunchSettings?: RuntimeTaskLaunchSettings;
	/** Epoch ms for a scheduled backlog auto-run (countdown set at create time). */
	autoRunAt?: number | null;
	baseRef: string;
}

export interface RuntimeUpdateTaskInput {
	title?: string;
	prompt: string;
	startInPlanMode?: boolean;
	autoReviewEnabled?: boolean;
	autoReviewMode?: RuntimeTaskAutoReviewMode;
	images?: RuntimeTaskImage[];
	agentId?: RuntimeAgentId | null;
	clineSettings?: RuntimeTaskClineSettings | null;
	taskLaunchSettings?: RuntimeTaskLaunchSettings | null;
	baseRef: string;
}

function normalizeTaskAutoReviewMode(value: RuntimeTaskAutoReviewMode | null | undefined): RuntimeTaskAutoReviewMode {
	if (value === "pr") {
		return value;
	}
	return "commit";
}

// Copy image metadata so board tasks do not retain caller-owned array or object references.
function cloneTaskImages(images?: RuntimeTaskImage[]): RuntimeTaskImage[] | undefined {
	return images && images.length > 0 ? images.map((image) => ({ ...image })) : undefined;
}

function cloneTaskClineSettings(settings?: RuntimeTaskClineSettings | null): RuntimeTaskClineSettings | undefined {
	if (settings === undefined || settings === null) {
		return undefined;
	}
	const providerId = settings.providerId?.trim();
	const modelId = settings.modelId?.trim();
	return {
		...(providerId ? { providerId } : {}),
		...(modelId ? { modelId } : {}),
		...(settings.reasoningEffort ? { reasoningEffort: settings.reasoningEffort } : {}),
	};
}

function cloneTaskLaunchSettings(
	settings?: RuntimeTaskLaunchSettings | null,
): RuntimeTaskLaunchSettings | undefined {
	if (settings === undefined || settings === null) {
		return undefined;
	}
	const modelId = settings.modelId?.trim();
	const skillIds =
		settings.skillIds === undefined
			? undefined
			: [...new Set(settings.skillIds.map((id) => id.trim()).filter((id) => id.length > 0))];
	const agentIds =
		settings.agentIds === undefined
			? undefined
			: [...new Set(settings.agentIds.map((id) => id.trim()).filter((id) => id.length > 0))];
	const commandIds =
		settings.commandIds === undefined
			? undefined
			: [...new Set(settings.commandIds.map((id) => id.trim()).filter((id) => id.length > 0))];
	const mcpServerIds =
		settings.mcpServerIds === undefined
			? undefined
			: [...new Set(settings.mcpServerIds.map((id) => id.trim()).filter((id) => id.length > 0))];
	const next: RuntimeTaskLaunchSettings = {
		...(modelId ? { modelId } : {}),
		...(settings.effort ? { effort: settings.effort } : {}),
		...(skillIds && skillIds.length > 0 ? { skillIds } : {}),
		...(agentIds && agentIds.length > 0 ? { agentIds } : {}),
		...(commandIds && commandIds.length > 0 ? { commandIds } : {}),
		...(mcpServerIds && mcpServerIds.length > 0 ? { mcpServerIds } : {}),
	};
	if (
		next.modelId === undefined &&
		next.effort === undefined &&
		next.skillIds === undefined &&
		next.agentIds === undefined &&
		next.commandIds === undefined &&
		next.mcpServerIds === undefined
	) {
		return undefined;
	}
	return next;
}

export interface RuntimeCreateTaskResult {
	board: RuntimeBoardData;
	task: RuntimeBoardCard;
}

export interface RuntimeMoveTaskResult {
	moved: boolean;
	board: RuntimeBoardData;
	task: RuntimeBoardCard | null;
	fromColumnId: RuntimeBoardColumnId | null;
}

export interface RuntimeUpdateTaskResult {
	board: RuntimeBoardData;
	task: RuntimeBoardCard | null;
	updated: boolean;
}

export interface RuntimeAddTaskDependencyResult {
	board: RuntimeBoardData;
	added: boolean;
	reason?: "missing_task" | "same_task" | "duplicate" | "trash_task" | "non_backlog" | "chain_conflict";
	dependency?: RuntimeBoardDependency;
}

export interface RuntimeRemoveTaskDependencyResult {
	board: RuntimeBoardData;
	removed: boolean;
}

export interface RuntimeReorderChainResult {
	board: RuntimeBoardData;
	reordered: boolean;
}

export interface RuntimeBreakChainResult {
	board: RuntimeBoardData;
	removed: boolean;
}

export interface RuntimeTrashTaskResult extends RuntimeMoveTaskResult {
	readyTaskIds: string[];
}

export interface RuntimeDeleteTasksResult {
	board: RuntimeBoardData;
	deleted: boolean;
	deletedTaskIds: string[];
}

function collectExistingTaskIds(board: RuntimeBoardData): Set<string> {
	const existingIds = new Set<string>();
	for (const column of board.columns) {
		for (const card of column.cards) {
			existingIds.add(card.id);
		}
	}
	return existingIds;
}

function collectTaskIds(board: RuntimeBoardData): Set<string> {
	const taskIds = new Set<string>();
	for (const column of board.columns) {
		for (const card of column.cards) {
			taskIds.add(card.id);
		}
	}
	return taskIds;
}

function createDependencyId(): string {
	return crypto.randomUUID().replaceAll("-", "").slice(0, 8);
}

function createDependencyPairKey(backlogTaskId: string, linkedTaskId: string): string {
	return `${backlogTaskId}::${linkedTaskId}`;
}

function hasDependencyPair(board: RuntimeBoardData, backlogTaskId: string, linkedTaskId: string): boolean {
	const pairKey = createDependencyPairKey(backlogTaskId, linkedTaskId);
	for (const dependency of board.dependencies) {
		const existing = resolveDependencyEndpoints(board, dependency.fromTaskId, dependency.toTaskId);
		if ("reason" in existing) {
			continue;
		}
		if (createDependencyPairKey(existing.backlogTaskId, existing.linkedTaskId) === pairKey) {
			return true;
		}
	}
	return false;
}

function findTaskLocation(
	board: RuntimeBoardData,
	taskId: string,
): {
	columnIndex: number;
	taskIndex: number;
	columnId: RuntimeBoardColumnId;
	task: RuntimeBoardCard;
} | null {
	for (const [columnIndex, column] of board.columns.entries()) {
		const taskIndex = column.cards.findIndex((card) => card.id === taskId);
		if (taskIndex === -1) {
			continue;
		}
		const task = column.cards[taskIndex];
		if (!task) {
			continue;
		}
		return {
			columnIndex,
			taskIndex,
			columnId: column.id,
			task,
		};
	}
	return null;
}

function resolveDependencyEndpoints(
	board: RuntimeBoardData,
	firstTaskId: string,
	secondTaskId: string,
):
	| {
			backlogTaskId: string;
			linkedTaskId: string;
			/** Both endpoints are in Backlog: this link is a worktree-sharing chain. */
			chain: boolean;
	  }
	| { reason: RuntimeAddTaskDependencyResult["reason"] } {
	const firstColumnId = getTaskColumnId(board, firstTaskId);
	const secondColumnId = getTaskColumnId(board, secondTaskId);
	if (!firstColumnId || !secondColumnId) {
		return { reason: "missing_task" };
	}
	if (firstColumnId === "trash" || secondColumnId === "trash") {
		return { reason: "trash_task" };
	}
	const firstIsBacklog = firstColumnId === "backlog";
	const secondIsBacklog = secondColumnId === "backlog";
	if (firstIsBacklog && secondIsBacklog) {
		// Chain link: the first task (drag source / `link A B`'s A) runs FIRST, so it is the
		// root/prerequisite (`toTaskId`); the second task follows it (`fromTaskId`). Dragging
		// A onto B therefore reads as "A before B".
		return {
			backlogTaskId: secondTaskId,
			linkedTaskId: firstTaskId,
			chain: true,
		};
	}
	if (!firstIsBacklog && !secondIsBacklog) {
		return { reason: "non_backlog" };
	}
	return firstIsBacklog
		? { backlogTaskId: firstTaskId, linkedTaskId: secondTaskId, chain: false }
		: { backlogTaskId: secondTaskId, linkedTaskId: firstTaskId, chain: false };
}

/**
 * Walks the chain-dependency graph from a task up to the chain root and returns the
 * task id whose git worktree the whole chain shares. A chain follower is the
 * `fromTaskId` of a `chain` dependency; its worktree owner is the `toTaskId` it waits
 * on, resolved transitively to the root that is not itself a follower. A task with no
 * incoming chain dependency owns its own worktree (returns its own id). Cycle-guarded.
 */
export function resolveChainWorktreeOwnerTaskId(board: RuntimeBoardData, taskId: string): string {
	const normalized = taskId.trim();
	if (!normalized) {
		return normalized;
	}
	const seen = new Set<string>();
	let current = normalized;
	while (!seen.has(current)) {
		seen.add(current);
		const chainDependency = board.dependencies.find(
			(dependency) => dependency.chain === true && dependency.fromTaskId === current,
		);
		if (!chainDependency) {
			break;
		}
		const next = chainDependency.toTaskId.trim();
		if (!next) {
			break;
		}
		current = next;
	}
	return current;
}

/**
 * True when walking `chain` dependencies root-ward from `startTaskId` (follower →
 * prerequisite) reaches `targetTaskId`. Used to detect cycles before adding a chain link.
 */
function chainReachesTaskId(board: RuntimeBoardData, startTaskId: string, targetTaskId: string): boolean {
	const seen = new Set<string>();
	let current = startTaskId;
	while (!seen.has(current)) {
		if (current === targetTaskId) {
			return true;
		}
		seen.add(current);
		const chainDependency = board.dependencies.find(
			(dependency) => dependency.chain === true && dependency.fromTaskId === current,
		);
		if (!chainDependency) {
			break;
		}
		current = chainDependency.toTaskId;
	}
	return current === targetTaskId;
}

/**
 * True when some live (non-trash) task other than `excludeTaskId` still resolves to
 * `ownerTaskId` as its chain worktree owner. Used at trash time to decide whether the
 * shared worktree must be handed off to a chain follower instead of being deleted.
 */
export function hasLiveChainMemberSharingWorktree(
	board: RuntimeBoardData,
	ownerTaskId: string,
	excludeTaskId: string,
): boolean {
	const normalizedOwner = ownerTaskId.trim();
	if (!normalizedOwner) {
		return false;
	}
	for (const column of board.columns) {
		if (column.id === "trash") {
			continue;
		}
		for (const card of column.cards) {
			if (card.id === excludeTaskId) {
				continue;
			}
			if (resolveChainWorktreeOwnerTaskId(board, card.id) === normalizedOwner) {
				return true;
			}
		}
	}
	return false;
}

/**
 * Returns task ids that become runnable after `taskId` leaves Review or In Progress for
 * Done. `fromColumnId` is the column the task left (or was about to leave). Pass
 * `"review"` explicitly when the card is already in trash from an optimistic UI move so
 * unlock still runs.
 *
 * Classic Backlog wait-links only unlock when the prerequisite went through Review (the
 * conventional review-before-done flow). Chain queue-stack followers unlock regardless —
 * a chain root can be dragged straight from In Progress to Done (skipping Review) and its
 * follower must still start, since the shared worktree is otherwise left stalled forever.
 */
export function getReadyLinkedTaskIdsAfterLeavingReview(
	board: RuntimeBoardData,
	taskId: string,
	fromColumnId: RuntimeBoardColumnId | null,
): string[] {
	const isEligibleSource = fromColumnId === "review" || fromColumnId === "in_progress";
	if (!taskId || board.dependencies.length === 0 || !isEligibleSource) {
		return [];
	}
	const readyTaskIds = new Set<string>();
	for (const dependency of board.dependencies) {
		if (dependency.toTaskId !== taskId) {
			continue;
		}
		const waiterColumnId = getTaskColumnId(board, dependency.fromTaskId);
		// Classic wait-link: unlock a Backlog follower once its review prerequisite is Done.
		if (waiterColumnId === "backlog") {
			if (fromColumnId === "review") {
				readyTaskIds.add(dependency.fromTaskId);
			}
			continue;
		}
		// Chain queue stack: followers may already sit in In Progress as queued cards; unlock
		// them so a new agent can start in the shared worktree (not resume the finished
		// session), whether the root went through Review or straight from In Progress.
		if (waiterColumnId === "in_progress" && dependency.chain === true) {
			readyTaskIds.add(dependency.fromTaskId);
		}
	}
	return [...readyTaskIds];
}

export function updateTaskDependencies(board: RuntimeBoardData): RuntimeBoardData {
	if (board.dependencies.length === 0) {
		return board;
	}
	const taskIds = collectTaskIds(board);
	const dependencies: RuntimeBoardDependency[] = [];
	const existingPairs = new Set<string>();
	for (const dependency of board.dependencies) {
		const firstTaskId = dependency.fromTaskId.trim();
		const secondTaskId = dependency.toTaskId.trim();
		if (!firstTaskId || !secondTaskId || firstTaskId === secondTaskId) {
			continue;
		}
		if (!taskIds.has(firstTaskId) || !taskIds.has(secondTaskId)) {
			continue;
		}
		// A chain dependency must survive its endpoints moving out of Backlog (e.g. the root
		// running then landing in trash) so the shared worktree stays resolvable during
		// hand-off. Preserve it verbatim as long as both tasks still exist; it is only pruned
		// once a task is deleted (dropped by the taskIds guard above). Re-resolving here would
		// treat a trashed endpoint as invalid and silently drop the chain.
		if (dependency.chain === true) {
			const chainPairKey = createDependencyPairKey(firstTaskId, secondTaskId);
			if (existingPairs.has(chainPairKey)) {
				continue;
			}
			existingPairs.add(chainPairKey);
			dependencies.push({
				id: dependency.id,
				fromTaskId: firstTaskId,
				toTaskId: secondTaskId,
				createdAt: dependency.createdAt,
				chain: true,
			});
			continue;
		}
		const resolved = resolveDependencyEndpoints(board, firstTaskId, secondTaskId);
		if ("reason" in resolved) {
			continue;
		}
		// Chain deps already `continue`d above, so this path is non-chain-only: no `chain` flag.
		const pairKey = createDependencyPairKey(resolved.backlogTaskId, resolved.linkedTaskId);
		if (existingPairs.has(pairKey)) {
			continue;
		}
		existingPairs.add(pairKey);
		dependencies.push({
			id: dependency.id,
			fromTaskId: resolved.backlogTaskId,
			toTaskId: resolved.linkedTaskId,
			createdAt: dependency.createdAt,
		});
	}
	if (
		dependencies.length === board.dependencies.length &&
		dependencies.every((dependency, index) => {
			const current = board.dependencies[index];
			return (
				current &&
				current.id === dependency.id &&
				current.fromTaskId === dependency.fromTaskId &&
				current.toTaskId === dependency.toTaskId &&
				current.createdAt === dependency.createdAt &&
				Boolean(current.chain) === Boolean(dependency.chain)
			);
		})
	) {
		return board;
	}
	return {
		...board,
		dependencies,
	};
}

export function addTaskToColumn(
	board: RuntimeBoardData,
	columnId: RuntimeBoardColumnId,
	input: RuntimeCreateTaskInput,
	randomUuid: () => string,
	now: number = Date.now(),
): RuntimeCreateTaskResult {
	const prompt = input.prompt.trim();
	if (!prompt) {
		throw new Error("Task prompt is required.");
	}
	const baseRef = input.baseRef.trim();
	if (!baseRef) {
		throw new Error("Task baseRef is required.");
	}
	const existingIds = collectExistingTaskIds(board);
	const explicitTaskId = input.taskId?.trim();
	if (explicitTaskId && existingIds.has(explicitTaskId)) {
		throw new Error(`Task "${explicitTaskId}" already exists.`);
	}
	const task: RuntimeBoardCard = {
		id: explicitTaskId || createUniqueTaskId(existingIds, randomUuid),
		title: resolveTaskTitle(input.title, prompt),
		prompt,
		startInPlanMode: Boolean(input.startInPlanMode),
		autoReviewEnabled: Boolean(input.autoReviewEnabled),
		autoReviewMode: normalizeTaskAutoReviewMode(input.autoReviewMode),
		images: cloneTaskImages(input.images),
		...(input.agentId ? { agentId: input.agentId } : {}),
		...(typeof input.managerAccountId === "number" && Number.isInteger(input.managerAccountId) && input.managerAccountId > 0
			? { managerAccountId: input.managerAccountId }
			: {}),
		...(input.clineSettings !== undefined ? { clineSettings: cloneTaskClineSettings(input.clineSettings) } : {}),
		...(input.taskLaunchSettings !== undefined
			? { taskLaunchSettings: cloneTaskLaunchSettings(input.taskLaunchSettings) }
			: {}),
		...(input.autoRunAt != null ? { autoRunAt: input.autoRunAt } : {}),
		baseRef,
		createdAt: now,
		updatedAt: now,
	};

	const targetColumnIndex = board.columns.findIndex((column) => column.id === columnId);
	if (targetColumnIndex === -1) {
		throw new Error(`Column ${columnId} not found.`);
	}

	const columns = board.columns.map((column, index) => {
		if (index !== targetColumnIndex) {
			return column;
		}
		return {
			...column,
			cards: [task, ...column.cards],
		};
	});

	return {
		board: {
			...board,
			columns,
		},
		task,
	};
}

export function getTaskColumnId(board: RuntimeBoardData, taskId: string): RuntimeBoardColumnId | null {
	const normalizedTaskId = taskId.trim();
	if (!normalizedTaskId) {
		return null;
	}
	const found = findTaskLocation(board, normalizedTaskId);
	return found ? found.columnId : null;
}

export function addTaskDependency(
	board: RuntimeBoardData,
	firstTaskId: string,
	secondTaskId: string,
): RuntimeAddTaskDependencyResult {
	const normalizedFirstTaskId = firstTaskId.trim();
	const normalizedSecondTaskId = secondTaskId.trim();
	if (!normalizedFirstTaskId || !normalizedSecondTaskId) {
		return { board, added: false, reason: "missing_task" };
	}
	if (normalizedFirstTaskId === normalizedSecondTaskId) {
		return { board, added: false, reason: "same_task" };
	}
	const resolved = resolveDependencyEndpoints(board, normalizedFirstTaskId, normalizedSecondTaskId);
	if ("reason" in resolved) {
		return { board, added: false, reason: resolved.reason };
	}
	if (hasDependencyPair(board, resolved.backlogTaskId, resolved.linkedTaskId)) {
		return { board, added: false, reason: "duplicate" };
	}
	if (resolved.chain) {
		// A chain follower runs in exactly one shared worktree, so it may wait on at most one
		// chain root. Reject a second chain prerequisite for the same follower to keep chains
		// resolvable to a single worktree owner.
		if (
			board.dependencies.some(
				(dependency) => dependency.chain === true && dependency.fromTaskId === resolved.backlogTaskId,
			)
		) {
			return { board, added: false, reason: "chain_conflict" };
		}
		// Reject a link that would make the chain cyclic (the proposed root already chains,
		// transitively, back onto the proposed follower). A cycle has no single root/owner.
		if (chainReachesTaskId(board, resolved.linkedTaskId, resolved.backlogTaskId)) {
			return { board, added: false, reason: "chain_conflict" };
		}
	}
	const dependency: RuntimeBoardDependency = {
		id: createDependencyId(),
		fromTaskId: resolved.backlogTaskId,
		toTaskId: resolved.linkedTaskId,
		createdAt: Date.now(),
		...(resolved.chain ? { chain: true } : {}),
	};
	return {
		board: {
			...board,
			dependencies: [...board.dependencies, dependency],
		},
		added: true,
		dependency,
	};
}

export function canAddTaskDependency(board: RuntimeBoardData, firstTaskId: string, secondTaskId: string): boolean {
	const normalizedFirstTaskId = firstTaskId.trim();
	const normalizedSecondTaskId = secondTaskId.trim();
	if (!normalizedFirstTaskId || !normalizedSecondTaskId || normalizedFirstTaskId === normalizedSecondTaskId) {
		return false;
	}
	const resolved = resolveDependencyEndpoints(board, normalizedFirstTaskId, normalizedSecondTaskId);
	if ("reason" in resolved) {
		return false;
	}
	return !hasDependencyPair(board, resolved.backlogTaskId, resolved.linkedTaskId);
}

export function removeTaskDependency(board: RuntimeBoardData, dependencyId: string): RuntimeRemoveTaskDependencyResult {
	const dependencies = board.dependencies.filter((dependency) => dependency.id !== dependencyId);
	if (dependencies.length === board.dependencies.length) {
		return { board, removed: false };
	}
	return {
		board: {
			...board,
			dependencies,
		},
		removed: true,
	};
}

/**
 * Rewrites a chain's edges so its members run in `orderedMemberIds` order. `orderedMemberIds[0]`
 * becomes the root/worktree owner (no incoming chain dependency); every later member follows the
 * one before it (`fromTaskId: ordered[i], toTaskId: ordered[i-1]`). A forked chain is linearized
 * in the process. No-ops (`reordered: false`) unless the ids are exactly one existing chain's
 * member set, all still in Backlog.
 */
export function reorderChainMembers(board: RuntimeBoardData, orderedMemberIds: string[]): RuntimeReorderChainResult {
	const ordered = orderedMemberIds.map((id) => id.trim()).filter((id) => id.length > 0);
	if (ordered.length < 2) {
		return { board, reordered: false };
	}
	const orderedSet = new Set(ordered);
	if (orderedSet.size !== ordered.length) {
		return { board, reordered: false };
	}
	// Every member must exist, be in Backlog, and resolve to the same chain root today.
	let sharedRoot: string | null = null;
	for (const memberId of ordered) {
		if (getTaskColumnId(board, memberId) !== "backlog") {
			return { board, reordered: false };
		}
		const root = resolveChainWorktreeOwnerTaskId(board, memberId);
		if (sharedRoot === null) {
			sharedRoot = root;
		} else if (sharedRoot !== root) {
			return { board, reordered: false };
		}
	}

	// Index the chain edges among these members so ids/createdAt can be reused for stable identity.
	const existingByPair = new Map<string, RuntimeBoardDependency>();
	for (const dependency of board.dependencies) {
		if (dependency.chain !== true) {
			continue;
		}
		if (orderedSet.has(dependency.fromTaskId) && orderedSet.has(dependency.toTaskId)) {
			existingByPair.set(createDependencyPairKey(dependency.fromTaskId, dependency.toTaskId), dependency);
		}
	}
	if (existingByPair.size === 0) {
		return { board, reordered: false };
	}

	// Drop the old chain edges among these members, keep everything else untouched.
	const dependencies = board.dependencies.filter(
		(dependency) =>
			!(dependency.chain === true && orderedSet.has(dependency.fromTaskId) && orderedSet.has(dependency.toTaskId)),
	);
	// Re-add a single linear spine in the requested order.
	for (let index = 1; index < ordered.length; index += 1) {
		const followerId = ordered[index] as string;
		const parentId = ordered[index - 1] as string;
		const reused = existingByPair.get(createDependencyPairKey(followerId, parentId));
		dependencies.push({
			id: reused ? reused.id : createDependencyId(),
			fromTaskId: followerId,
			toTaskId: parentId,
			createdAt: reused ? reused.createdAt : Date.now(),
			chain: true,
		});
	}

	return {
		board: {
			...board,
			dependencies,
		},
		reordered: true,
	};
}

/**
 * Dissolves a chain by removing every `chain` dependency whose both endpoints are in `memberIds`,
 * leaving the members as standalone tasks. Non-chain dependencies are untouched.
 */
export function breakChain(board: RuntimeBoardData, memberIds: string[]): RuntimeBreakChainResult {
	const members = new Set(memberIds.map((id) => id.trim()).filter((id) => id.length > 0));
	if (members.size === 0) {
		return { board, removed: false };
	}
	const dependencies = board.dependencies.filter(
		(dependency) => !(dependency.chain === true && members.has(dependency.fromTaskId) && members.has(dependency.toTaskId)),
	);
	if (dependencies.length === board.dependencies.length) {
		return { board, removed: false };
	}
	return {
		board: {
			...board,
			dependencies,
		},
		removed: true,
	};
}

export function getReadyLinkedTaskIdsForTaskInTrash(board: RuntimeBoardData, taskId: string): string[] {
	return getReadyLinkedTaskIdsAfterLeavingReview(board, taskId, getTaskColumnId(board, taskId));
}

export function trashTaskAndGetReadyLinkedTaskIds(
	board: RuntimeBoardData,
	taskId: string,
	now: number = Date.now(),
): RuntimeTrashTaskResult {
	const fromColumnId = getTaskColumnId(board, taskId);
	const readyTaskIds = getReadyLinkedTaskIdsAfterLeavingReview(board, taskId, fromColumnId);
	const movedToTrash = moveTaskToColumn(board, taskId, "trash", now);
	return {
		...movedToTrash,
		readyTaskIds: movedToTrash.moved ? readyTaskIds : [],
	};
}

export function deleteTasksFromBoard(board: RuntimeBoardData, taskIds: Iterable<string>): RuntimeDeleteTasksResult {
	const normalizedTaskIds = new Set(
		Array.from(taskIds, (taskId) => taskId.trim()).filter((taskId) => taskId.length > 0),
	);
	if (normalizedTaskIds.size === 0) {
		return {
			board,
			deleted: false,
			deletedTaskIds: [],
		};
	}

	const deletedTaskIds: string[] = [];
	const columns = board.columns.map((column) => {
		const remainingCards = column.cards.filter((card) => {
			if (!normalizedTaskIds.has(card.id)) {
				return true;
			}
			deletedTaskIds.push(card.id);
			return false;
		});
		return remainingCards.length === column.cards.length ? column : { ...column, cards: remainingCards };
	});

	if (deletedTaskIds.length === 0) {
		return {
			board,
			deleted: false,
			deletedTaskIds: [],
		};
	}

	const deletedTaskIdSet = new Set(deletedTaskIds);
	const dependencies = board.dependencies.filter(
		(dependency) => !deletedTaskIdSet.has(dependency.fromTaskId) && !deletedTaskIdSet.has(dependency.toTaskId),
	);

	return {
		board: {
			...board,
			columns,
			dependencies,
		},
		deleted: true,
		deletedTaskIds,
	};
}

export function moveTaskToColumn(
	board: RuntimeBoardData,
	taskId: string,
	targetColumnId: RuntimeBoardColumnId,
	now: number = Date.now(),
): RuntimeMoveTaskResult {
	const normalizedTaskId = taskId.trim();
	if (!normalizedTaskId) {
		return {
			moved: false,
			board,
			task: null,
			fromColumnId: null,
		};
	}

	const found = findTaskLocation(board, normalizedTaskId);
	if (!found) {
		return {
			moved: false,
			board,
			task: null,
			fromColumnId: null,
		};
	}
	if (found.columnId === targetColumnId) {
		return {
			moved: false,
			board,
			task: found.task,
			fromColumnId: found.columnId,
		};
	}
	const targetColumnIndex = board.columns.findIndex((column) => column.id === targetColumnId);
	if (targetColumnIndex === -1) {
		return {
			moved: false,
			board,
			task: found.task,
			fromColumnId: found.columnId,
		};
	}

	const sourceColumn = board.columns[found.columnIndex];
	const targetColumn = board.columns[targetColumnIndex];
	if (!sourceColumn || !targetColumn) {
		return {
			moved: false,
			board,
			task: found.task,
			fromColumnId: found.columnId,
		};
	}

	const sourceCards = [...sourceColumn.cards];
	const [task] = sourceCards.splice(found.taskIndex, 1);
	if (!task) {
		return {
			moved: false,
			board,
			task: found.task,
			fromColumnId: found.columnId,
		};
	}
	const movedTask: RuntimeBoardCard = {
		...task,
		updatedAt: now,
	};
	const targetCards =
		targetColumnId === "trash" ? [movedTask, ...targetColumn.cards] : [...targetColumn.cards, movedTask];

	const columns = board.columns.map((column, index) => {
		if (index === found.columnIndex) {
			return {
				...column,
				cards: sourceCards,
			};
		}
		if (index === targetColumnIndex) {
			return {
				...column,
				cards: targetCards,
			};
		}
		return column;
	});

	return {
		moved: true,
		board: updateTaskDependencies({
			...board,
			columns,
		}),
		task: movedTask,
		fromColumnId: found.columnId,
	};
}

export function updateTask(
	board: RuntimeBoardData,
	taskId: string,
	input: RuntimeUpdateTaskInput,
	now: number = Date.now(),
): RuntimeUpdateTaskResult {
	const normalizedTaskId = taskId.trim();
	if (!normalizedTaskId) {
		return {
			board,
			task: null,
			updated: false,
		};
	}

	const prompt = input.prompt.trim();
	if (!prompt) {
		return {
			board,
			task: null,
			updated: false,
		};
	}

	const baseRef = input.baseRef.trim();
	if (!baseRef) {
		return {
			board,
			task: null,
			updated: false,
		};
	}

	let updatedTask: RuntimeBoardCard | null = null;
	const columns = board.columns.map((column) => {
		let columnUpdated = false;
		const cards = column.cards.map((card) => {
			if (card.id !== normalizedTaskId) {
				return card;
			}
			columnUpdated = true;
			updatedTask = {
				...card,
				title: resolveTaskTitle(input.title, prompt),
				prompt,
				startInPlanMode: Boolean(input.startInPlanMode),
				autoReviewEnabled: Boolean(input.autoReviewEnabled),
				autoReviewMode: normalizeTaskAutoReviewMode(input.autoReviewMode),
				images: input.images === undefined ? card.images : cloneTaskImages(input.images),
				agentId: input.agentId === undefined ? card.agentId : (input.agentId ?? undefined),
				clineSettings:
					input.clineSettings === undefined
						? cloneTaskClineSettings(card.clineSettings)
						: input.clineSettings === null
							? undefined
							: cloneTaskClineSettings(input.clineSettings),
				taskLaunchSettings:
					input.taskLaunchSettings === undefined
						? cloneTaskLaunchSettings(card.taskLaunchSettings)
						: input.taskLaunchSettings === null
							? undefined
							: cloneTaskLaunchSettings(input.taskLaunchSettings),
				baseRef,
				updatedAt: now,
			};
			return updatedTask;
		});
		return columnUpdated ? { ...column, cards } : column;
	});

	if (!updatedTask) {
		return {
			board,
			task: null,
			updated: false,
		};
	}

	return {
		board: {
			...board,
			columns,
		},
		task: updatedTask,
		updated: true,
	};
}
