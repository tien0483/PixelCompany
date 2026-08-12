import { FileText, FolderPlus, Plus, Trash2 } from "lucide-react";
import { type ReactElement, useState } from "react";

import { showAppToast } from "@/components/app-toaster";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Spinner } from "@/components/ui/spinner";
import { DOCS_LABELS } from "@/docs/docs-labels";
import { useCreateDocProject, type DocProjectMeta } from "@/docs/use-doc-projects";

export interface DocsProjectSidebarProps {
	projects: DocProjectMeta[];
	selectedId: string | null;
	onSelect: (id: string) => void;
	onProjectsChanged: () => Promise<void>;
	online: boolean;
}

type FormMode = "none" | "create" | "adopt";

function splitSources(raw: string): string[] {
	return raw
		.split(/[\n,]/)
		.map((s) => s.trim())
		.filter((s) => s.length > 0);
}

export function DocsProjectSidebar({
	projects,
	selectedId,
	onSelect,
	onProjectsChanged,
	online,
}: DocsProjectSidebarProps): ReactElement {
	const [formMode, setFormMode] = useState<FormMode>("none");
	const [name, setName] = useState("");
	const [targetRepo, setTargetRepo] = useState("");
	const [workspaceDir, setWorkspaceDir] = useState("");
	const [sources, setSources] = useState("");
	const [tagline, setTagline] = useState("");
	const [adopting, setAdopting] = useState(false);
	const [deletingId, setDeletingId] = useState<string | null>(null);
	const { create, loading: creating, error: createError } = useCreateDocProject();

	const resetForm = () => {
		setName("");
		setTargetRepo("");
		setWorkspaceDir("");
		setSources("");
		setTagline("");
		setFormMode("none");
	};

	const handleCreate = async () => {
		if (!targetRepo.trim() || !workspaceDir.trim() || !name.trim()) return;
		try {
			const project = await create({
				name: name.trim(),
				targetRepo: targetRepo.trim(),
				workspaceDir: workspaceDir.trim(),
				sources: splitSources(sources),
				tagline: tagline.trim() || undefined,
			});
			resetForm();
			// Await the refresh before selecting: `projects` (and downstream
			// `DocsView`'s stale-selection guard) only see the new project once
			// this resolves — selecting first raced the guard into clearing the
			// selection back to null before the list ever updated.
			await onProjectsChanged();
			onSelect(project.id);
		} catch (err) {
			showAppToast({
				intent: "danger",
				message: err instanceof Error ? err.message : String(err),
			});
		}
	};

	const handleAdopt = async () => {
		if (!targetRepo.trim() || !workspaceDir.trim()) return;
		setAdopting(true);
		try {
			const res = await fetch("/api/doc-skill-proxy/api/projects/adopt", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					targetRepo: targetRepo.trim(),
					workspaceDir: workspaceDir.trim(),
				}),
			});
			const data: unknown = await res.json();
			if (!res.ok) {
				const message =
					data && typeof data === "object" && "error" in data
						? String((data as { error: unknown }).error)
						: `HTTP ${res.status}`;
				throw new Error(message);
			}
			resetForm();
			await onProjectsChanged();
			const id = data && typeof data === "object" && "id" in data ? String((data as { id: unknown }).id) : null;
			if (id) onSelect(id);
		} catch (err) {
			showAppToast({
				intent: "danger",
				message: err instanceof Error ? err.message : String(err),
			});
		} finally {
			setAdopting(false);
		}
	};

	const handleDelete = async (id: string) => {
		setDeletingId(id);
		try {
			const res = await fetch(`/api/doc-skill-proxy/api/projects/${id}`, {
				method: "DELETE",
			});
			if (!res.ok) {
				const data: unknown = await res.json().catch(() => null);
				const message =
					data && typeof data === "object" && "error" in data
						? String((data as { error: unknown }).error)
						: `HTTP ${res.status}`;
				throw new Error(message);
			}
			void onProjectsChanged();
		} catch (err) {
			showAppToast({
				intent: "danger",
				message: err instanceof Error ? err.message : String(err),
			});
		} finally {
			setDeletingId(null);
		}
	};

	return (
		<div className="flex flex-1 flex-col min-h-0 h-full">
			<div className="flex items-center justify-between px-2 py-2 border-b border-border shrink-0">
				<span className="text-xs font-semibold text-text-secondary uppercase tracking-wide">
					{DOCS_LABELS.title}
				</span>
			</div>
			<div className="flex-1 overflow-y-auto min-h-0">
				{projects.length === 0 ? (
					<p className="px-2.5 py-3 text-xs text-text-tertiary">
						{DOCS_LABELS.emptyProjects}
					</p>
				) : (
					<ul className="flex flex-col">
						{projects.map((project) => (
							<li key={project.id} className="group relative">
								<button
									type="button"
									onClick={() => onSelect(project.id)}
									className={cn(
										"flex w-full flex-col items-start gap-0.5 py-2 pl-2.5 pr-7 text-left hover:bg-surface-2",
										selectedId === project.id && "bg-surface-2",
									)}
								>
									<div className="flex w-full items-center gap-1.5">
										<FileText size={13} className="shrink-0 text-text-tertiary" />
										<span className="truncate text-[13px] text-text-primary flex-1">
											{project.name}
										</span>
									</div>
									{project.tagline ? (
										<span className="truncate text-[11px] text-text-tertiary w-full">
											{project.tagline}
										</span>
									) : null}
									<span className="text-[10px] text-text-tertiary">
										{project.docCount} docs
										{project.hasSite ? " · site built" : ""}
									</span>
								</button>
								{/* Sibling of the row button (not nested inside it) — a <button> can't
								    contain another interactive <button> without breaking semantics. */}
								<button
									type="button"
									aria-label={DOCS_LABELS.delete}
									onClick={(e) => {
										e.stopPropagation();
										void handleDelete(project.id);
									}}
									className="absolute right-1.5 top-2 rounded p-0.5 text-text-tertiary opacity-0 hover:bg-surface-3 hover:text-status-red group-hover:opacity-100"
								>
									{deletingId === project.id ? (
										<Spinner size={12} />
									) : (
										<Trash2 size={12} />
									)}
								</button>
							</li>
						))}
					</ul>
				)}
			</div>

			<div className="shrink-0 border-t border-border p-2 flex flex-col gap-1.5">
				{formMode === "none" ? (
					<>
						<Button
							variant="default"
							size="sm"
							icon={<Plus size={13} />}
							disabled={!online}
							onClick={() => setFormMode("create")}
						>
							{DOCS_LABELS.newProject}
						</Button>
						<Button
							variant="ghost"
							size="sm"
							icon={<FolderPlus size={13} />}
							disabled={!online}
							onClick={() => setFormMode("adopt")}
						>
							{DOCS_LABELS.adoptExisting}
						</Button>
					</>
				) : formMode === "create" ? (
					<div className="flex flex-col gap-1.5">
						<input
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder={DOCS_LABELS.projectName}
							className="h-7 w-full rounded-md border border-border bg-surface-2 px-2 text-xs text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none"
						/>
						<input
							value={targetRepo}
							onChange={(e) => setTargetRepo(e.target.value)}
							placeholder={DOCS_LABELS.targetRepo}
							className="h-7 w-full rounded-md border border-border bg-surface-2 px-2 text-xs text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none"
						/>
						<input
							value={workspaceDir}
							onChange={(e) => setWorkspaceDir(e.target.value)}
							placeholder={DOCS_LABELS.workspaceDir}
							className="h-7 w-full rounded-md border border-border bg-surface-2 px-2 text-xs text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none"
						/>
						<textarea
							value={sources}
							onChange={(e) => setSources(e.target.value)}
							placeholder={DOCS_LABELS.sources}
							rows={2}
							className="w-full resize-none rounded-md border border-border bg-surface-2 px-2 py-1 text-xs text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none"
						/>
						<input
							value={tagline}
							onChange={(e) => setTagline(e.target.value)}
							placeholder={DOCS_LABELS.tagline}
							className="h-7 w-full rounded-md border border-border bg-surface-2 px-2 text-xs text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none"
						/>
						{createError ? (
							<p className="text-[11px] text-status-red">{createError}</p>
						) : null}
						<div className="flex gap-1.5">
							<Button variant="ghost" size="sm" onClick={resetForm} disabled={creating}>
								{DOCS_LABELS.cancel}
							</Button>
							<Button
								variant="primary"
								size="sm"
								fill
								icon={creating ? <Spinner size={12} /> : undefined}
								disabled={
									creating || !name.trim() || !targetRepo.trim() || !workspaceDir.trim()
								}
								onClick={() => {
									void handleCreate();
								}}
							>
								{DOCS_LABELS.create}
							</Button>
						</div>
					</div>
				) : (
					<div className="flex flex-col gap-1.5">
						<input
							value={targetRepo}
							onChange={(e) => setTargetRepo(e.target.value)}
							placeholder={DOCS_LABELS.targetRepo}
							className="h-7 w-full rounded-md border border-border bg-surface-2 px-2 text-xs text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none"
						/>
						<input
							value={workspaceDir}
							onChange={(e) => setWorkspaceDir(e.target.value)}
							placeholder={DOCS_LABELS.workspaceDir}
							className="h-7 w-full rounded-md border border-border bg-surface-2 px-2 text-xs text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none"
						/>
						<div className="flex gap-1.5">
							<Button variant="ghost" size="sm" onClick={resetForm} disabled={adopting}>
								{DOCS_LABELS.cancel}
							</Button>
							<Button
								variant="primary"
								size="sm"
								fill
								icon={adopting ? <Spinner size={12} /> : undefined}
								disabled={adopting || !targetRepo.trim() || !workspaceDir.trim()}
								onClick={() => {
									void handleAdopt();
								}}
							>
								{DOCS_LABELS.adopt}
							</Button>
						</div>
					</div>
				)}
			</div>
		</div>
	);
}
