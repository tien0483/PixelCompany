// "Someone commented on a file after you ticked it reviewed."
//
// A tick is the reviewer's claim that a file is settled, and a comment arriving
// afterwards is precisely the thing that unsettles it — but `reviewedPaths` alone
// cannot tell the two apart, because it records no time. `reviewedAt` does, and this
// module is the whole comparison.
//
// Two deliberate exclusions. Notes the signed-in user wrote are skipped: publishing
// your own draft would otherwise un-review every file you commented on, which is the
// opposite of useful. And a path with no `reviewedAt` entry — a tick from before that
// field existed — is skipped rather than guessed at; it starts working the next time
// the file is ticked, and a wrong "new comments" badge is worse than a missing one.
import type { RuntimeGitlabDiscussion } from "@/runtime/types";

export interface ReviewNewCommentsOnPath {
	count: number;
	/** ISO time of the most recent qualifying note, for the tooltip. */
	latestAt: string;
}

export interface ReviewNewComments {
	byPath: Map<string, ReviewNewCommentsOnPath>;
	/** Notes with no diff position — they belong to the merge request, not a file. */
	mergeRequestLevel: number;
}

export const EMPTY_REVIEW_NEW_COMMENTS: ReviewNewComments = { byPath: new Map(), mergeRequestLevel: 0 };

function firstNonEmpty(...values: Array<string | null | undefined>): string | null {
	for (const value of values) {
		if (value !== null && value !== undefined && value.length > 0) {
			return value;
		}
	}
	return null;
}

export function findNewCommentsSinceReview(input: {
	discussions: RuntimeGitlabDiscussion[];
	reviewedPaths: string[];
	reviewedAt: Record<string, string>;
	myUsername: string | null;
}): ReviewNewComments {
	const reviewed = new Set(input.reviewedPaths);
	const byPath = new Map<string, ReviewNewCommentsOnPath>();
	let mergeRequestLevel = 0;

	for (const discussion of input.discussions) {
		for (const note of discussion.notes) {
			// A system note is GitLab narrating itself ("changed the description"), not
			// anybody asking for another look.
			if (note.system || note.createdAt === null) {
				continue;
			}
			if (input.myUsername !== null && note.authorUsername === input.myUsername) {
				continue;
			}

			// A note on a deleted line carries an empty post-image path, so "first
			// non-empty" rather than `??` — nullish coalescing keeps the empty string
			// and loses the only path the note has.
			const path = firstNonEmpty(note.position?.newPath, note.position?.oldPath);
			if (path === null) {
				mergeRequestLevel += 1;
				continue;
			}
			if (!reviewed.has(path)) {
				continue;
			}
			const markedAt = input.reviewedAt[path];
			if (markedAt === undefined || note.createdAt <= markedAt) {
				continue;
			}

			const existing = byPath.get(path);
			byPath.set(path, {
				count: (existing?.count ?? 0) + 1,
				latestAt:
					existing === undefined || existing.latestAt < note.createdAt ? note.createdAt : existing.latestAt,
			});
		}
	}

	return { byPath, mergeRequestLevel };
}

/**
 * Non-system notes across every discussion — the same definition as GitLab's
 * `user_notes_count` on a merge-request summary, which is what makes a count taken
 * here comparable to the one the merge-request list reads.
 */
export function countUserNotes(discussions: RuntimeGitlabDiscussion[]): number {
	let total = 0;
	for (const discussion of discussions) {
		for (const note of discussion.notes) {
			if (!note.system) {
				total += 1;
			}
		}
	}
	return total;
}
