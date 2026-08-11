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
 * `pickDirectoryPathFromSystemDialog` (backends/runtime/src/server/directory-picker.ts) throws one
 * of these exact messages when no native dialog command is available at all (missing zenity/kdialog,
 * no DISPLAY/WAYLAND_DISPLAY, missing osascript, missing PowerShell). The `projects.pickDirectory`
 * tRPC procedure catches any thrown error into `{ ok: false, path: null, error: message }` - the same
 * shape used for a clean user cancellation (`CANCELLED_ERROR_MESSAGE` below) and for genuine dialog
 * failures (e.g. "Could not open directory picker via zenity: Gtk warning", or a signal-terminated
 * command). Only these exact strings mean "no native picker available" - anything else (including
 * other errors that happen to share the "Could not open directory picker" prefix) is a real failure
 * and must not be silently reclassified as unavailable or as a cancellation.
 */
const UNAVAILABLE_ERROR_MESSAGES = new Set<string>([
	'Could not open directory picker. Install "zenity" or "kdialog" and try again.',
	'Could not open directory picker. Command "osascript" is not available.',
	'Could not open directory picker. Install PowerShell ("powershell" or "pwsh") and try again.',
]);

const CANCELLED_ERROR_MESSAGE = "No directory was selected.";

/** Shared hook for "Browse folder…" call sites: native picker first, in-app browser as fallback. */
export function useNativeDirectoryPicker(workspaceId: string | null): UseNativeDirectoryPickerResult {
	const pickDirectory = useCallback(async (): Promise<NativeDirectoryPickerResult> => {
		const trpcClient = getRuntimeTrpcClient(workspaceId);
		const response = await trpcClient.projects.pickDirectory.mutate();
		if (response.ok && response.path) {
			return { path: response.path };
		}
		if (response.error === CANCELLED_ERROR_MESSAGE) {
			return { path: null };
		}
		if (response.error && UNAVAILABLE_ERROR_MESSAGES.has(response.error)) {
			return { path: null, unavailable: true };
		}
		// A genuine failure (real command error, signal termination, or an unrecognized shape) -
		// surface it as a real error rather than silently treating it as "unavailable" or "cancelled".
		throw new Error(response.error ?? "Could not pick a directory.");
	}, [workspaceId]);

	return { pickDirectory };
}
