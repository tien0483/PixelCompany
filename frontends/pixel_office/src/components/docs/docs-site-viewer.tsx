import { BookOpen } from "lucide-react";
import type { ReactElement } from "react";

import { DOCS_LABELS } from "@/docs/docs-labels";

export interface DocsSiteViewerProps {
	projectId: string | null;
	hasSite: boolean;
	/** Bumped by the parent after a successful build to force the iframe to remount. */
	cacheBustKey: number | string;
}

/**
 * Hosts the built documentation site for the selected project. Renders a
 * placeholder instead of an iframe pointed at a 404 when nothing is selected
 * or the project has no built site yet.
 */
export function DocsSiteViewer({
	projectId,
	hasSite,
	cacheBustKey,
}: DocsSiteViewerProps): ReactElement {
	if (!projectId || !hasSite) {
		return (
			<div className="flex flex-1 h-full w-full min-h-0 flex-col items-center justify-center gap-2 bg-surface-0 text-text-tertiary">
				<BookOpen size={40} strokeWidth={1} />
				<p className="text-sm text-text-secondary">
					{projectId ? DOCS_LABELS.noSite : DOCS_LABELS.selectProject}
				</p>
				{projectId ? (
					<p className="text-xs text-text-tertiary">{DOCS_LABELS.noSiteHint}</p>
				) : null}
			</div>
		);
	}

	return (
		<iframe
			key={`${projectId}:${cacheBustKey}`}
			src={`/api/doc-skill-proxy/site/${projectId}/index.html`}
			title="Documentation site"
			className="flex-1 w-full h-full border-0"
		/>
	);
}
