import { useCallback, useEffect, useMemo, useState } from "react";

import { showAppToast } from "@/components/app-toaster";
import { fetchRuntimeHostEnvironment } from "@/runtime/runtime-config-query";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import { LocalStorageKey } from "@/storage/local-storage-store";
import {
	buildOpenCommand,
	getOpenTargetOption,
	getOpenTargetOptions,
	normalizeOpenPlatformOverride,
	normalizeOpenTargetId,
	type OpenPlatformOverride,
	type OpenTargetId,
	type OpenTargetOption,
	type OpenTargetPlatform,
	PREFERRED_OPEN_TARGET_STORAGE_KEY,
	resolveEffectiveOpenPlatform,
	resolveOpenTargetPlatform,
} from "@/utils/open-targets";
import { useRawLocalStorageValue } from "@/utils/react-use";

interface UseOpenWorkspaceParams {
	currentProjectId: string | null;
	workspacePath?: string;
}

export interface UseOpenWorkspaceResult {
	openTargetOptions: readonly OpenTargetOption[];
	selectedOpenTargetId: OpenTargetId;
	onSelectOpenTarget: (targetId: OpenTargetId) => void;
	openPlatformOverride: OpenPlatformOverride;
	onSelectOpenPlatform: (override: OpenPlatformOverride) => void;
	detectedOpenPlatform: OpenTargetPlatform | null;
	onOpenWorkspace: () => void;
	canOpenWorkspace: boolean;
	isOpeningWorkspace: boolean;
}

function getFirstOutputLine(output: string): string | null {
	return (
		output
			.split("\n")
			.map((line) => line.trim())
			.find(Boolean) ?? null
	);
}

export function useOpenWorkspace({ currentProjectId, workspacePath }: UseOpenWorkspaceParams): UseOpenWorkspaceResult {
	const navigatorPlatform = resolveOpenTargetPlatform();
	// The runtime host — not the browser — actually runs the Open command. In WSL
	// the browser is Windows while the host is Linux, so the navigator guess emits
	// the wrong command form. Fetch the real host env once on mount (it is static
	// per runtime) and prefer it over the navigator fallback.
	const [detectedOpenPlatform, setDetectedOpenPlatform] = useState<OpenTargetPlatform | null>(null);
	useEffect(() => {
		let cancelled = false;
		void (async () => {
			try {
				const hostEnv = await fetchRuntimeHostEnvironment(null);
				if (!cancelled) {
					setDetectedOpenPlatform(hostEnv.isWsl ? "wsl" : hostEnv.platform);
				}
			} catch {
				// Host-env detection is a best-effort refinement; the navigator
				// fallback keeps the Open menu usable if the runtime call fails.
			}
		})();
		return () => {
			cancelled = true;
		};
	}, []);

	const [openPlatformOverride, setOpenPlatformOverrideRaw] = useRawLocalStorageValue<OpenPlatformOverride>(
		LocalStorageKey.PreferredOpenPlatform,
		"auto",
		(value) => normalizeOpenPlatformOverride(value),
	);
	const effectiveOpenPlatform = resolveEffectiveOpenPlatform(
		openPlatformOverride,
		detectedOpenPlatform,
		navigatorPlatform,
	);

	const openTargetOptions = useMemo(() => getOpenTargetOptions(effectiveOpenPlatform), [effectiveOpenPlatform]);
	const fallbackTargetId = openTargetOptions[0]?.id ?? "vscode";
	const [preferredOpenTargetId, setPreferredOpenTargetId] = useRawLocalStorageValue<OpenTargetId>(
		PREFERRED_OPEN_TARGET_STORAGE_KEY,
		fallbackTargetId,
		(value) => normalizeOpenTargetId(value),
	);
	const [isOpeningWorkspace, setIsOpeningWorkspace] = useState(false);
	const selectedOpenTarget = useMemo(
		() => getOpenTargetOption(preferredOpenTargetId, effectiveOpenPlatform),
		[effectiveOpenPlatform, preferredOpenTargetId],
	);
	const canOpenWorkspace = Boolean(currentProjectId && workspacePath);

	const onSelectOpenTarget = useCallback(
		(targetId: OpenTargetId) => {
			if (!openTargetOptions.some((option) => option.id === targetId)) {
				return;
			}
			setPreferredOpenTargetId(targetId);
		},
		[openTargetOptions, setPreferredOpenTargetId],
	);

	const onSelectOpenPlatform = useCallback(
		(override: OpenPlatformOverride) => {
			setOpenPlatformOverrideRaw(override);
		},
		[setOpenPlatformOverrideRaw],
	);

	const showOpenFailureToast = useCallback(
		(message: string) => {
			showAppToast(
				{
					intent: "danger",
					icon: "error",
					message: `Could not open in ${selectedOpenTarget.label}: ${message}`,
					timeout: 6000,
				},
				"open-workspace-failed",
			);
		},
		[selectedOpenTarget.label],
	);

	const onOpenWorkspace = useCallback(() => {
		if (isOpeningWorkspace || !currentProjectId || !workspacePath) {
			return;
		}

		void (async () => {
			setIsOpeningWorkspace(true);
			try {
				const trpcClient = getRuntimeTrpcClient(currentProjectId);
				const payload = await trpcClient.runtime.runCommand.mutate({
					command: buildOpenCommand(selectedOpenTarget.id, workspacePath, effectiveOpenPlatform),
				});
				if (payload.exitCode !== 0) {
					const details = getFirstOutputLine(payload.combinedOutput) ?? `Exited with code ${payload.exitCode}.`;
					showOpenFailureToast(details);
				}
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				showOpenFailureToast(message);
			} finally {
				setIsOpeningWorkspace(false);
			}
		})();
	}, [
		currentProjectId,
		effectiveOpenPlatform,
		isOpeningWorkspace,
		selectedOpenTarget.id,
		showOpenFailureToast,
		workspacePath,
	]);

	return {
		openTargetOptions,
		selectedOpenTargetId: selectedOpenTarget.id,
		onSelectOpenTarget,
		openPlatformOverride,
		onSelectOpenPlatform,
		detectedOpenPlatform,
		onOpenWorkspace,
		canOpenWorkspace,
		isOpeningWorkspace,
	};
}
