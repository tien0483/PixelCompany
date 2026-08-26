// The post-image of one reviewed file, fetched on demand for the "Full file" toggle.
//
// This exists because the diff pane used to hold the content in a plain `useState` that
// was written once and never invalidated. The pane is not remounted per file — it has no
// `key` — so every file after the first rendered the first one's text, with the *current*
// file's added lines highlighted over it. Keying the cache on the path is the fix; the
// request token is what stops the same bug arriving by a slower route, when a fetch for
// the file the reviewer just left resolves after the one they moved to.

import { useCallback, useEffect, useRef, useState } from "react";

export interface FullFileFetchResult {
	content: string | null;
	/** The reason the fetch failed, as the server described it. */
	error: string | null;
}

export interface FullFileContentState {
	content: string | null;
	isLoading: boolean;
	error: string | null;
	/** Clears the error so a failed fetch can be attempted again on the same file. */
	retry: () => void;
}

export function useFullFileContent(input: {
	/** The file the content must belong to. Changing it discards what was loaded. */
	path: string | null;
	/** Whether the reviewer is asking to see it — nothing is fetched until they do. */
	enabled: boolean;
	fetchFile: (() => Promise<FullFileFetchResult>) | undefined;
}): FullFileContentState {
	const { path, enabled, fetchFile } = input;
	const [content, setContent] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [isLoading, setIsLoading] = useState(false);

	// Held in a ref so the parent's fresh callback identity on every render cannot
	// re-trigger the fetch effect; the callback already closes over the active file.
	const fetchFileRef = useRef(fetchFile);
	fetchFileRef.current = fetchFile;

	/** Incremented per attempt. A resolution whose token is stale is dropped. */
	const attemptRef = useRef(0);

	useEffect(() => {
		attemptRef.current += 1;
		setContent(null);
		setError(null);
		setIsLoading(false);
	}, [path]);

	useEffect(() => {
		const load = fetchFileRef.current;
		if (!enabled || path === null || load === undefined || content !== null || error !== null) {
			return;
		}
		attemptRef.current += 1;
		const attempt = attemptRef.current;
		setIsLoading(true);
		void (async () => {
			let result: FullFileFetchResult;
			try {
				result = await load();
			} catch (cause) {
				result = { content: null, error: cause instanceof Error ? cause.message : String(cause) };
			}
			if (attemptRef.current !== attempt) {
				// The reviewer moved on. Whatever this is, it is not their file.
				return;
			}
			setIsLoading(false);
			setContent(result.content);
			setError(
				result.content === null
					? (result.error ?? "Could not load this file's contents from GitLab.")
					: null,
			);
		})();
		// `content`/`error` are read as "is there anything to do", not as inputs: the
		// effect is a no-op once either is set, and the `[path]` effect above clearing
		// them is what lets the next file fetch.
	}, [content, enabled, error, path]);

	const retry = useCallback(() => {
		setError(null);
	}, []);

	return { content, isLoading, error, retry };
}
