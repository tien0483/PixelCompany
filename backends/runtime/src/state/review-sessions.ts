// Persistence for an in-progress merge-request review.
//
// The valuable thing in here is the draft comments: work the reviewer has typed
// but not yet published to GitLab. Losing them to a reload is worse than losing
// any cached MR metadata, all of which can be refetched. So the whole session is
// written as one document per MR under the runtime home, and the write path is
// whole-document — a field-level patch API would let a stale tab overwrite drafts
// it never loaded.
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { type RuntimeReviewSession, runtimeReviewSessionSchema } from "../core/api-contract";
import { getRuntimeHomePath } from "./workspace-state";

export const REVIEW_SESSIONS_DIR_NAME = "reviews";

/**
 * A host becomes a directory name, so it has to survive a filesystem round-trip:
 * `https://code.akselos.com/repo` → `code.akselos.com_repo`.
 */
export function toHostDirName(host: string): string {
	return (
		host
			.replace(/^https?:\/\//, "")
			.replace(/\/+$/, "")
			.replace(/[^a-zA-Z0-9._-]+/g, "_") || "unknown-host"
	);
}

export function getReviewSessionsDir(): string {
	return join(getRuntimeHomePath(), REVIEW_SESSIONS_DIR_NAME);
}

export function getReviewSessionPath(host: string, projectId: number, iid: number): string {
	return join(getReviewSessionsDir(), toHostDirName(host), `${projectId}-${iid}.json`);
}

export async function readReviewSession(
	host: string,
	projectId: number,
	iid: number,
): Promise<RuntimeReviewSession | null> {
	try {
		const text = await readFile(getReviewSessionPath(host, projectId, iid), "utf-8");
		const parsed = runtimeReviewSessionSchema.safeParse(JSON.parse(text) as unknown);
		return parsed.success ? parsed.data : null;
	} catch {
		// No session yet is the normal first-open case, so this is not an error.
		return null;
	}
}

export async function writeReviewSession(session: RuntimeReviewSession): Promise<RuntimeReviewSession> {
	const path = getReviewSessionPath(session.host, session.projectId, session.iid);
	await mkdir(dirname(path), { recursive: true });
	const next: RuntimeReviewSession = { ...session, updatedAt: new Date().toISOString() };
	await writeFile(path, `${JSON.stringify(next, null, 2)}\n`, "utf-8");
	return next;
}

export function createEmptyReviewSession(host: string, projectId: number, iid: number): RuntimeReviewSession {
	return {
		host,
		projectId,
		iid,
		lastReviewedHeadSha: null,
		reviewedPaths: [],
		draftComments: [],
		findings: [],
		dismissedFindingIds: [],
		chatSessionId: null,
		chatMessages: [],
		updatedAt: new Date().toISOString(),
	};
}

/**
 * Sessions that still hold unpublished drafts, newest first. The Review sidebar
 * uses this to surface "you left 2 comments on !142" without hitting GitLab —
 * unfinished local work should be visible before the network is even reachable.
 */
export async function listReviewSessionsWithDrafts(host: string): Promise<RuntimeReviewSession[]> {
	const dir = join(getReviewSessionsDir(), toHostDirName(host));
	let names: string[];
	try {
		names = await readdir(dir);
	} catch {
		return [];
	}
	const sessions: RuntimeReviewSession[] = [];
	for (const name of names) {
		if (!name.endsWith(".json")) {
			continue;
		}
		try {
			const parsed = runtimeReviewSessionSchema.safeParse(
				JSON.parse(await readFile(join(dir, name), "utf-8")) as unknown,
			);
			if (parsed.success && parsed.data.draftComments.length > 0) {
				sessions.push(parsed.data);
			}
		} catch {
			// One unreadable session must not hide the others.
		}
	}
	return sessions.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}
