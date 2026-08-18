import { useCallback, useEffect, useRef, useState } from "react";

import type { ReviewTarget } from "@/review/review-target";

/**
 * Keeps the open merge request in the URL so the standalone reviewer survives a
 * reload and answers Back. Without it the open MR lived only in component state, and
 * reloading — the obvious move after authorizing GitLab in another tab — dropped the
 * reviewer back on the list.
 *
 * The target travels in the hash, not a path segment: the packaged server serves the
 * built `index.html` for `/` and has no history fallback, so `/mr/102/142` would 404
 * on exactly the reload this exists to survive. Same reasoning as `use-plan-route.ts`.
 */
const REVIEW_HASH_PREFIX = "#mr=";

export function readReviewTargetFromHash(): ReviewTarget | null {
	if (typeof window === "undefined") {
		return null;
	}
	const hash = window.location.hash;
	if (!hash.startsWith(REVIEW_HASH_PREFIX)) {
		return null;
	}
	// `<projectId>/<iid>/<projectKey>`; the host comes from the connected account,
	// since a URL is not allowed to point this at an instance nobody authorized.
	const parts = decodeURIComponent(hash.slice(REVIEW_HASH_PREFIX.length)).split("/");
	const projectId = Number(parts[0]);
	const iid = Number(parts[1]);
	if (!Number.isInteger(projectId) || projectId <= 0 || !Number.isInteger(iid) || iid <= 0) {
		return null;
	}
	return {
		host: "",
		projectId,
		iid,
		title: `!${iid}`,
		projectKey: parts[2] && parts[2].length > 0 ? parts[2] : "default",
	};
}

function reviewHashUrl(target: ReviewTarget | null): string {
	const { pathname, search } = window.location;
	if (target === null) {
		return `${pathname}${search}`;
	}
	const value = `${target.projectId}/${target.iid}/${target.projectKey}`;
	return `${pathname}${search}${REVIEW_HASH_PREFIX}${encodeURIComponent(value)}`;
}

/**
 * `pushState` rather than assigning `location.hash`: assigning fires `hashchange`,
 * which would send this hook straight back to re-resolving the target it just opened.
 */
function pushTarget(target: ReviewTarget | null): void {
	window.history.pushState(null, "", reviewHashUrl(target));
}

export interface ReviewRoute {
	openTarget: ReviewTarget | null;
	openFromList: (target: ReviewTarget) => void;
	close: () => void;
}

export function useReviewRoute(hostFromConnection: string | null): ReviewRoute {
	const [openTarget, setOpenTarget] = useState<ReviewTarget | null>(null);
	const openTargetRef = useRef<ReviewTarget | null>(null);
	openTargetRef.current = openTarget;

	useEffect(() => {
		const syncFromUrl = (): void => {
			const fromHash = readReviewTargetFromHash();
			if (fromHash === null) {
				setOpenTarget(null);
				return;
			}
			const current = openTargetRef.current;
			if (current && current.projectId === fromHash.projectId && current.iid === fromHash.iid) {
				return;
			}
			// A URL-restored target has no host until the connection reports one, so this
			// waits rather than opening a review keyed to an empty host — the session file
			// and every draft in it are keyed by host.
			if (!hostFromConnection) {
				return;
			}
			setOpenTarget({ ...fromHash, host: hostFromConnection });
		};

		syncFromUrl();
		const handleNavigate = (): void => syncFromUrl();
		window.addEventListener("popstate", handleNavigate);
		window.addEventListener("hashchange", handleNavigate);
		return () => {
			window.removeEventListener("popstate", handleNavigate);
			window.removeEventListener("hashchange", handleNavigate);
		};
	}, [hostFromConnection]);

	const openFromList = useCallback((target: ReviewTarget) => {
		setOpenTarget(target);
		pushTarget(target);
	}, []);

	const close = useCallback(() => {
		setOpenTarget(null);
		pushTarget(null);
	}, []);

	return { openTarget, openFromList, close };
}
