import { useCallback, useState } from "react";

interface UseCleanupToolsResult {
	isCleanupDialogOpen: boolean;
	handleOpenCleanupDialog: () => void;
	handleCleanupDialogOpenChange: (nextOpen: boolean) => void;
}

export function useCleanupTools(): UseCleanupToolsResult {
	const [isCleanupDialogOpen, setIsCleanupDialogOpen] = useState(false);

	const handleOpenCleanupDialog = useCallback(() => {
		setIsCleanupDialogOpen(true);
	}, []);

	const handleCleanupDialogOpenChange = useCallback((nextOpen: boolean) => {
		setIsCleanupDialogOpen(nextOpen);
	}, []);

	return { isCleanupDialogOpen, handleOpenCleanupDialog, handleCleanupDialogOpenChange };
}
