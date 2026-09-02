import { FolderOpen, GitBranch, Search } from "lucide-react";
import { type ReactElement, useCallback, useEffect, useRef, useState } from "react";

import { showAppToast } from "@/components/app-toaster";
import { DirectoryAutocomplete } from "@/components/directory-autocomplete";
import { RemoteFileBrowserDialog } from "@/components/remote-file-browser-dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Dialog, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { useNativeDirectoryPicker } from "@/hooks/use-native-directory-picker";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import { LocalStorageKey, readLocalStorageItem, writeLocalStorageItem } from "@/storage/local-storage-store";
import { normalizeServerPath, toServerAbsolute } from "@/utils/server-path";

type AddProjectTab = "path" | "clone";

export interface AddProjectDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onProjectAdded: (projectId: string) => void;
	currentProjectId: string | null;
	/** When set, the dialog opens directly to the git-init confirmation for this absolute path. */
	initialGitInitPath?: string | null;
}

/** Detect Windows drive paths that may have been stored with a leading "/". */
function extractAbsoluteServerPath(pathValue: string): string | null {
	const normalized = normalizeServerPath(pathValue.trim());
	const withoutLeading = normalized.replace(/^\/+/, "");
	if (/^[A-Za-z]:(\/|$)/.test(withoutLeading)) {
		return withoutLeading.replace(/\/+$/, "") || withoutLeading.slice(0, 2);
	}
	if (/^[A-Za-z]:(\/|$)/.test(normalized)) {
		return normalized.replace(/\/+$/, "") || normalized.slice(0, 2);
	}
	return null;
}

export function AddProjectDialog({
	open,
	onOpenChange,
	onProjectAdded,
	currentProjectId,
	initialGitInitPath,
}: AddProjectDialogProps): ReactElement {
	const [activeTab, setActiveTab] = useState<AddProjectTab>("path");
	const [pathInput, setPathInput] = useState("");
	const [isAddingByPath, setIsAddingByPath] = useState(false);
	const [pendingGitInitPath, setPendingGitInitPath] = useState<string | null>(null);
	const [isInitializingGit, setIsInitializingGit] = useState(false);
	const [gitUrlInput, setGitUrlInput] = useState("");
	const [cloneDestInput, setCloneDestInput] = useState("");
	const [cloneFolderName, setCloneFolderName] = useState("");
	const [isCloning, setIsCloning] = useState(false);
	const [isBrowsing, setIsBrowsing] = useState(false);
	const [isBrowserOpen, setIsBrowserOpen] = useState(false);
	const [lastBrowseFolder, setLastBrowseFolder] = useState<string | undefined>(
		() => readLocalStorageItem(LocalStorageKey.AddProjectLastBrowseFolder) ?? undefined,
	);
	const [runtimeProbeError, setRuntimeProbeError] = useState<string | null>(null);
	const pathInputRef = useRef<HTMLInputElement>(null);
	const gitUrlInputRef = useRef<HTMLInputElement>(null);
	const [serverRootPath, setServerRootPath] = useState<string | null>(null);

	useEffect(() => {
		if (!open) {
			return;
		}
		setActiveTab("path");
		setPathInput("/");
		setGitUrlInput("");
		setCloneDestInput("/");
		setCloneFolderName("");
		setIsAddingByPath(false);
		setIsCloning(false);
		setIsBrowsing(false);
		setIsBrowserOpen(false);
		setPendingGitInitPath(initialGitInitPath ?? null);
		setIsInitializingGit(false);
		setRuntimeProbeError(null);

		const fetchRoot = async () => {
			try {
				const trpcClient = getRuntimeTrpcClient(currentProjectId);
				const response = await trpcClient.projects.listDirectoryContents.query({});
				if (response.ok && response.rootPath) {
					setServerRootPath(response.rootPath);
					setRuntimeProbeError(null);
				} else {
					setRuntimeProbeError(response.error ?? "Could not read server directories.");
				}
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				setRuntimeProbeError(
					/fetch|network|ECONNREFUSED|Failed to fetch|timeout/i.test(message)
						? "PIXTiel runtime is unreachable. Start it on port 3484, then try again."
						: message,
				);
			}
		};
		void fetchRoot();
	}, [open, currentProjectId, initialGitInitPath]);

	useEffect(() => {
		if (!open || activeTab !== "clone") {
			return;
		}
		const timer = setTimeout(() => {
			gitUrlInputRef.current?.focus();
		}, 50);
		return () => clearTimeout(timer);
	}, [open, activeTab]);

	const resolveToAbsolutePath = useCallback(
		(relativePath: string): string => {
			const absolute = extractAbsoluteServerPath(relativePath);
			if (absolute) {
				return absolute;
			}
			const cleaned = relativePath.replace(/^[\\/]+/, "").replace(/[\\/]+$/, "");
			if (!serverRootPath) {
				return cleaned;
			}
			return toServerAbsolute(serverRootPath, cleaned);
		},
		[serverRootPath],
	);

	const handleAddByPath = useCallback(
		async (path: string, initializeGit = false) => {
			const absolutePath = resolveToAbsolutePath(path);
			if (!absolutePath) {
				return;
			}
			const trimmed = absolutePath;
			if (initializeGit) {
				setIsInitializingGit(true);
			} else {
				setIsAddingByPath(true);
			}
			try {
				const trpcClient = getRuntimeTrpcClient(currentProjectId);
				const added = await trpcClient.projects.add.mutate({ path: trimmed, initializeGit });
				if (!added.ok || !added.project) {
					if (added.requiresGitInitialization) {
						setPendingGitInitPath(trimmed);
						return;
					}
					throw new Error(added.error ?? "Could not add project.");
				}
				setPendingGitInitPath(null);
				onProjectAdded(added.project.id);
				onOpenChange(false);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				showAppToast({ intent: "danger", icon: "warning-sign", message, timeout: 7000 });
			} finally {
				setIsAddingByPath(false);
				setIsInitializingGit(false);
			}
		},
		[currentProjectId, onOpenChange, onProjectAdded, resolveToAbsolutePath],
	);

	const handleInitializeGit = useCallback(
		async (absolutePath: string) => {
			setIsInitializingGit(true);
			try {
				const trpcClient = getRuntimeTrpcClient(currentProjectId);
				const added = await trpcClient.projects.add.mutate({ path: absolutePath, initializeGit: true });
				if (!added.ok || !added.project) {
					throw new Error(added.error ?? "Could not add project.");
				}
				setPendingGitInitPath(null);
				onProjectAdded(added.project.id);
				onOpenChange(false);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				showAppToast({ intent: "danger", icon: "warning-sign", message, timeout: 7000 });
			} finally {
				setIsInitializingGit(false);
			}
		},
		[currentProjectId, onOpenChange, onProjectAdded],
	);

	const handleFolderPicked = useCallback(
		async (path: string) => {
			setIsBrowsing(true);
			try {
				const trpcClient = getRuntimeTrpcClient(currentProjectId);
				const added = await trpcClient.projects.add.mutate({ path });
				if (!added.ok || !added.project) {
					if (added.requiresGitInitialization) {
						setPendingGitInitPath(path);
						setPathInput(path);
						return;
					}
					throw new Error(added.error ?? "Could not add project.");
				}
				onProjectAdded(added.project.id);
				onOpenChange(false);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				showAppToast({ intent: "danger", icon: "warning-sign", message, timeout: 7000 });
			} finally {
				setIsBrowsing(false);
			}
		},
		[currentProjectId, onOpenChange, onProjectAdded],
	);

	const { pickDirectory } = useNativeDirectoryPicker(currentProjectId);

	const handleBrowseFolder = useCallback(async () => {
		setIsBrowsing(true);
		try {
			const result = await pickDirectory();
			if (result.path) {
				setPendingGitInitPath(null);
				setPathInput(result.path);
				return;
			}
			if (result.unavailable) {
				showAppToast({
					intent: "warning",
					icon: "warning-sign",
					message: "No native folder picker is available on this system. Use the file browser instead.",
					timeout: 6000,
				});
				setIsBrowserOpen(true);
			}
			// Clean cancellation (path: null, no unavailable flag): do nothing.
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			showAppToast({ intent: "danger", icon: "warning-sign", message, timeout: 7000 });
		} finally {
			setIsBrowsing(false);
		}
	}, [pickDirectory]);

	const handleClone = useCallback(async () => {
		const trimmedUrl = gitUrlInput.trim();
		if (!trimmedUrl) {
			return;
		}
		setIsCloning(true);
		try {
			const trpcClient = getRuntimeTrpcClient(currentProjectId);
			const mutationInput: { gitUrl: string; path?: string } = { gitUrl: trimmedUrl };
			const trimmedDest = cloneDestInput.trim();
			const trimmedFolder = cloneFolderName.trim();

			if (trimmedDest && trimmedDest !== "/") {
				const resolvedDest = resolveToAbsolutePath(trimmedDest);
				mutationInput.path = trimmedFolder ? toServerAbsolute(resolvedDest, trimmedFolder) : resolvedDest;
			} else if (trimmedFolder) {
				mutationInput.path = serverRootPath ? toServerAbsolute(serverRootPath, trimmedFolder) : trimmedFolder;
			}
			const added = await trpcClient.projects.add.mutate(mutationInput);
			if (!added.ok || !added.project) {
				throw new Error(added.error ?? "Clone failed.");
			}
			showAppToast({ intent: "success", message: "Repository cloned and added successfully.", timeout: 4000 });
			onProjectAdded(added.project.id);
			onOpenChange(false);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			showAppToast({ intent: "danger", icon: "warning-sign", message, timeout: 7000 });
		} finally {
			setIsCloning(false);
		}
	}, [
		cloneDestInput,
		cloneFolderName,
		currentProjectId,
		gitUrlInput,
		onOpenChange,
		onProjectAdded,
		resolveToAbsolutePath,
		serverRootPath,
	]);

	const handleDialogEscapeKeyDown = useCallback((event: KeyboardEvent) => {
		const active = document.activeElement;
		if (active instanceof HTMLInputElement) {
			event.preventDefault();
			if (active.role !== "combobox") {
				active.blur();
			}
		}
	}, []);

	const isBusy = isAddingByPath || isCloning || isInitializingGit || isBrowsing;
	const canSubmitPath = pathInput.trim() !== "/" && pathInput.trim().length > 1;

	return (
		<>
			<Dialog
				open={open}
				onOpenChange={(isOpen) => {
					if (!isOpen && isBusy) {
						return;
					}
					onOpenChange(isOpen);
				}}
				size="md"
				contentAriaDescribedBy="add-project-dialog-description"
				onEscapeKeyDown={handleDialogEscapeKeyDown}
			>
				<DialogHeader title="Add Project" icon={<FolderOpen size={16} />} />
				<div className="flex flex-col gap-4 p-4 bg-surface-1">
					{runtimeProbeError ? (
						<div className="rounded-md border border-status-red/30 bg-status-red/5 px-3 py-2.5 text-[13px] text-text-primary">
							{runtimeProbeError}
						</div>
					) : null}
					<div className="rounded-md bg-surface-2 p-1">
						<div className="grid grid-cols-2 gap-1">
							<button
								type="button"
								onClick={() => {
									setActiveTab("path");
									setPendingGitInitPath(null);
								}}
								disabled={isBusy}
								className={cn(
									"cursor-pointer rounded-sm px-2 py-1 text-xs font-medium inline-flex items-center justify-center gap-1.5",
									activeTab === "path"
										? "bg-surface-4 text-text-primary"
										: "text-text-secondary hover:text-text-primary",
									isBusy && "cursor-not-allowed opacity-50",
								)}
							>
								<Search size={12} />
								Server Path
							</button>
							<button
								type="button"
								onClick={() => {
									setActiveTab("clone");
									setPendingGitInitPath(null);
								}}
								disabled={isBusy}
								className={cn(
									"cursor-pointer rounded-sm px-2 py-1 text-xs font-medium inline-flex items-center justify-center gap-1.5",
									activeTab === "clone"
										? "bg-surface-4 text-text-primary"
										: "text-text-secondary hover:text-text-primary",
									isBusy && "cursor-not-allowed opacity-50",
								)}
							>
								<GitBranch size={12} />
								Git Clone
							</button>
						</div>
					</div>

					{activeTab === "path" ? (
						<PathTabContent
							pathInput={pathInput}
							setPathInput={(v) => {
								setPathInput(v);
								setPendingGitInitPath(null);
							}}
							pathInputRef={pathInputRef}
							isAddingByPath={isAddingByPath}
							isInitializingGit={isInitializingGit}
							isBrowsing={isBrowsing}
							pendingGitInitPath={pendingGitInitPath}
							serverRootPath={serverRootPath}
							onSubmitPath={() => void handleAddByPath(pathInput)}
							onSubmitGitInit={() => {
								if (pendingGitInitPath) void handleInitializeGit(pendingGitInitPath);
							}}
							onBrowseNative={handleBrowseFolder}
							currentProjectId={currentProjectId}
						/>
					) : (
						<CloneTabContent
							gitUrlInput={gitUrlInput}
							setGitUrlInput={setGitUrlInput}
							cloneDestInput={cloneDestInput}
							setCloneDestInput={setCloneDestInput}
							cloneFolderName={cloneFolderName}
							setCloneFolderName={setCloneFolderName}
							gitUrlInputRef={gitUrlInputRef}
							isCloning={isCloning}
							onSubmitClone={() => void handleClone()}
							currentProjectId={currentProjectId}
						/>
					)}
				</div>
				<DialogFooter>
					<Button variant="default" onClick={() => onOpenChange(false)} disabled={isBusy}>
						Cancel
					</Button>
					{activeTab === "path" ? (
						pendingGitInitPath === null ? (
							<Button
								variant="primary"
								onClick={() => void handleAddByPath(pathInput)}
								disabled={!canSubmitPath || isAddingByPath || Boolean(runtimeProbeError)}
							>
								{isAddingByPath ? (
									<>
										<Spinner size={14} />
										Adding...
									</>
								) : (
									"Add Project"
								)}
							</Button>
						) : (
							<Button
								variant="primary"
								onClick={() => {
									if (pendingGitInitPath) void handleInitializeGit(pendingGitInitPath);
								}}
								disabled={isInitializingGit}
							>
								{isInitializingGit ? (
									<>
										<Spinner size={14} />
										Initializing...
									</>
								) : (
									"Initialize Git Repository"
								)}
							</Button>
						)
					) : (
						<Button
							variant="primary"
							onClick={() => void handleClone()}
							disabled={!gitUrlInput.trim() || isCloning || Boolean(runtimeProbeError)}
						>
							{isCloning ? (
								<>
									<Spinner size={14} />
									Cloning...
								</>
							) : (
								"Clone & Add"
							)}
						</Button>
					)}
				</DialogFooter>
			</Dialog>
			<RemoteFileBrowserDialog
				open={isBrowserOpen}
				onOpenChange={setIsBrowserOpen}
				workspaceId={currentProjectId}
				initialPath={lastBrowseFolder}
				onSelect={(path) => {
					setIsBrowserOpen(false);
					writeLocalStorageItem(LocalStorageKey.AddProjectLastBrowseFolder, path);
					setLastBrowseFolder(path);
					void handleFolderPicked(path);
				}}
			/>
		</>
	);
}

function PathTabContent({
	pathInput,
	setPathInput,
	pathInputRef,
	isAddingByPath,
	isInitializingGit,
	isBrowsing,
	pendingGitInitPath,
	serverRootPath,
	onSubmitPath,
	onSubmitGitInit,
	onBrowseNative,
	currentProjectId,
}: {
	pathInput: string;
	setPathInput: (value: string) => void;
	pathInputRef: React.RefObject<HTMLInputElement>;
	isAddingByPath: boolean;
	isInitializingGit: boolean;
	isBrowsing: boolean;
	pendingGitInitPath: string | null;
	serverRootPath: string | null;
	onSubmitPath: () => void;
	onSubmitGitInit: () => void;
	onBrowseNative: () => void;
	currentProjectId: string | null;
}): ReactElement {
	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		if (pendingGitInitPath) {
			onSubmitGitInit();
		} else {
			onSubmitPath();
		}
	};

	return (
		<form onSubmit={handleSubmit} className="flex flex-col gap-3">
			<div>
				<div className="mb-1.5 flex items-center justify-between gap-2">
					<span className="block text-[12px] text-text-secondary">Directory path</span>
					{serverRootPath ? (
						<span className="truncate font-mono text-[10px] text-text-tertiary" title={serverRootPath}>
							root: {serverRootPath}
						</span>
					) : null}
				</div>
				<DirectoryAutocomplete
					inputRef={pathInputRef}
					value={pathInput}
					onChange={setPathInput}
					placeholder="Search directories or paste C:\path\to\repo"
					disabled={isAddingByPath || isInitializingGit || isBrowsing}
					id="add-project-path-input"
					ariaLabel="Server path input"
					workspaceId={currentProjectId}
				/>
			</div>
			<div className="flex items-center gap-2">
				<Button
					type="button"
					variant="default"
					size="sm"
					onClick={onBrowseNative}
					disabled={isAddingByPath || isInitializingGit || isBrowsing}
				>
					{isBrowsing ? (
						<>
							<Spinner size={14} />
							Browsing…
						</>
					) : (
						"Browse folder…"
					)}
				</Button>
			</div>
			{pendingGitInitPath !== null ? (
				<div className="rounded-md border border-status-orange/30 bg-status-orange/5 px-3 py-2.5 flex flex-col gap-2">
					<p className="text-[13px] text-text-primary">
						This directory is not a git repository. PIXTiel requires git to manage worktrees for tasks.
					</p>
					<p className="font-mono text-[11px] text-text-secondary break-all">{pendingGitInitPath}</p>
					<Button variant="primary" size="sm" type="submit" disabled={isInitializingGit} className="self-start">
						{isInitializingGit ? (
							<>
								<Spinner size={14} />
								Initializing...
							</>
						) : (
							"Initialize Git Repository"
						)}
					</Button>
				</div>
			) : null}
			<p id="add-project-dialog-description" className="sr-only">
				Add a project by entering a server path, browsing the remote filesystem, or cloning a git repository.
			</p>
		</form>
	);
}

/** Derive a display-friendly repo name from a git URL for use as placeholder text. */
function deriveRepoNameFromUrl(gitUrl: string): string {
	const trimmed = gitUrl.trim().replace(/\/+$/, "");
	if (!trimmed) {
		return "";
	}
	const sshMatch = trimmed.match(/^[^@]+@[^:]+:(.+)$/);
	const pathPart = sshMatch?.[1] ?? trimmed;
	const lastSegment = pathPart.split("/").pop() ?? "";
	return lastSegment.endsWith(".git") ? lastSegment.slice(0, -4) : lastSegment;
}

function CloneTabContent({
	gitUrlInput,
	setGitUrlInput,
	cloneDestInput,
	setCloneDestInput,
	cloneFolderName,
	setCloneFolderName,
	gitUrlInputRef,
	isCloning,
	onSubmitClone,
	currentProjectId,
}: {
	gitUrlInput: string;
	setGitUrlInput: (value: string) => void;
	cloneDestInput: string;
	setCloneDestInput: (value: string) => void;
	cloneFolderName: string;
	setCloneFolderName: (value: string) => void;
	gitUrlInputRef: React.RefObject<HTMLInputElement>;
	isCloning: boolean;
	onSubmitClone: () => void;
	currentProjectId: string | null;
}): ReactElement {
	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		onSubmitClone();
	};

	const derivedName = deriveRepoNameFromUrl(gitUrlInput);

	return (
		<form onSubmit={handleSubmit} className="flex flex-col gap-3">
			<div>
				<label htmlFor="add-project-git-url-input" className="block text-[12px] text-text-secondary mb-1.5">
					Git repository URL
				</label>
				<input
					ref={gitUrlInputRef}
					type="text"
					id="add-project-git-url-input"
					value={gitUrlInput}
					onChange={(e) => setGitUrlInput(e.target.value)}
					placeholder="e.g. https://github.com/user/repo.git"
					className="w-full h-8 px-2.5 text-[13px] font-mono rounded-md border border-border bg-surface-2 text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent"
					disabled={isCloning}
					aria-label="Git URL input"
				/>
			</div>
			<div className="grid grid-cols-2 gap-2">
				<div>
					<span className="block text-[12px] text-text-secondary mb-1.5">Clone into</span>
					<DirectoryAutocomplete
						value={cloneDestInput}
						onChange={setCloneDestInput}
						placeholder="Search directories…"
						disabled={isCloning}
						id="add-project-clone-dest-input"
						ariaLabel="Clone destination path"
						workspaceId={currentProjectId}
					/>
				</div>
				<div>
					<label htmlFor="add-project-folder-name-input" className="block text-[12px] text-text-secondary mb-1.5">
						Folder name
					</label>
					<input
						type="text"
						id="add-project-folder-name-input"
						value={cloneFolderName}
						onChange={(e) => setCloneFolderName(e.target.value.replace(/[\\/]/g, ""))}
						placeholder={derivedName || "repo-name"}
						className="w-full h-8 px-2.5 text-[13px] font-mono rounded-md border border-border bg-surface-2 text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent"
						disabled={isCloning}
						aria-label="Clone folder name"
					/>
				</div>
			</div>
			{isCloning ? (
				<div className="flex items-center gap-2 text-[13px] text-text-secondary">
					<Spinner size={14} />
					Cloning repository... This may take a moment.
				</div>
			) : null}
		</form>
	);
}
