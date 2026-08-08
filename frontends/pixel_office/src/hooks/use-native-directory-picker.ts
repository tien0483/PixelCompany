import { useCallback } from "react";

import { getRuntimeTrpcClient } from "@/runtime/trpc-client";

export interface NativeDirectoryPickerResult {
	path: string | null;
	/** Set when no native dialog command (zenity/kdialog/osascript/PowerShell) is available. */
	unavailable?: boolean;
}

export interface UseNativeDirectoryPickerResult {
	pickDirectory: () => Promise<NativeDirectoryPickerResult>;
}

/**
 * `pickDirectoryPathFromSystemDialog` (backends/runtime/src/server/directory-picker.ts) throws a
 * "Could not open directory picker..." error for every "no native dialog available" case (missing
 * zenity/kdialog, no DISPLAY/WAYLAND_DISPLAY, missing osascript, missing PowerShell). The tRPC
 * `projects.pickDirectory` procedure catches that into `{ ok: false, path: null, error: message }` -
 * the same shape used for a clean user cancellation, whose error is instead the distinct
 * "No directory was selected." message. This prefix is what distinguishes the two.
 */
const UNAVAILABLE_ERROR_PREFIX = "Could not open directory picker";

/** Shared hook for "Browse folder…" call sites: native picker first, in-app browser as fallback. */
export function useNativeDirectoryPicker(workspaceId: string | null): UseNativeDirectoryPickerResult {
	const pickDirectory = useCallback(async (): Promise<NativeDirectoryPickerResult> => {
		const trpcClient = getRuntimeTrpcClient(workspaceId);
		const response = await trpcClient.projects.pickDirectory.mutate();
		if (response.ok && response.path) {
			return { path: response.path };
		}
		if (response.error?.startsWith(UNAVAILABLE_ERROR_PREFIX)) {
			return { path: null, unavailable: true };
		}
		return { path: null };
	}, [workspaceId]);

	return { pickDirectory };
}
