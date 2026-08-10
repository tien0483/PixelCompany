import { BookOpen } from "lucide-react";
import { type ReactElement, useEffect, useState } from "react";

import { DocsProjectSidebar } from "@/components/docs/docs-project-sidebar";
import { DocsRunPanel } from "@/components/docs/docs-run-panel";
import { DocsSiteViewer } from "@/components/docs/docs-site-viewer";
import { Spinner } from "@/components/ui/spinner";
import { DOCS_LABELS } from "@/docs/docs-labels";
import { useDocProjects } from "@/docs/use-doc-projects";

export interface DocsViewProps {
	/**
	 * Matches the `workspaceId={currentProjectId}` shape other exclusive home
	 * views take. Doc projects aren't scoped by workspace server-side (targetRepo
	 * is a free-form path chosen at project-creation time), so this is unused in
	 * v1 — kept for consistency with the view-toggle pattern.
	 */
	workspaceId: string | null;
}

export function DocsView({ workspaceId }: DocsViewProps): ReactElement {
	void workspaceId;
	const { online, projects, loading, refresh } = useDocProjects();
	const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
	const [cacheBustKey, setCacheBustKey] = useState(0);

	// If the selected project disappears from the list (deleted elsewhere, or
	// stale after a refresh), clear the selection rather than pointing the
	// viewer/run panel at a project that no longer exists.
	useEffect(() => {
		if (selectedProjectId && !projects.some((p) => p.id === selectedProjectId)) {
			setSelectedProjectId(null);
		}
	}, [projects, selectedProjectId]);

	const selectedProject = projects.find((p) => p.id === selectedProjectId) ?? null;

	if (loading) {
		return (
			<div className="flex flex-1 h-full min-h-0 items-center justify-center bg-surface-0">
				<Spinner size={24} />
			</div>
		);
	}

	if (!online) {
		return (
			<div className="flex flex-1 h-full min-h-0 flex-col items-center justify-center gap-2 bg-surface-0 text-text-tertiary">
				<BookOpen size={40} strokeWidth={1} />
				<p className="text-sm text-text-secondary">{DOCS_LABELS.offline}</p>
				<p className="text-xs text-text-tertiary">{DOCS_LABELS.offlineHint}</p>
			</div>
		);
	}

	return (
		<div className="flex flex-col h-full min-h-0 w-full">
			<div className="flex flex-1 min-h-0">
				<div className="w-64 shrink-0 border-r border-border bg-surface-1">
					<DocsProjectSidebar
						projects={projects}
						selectedId={selectedProjectId}
						onSelect={setSelectedProjectId}
						onProjectsChanged={() => {
							void refresh();
						}}
						online={online}
					/>
				</div>
				<div className="flex-1 min-h-0">
					<DocsSiteViewer
						projectId={selectedProjectId}
						hasSite={selectedProject?.hasSite ?? false}
						cacheBustKey={cacheBustKey}
					/>
				</div>
			</div>
			{selectedProject ? (
				<div className="h-56 shrink-0">
					<DocsRunPanel
						project={selectedProject}
						onBuildDone={() => setCacheBustKey((k) => k + 1)}
					/>
				</div>
			) : null}
		</div>
	);
}
