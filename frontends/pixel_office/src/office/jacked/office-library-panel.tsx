import type { ReactElement } from "react";
import { useCallback, useState } from "react";

import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import { FeatureToggleButton } from "@/jacked/feature-toggle-button";
import type { LibraryShelf, LibrarySection } from "./office-jacked-semantics.js";

interface OfficeLibraryPanelProps {
	sections: LibrarySection[];
	workspaceId: string | null;
	jackedOnline: boolean;
}

/**
 * Compact library shelf list, grouped into the same Playbooks/Training/Handbook
 * sections as the sidebar Manager shelves. Clicking toggles the jacked feature via tRPC.
 */
export function OfficeLibraryPanel({
	sections,
	workspaceId,
	jackedOnline,
}: OfficeLibraryPanelProps): ReactElement | null {
	const [pending, setPending] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	const handleToggle = useCallback(
		async (shelf: LibraryShelf) => {
			if (!workspaceId || !jackedOnline || pending !== null) {
				return;
			}
			const key = `${shelf.category}/${shelf.name}`;
			setPending(key);
			setError(null);
			try {
				const trpc = getRuntimeTrpcClient(workspaceId);
				const result = await trpc.jacked.setFeatureEnabled.mutate({
					category: shelf.category,
					name: shelf.name,
					enabled: !shelf.installed,
				});
				if (!result.ok) {
					setError(result.error ?? "Toggle failed");
				}
			} catch (err) {
				setError(err instanceof Error ? err.message : "Toggle failed");
			} finally {
				setPending(null);
			}
		},
		[jackedOnline, pending, workspaceId],
	);

	if (!jackedOnline || !sections.some((section) => section.shelves.length > 0)) {
		return null;
	}

	return (
		<div
			data-testid="office-library-panel"
			className="pointer-events-none absolute bottom-16 left-3 max-w-[18rem]"
		>
			<div className="pointer-events-auto flex max-h-[28rem] flex-col rounded-md border border-border bg-surface-1/90 px-2.5 py-2 text-[11px] text-text-secondary shadow-sm backdrop-blur">
				<div className="mb-1.5 shrink-0 font-medium text-text-primary">Library</div>
				<div className="min-h-0 flex-1 overflow-y-auto">
					{sections.map((section) => (
						<div key={section.key} className="mb-2 last:mb-0">
							<div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-text-tertiary">
								{section.label}
							</div>
							<ul className="flex flex-col gap-1">
								{section.shelves.map((shelf) => {
									const key = `${shelf.category}/${shelf.name}`;
									const busy = pending === key;
									return (
										<li
											key={key}
											title={shelf.description}
											className="flex items-center justify-between gap-2 rounded px-1.5 py-1 hover:bg-surface-2"
										>
											<span className="min-w-0 flex-1 truncate">{shelf.displayName}</span>
											<FeatureToggleButton
												installed={shelf.installed}
												busy={busy}
												disabled={!workspaceId}
												onToggle={() => {
													void handleToggle(shelf);
												}}
												subjectLabel={shelf.displayName}
											/>
										</li>
									);
								})}
							</ul>
						</div>
					))}
				</div>
				{error ? <p className="mt-1 shrink-0 text-[10px] text-status-red">{error}</p> : null}
			</div>
		</div>
	);
}
