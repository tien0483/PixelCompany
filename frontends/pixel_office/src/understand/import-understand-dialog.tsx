import { AlertCircle, Check, Folder, FolderInput, HardDrive } from "lucide-react";
import { type ReactElement, useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Dialog, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";

export interface ImportUnderstandDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	workspaceId: string | null;
	currentTargetProjectPath: string;
	onImportSuccess: () => void;
}

interface ProjectOption {
	id: string;
	name: string;
	path: string;
	hasGraph: boolean;
}

export function ImportUnderstandDialog({
	open,
	onOpenChange,
	workspaceId,
	currentTargetProjectPath,
	onImportSuccess,
}: ImportUnderstandDialogProps): ReactElement {
	const [projects, setProjects] = useState<ProjectOption[]>([]);
	const [isLoading, setIsLoading] = useState(false);
	const [selectedSourcePath, setSelectedSourcePath] = useState<string>("");
	const [customPath, setCustomPath] = useState<string>("");
	const [isCustomMode, setIsCustomMode] = useState(false);
	const [isImporting, setIsImporting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Load sibling projects and check graph availability
	useEffect(() => {
		if (!open) {
			setSelectedSourcePath("");
			setCustomPath("");
			setIsCustomMode(false);
			setError(null);
			return;
		}

		let cancelled = false;
		setIsLoading(true);
		setError(null);

		void (async () => {
			try {
				const client = getRuntimeTrpcClient(workspaceId);
				const projectsRes = await client.projects.list.query();
				if (cancelled) {
					return;
				}

				// Filter out current target project
				const candidateProjects = projectsRes.projects.filter(
					(p) => p.path !== currentTargetProjectPath,
				);

				const paths = candidateProjects.map((p) => p.path);
				const graphStatus = await client.review.checkProjectsGraph.query({ projectPaths: paths });
				if (cancelled) {
					return;
				}

				const mapped: ProjectOption[] = candidateProjects.map((p) => ({
					id: p.id,
					name: p.name,
					path: p.path,
					hasGraph: Boolean(graphStatus.available[p.path]),
				}));

				setProjects(mapped);

				// Auto-select first project that has a graph
				const firstWithGraph = mapped.find((p) => p.hasGraph);
				if (firstWithGraph) {
					setSelectedSourcePath(firstWithGraph.path);
				} else if (mapped.length > 0 && mapped[0]) {
					setSelectedSourcePath(mapped[0].path);
				}
			} catch (err) {
				if (!cancelled) {
					setError(err instanceof Error ? err.message : String(err));
				}
			} finally {
				if (!cancelled) {
					setIsLoading(false);
				}
			}
		})();

		return () => {
			cancelled = true;
		};
	}, [open, currentTargetProjectPath, workspaceId]);

	const effectiveSourcePath = isCustomMode ? customPath.trim() : selectedSourcePath.trim();

	const handleImport = useCallback(async () => {
		if (!effectiveSourcePath) {
			return;
		}
		setIsImporting(true);
		setError(null);
		try {
			const client = getRuntimeTrpcClient(workspaceId);
			const response = await client.review.importGraph.mutate({
				sourcePath: effectiveSourcePath,
				targetPath: currentTargetProjectPath,
			});
			if (!response.ok) {
				setError(response.error ?? "Failed to import knowledge graph.");
				return;
			}
			onImportSuccess();
			onOpenChange(false);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setIsImporting(false);
		}
	}, [effectiveSourcePath, currentTargetProjectPath, workspaceId, onImportSuccess, onOpenChange]);

	return (
		<Dialog open={open} onOpenChange={onOpenChange} size="md">
			<DialogHeader
				title="Import Understand folder"
				icon={<FolderInput size={16} />}
			/>

			<div className="flex flex-col gap-4 p-4">
				{/* Destination info */}
				<div className="rounded-md border border-border bg-surface-1 p-3 text-xs">
					<div className="font-medium text-text-primary">Destination</div>
					<div className="mt-1 font-mono text-text-secondary break-all">
						{currentTargetProjectPath}/.ua
					</div>
				</div>

				{/* Sibling projects list */}
				<div className="flex flex-col gap-2">
					<div className="flex items-center justify-between">
						<span className="text-xs font-semibold text-text-primary">Select source project</span>
						{isLoading ? (
							<span className="flex items-center gap-1 text-[11px] text-text-tertiary">
								<Spinner size={11} /> Checking projects…
							</span>
						) : null}
					</div>

					{projects.length === 0 && !isLoading ? (
						<div className="rounded border border-border bg-surface-1 p-3 text-center text-xs text-text-tertiary">
							No other projects configured in this workspace. Enter a custom directory path below.
						</div>
					) : (
						<div className="max-h-48 space-y-1.5 overflow-y-auto pr-1">
							{projects.map((proj) => {
								const isSelected = !isCustomMode && selectedSourcePath === proj.path;
								return (
									<button
										key={proj.id}
										type="button"
										onClick={() => {
											setIsCustomMode(false);
											setSelectedSourcePath(proj.path);
										}}
										className={cn(
											"flex w-full items-start gap-2.5 rounded-md border p-2.5 text-left transition-colors",
											isSelected
												? "border-primary-500 bg-primary-500/10 text-text-primary"
												: "border-border bg-surface-1 hover:bg-surface-2 text-text-secondary",
										)}
									>
										<Folder
											size={16}
											className={cn(
												"shrink-0 mt-0.5",
												proj.hasGraph ? "text-primary-500" : "text-text-tertiary",
											)}
										/>
										<div className="flex flex-1 min-w-0 flex-col gap-0.5">
											<div className="flex items-center justify-between gap-2">
												<span className="font-medium text-xs text-text-primary truncate">
													{proj.name}
												</span>
												{proj.hasGraph ? (
													<span className="inline-flex items-center gap-1 rounded bg-status-green/15 px-1.5 py-0.5 text-[10px] font-medium text-status-green">
														<Check size={10} /> Has .ua graph
													</span>
												) : (
													<span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-text-tertiary">
														No graph
													</span>
												)}
											</div>
											<div className="font-mono text-[11px] text-text-tertiary truncate">
												{proj.path}
											</div>
										</div>
									</button>
								);
							})}
						</div>
					)}
				</div>

				{/* Custom directory input */}
				<div className="flex flex-col gap-1.5 pt-1 border-t border-border">
					<div className="flex items-center justify-between">
						<span className="text-xs font-semibold text-text-primary">Or enter directory path</span>
					</div>
					<div
						className={cn(
							"flex items-center gap-2 rounded-md border p-1.5 transition-colors",
							isCustomMode ? "border-primary-500 bg-surface-0" : "border-border bg-surface-1",
						)}
					>
						<HardDrive size={15} className="ml-1 text-text-tertiary shrink-0" />
						<input
							type="text"
							placeholder="/path/to/another/repo"
							value={customPath}
							onFocus={() => setIsCustomMode(true)}
							onChange={(e) => {
								setIsCustomMode(true);
								setCustomPath(e.target.value);
							}}
							className="flex-1 bg-transparent text-xs text-text-primary placeholder:text-text-tertiary focus:outline-none"
						/>
					</div>
					<p className="text-[11px] text-text-tertiary">
						Points to another workspace or directory containing a .ua or .understand-anything folder.
					</p>
				</div>

				{/* Error display */}
				{error ? (
					<div className="flex items-center gap-2 rounded-md border border-status-red/40 bg-status-red/10 p-2.5 text-xs text-status-red">
						<AlertCircle size={15} className="shrink-0" />
						<span className="break-words">{error}</span>
					</div>
				) : null}
			</div>

			<DialogFooter>
				<Button
					variant="ghost"
					size="sm"
					onClick={() => onOpenChange(false)}
					disabled={isImporting}
				>
					Cancel
				</Button>
				<Button
					variant="default"
					size="sm"
					icon={isImporting ? <Spinner size={13} /> : <FolderInput size={13} />}
					disabled={!effectiveSourcePath || isImporting}
					onClick={handleImport}
				>
					{isImporting ? "Importing…" : "Import & Copy .ua"}
				</Button>
			</DialogFooter>
		</Dialog>
	);
}
