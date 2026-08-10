import { type ClipboardEvent, type DragEvent, useCallback, useState } from "react";

import { showAppToast } from "@/components/app-toaster";
import {
	ACCEPTED_TASK_IMAGE_INPUT_ACCEPT,
	collectImageLikeFilesFromDataTransfer,
	fileToTaskImage,
	isAcceptedTaskImageFile,
} from "@/components/task-image-input-utils";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";

/**
 * The wire ceiling for a plan asset, mirroring `PLAN_ASSET_MAX_BASE64_LENGTH`
 * (14,000,000 base64 chars) in `backends/runtime/src/core/api-contract.ts`. Checked here
 * because the contract rejects an oversized upload with a zod error the user cannot act
 * on, and the generic task-image ceiling is twice as high.
 */
export const PLAN_ASSET_MAX_BYTES = 10 * 1024 * 1024;

function formatMegabytes(bytes: number): string {
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export interface UsePlanImagePasteResult {
	isUploading: boolean;
	uploadImageFile: (file: File) => Promise<void>;
	handlePaste: (event: ClipboardEvent) => void;
	handleDrop: (event: DragEvent) => void;
	handleDragOver: (event: DragEvent) => void;
}

/**
 * Uploads pasted/dropped/picked images to the plan's `<stem>.assets/` folder
 * via `plans.writeAsset`, then hands the caller the uploaded file's relative path
 * to insert at the cursor.
 *
 * Every rejection has to surface: an upload that fails silently is indistinguishable
 * from an editor that does not support images at all.
 */
export function usePlanImagePaste(
	planId: string | null,
	workspaceId: string | null | undefined,
	onImageInserted: (relativePath: string, name: string) => void,
): UsePlanImagePasteResult {
	const [isUploading, setIsUploading] = useState(false);

	const uploadFiles = useCallback(
		async (files: File[]) => {
			if (!planId || files.length === 0) {
				return;
			}
			setIsUploading(true);
			try {
				for (const file of files) {
					if (!isAcceptedTaskImageFile(file)) {
						showAppToast({
							intent: "danger",
							message: `"${file.name || "image"}" is a ${file.type || "unknown"} file. Supported: ${ACCEPTED_TASK_IMAGE_INPUT_ACCEPT}.`,
						});
						continue;
					}
					if (file.size > PLAN_ASSET_MAX_BYTES) {
						showAppToast({
							intent: "danger",
							message: `"${file.name || "image"}" is ${formatMegabytes(file.size)}. The limit for a plan image is ${formatMegabytes(PLAN_ASSET_MAX_BYTES)}.`,
						});
						continue;
					}
					const image = await fileToTaskImage(file);
					if (!image) {
						showAppToast({ intent: "danger", message: `Could not read image "${file.name || "image"}".` });
						continue;
					}
					try {
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
						onImageInserted(response.relativePath, image.name ?? "image");
					} catch (error) {
						showAppToast({
							intent: "danger",
							message: `Could not save "${file.name || "image"}": ${error instanceof Error ? error.message : String(error)}`,
						});
					}
				}
			} finally {
				setIsUploading(false);
			}
		},
		[planId, workspaceId, onImageInserted],
	);

	const uploadImageFile = useCallback(
		async (file: File) => {
			await uploadFiles([file]);
		},
		[uploadFiles],
	);

	const handlePaste = useCallback(
		(event: ClipboardEvent) => {
			if (!event.clipboardData) {
				return;
			}
			// Must run inside the synchronous event window — browsers clear the DataTransfer after it.
			const imageFiles = collectImageLikeFilesFromDataTransfer(event.clipboardData);
			if (imageFiles.length === 0) {
				return;
			}
			event.preventDefault();
			void uploadFiles(imageFiles);
		},
		[uploadFiles],
	);

	const handleDrop = useCallback(
		(event: DragEvent) => {
			if (!event.dataTransfer) {
				return;
			}
			const imageFiles = collectImageLikeFilesFromDataTransfer(event.dataTransfer);
			if (imageFiles.length === 0) {
				return;
			}
			event.preventDefault();
			void uploadFiles(imageFiles);
		},
		[uploadFiles],
	);

	const handleDragOver = useCallback((event: DragEvent) => {
		event.preventDefault();
	}, []);

	return { isUploading, uploadImageFile, handlePaste, handleDrop, handleDragOver };
}
