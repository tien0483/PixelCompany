import { useCallback, useState } from "react";

interface UseStackControlResult {
	isStackDialogOpen: boolean;
	handleOpenStackDialog: () => void;
	handleStackDialogOpenChange: (nextOpen: boolean) => void;
}

export function useStackControl(): UseStackControlResult {
	const [isStackDialogOpen, setIsStackDialogOpen] = useState(false);

	const handleOpenStackDialog = useCallback(() => {
		setIsStackDialogOpen(true);
	}, []);

	const handleStackDialogOpenChange = useCallback((nextOpen: boolean) => {
		setIsStackDialogOpen(nextOpen);
	}, []);

	return {
		isStackDialogOpen,
		handleOpenStackDialog,
		handleStackDialogOpenChange,
	};
}
