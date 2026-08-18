import { type ReactElement, useCallback, useEffect, useState } from "react";

import { ReviewMergeRequestListScreen } from "@/components/review/review-mr-list-screen";
import { ReviewWorkspaceView } from "@/components/review/review-workspace-view";
import { ThemeSelect } from "@/components/theme-select";
import { useTheme } from "@/hooks/use-theme";
import { useReviewRoute } from "@/review-app/use-review-route";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";

/** Rules-bundle key for the standalone package, which has no project list to key off. */
const STANDALONE_PROJECT_KEY = "standalone";

export function ReviewApp(): ReactElement {
	const { themeId, setThemeId } = useTheme();
	const [host, setHost] = useState<string | null>(null);
	const { openTarget, openFromList, close } = useReviewRoute(host);

	// The route hook needs the connected host before it can restore a target from the
	// URL, since a review session is keyed by host.
	const loadHost = useCallback(async () => {
		try {
			const status = await getRuntimeTrpcClient(null).gitlab.status.query();
			setHost(status.host);
		} catch {
			// Not connected yet is the normal first-run state; the list screen prompts.
		}
	}, []);

	useEffect(() => {
		void loadHost();
	}, [loadHost]);

	// This shell owns the app's height. `#root` is `height: 100%` but a *block* box
	// (globals.css), so a child's `flex-1` resolves against nothing when mounted
	// directly under it and the panes collapse to content height. Inside the full app
	// `App.tsx` supplies this flex column, so it is only needed here.
	return (
		<div className="flex h-[100svh] min-h-0 flex-col bg-surface-0 text-text-primary">
			{openTarget ? (
				<ReviewWorkspaceView
					key={`${openTarget.host}-${openTarget.projectId}-${openTarget.iid}`}
					target={openTarget}
					workspaceId={null}
					onClose={close}
				/>
			) : (
				<>
					{/* The standalone package has no settings dialog, so the theme picker
					    travels with the list header — otherwise it would be unreachable. */}
					<div className="flex h-10 shrink-0 items-center justify-between border-b border-border bg-surface-1 px-3">
						<span className="text-sm font-semibold">Review</span>
						<ThemeSelect variant="compact" value={themeId} onValueChange={setThemeId} />
					</div>
					<ReviewMergeRequestListScreen
						workspaceId={null}
						projectKey={STANDALONE_PROJECT_KEY}
						onOpenMergeRequest={(target) => {
							setHost(target.host);
							openFromList(target);
						}}
					/>
				</>
			)}
		</div>
	);
}
