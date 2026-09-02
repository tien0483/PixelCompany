import { useCallback, useRef } from "react";

// Native DOM events, not React's synthetic ones: these handlers are attached with
// `container.addEventListener` in `use-persistent-terminal-session.ts`, so a synthetic
// signature never matches what the listener actually receives.

import { showAppToast } from "@/components/app-toaster";
import {
	ACCEPTED_TASK_IMAGE_INPUT_ACCEPT,
	collectImageLikeFilesFromDataTransfer,
	fileToTaskImage,
	isAcceptedTaskImageFile,
} from "@/components/task-image-input-utils";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";

const TERMINAL_PASTE_IMAGE_MAX_BYTES = 20 * 1024 * 1024;

function formatMegabytes(bytes: number): string {
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export interface UseTerminalImagePasteInput {
	taskId: string;
	workspaceId: string | null;
	enabled?: boolean;
	onPastePaths: (paths: string[]) => void;
}

export interface UseTerminalImagePasteResult {
	handlePaste: (event: ClipboardEvent) => void;
	handleDrop: (event: DragEvent) => void;
	handleDragOver: (event: DragEvent) => void;
}

/**
 * Intercepts image paste/drop on a PTY container, uploads to the runtime tmp dir,
 * then injects absolute file paths as text (matching Claude Code terminal behavior).
 */
export function useTerminalImagePaste({
	taskId,
	workspaceId,
	enabled = true,
	onPastePaths,
}: UseTerminalImagePasteInput): UseTerminalImagePasteResult {
	const onPastePathsRef = useRef(onPastePaths);
	onPastePathsRef.current = onPastePaths;

	const uploadFiles = useCallback(
		async (files: File[]) => {
			if (!enabled || !workspaceId || files.length === 0) {
				return;
			}
			const stagedImages = [];
			for (const file of files) {
				if (!isAcceptedTaskImageFile(file)) {
					showAppToast({
						intent: "danger",
						message: `"${file.name || "image"}" is a ${file.type || "unknown"} file. Supported: ${ACCEPTED_TASK_IMAGE_INPUT_ACCEPT}.`,
					});
					continue;
				}
				if (file.size > TERMINAL_PASTE_IMAGE_MAX_BYTES) {
					showAppToast({
						intent: "danger",
						message: `"${file.name || "image"}" is ${formatMegabytes(file.size)}. The limit is ${formatMegabytes(TERMINAL_PASTE_IMAGE_MAX_BYTES)}.`,
					});
					continue;
				}
				const image = await fileToTaskImage(file);
				if (!image) {
					showAppToast({
						intent: "danger",
						message: `Could not read image "${file.name || "image"}".`,
					});
					continue;
				}
				stagedImages.push(image);
			}
			if (stagedImages.length === 0) {
				return;
			}
			try {
				const trpcClient = getRuntimeTrpcClient(workspaceId);
				const response = await trpcClient.runtime.stageTaskSessionPasteImages.mutate({
					taskId,
					images: stagedImages,
				});
				if (!response.ok || response.paths.length === 0) {
					showAppToast({
						intent: "danger",
						message: response.error ?? "Could not save pasted image for the terminal.",
					});
					return;
				}
				onPastePathsRef.current(response.paths);
			} catch (error) {
				showAppToast({
					intent: "danger",
					message: error instanceof Error ? error.message : "Could not save pasted image for the terminal.",
				});
			}
		},
		[enabled, taskId, workspaceId],
	);

	const handleImageTransfer = useCallback(
		(event: ClipboardEvent | DragEvent, dataTransfer: DataTransfer | null) => {
			if (!enabled || !dataTransfer) {
				return false;
			}
			const imageFiles = collectImageLikeFilesFromDataTransfer(dataTransfer);
			if (imageFiles.length === 0) {
				return false;
			}
			event.preventDefault();
			event.stopPropagation();
			void uploadFiles(imageFiles);
			return true;
		},
		[enabled, uploadFiles],
	);

	const handlePaste = useCallback(
		(event: ClipboardEvent) => {
			handleImageTransfer(event, event.clipboardData);
		},
		[handleImageTransfer],
	);

	const handleDrop = useCallback(
		(event: DragEvent) => {
			handleImageTransfer(event, event.dataTransfer);
		},
		[handleImageTransfer],
	);

	const handleDragOver = useCallback(
		(event: DragEvent) => {
			if (!enabled || !event.dataTransfer) {
				return;
			}
			const imageFiles = collectImageLikeFilesFromDataTransfer(event.dataTransfer);
			if (imageFiles.length === 0) {
				return;
			}
			event.preventDefault();
		},
		[enabled],
	);

	return { handlePaste, handleDrop, handleDragOver };
}
