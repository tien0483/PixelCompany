import { useCallback, useEffect, useState } from "react";

/** Follows `pixtiel.review.seat.<host>` — same scope, same convention. */
const STORAGE_KEY_PREFIX = "pixtiel.review.repo.";

/**
 * "Follow the shell's project", stored rather than left absent.
 *
 * The same three-way distinction `SeatChoice` needs, for the same reason: a missing key
 * means "never chosen" and is what triggers the one-time auto-capture below, so storing
 * nothing for a deliberate unlock would re-pin the repository on the next render. Safe
 * as a sentinel because a real value is always an absolute checkout path.
 */
const UNLOCKED_STORAGE_VALUE = "unlocked";

/**
 * The local checkout a review reads from, remembered per GitLab project.
 *
 * Keyed by `host` + `projectId` rather than by host: one GitLab instance holds many
 * repositories, and the whole point of the lock is that a merge request is answered
 * about *its own* repository. Keyed by neither the merge request nor the reviewer's
 * shell selection: the pairing is a property of the project, so the next merge request
 * against the same repository opens against the same checkout.
 */
export function reviewRepoLockStorageKey(host: string, projectId: number): string {
	return `${STORAGE_KEY_PREFIX}${host}.${projectId}`;
}

export interface ReviewRepoLock {
	/** The pinned checkout, or null when the review follows the shell's project. */
	lockedPath: string | null;
	lock: (path: string) => void;
	unlock: () => void;
}

/**
 * Pins the repository a review resolves its knowledge graph, slash commands and chat
 * cwd against, so a project switch in the sidebar cannot silently repoint them.
 *
 * `shellRepoPath` is the project the shell currently points at. It is captured *once*,
 * the first time a merge request is opened with nothing stored, which is what makes the
 * pin cost no clicks. A first capture can be wrong — opening a merge request for one
 * repository while another is selected pins the wrong one — so the header chip shows
 * what got pinned and offers a re-pick. That is still strictly better than the silent
 * drift it replaces, where nothing on screen said which repository was being read.
 *
 * The value is a path, not a project id: ids are per-install, and a path is what every
 * repo-scoped review procedure takes.
 */
export function useReviewRepoLock(input: {
	host: string;
	projectId: number;
	shellRepoPath: string | undefined;
}): ReviewRepoLock {
	const { host, projectId, shellRepoPath } = input;
	const storageKey = reviewRepoLockStorageKey(host, projectId);
	const [lockedPath, setLockedPath] = useState<string | null>(null);

	const write = useCallback(
		(value: string | null) => {
			try {
				window.localStorage.setItem(storageKey, value ?? UNLOCKED_STORAGE_VALUE);
			} catch {
				// Private mode or a disabled store: the in-memory pin still applies for
				// this session.
			}
		},
		[storageKey],
	);

	useEffect(() => {
		let raw: string | null = null;
		try {
			raw = window.localStorage.getItem(storageKey);
		} catch {
			// Nothing readable, so nothing to honour. The review falls back to following
			// the shell's project, which is the behaviour this hook replaced.
			setLockedPath(null);
			return;
		}
		if (raw === UNLOCKED_STORAGE_VALUE) {
			setLockedPath(null);
			return;
		}
		if (raw !== null && raw.length > 0) {
			setLockedPath(raw);
			return;
		}
		// Never chosen. Capture whatever the shell is pointing at now, and only now:
		// re-capturing on every project switch is exactly the drift being fixed.
		if (shellRepoPath === undefined || shellRepoPath.length === 0) {
			setLockedPath(null);
			return;
		}
		setLockedPath(shellRepoPath);
		write(shellRepoPath);
	}, [shellRepoPath, storageKey, write]);

	const lock = useCallback(
		(path: string) => {
			setLockedPath(path);
			write(path);
		},
		[write],
	);

	const unlock = useCallback(() => {
		setLockedPath(null);
		write(null);
	}, [write]);

	return { lockedPath, lock, unlock };
}
