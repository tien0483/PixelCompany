import type { ReactElement } from "react";
import { useCallback, useState } from "react";

import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import type { LibraryShelf } from "./office-jacked-semantics.js";

interface OfficeLibraryPanelProps {
	shelves: LibraryShelf[];
	workspaceId: string | null;
	jackedOnline: boolean;
}

/**
 * Compact library shelf list. Clicking toggles the jacked feature via tRPC.
 * Caps visible shelves so the canvas stays the hero.
 */
export function OfficeLibraryPanel({
	shelves,
	workspaceId,
	jackedOnline,
}: OfficeLibraryPanelProps): ReactElement | null {
	const [pending, setPending] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	const visible = shelves.slice(0, 8);

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

	if (!jackedOnline || visible.length === 0) {
		return null;
	}

	return (
		<div
			data-testid="office-library-panel"
			className="pointer-events-none absolute bottom-16 left-3 max-w-[14rem]"
		>
			<div className="pointer-events-auto rounded-md border border-border bg-surface-1/90 px-2.5 py-2 text-[11px] text-text-secondary shadow-sm backdrop-blur">
				<div className="mb-1.5 font-medium text-text-primary">Library</div>
				<ul className="flex max-h-40 flex-col gap-1 overflow-y-auto">
					{visible.map((shelf) => {
						const key = `${shelf.category}/${shelf.name}`;
						const busy = pending === key;
						return (
							<li key={key}>
								<button
									type="button"
									title={shelf.description}
									disabled={busy || !workspaceId}
									onClick={() => {
										void handleToggle(shelf);
									}}
									className="flex w-full items-center justify-between gap-2 rounded px-1.5 py-1 text-left hover:bg-surface-2 disabled:opacity-50"
								>
									<span className="truncate">{shelf.displayName}</span>
									<span className="shrink-0 text-[10px] uppercase tracking-wide text-text-tertiary">
										{shelf.installed ? "on" : "off"}
									</span>
								</button>
							</li>
						);
					})}
				</ul>
				{error ? <p className="mt-1 text-[10px] text-status-red">{error}</p> : null}
			</div>
		</div>
	);
}
