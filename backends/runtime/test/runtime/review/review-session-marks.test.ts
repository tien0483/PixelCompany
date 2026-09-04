import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtimeHome = { path: "" };

vi.mock("../../../src/state/workspace-state", () => ({
	getRuntimeHomePath: () => runtimeHome.path,
}));

import {
	createEmptyReviewSession,
	getReviewSessionPath,
	listReviewSessionMarks,
	listReviewSessionsWithDrafts,
	writeReviewSession,
} from "../../../src/state/review-sessions";

const HOST = "https://code.example.com";

/**
 * The merge-request list draws its "already reviewed" badge from this projection, so
 * what matters is that a session's progress survives the round-trip and that one
 * corrupt file cannot blank the badges on every other row.
 */
describe("listReviewSessionMarks", () => {
	beforeEach(async () => {
		runtimeHome.path = await mkdtemp(join(tmpdir(), "kanban-review-marks-"));
	});

	afterEach(() => {
		runtimeHome.path = "";
	});

	it("reports reviewed progress per merge request without the session body", async () => {
		await writeReviewSession({
			...createEmptyReviewSession(HOST, 12, 142),
			reviewedPaths: ["a.py", "b.py"],
			reviewedAt: { "a.py": "2026-09-01T10:00:00.000Z", "b.py": "2026-09-01T10:01:00.000Z" },
			reviewedAllMark: { at: "2026-09-01T10:01:00.000Z", headSha: "abc123", fileCount: 2, notesCount: 4 },
		});
		await writeReviewSession({
			...createEmptyReviewSession(HOST, 12, 143),
			reviewedPaths: ["c.py"],
		});

		const marks = await listReviewSessionMarks(HOST);

		expect(marks).toHaveLength(2);
		expect(marks.find((mark) => mark.iid === 142)).toEqual({
			projectId: 12,
			iid: 142,
			reviewedCount: 2,
			reviewedAllMark: { at: "2026-09-01T10:01:00.000Z", headSha: "abc123", fileCount: 2, notesCount: 4 },
		});
		// Half-finished: no mark, so the list badge stays away rather than claiming a
		// review that is not done.
		expect(marks.find((mark) => mark.iid === 143)?.reviewedAllMark).toBeNull();
	});

	it("returns an empty list for a host with no sessions", async () => {
		expect(await listReviewSessionMarks(HOST)).toEqual([]);
	});

	it("skips an unreadable session instead of hiding the others", async () => {
		await writeReviewSession({
			...createEmptyReviewSession(HOST, 12, 142),
			reviewedPaths: ["a.py"],
		});
		const corrupt = getReviewSessionPath(HOST, 12, 999);
		await mkdir(dirname(corrupt), { recursive: true });
		await writeFile(corrupt, "{ not json", "utf-8");

		const marks = await listReviewSessionMarks(HOST);

		expect(marks.map((mark) => mark.iid)).toEqual([142]);
	});

	it("still lists only the sessions holding drafts", async () => {
		await writeReviewSession({
			...createEmptyReviewSession(HOST, 12, 142),
			reviewedPaths: ["a.py"],
		});
		await writeReviewSession({
			...createEmptyReviewSession(HOST, 12, 143),
			draftComments: [
				{
					id: "draft-1",
					newPath: "a.py",
					oldPath: "a.py",
					oldLine: null,
					newLine: 46,
					text: "guard the negative case",
					ruleIds: [],
					author: "You (Reviewer)",
					createdAt: "2026-09-01T10:00:00.000Z",
					aiFindingId: null,
				},
			],
		});

		const withDrafts = await listReviewSessionsWithDrafts(HOST);

		expect(withDrafts.map((session) => session.iid)).toEqual([143]);
	});
});
