import { type ClipboardEvent, type DragEvent, useCallback, useState } from "react";

import { showAppToast } from "@/components/app-toaster";
import {
	collectImageFilesFromDataTransfer,
	extractImagesFromDataTransfer,
	fileToTaskImage,
} from "@/components/task-image-input-utils";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";

export interface UsePlanImagePasteResult {
	isUploading: boolean;
	uploadImageFile: (file: File) => Promise<void>;
	handlePaste: (event: ClipboardEvent) => void;
	handleDrop: (event: DragEvent) => void;
	handleDragOver: (event: DragEvent) => void;
}

/**
 * Uploads pasted/dropped/picked images to the plan's `<stem>.assets/` folder
 * via `plans.writeAsset`, then hands the caller a `![name](relativePath)` link
 * to insert at the cursor.
 */
export function usePlanImagePaste(
	planId: string | null,
	workspaceId: string | null | undefined,
	onImageInserted: (markdown: string) => void,
): UsePlanImagePasteResult {
	const [isUploading, setIsUploading] = useState(false);

	const uploadImages = useCallback(
		async (images: { data: string; mimeType: string; name?: string }[]) => {
			if (!planId || images.length === 0) {
				return;
			}
			setIsUploading(true);
			try {
				for (const image of images) {
					const trpcClient = getRuntimeTrpcClient(workspaceId ?? null);
					const response = await trpcClient.plans.writeAsset.mutate({
						planId,
						data: image.data,
						mimeType: image.mimeType,
						name: image.name,
					});
					if (!response.ok || !response.relativePath) {
						showAppToast({ intent: "danger", message: response.error ?? "Failed to save image." });
						continue;
					}
					onImageInserted(`![${image.name ?? "image"}](${response.relativePath})`);
				}
			} finally {
				setIsUploading(false);
			}
		},
		[planId, workspaceId, onImageInserted],
	);

	const uploadImageFile = useCallback(
		async (file: File) => {
			const image = await fileToTaskImage(file);
			if (!image) {
				showAppToast({ intent: "danger", message: `Could not read image "${file.name}".` });
				return;
			}
			await uploadImages([image]);
		},
		[uploadImages],
	);

	const handlePaste = useCallback(
		(event: ClipboardEvent) => {
			if (!event.clipboardData) {
				return;
			}
			const imageFiles = collectImageFilesFromDataTransfer(event.clipboardData);
			if (imageFiles.length === 0) {
				return;
			}
			event.preventDefault();
			const dataTransfer = event.clipboardData;
			void (async () => {
				const images = await extractImagesFromDataTransfer(dataTransfer);
				await uploadImages(images);
			})();
		},
		[uploadImages],
	);

	const handleDrop = useCallback(
		(event: DragEvent) => {
			if (!event.dataTransfer) {
				return;
			}
			const imageFiles = collectImageFilesFromDataTransfer(event.dataTransfer);
			if (imageFiles.length === 0) {
				return;
			}
			event.preventDefault();
			const dataTransfer = event.dataTransfer;
			void (async () => {
				const images = await extractImagesFromDataTransfer(dataTransfer);
				await uploadImages(images);
			})();
		},
		[uploadImages],
	);

	const handleDragOver = useCallback((event: DragEvent) => {
		event.preventDefault();
	}, []);

	return { isUploading, uploadImageFile, handlePaste, handleDrop, handleDragOver };
}
