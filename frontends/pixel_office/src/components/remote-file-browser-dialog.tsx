import { ArrowUp, ChevronRight, FileText, Folder, FolderOpen, GitBranch } from "lucide-react";
import { type FormEvent, type ReactElement, useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Dialog, DialogBody, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import type { RuntimeDirectoryListEntry, RuntimeDirectoryListResponse } from "@/runtime/types";
import { serverRootLabel, splitServerPath, toUiRelative } from "@/utils/server-path";

export interface RemoteFileBrowserDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSelect: (path: string, type: "file" | "folder") => void;
	initialPath?: string;
	workspaceId?: string | null;
	/** Ctrl/⌘-click adds files to the selection instead of replacing it. */
	multiSelectFiles?: boolean;
	/** Called instead of `onSelect` when more than one file is selected. */
	onSelectFiles?: (paths: string[]) => void;
	/** Verb on the confirm button. Defaults to "Select". */
	selectLabel?: string;
}

export function RemoteFileBrowserDialog({
	open,
	onOpenChange,
	onSelect,
	initialPath,
	workspaceId = null,
	multiSelectFiles = false,
	onSelectFiles,
	selectLabel = "Select",
}: RemoteFileBrowserDialogProps): ReactElement {
	const [currentPath, setCurrentPath] = useState<string>("");
	const [rootPath, setRootPath] = useState<string>("");
	const [parentPath, setParentPath] = useState<string | null>(null);
	const [entries, setEntries] = useState<RuntimeDirectoryListEntry[]>([]);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [pathInput, setPathInput] = useState("");
	const [selectedFilePaths, setSelectedFilePaths] = useState<string[]>([]);
	const [selectedFolderPath, setSelectedFolderPath] = useState<string | null>(null);
	const fetchIdRef = useRef(0);

	const fetchContents = useCallback(
		async (path?: string) => {
			const fetchId = ++fetchIdRef.current;
			setIsLoading(true);
			setError(null);
			setSelectedFilePaths([]);
			setSelectedFolderPath(null);
			try {
				const trpcClient = getRuntimeTrpcClient(workspaceId);
				const response: RuntimeDirectoryListResponse = await trpcClient.projects.listDirectoryContents.query(
					path !== undefined ? { path, includeFiles: true } : { includeFiles: true },
				);
				if (fetchId !== fetchIdRef.current) {
					return;
				}
				if (!response.ok) {
					setError(response.error ?? "Failed to list directory contents.");
					setRootPath(response.rootPath);
					setCurrentPath(response.currentPath ?? response.rootPath);
					setParentPath(response.parentPath);
					setEntries([]);
					return;
				}
				setCurrentPath(response.currentPath);
				setRootPath(response.rootPath);
				setParentPath(response.parentPath);
				setEntries(response.entries);
				setPathInput(response.currentPath);
			} catch (err) {
				if (fetchId !== fetchIdRef.current) {
					return;
				}
				const message = err instanceof Error ? err.message : "An unexpected error occurred.";
				setError(message);
				setEntries([]);
			} finally {
				if (fetchId === fetchIdRef.current) {
					setIsLoading(false);
				}
			}
		},
		[workspaceId],
	);

	useEffect(() => {
		if (!open) {
			return;
		}
		void fetchContents(initialPath);
	}, [open, initialPath, fetchContents]);

	const handleNavigate = useCallback(
		(path: string) => {
			void fetchContents(path);
		},
		[fetchContents],
	);

	const handleUp = useCallback(() => {
		if (parentPath !== null) {
			void fetchContents(parentPath);
		}
	}, [parentPath, fetchContents]);

	const handlePathInputSubmit = useCallback(
		(e: FormEvent) => {
			e.preventDefault();
			const trimmed = pathInput.trim();
			if (trimmed) {
				void fetchContents(trimmed);
			}
		},
		[pathInput, fetchContents],
	);

	const handleSelectFile = useCallback(
		(path: string, additive: boolean) => {
			setSelectedFolderPath(null);
			setSelectedFilePaths((previous) => {
				if (!multiSelectFiles || !additive) {
					return [path];
				}
				return previous.includes(path) ? previous.filter((entry) => entry !== path) : [...previous, path];
			});
		},
		[multiSelectFiles],
	);

	const handleSelectFolder = useCallback((path: string) => {
		setSelectedFolderPath(path);
		setSelectedFilePaths([]);
	}, []);

	const handleSelect = useCallback(() => {
		if (selectedFilePaths.length > 1 && onSelectFiles) {
			onSelectFiles(selectedFilePaths);
			return;
		}
		const singleFile = selectedFilePaths[0];
		if (singleFile) {
			onSelect(singleFile, "file");
			return;
		}
		if (selectedFolderPath) {
			onSelect(selectedFolderPath, "folder");
			return;
		}
		onSelect(currentPath, "folder");
	}, [currentPath, onSelect, onSelectFiles, selectedFilePaths, selectedFolderPath]);

	const selectionSummary =
		selectedFilePaths.length > 1
			? `${selectLabel} ${selectedFilePaths.length} files`
			: selectedFilePaths.length === 1
				? `${selectLabel} file`
				: selectLabel;

	const breadcrumbSegments = buildBreadcrumbs(currentPath, rootPath);

	return (
		<Dialog
			open={open}
			onOpenChange={onOpenChange}
			size="custom"
			contentClassName="w-[90vw] max-w-xl max-h-[85vh]"
			contentAriaDescribedBy="remote-file-browser-description"
		>
			<DialogHeader title="Browse Remote Directory" icon={<FolderOpen size={16} />} />
			<DialogBody className="flex flex-col gap-3 p-0">
				<RemoteFileBrowserContent
					rootPath={rootPath}
					pathInput={pathInput}
					setPathInput={setPathInput}
					onPathInputSubmit={handlePathInputSubmit}
					parentPath={parentPath}
					onUp={handleUp}
					breadcrumbSegments={breadcrumbSegments}
					onNavigate={handleNavigate}
					isLoading={isLoading}
					error={error}
					entries={entries}
					selectedFilePaths={selectedFilePaths}
					onSelectFile={handleSelectFile}
					selectedFolderPath={selectedFolderPath}
					onSelectFolder={handleSelectFolder}
					multiSelectFiles={multiSelectFiles}
				/>
			</DialogBody>
			<DialogFooter>
				<Button variant="default" onClick={() => onOpenChange(false)}>
					Cancel
				</Button>
				<Button
					variant="primary"
					onClick={handleSelect}
					data-testid="remote-file-browser-select"
					disabled={isLoading || (!currentPath && selectedFilePaths.length === 0 && !selectedFolderPath)}
				>
					{selectionSummary}
				</Button>
			</DialogFooter>
		</Dialog>
	);
}

interface BreadcrumbSegment {
	label: string;
	path: string;
}

function RemoteFileBrowserContent({
	rootPath,
	pathInput,
	setPathInput,
	onPathInputSubmit,
	parentPath,
	onUp,
	breadcrumbSegments,
	onNavigate,
	isLoading,
	error,
	entries,
	selectedFilePaths,
	onSelectFile,
	selectedFolderPath,
	onSelectFolder,
	multiSelectFiles,
}: {
	rootPath: string;
	pathInput: string;
	setPathInput: (value: string) => void;
	onPathInputSubmit: (e: FormEvent) => void;
	parentPath: string | null;
	onUp: () => void;
	breadcrumbSegments: BreadcrumbSegment[];
	onNavigate: (path: string) => void;
	isLoading: boolean;
	error: string | null;
	entries: RuntimeDirectoryListEntry[];
	selectedFilePaths: string[];
	onSelectFile: (path: string, additive: boolean) => void;
	selectedFolderPath: string | null;
	onSelectFolder: (path: string) => void;
	multiSelectFiles: boolean;
}): ReactElement {
	return (
		<>
			{/* Root path indicator */}
			<div className="px-4 pt-3">
				<div className="text-[11px] text-text-tertiary font-mono truncate" title={rootPath}>
					Server root: {rootPath}
				</div>
			</div>

			{/* Path input */}
			<form onSubmit={onPathInputSubmit} className="px-4">
				<input
					type="text"
					value={pathInput}
					onChange={(e) => setPathInput(e.target.value)}
					placeholder="Type a path and press Enter"
					className="w-full h-8 px-2 text-[13px] font-mono rounded-md border border-border bg-surface-2 text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent"
					aria-label="Directory path input"
				/>
			</form>

			{/* Breadcrumb + Up button */}
			<div className="flex items-center gap-1 px-4">
				<Button
					variant="ghost"
					size="sm"
					icon={<ArrowUp size={14} />}
					disabled={parentPath === null}
					onClick={onUp}
					aria-label="Go to parent directory"
				/>
				<nav className="flex items-center gap-0.5 min-w-0 overflow-x-auto text-[12px]" aria-label="Breadcrumb">
					{breadcrumbSegments.map((segment, index) => {
						const isLast = index === breadcrumbSegments.length - 1;
						return (
							<span key={segment.path} className="flex items-center gap-0.5 shrink-0">
								{index > 0 && <ChevronRight size={10} className="text-text-tertiary shrink-0" />}
								{isLast ? (
									<span className="text-text-primary font-medium px-1 py-0.5">{segment.label}</span>
								) : (
									<button
										type="button"
										className="text-text-secondary hover:text-text-primary hover:bg-surface-3 rounded-sm px-1 py-0.5 cursor-pointer bg-transparent border-none"
										onClick={() => onNavigate(segment.path)}
									>
										{segment.label}
									</button>
								)}
							</span>
						);
					})}
				</nav>
			</div>

			{/* Directory listing */}
			<DirectoryEntryList
				isLoading={isLoading}
				error={error}
				entries={entries}
				onNavigate={onNavigate}
				selectedFilePaths={selectedFilePaths}
				onSelectFile={onSelectFile}
				selectedFolderPath={selectedFolderPath}
				onSelectFolder={onSelectFolder}
			/>

			{multiSelectFiles ? (
				<p className="px-4 text-[11px] text-text-tertiary">
					Click a file to import it, Ctrl/⌘-click to add more, or pick a folder to import every plan in it.
				</p>
			) : null}

			{/* Hidden description for accessibility */}
			<p id="remote-file-browser-description" className="sr-only">
				Browse the remote server filesystem to select a project directory.
			</p>
		</>
	);
}

function DirectoryEntryList({
	isLoading,
	error,
	entries,
	onNavigate,
	selectedFilePaths,
	onSelectFile,
	selectedFolderPath,
	onSelectFolder,
}: {
	isLoading: boolean;
	error: string | null;
	entries: RuntimeDirectoryListEntry[];
	onNavigate: (path: string) => void;
	selectedFilePaths: string[];
	onSelectFile: (path: string, additive: boolean) => void;
	selectedFolderPath: string | null;
	onSelectFolder: (path: string) => void;
}): ReactElement {
	return (
		<div className="flex-1 min-h-0 overflow-y-auto border-t border-b border-border min-h-[200px] max-h-[360px]">
			{isLoading ? (
				<div className="flex items-center justify-center py-12">
					<Spinner size={20} />
				</div>
			) : error ? (
				<div className="flex items-center justify-center py-12 px-4">
					<p className="text-[13px] text-status-red text-center">{error}</p>
				</div>
			) : entries.length === 0 ? (
				<div className="flex items-center justify-center py-12 px-4">
					<p className="text-[13px] text-text-tertiary text-center">This directory is empty.</p>
				</div>
			) : (
				<div className="flex flex-col">
					{entries.map((entry) =>
						entry.isDirectory ? (
							<div
								key={entry.path}
								className={cn(
									"group flex items-center gap-2 px-4 py-2 text-left cursor-pointer",
									"transition-colors hover:bg-surface-2 active:bg-surface-3",
									"text-[13px] text-text-primary",
									selectedFolderPath === entry.path && "bg-surface-3",
								)}
								role="button"
								tabIndex={0}
								onClick={() => onSelectFolder(entry.path)}
								onDoubleClick={() => onNavigate(entry.path)}
								onKeyDown={(e) => {
									if (e.key === "Enter") {
										onSelectFolder(entry.path);
									}
								}}
								data-testid={`dir-entry-${entry.name}`}
							>
								{entry.isGitRepository ? (
									<span className="relative flex items-center shrink-0 size-4 text-text-secondary" title="Git repository">
										<Folder size={16} className="text-text-secondary" />
										<GitBranch size={9} className="absolute -bottom-0.5 -right-0.5 text-accent" />
									</span>
								) : (
									<Folder size={16} className="text-text-secondary shrink-0" />
								)}
								<span className="truncate">{entry.name}</span>
								<button
									type="button"
									className="ml-auto shrink-0 rounded-sm p-0.5 text-text-tertiary transition-colors hover:bg-surface-3 hover:text-text-primary cursor-pointer bg-transparent border-none"
									aria-label={`Open ${entry.name}`}
									onClick={(e) => {
										e.stopPropagation();
										onNavigate(entry.path);
									}}
									data-testid={`dir-entry-open-${entry.name}`}
								>
									<ChevronRight size={12} />
								</button>
							</div>
						) : (
							<button
								key={entry.path}
								type="button"
								aria-pressed={selectedFilePaths.includes(entry.path)}
								className={cn(
									"flex items-center gap-2 px-4 py-2 text-left cursor-pointer bg-transparent border-none",
									"transition-colors hover:bg-surface-2 active:bg-surface-3",
									"text-[13px] text-text-primary",
									selectedFilePaths.includes(entry.path) && "bg-surface-3",
								)}
								onClick={(event) => onSelectFile(entry.path, event.ctrlKey || event.metaKey)}
								data-testid={`file-entry-${entry.name}`}
							>
								<FileText size={16} className="text-text-secondary shrink-0" />
								<span className="truncate">{entry.name}</span>
							</button>
						),
					)}
				</div>
			)}
		</div>
	);
}

function buildBreadcrumbs(currentPath: string, rootPath: string): BreadcrumbSegment[] {
	if (!rootPath || !currentPath) {
		return [];
	}

	const segments: BreadcrumbSegment[] = [{ label: serverRootLabel(rootPath), path: rootPath }];

	if (currentPath === rootPath) {
		return segments;
	}

	const relativePath = toUiRelative(rootPath, currentPath);

	if (!relativePath) {
		return segments;
	}

	const parts = splitServerPath(relativePath);
	let accumulated = rootPath.replace(/[\\/]+$/, "");

	for (const part of parts) {
		accumulated = `${accumulated}/${part}`;
		segments.push({ label: part, path: accumulated });
	}

	return segments;
}
