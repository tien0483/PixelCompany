import { useCallback, useEffect, useState } from "react";

import { notifyError } from "@/components/app-toaster";
import { parseProjectIdFromPathname } from "@/hooks/app-utils";
import { replaceProjectSegment } from "@/hooks/home-route";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import { useRuntimeStateStream } from "@/runtime/use-runtime-state-stream";
import { useWindowEvent } from "@/utils/react-use";

const REMOVED_PROJECT_ERROR_PREFIX = "Project no longer exists on disk and was removed:";

export function parseRemovedProjectPathFromStreamError(streamError: string | null): string | null {
	if (!streamError || !streamError.startsWith(REMOVED_PROJECT_ERROR_PREFIX)) {
		return null;
	}
	return streamError.slice(REMOVED_PROJECT_ERROR_PREFIX.length).trim();
}

interface UseProjectNavigationInput {
	onProjectSwitchStart: () => void;
}

export interface UseProjectNavigationResult {
	requestedProjectId: string | null;
	navigationCurrentProjectId: string | null;
	removingProjectId: string | null;
	isAddProjectDialogOpen: boolean;
	setIsAddProjectDialogOpen: (open: boolean) => void;
	pendingNativeGitInitPath: string | null;
	currentProjectId: string | null;
	projects: ReturnType<typeof useRuntimeStateStream>["projects"];
	workspaceState: ReturnType<typeof useRuntimeStateStream>["workspaceState"];
	workspaceMetadata: ReturnType<typeof useRuntimeStateStream>["workspaceMetadata"];
	latestTaskChatMessage: ReturnType<typeof useRuntimeStateStream>["latestTaskChatMessage"];
	taskChatMessagesByTaskId: ReturnType<typeof useRuntimeStateStream>["taskChatMessagesByTaskId"];
	latestTaskReadyForReview: ReturnType<typeof useRuntimeStateStream>["latestTaskReadyForReview"];
	latestMcpAuthStatuses: ReturnType<typeof useRuntimeStateStream>["latestMcpAuthStatuses"];
	clineSessionContextVersion: ReturnType<typeof useRuntimeStateStream>["clineSessionContextVersion"];
	manager: ReturnType<typeof useRuntimeStateStream>["manager"];
	streamError: string | null;
	isRuntimeDisconnected: boolean;
	hasReceivedSnapshot: boolean;
	hasNoProjects: boolean;
	isProjectSwitching: boolean;
	handleSelectProject: (projectId: string) => void;
	handleAddProject: () => void;
	handleAddProjectSuccess: (projectId: string) => void;
	handleRemoveProject: (projectId: string) => Promise<boolean>;
	handleClearProjectSelection: () => void;
	resetProjectNavigationState: () => void;
}

export function useProjectNavigation({ onProjectSwitchStart }: UseProjectNavigationInput): UseProjectNavigationResult {
	const [requestedProjectId, setRequestedProjectId] = useState<string | null>(() => {
		if (typeof window === "undefined") {
			return null;
		}
		return parseProjectIdFromPathname(window.location.pathname);
	});
	const [pendingAddedProjectId, setPendingAddedProjectId] = useState<string | null>(null);
	const [removingProjectId, setRemovingProjectId] = useState<string | null>(null);
	const [isAddProjectDialogOpen, setIsAddProjectDialogOpen] = useState(false);
	const [pendingGitInitPath, setPendingGitInitPath] = useState<string | null>(null);

	const {
		currentProjectId,
		projects,
		workspaceState,
		workspaceMetadata,
		latestTaskChatMessage,
		taskChatMessagesByTaskId,
		latestTaskReadyForReview,
		latestMcpAuthStatuses,
		clineSessionContextVersion,
		manager,
		streamError,
		isRuntimeDisconnected,
		hasReceivedSnapshot,
	} = useRuntimeStateStream(requestedProjectId);

	const hasNoProjects = hasReceivedSnapshot && projects.length === 0 && currentProjectId === null;
	const isProjectSwitching = requestedProjectId !== null && requestedProjectId !== currentProjectId && !hasNoProjects;
	const navigationCurrentProjectId = requestedProjectId ?? currentProjectId;

	const handleSelectProject = useCallback(
		(projectId: string) => {
			if (!projectId || projectId === currentProjectId) {
				return;
			}
			onProjectSwitchStart();
			setRequestedProjectId(projectId);
		},
		[currentProjectId, onProjectSwitchStart],
	);

	const handleAddProjectSuccess = useCallback(
		(projectId: string) => {
			setPendingAddedProjectId(projectId);
			handleSelectProject(projectId);
		},
		[handleSelectProject],
	);

	const handleAddProject = useCallback(() => {
		// Open the path dialog only. Do NOT auto-call projects.pickDirectory —
		// on Windows that used spawnSync(FolderBrowserDialog) and froze the
		// entire Kanban runtime until the OS dialog closed (often hidden),
		// which made Add Project look like a no-op and disconnected the UI.
		setIsAddProjectDialogOpen(true);
	}, []);

	const handleRemoveProject = useCallback(
		async (projectId: string): Promise<boolean> => {
			if (removingProjectId) {
				return false;
			}
			setRemovingProjectId(projectId);
			try {
				const trpcClient = getRuntimeTrpcClient(currentProjectId);
				const payload = await trpcClient.projects.remove.mutate({ projectId });
				if (!payload.ok) {
					throw new Error(payload.error ?? "Could not remove project.");
				}
				if (currentProjectId === projectId) {
					onProjectSwitchStart();
					setRequestedProjectId(null);
				}
				return true;
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				notifyError(message);
				return false;
			} finally {
				setRemovingProjectId((current) => (current === projectId ? null : current));
			}
		},
		[currentProjectId, onProjectSwitchStart, removingProjectId],
	);

	const handlePopState = useCallback(() => {
		if (typeof window === "undefined") {
			return;
		}
		const nextProjectId = parseProjectIdFromPathname(window.location.pathname);
		setRequestedProjectId(nextProjectId);
	}, []);
	useWindowEvent("popstate", handlePopState);

	useEffect(() => {
		if (typeof window === "undefined") {
			return;
		}
		if (!currentProjectId) {
			return;
		}
		const nextUrl = new URL(window.location.href);
		// Only segment 0 belongs to this hook. Rebuilding the whole pathname from the project id
		// used to delete whatever route the shell had open (`/proj/plans/<id>` → `/proj`).
		const nextPathname = replaceProjectSegment(nextUrl.pathname, currentProjectId);
		if (nextUrl.pathname === nextPathname) {
			return;
		}
		window.history.replaceState({}, "", `${nextPathname}${nextUrl.search}${nextUrl.hash}`);
	}, [currentProjectId]);

	useEffect(() => {
		if (typeof window === "undefined") {
			return;
		}
		if (!hasNoProjects || !requestedProjectId) {
			return;
		}
		const nextUrl = new URL(window.location.href);
		if (nextUrl.pathname !== "/") {
			window.history.replaceState({}, "", `/${nextUrl.search}${nextUrl.hash}`);
		}
		setRequestedProjectId(null);
	}, [hasNoProjects, requestedProjectId]);

	useEffect(() => {
		if (!pendingAddedProjectId) {
			return;
		}
		const projectExists = projects.some((project) => project.id === pendingAddedProjectId);
		if (!projectExists && currentProjectId !== pendingAddedProjectId) {
			return;
		}
		setPendingAddedProjectId(null);
	}, [currentProjectId, pendingAddedProjectId, projects]);

	useEffect(() => {
		if (!requestedProjectId || !currentProjectId) {
			return;
		}
		if (pendingAddedProjectId && requestedProjectId === pendingAddedProjectId) {
			return;
		}
		const requestedStillExists = projects.some((project) => project.id === requestedProjectId);
		if (requestedStillExists) {
			return;
		}
		setRequestedProjectId(currentProjectId);
	}, [currentProjectId, pendingAddedProjectId, projects, requestedProjectId]);

	const resetProjectNavigationState = useCallback(() => {
		setRemovingProjectId(null);
		setIsAddProjectDialogOpen(false);
		setPendingGitInitPath(null);
	}, []);

	// Lets the user bail out of a project that never finishes loading (e.g. a
	// stuck workspace over a slow filesystem) without waiting on the backend.
	const handleClearProjectSelection = useCallback(() => {
		if (typeof window !== "undefined") {
			const nextUrl = new URL(window.location.href);
			if (nextUrl.pathname !== "/") {
				window.history.replaceState({}, "", `/${nextUrl.search}${nextUrl.hash}`);
			}
		}
		onProjectSwitchStart();
		setRequestedProjectId(null);
	}, [onProjectSwitchStart]);

	return {
		requestedProjectId,
		navigationCurrentProjectId,
		removingProjectId,
		isAddProjectDialogOpen,
		setIsAddProjectDialogOpen,
		pendingNativeGitInitPath: pendingGitInitPath,
		currentProjectId,
		projects,
		workspaceState,
		workspaceMetadata,
		latestTaskChatMessage,
		taskChatMessagesByTaskId,
		latestTaskReadyForReview,
		latestMcpAuthStatuses,
		clineSessionContextVersion,
		manager,
		streamError,
		isRuntimeDisconnected,
		hasReceivedSnapshot,
		hasNoProjects,
		isProjectSwitching,
		handleSelectProject,
		handleAddProject,
		handleAddProjectSuccess,
		handleRemoveProject,
		handleClearProjectSelection,
		resetProjectNavigationState,
	};
}
