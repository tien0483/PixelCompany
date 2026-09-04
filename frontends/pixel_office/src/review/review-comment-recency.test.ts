import { describe, expect, it } from "vitest";

import { countUserNotes, findNewCommentsSinceReview } from "@/review/review-comment-recency";
import type { RuntimeGitlabDiscussion, RuntimeGitlabNote } from "@/runtime/types";

const REVIEWED_AT = "2026-09-01T10:00:00.000Z";

function note(overrides: Partial<RuntimeGitlabNote> = {}): RuntimeGitlabNote {
	return {
		id: "note-1",
		body: "Please rename this.",
		authorUsername: "author",
		authorName: "Author",
		createdAt: "2026-09-01T11:00:00.000Z",
		system: false,
		resolvable: true,
		resolved: false,
		position: { oldPath: "src/a.ts", newPath: "src/a.ts", oldLine: null, newLine: 12 },
		...overrides,
	};
}

function discussion(notes: RuntimeGitlabNote[]): RuntimeGitlabDiscussion {
	return { id: "discussion-1", individualNote: false, resolved: false, notes };
}

function find(notes: RuntimeGitlabNote[], overrides: { myUsername?: string | null } = {}) {
	return findNewCommentsSinceReview({
		discussions: [discussion(notes)],
		reviewedPaths: ["src/a.ts"],
		reviewedAt: { "src/a.ts": REVIEWED_AT },
		myUsername: "myUsername" in overrides ? (overrides.myUsername ?? null) : "me",
	});
}

describe("findNewCommentsSinceReview", () => {
	it("flags a note somebody else left after the file was reviewed", () => {
		const result = find([note()]);
		expect(result.byPath.get("src/a.ts")).toEqual({ count: 1, latestAt: "2026-09-01T11:00:00.000Z" });
	});

	it("keeps the most recent time and counts every qualifying note", () => {
		const result = find([
			note({ id: "a", createdAt: "2026-09-01T11:00:00.000Z" }),
			note({ id: "b", createdAt: "2026-09-01T12:00:00.000Z" }),
		]);
		expect(result.byPath.get("src/a.ts")).toEqual({ count: 2, latestAt: "2026-09-01T12:00:00.000Z" });
	});

	it("ignores the reviewer's own notes, so publishing drafts does not un-review the file", () => {
		expect(find([note({ authorUsername: "me" })]).byPath.size).toBe(0);
	});

	it("ignores system notes", () => {
		expect(find([note({ system: true })]).byPath.size).toBe(0);
	});

	it("ignores a note that predates the review", () => {
		expect(find([note({ createdAt: "2026-09-01T09:00:00.000Z" })]).byPath.size).toBe(0);
	});

	it("ignores a note with no creation time, which cannot be placed either side of the tick", () => {
		expect(find([note({ createdAt: null })]).byPath.size).toBe(0);
	});

	it("ignores a file that was never marked reviewed", () => {
		const result = findNewCommentsSinceReview({
			discussions: [discussion([note()])],
			reviewedPaths: [],
			reviewedAt: {},
			myUsername: "me",
		});
		expect(result.byPath.size).toBe(0);
	});

	it("ignores a tick from before reviewedAt existed rather than guessing when it happened", () => {
		const result = findNewCommentsSinceReview({
			discussions: [discussion([note()])],
			reviewedPaths: ["src/a.ts"],
			reviewedAt: {},
			myUsername: "me",
		});
		expect(result.byPath.size).toBe(0);
	});

	it("falls back to the pre-image path for a note on a deleted side", () => {
		const result = find([
			note({ position: { oldPath: "src/a.ts", newPath: "", oldLine: 4, newLine: null } }),
		]);
		expect(result.byPath.get("src/a.ts")?.count).toBe(1);
	});

	it("counts a position-less note against the merge request, not a file", () => {
		const result = find([note({ position: null })]);
		expect(result.byPath.size).toBe(0);
		expect(result.mergeRequestLevel).toBe(1);
	});

	it("counts every author when the signed-in username is unknown", () => {
		expect(find([note({ authorUsername: "me" })], { myUsername: null }).byPath.size).toBe(1);
	});
});

describe("countUserNotes", () => {
	it("counts non-system notes only, matching GitLab's user_notes_count", () => {
		expect(countUserNotes([discussion([note({ id: "a" }), note({ id: "b", system: true })])])).toBe(1);
	});

	it("is zero for a merge request nobody has commented on", () => {
		expect(countUserNotes([])).toBe(0);
	});
});
