import { useCallback, useEffect, useState } from "react";

import { cleanRuntimeMergedWorktrees, fetchClaudeCacheStatus } from "@/runtime/runtime-config-query";

interface UseCleanupToolsResult {
	isCleanupDialogOpen: boolean;
	handleOpenCleanupDialog: () => void;
	handleCleanupDialogOpenChange: (nextOpen: boolean) => void;
	/** Best-effort estimate behind the top bar's cleanup badge; 0 when unknown. */
	reclaimableBytes: number;
}

export function useCleanupTools(workspaceId: string | null): UseCleanupToolsResult {
	const [isCleanupDialogOpen, setIsCleanupDialogOpen] = useState(false);
	const [reclaimableBytes, setReclaimableBytes] = useState(0);

	// The scan walks every task worktree to size it, so it is deliberately run only
	// on mount and after the dialog closes (the one moment the number is known to
	// have changed) rather than on a timer.
	const refreshEstimate = useCallback(() => {
		void (async () => {
			const [worktreeResult, statusResult] = await Promise.allSettled([
				cleanRuntimeMergedWorktrees(workspaceId, {
					dryRun: true,
					categories: ["missing", "merged", "unused", "orphaned", "unregistered", "stale-branch"],
				}),
				fetchClaudeCacheStatus(workspaceId, { days: 1 }),
			]);
			let total = 0;
			if (worktreeResult.status === "fulfilled") {
				total += (worktreeResult.value.reclaimable ?? []).reduce((sum, entry) => sum + entry.sizeBytes, 0);
			}
			if (statusResult.status === "fulfilled") {
				const status = statusResult.value;
				total += status.safeSizeBytes + (status.legacySizeBytes ?? 0);
				total += status.cliCacheSizeBytes ?? 0;
				total += status.dshPackageSizeBytes ?? 0;
				total += status.cursorCacheSizeBytes ?? 0;
				total += status.geminiCacheSizeBytes ?? 0;
				total += status.antigravityHomeSizeBytes ?? 0;
				total += status.tmpSizeBytes ?? 0;
				total += status.npmCacheSizeBytes ?? 0;
				total += status.nvmCacheSizeBytes ?? 0;
				total += status.pnpmStoreSizeBytes ?? 0;
				total += status.playwrightCacheSizeBytes ?? 0;
				// Build *caches* only, matching what "Select maximum" checks: an output
				// costs a rebuild, so the badge must not advertise it as free space.
				total += status.buildCacheSizeBytes ?? 0;
				total += (status.nvmVersions ?? [])
					.filter((entry) => !entry.inUse)
					.reduce((sum, entry) => sum + entry.sizeBytes, 0);
				total += status.recycleBinSizeBytes ?? 0;
			}
			// Both sides failing is the "no project open" case, which should read as
			// "nothing to show" rather than surfacing an error the user can't act on.
			setReclaimableBytes(total);
		})();
	}, [workspaceId]);

	useEffect(() => {
		refreshEstimate();
	}, [refreshEstimate]);

	const handleOpenCleanupDialog = useCallback(() => {
		setIsCleanupDialogOpen(true);
	}, []);

	const handleCleanupDialogOpenChange = useCallback(
		(nextOpen: boolean) => {
			setIsCleanupDialogOpen(nextOpen);
			if (!nextOpen) {
				refreshEstimate();
			}
		},
		[refreshEstimate],
	);

	return { isCleanupDialogOpen, handleOpenCleanupDialog, handleCleanupDialogOpenChange, reclaimableBytes };
}
