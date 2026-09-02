import type {
	RuntimeGitlabDiffFile,
	RuntimeGitlabDiscussion,
	RuntimeReviewAnnotation,
	RuntimeReviewDraftComment,
	RuntimeReviewFinding,
} from "@/runtime/types";

/**
 * Everything needed to open a review. `host` travels with the ids because a review
 * session is stored per instance — the same project id on two GitLab instances is
 * two different projects, and merging their drafts would publish notes to the
 * wrong repository.
 */
export interface ReviewTarget {
	host: string;
	projectId: number;
	iid: number;
	/** For the tab title before the merge request itself has loaded. */
	title: string;
	projectKey: string;
}

export type ReviewDiffMode = "split" | "unified";

/**
 * The lines the reviewer has picked out in the diff, and their text.
 *
 * This is what "the assistant can see my screen" resolves to: the chat sends this
 * instead of the whole file, so a question about line 46 is answered about line 46.
 * The text travels with the range because the diff pane is the only thing that has
 * already parsed the patch into rows — re-deriving it in the chat caller would mean
 * parsing the same patch twice.
 */
export interface ReviewLineSelection {
	path: string;
	/** Which revision the numbers belong to. Mixing these up mispositions a note. */
	side: "old" | "new";
	startLine: number;
	endLine: number;
	text: string;
}

/**
 * A request to bring one line of one file into view — what clicking a draft comment
 * or a thread in the side panels resolves to.
 *
 * The line is carried as the same `oldLine`/`newLine` pair a note is anchored by,
 * rather than a single number, because a note on a deleted line has no post-image
 * number at all and the pane has to look it up on the other side of the split.
 *
 * `nonce` is what makes a repeat click work: jumping to the draft already on screen
 * changes neither path nor line, so without it the pane sees an unchanged value and
 * never scrolls again.
 */
export interface ReviewLineFocus {
	path: string;
	oldLine: number | null;
	newLine: number | null;
	nonce: number;
}

/** Where the reviewer is scrolled to, used when nothing is selected. */
export interface ReviewVisibleRange {
	path: string;
	startLine: number;
	endLine: number;
}

/** `src/a.ts:40-60`, or `src/a.ts:46` for a single line. For the chat's context chip. */
export function formatSelectionLabel(selection: ReviewLineSelection): string {
	const range =
		selection.startLine === selection.endLine
			? `${selection.startLine}`
			: `${selection.startLine}-${selection.endLine}`;
	return `${selection.path}:${range}`;
}

/** Draft comments, threads and tag annotations indexed by the line they hang off. */
export interface ReviewLineAnnotations {
	draftsByNewLine: Map<number, RuntimeReviewDraftComment[]>;
	draftsByOldLine: Map<number, RuntimeReviewDraftComment[]>;
	threadsByNewLine: Map<number, RuntimeGitlabDiscussion[]>;
	threadsByOldLine: Map<number, RuntimeGitlabDiscussion[]>;
	tagsByNewLine: Map<number, RuntimeReviewAnnotation[]>;
	tagsByOldLine: Map<number, RuntimeReviewAnnotation[]>;
}

const EMPTY_ANNOTATIONS: ReviewLineAnnotations = {
	draftsByNewLine: new Map(),
	draftsByOldLine: new Map(),
	threadsByNewLine: new Map(),
	threadsByOldLine: new Map(),
	tagsByNewLine: new Map(),
	tagsByOldLine: new Map(),
};

function pushInto<T>(map: Map<number, T[]>, line: number | null | undefined, value: T): void {
	if (line == null) {
		return;
	}
	const existing = map.get(line);
	if (existing) {
		existing.push(value);
		return;
	}
	map.set(line, [value]);
}

/**
 * Indexes a file's drafts, threads, and tag annotations by line, both sides.
 *
 * Both sides matter: a note on a deleted line is anchored by its old-side number
 * and has no new-side number at all, so a new-line-only index would silently hide
 * every deletion comment.
 */
export function buildLineAnnotations(input: {
	path: string;
	oldPath: string;
	draftComments: RuntimeReviewDraftComment[];
	discussions: RuntimeGitlabDiscussion[];
	annotations?: RuntimeReviewAnnotation[];
}): ReviewLineAnnotations {
	if (
		input.draftComments.length === 0 &&
		input.discussions.length === 0 &&
		(input.annotations?.length ?? 0) === 0
	) {
		return EMPTY_ANNOTATIONS;
	}
	const annotations: ReviewLineAnnotations = {
		draftsByNewLine: new Map(),
		draftsByOldLine: new Map(),
		threadsByNewLine: new Map(),
		threadsByOldLine: new Map(),
		tagsByNewLine: new Map(),
		tagsByOldLine: new Map(),
	};

	for (const draft of input.draftComments) {
		if (draft.newPath !== input.path && draft.oldPath !== input.oldPath) {
			continue;
		}
		pushInto(annotations.draftsByNewLine, draft.newLine, draft);
		pushInto(annotations.draftsByOldLine, draft.oldLine, draft);
	}

	for (const discussion of input.discussions) {
		// A discussion's position lives on its first positioned note; replies inherit it.
		const positioned = discussion.notes.find((note) => note.position !== null);
		const position = positioned?.position;
		if (!position) {
			continue;
		}
		if (position.newPath !== input.path && position.oldPath !== input.oldPath) {
			continue;
		}
		pushInto(annotations.threadsByNewLine, position.newLine, discussion);
		pushInto(annotations.threadsByOldLine, position.oldLine, discussion);
	}

	for (const annotation of input.annotations ?? []) {
		if (annotation.newPath !== input.path && annotation.oldPath !== input.oldPath) {
			continue;
		}
		pushInto(annotations.tagsByNewLine, annotation.newLine, annotation);
		pushInto(annotations.tagsByOldLine, annotation.oldLine, annotation);
	}

	return annotations;
}

export function countReviewProgress(input: {
	files: RuntimeGitlabDiffFile[];
	reviewedPaths: string[];
}): { reviewed: number; total: number } {
	const reviewed = new Set(input.reviewedPaths);
	return {
		reviewed: input.files.filter((file) => reviewed.has(file.newPath)).length,
		total: input.files.length,
	};
}

/** Which way the reviewer is moving through the file list. */
export type ReviewNavDirection = "next" | "previous";

/**
 * The file to open when the reviewer leaves the current one, in either direction.
 *
 * Walks from the active file and wraps once, so a reviewer who jumped back to
 * file 2 still reaches the unreviewed file 9 instead of dead-ending. The active
 * path is never returned — leaving a file must not land on itself — and neither
 * is any file already marked reviewed. Returns null when there is nowhere left
 * to go, which the caller reads as "stay put".
 */
export function selectAdjacentUnreviewedPath(input: {
	files: RuntimeGitlabDiffFile[];
	reviewedPaths: string[];
	activePath: string | null;
	direction: ReviewNavDirection;
}): string | null {
	const total = input.files.length;
	if (total === 0) {
		return null;
	}
	const reviewed = new Set(input.reviewedPaths);
	const step = input.direction === "next" ? 1 : -1;
	const activeIndex = input.files.findIndex((file) => file.newPath === input.activePath);
	// An unknown active path (a file dropped by a refresh) starts the walk at the
	// nearer end of the list: the top going forwards, the bottom going backwards.
	const start = activeIndex >= 0 ? activeIndex : input.direction === "next" ? -1 : total;

	for (let offset = 1; offset <= total; offset += 1) {
		// Double modulo: a backwards walk goes negative, and `%` keeps the sign in JS.
		const candidate = input.files[(((start + step * offset) % total) + total) % total];
		if (!candidate || candidate.newPath === input.activePath) {
			continue;
		}
		if (!reviewed.has(candidate.newPath)) {
			return candidate.newPath;
		}
	}
	return null;
}

export function selectNextUnreviewedPath(input: {
	files: RuntimeGitlabDiffFile[];
	reviewedPaths: string[];
	activePath: string | null;
}): string | null {
	return selectAdjacentUnreviewedPath({ ...input, direction: "next" });
}

export function selectPreviousUnreviewedPath(input: {
	files: RuntimeGitlabDiffFile[];
	reviewedPaths: string[];
	activePath: string | null;
}): string | null {
	return selectAdjacentUnreviewedPath({ ...input, direction: "previous" });
}

export function sumDiffStats(files: RuntimeGitlabDiffFile[]): { additions: number; deletions: number } {
	let additions = 0;
	let deletions = 0;
	for (const file of files) {
		additions += file.additions;
		deletions += file.deletions;
	}
	return { additions, deletions };
}

/**
 * The `:12` / `:-7` / `:2-4` suffix a draft gets in the lists that only have room
 * for a path. Old-side notes keep their leading `-` so a note on a deleted line is
 * not read as a post-image line number.
 */
export function formatDraftLineLabel(draft: RuntimeReviewDraftComment): string {
	const isOldSide = draft.newLine === null && draft.oldLine !== null;
	const end = isOldSide ? draft.oldLine : draft.newLine;
	if (end === null) {
		return "";
	}
	const start = isOldSide ? draft.lineRange?.startOldLine : draft.lineRange?.startNewLine;
	const prefix = isOldSide ? ":-" : ":";
	return start != null && start !== end ? `${prefix}${start}-${end}` : `${prefix}${end}`;
}

export type ReviewFileStatus = "added" | "deleted" | "renamed" | "modified";

export function resolveFileStatus(file: RuntimeGitlabDiffFile): ReviewFileStatus {
	if (file.newFile) {
		return "added";
	}
	if (file.deletedFile) {
		return "deleted";
	}
	if (file.renamedFile) {
		return "renamed";
	}
	return "modified";
}

/**
 * Findings the reviewer has already acted on: dismissed outright, or accepted into a
 * draft comment (which is what an accept *is* — the draft's `aiFindingId` is the only
 * record of it).
 *
 * Returned as a set rather than folded into `selectPendingFindings` because the audit
 * panel and the chat transcript hold two different lists of findings that share one
 * triage namespace, and both have to hide a row the moment it is triaged.
 */
export function selectTriagedFindingIds(input: {
	dismissedFindingIds: string[];
	draftComments: RuntimeReviewDraftComment[];
}): Set<string> {
	const triaged = new Set(input.dismissedFindingIds);
	for (const draft of input.draftComments) {
		if (draft.aiFindingId !== null) {
			triaged.add(draft.aiFindingId);
		}
	}
	return triaged;
}

/** Findings the reviewer has neither accepted nor dismissed yet. */
export function selectPendingFindings(input: {
	findings: RuntimeReviewFinding[];
	dismissedFindingIds: string[];
	draftComments: RuntimeReviewDraftComment[];
}): RuntimeReviewFinding[] {
	const triaged = selectTriagedFindingIds(input);
	return input.findings.filter((finding) => !triaged.has(finding.id));
}
