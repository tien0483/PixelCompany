import { useCallback, useEffect, useState } from "react";

import { showAppToast } from "@/components/app-toaster";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";

export interface ReviewRulesConfigApi {
	/** Files or directories the extraction agent reads. Empty until the user sets them. */
	sourceRoots: string[];
	isLoading: boolean;
	isSaving: boolean;
	save: (sourceRoots: string[]) => Promise<boolean>;
}

/**
 * The project's rule-source paths, which are what makes extraction runnable.
 *
 * Separate from `useReviewSession` because it is keyed by project rather than by
 * merge request: every review of the same repo shares one set of guideline paths,
 * and the session is per-MR.
 */
export function useReviewRulesConfig(projectKey: string, workspaceId: string | null): ReviewRulesConfigApi {
	const [sourceRoots, setSourceRoots] = useState<string[]>([]);
	const [isLoading, setIsLoading] = useState(true);
	const [isSaving, setIsSaving] = useState(false);

	useEffect(() => {
		let cancelled = false;
		setIsLoading(true);
		void (async () => {
			try {
				const client = getRuntimeTrpcClient(workspaceId);
				const response = await client.review.getRulesConfig.query({ projectKey });
				if (!cancelled) {
					setSourceRoots(response.config?.sourceRoots ?? []);
				}
			} catch {
				// An unreadable config is indistinguishable from an unset one for the
				// caller's purposes: both mean "extraction cannot run yet", and the panel
				// already says so. A toast here would fire on every review that opens
				// before the runtime is up.
				if (!cancelled) {
					setSourceRoots([]);
				}
			} finally {
				if (!cancelled) {
					setIsLoading(false);
				}
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [projectKey, workspaceId]);

	const save = useCallback(
		async (next: string[]): Promise<boolean> => {
			// Blank entries come from an empty "add" row; storing one would send the
			// extraction agent an empty path to read.
			const cleaned = next.map((root) => root.trim()).filter((root) => root.length > 0);
			setIsSaving(true);
			try {
				const client = getRuntimeTrpcClient(workspaceId);
				const response = await client.review.setRulesConfig.mutate({ projectKey, sourceRoots: cleaned });
				if (!response.ok) {
					showAppToast({ intent: "danger", message: response.error ?? "Could not save the rule sources." });
					return false;
				}
				setSourceRoots(response.config?.sourceRoots ?? cleaned);
				return true;
			} catch (error) {
				showAppToast({
					intent: "danger",
					message: error instanceof Error ? error.message : String(error),
				});
				return false;
			} finally {
				setIsSaving(false);
			}
		},
		[projectKey, workspaceId],
	);

	return { sourceRoots, isLoading, isSaving, save };
}
