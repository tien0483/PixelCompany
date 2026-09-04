import { AlertTriangle, ExternalLink, GitBranch, RefreshCw } from "lucide-react";
import type { ReactElement } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Spinner } from "@/components/ui/spinner";
import type { RuntimeReviewGraphComponent, RuntimeReviewGraphImpactResponse } from "@/runtime/types";

/**
 * What the merge request touches, according to the project's knowledge graph.
 *
 * This is the visible half of the graph work. The agents get the same walk as
 * prose, which means a graph that is missing, stale or simply wrong degrades every
 * review prompt silently — so the reviewer needs somewhere to look at it. It also
 * costs nothing to render: the walk happens in the runtime, not in an agent.
 */
export function ReviewImpactPanel({
	impact,
	isLoading,
	projectPath,
	isRebuilding,
	canRebuild,
	rebuildProgressLine,
	onRefresh,
	onRebuildGraph,
	onOpenDashboard,
	onSelectPath,
}: {
	impact: RuntimeReviewGraphImpactResponse | null;
	isLoading: boolean;
	/** The checkout the graph was looked for under. Absent in the standalone app. */
	projectPath: string | undefined;
	isRebuilding: boolean;
	/** False when no Antigravity seat is available to spend on a rebuild. */
	canRebuild: boolean;
	/**
	 * The most recent thing the build reported doing. A whole-repository analysis
	 * is minutes of identical tool steps on the wire, so "Rebuilding graph…" alone
	 * is indistinguishable from a build that has stalled.
	 */
	rebuildProgressLine: string | null;
	onRefresh: () => void;
	onRebuildGraph: () => void;
	onOpenDashboard: () => void;
	/** Jumps the diff pane to a path, when the component has one in this merge request. */
	onSelectPath: (path: string) => void;
}): ReactElement {
	if (!projectPath) {
		return (
			<PanelMessage>
				No local checkout is selected, so there is no knowledge graph to read. Pick the project this merge request
				belongs to on the board.
			</PanelMessage>
		);
	}

	if (impact === null && isLoading) {
		return (
			<div className="flex min-h-0 flex-1 items-center justify-center" data-testid="review-impact-panel">
				<Spinner size={16} />
			</div>
		);
	}

	if (impact === null) {
		return <PanelMessage>Impact has not been loaded yet.</PanelMessage>;
	}

	if (!impact.hasGraph) {
		return (
			<div className="flex min-h-0 flex-1 flex-col gap-3 p-3" data-testid="review-impact-panel">
				<p className="text-xs text-text-secondary">
					{impact.error
						? `The knowledge graph could not be read: ${impact.error}`
						: "This project has no knowledge graph, so nothing can say what the change affects. The review agents fall back to reading only the diff."}
				</p>
				<p className="text-[11px] text-text-tertiary">
					Building one analyzes the whole repository. It runs on the Antigravity seat, not the review seat, and it
					takes a while on a large project.
				</p>
				<Button
					variant="default"
					size="sm"
					icon={isRebuilding ? <Spinner size={12} /> : <RefreshCw size={12} />}
					disabled={isRebuilding || !canRebuild}
					onClick={onRebuildGraph}
				>
					{isRebuilding ? "Building graph…" : "Build knowledge graph"}
				</Button>
				<RebuildProgressCaption isRebuilding={isRebuilding} line={rebuildProgressLine} />
				{!canRebuild ? (
					<p className="text-[11px] text-text-tertiary">
						No Antigravity seat is configured, so a build cannot be started from here.
					</p>
				) : null}
			</div>
		);
	}

	const freshness = impact.freshness;
	const changed = impact.changed ?? [];
	const affected = impact.affected ?? [];
	const dependencies = impact.dependencies ?? [];
	const changedPathSet = new Set(changed.flatMap((component) => (component.filePath ? [component.filePath] : [])));

	return (
		<div className="flex min-h-0 flex-1 flex-col" data-testid="review-impact-panel">
			<div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-2 py-1.5">
				<span className="truncate text-[10px] text-text-tertiary" title={impact.dataDir}>
					{impact.project?.name ?? "graph"} · {impact.nodeCount ?? 0} nodes
				</span>
				<div className="flex shrink-0 items-center gap-1">
					<button
						type="button"
						title="Recompute impact"
						aria-label="Recompute impact"
						className="cursor-pointer text-text-tertiary hover:text-text-primary"
						onClick={onRefresh}
					>
						{isLoading ? <Spinner size={11} /> : <RefreshCw size={11} />}
					</button>
					<button
						type="button"
						title="Open the graph dashboard in a browser tab"
						aria-label="Open the graph dashboard"
						className="cursor-pointer text-text-tertiary hover:text-text-primary"
						onClick={onOpenDashboard}
					>
						<ExternalLink size={11} />
					</button>
				</div>
			</div>

			{freshness?.isStale ? (
				<div className="flex shrink-0 flex-col gap-1.5 border-b border-border bg-surface-1 px-2 py-1.5">
					<div className="flex items-start gap-1.5 text-[11px] text-status-orange">
						<AlertTriangle size={11} className="mt-0.5 shrink-0" />
						<span title={freshness.changedSinceGraph.join("\n")}>
							{freshness.changedSinceGraphCount} file{freshness.changedSinceGraphCount === 1 ? "" : "s"} changed
							since the graph was built, so the impact below may be incomplete.
						</span>
					</div>
					<Button
						variant="default"
						size="sm"
						icon={isRebuilding ? <Spinner size={11} /> : <RefreshCw size={11} />}
						disabled={isRebuilding || !canRebuild}
						onClick={onRebuildGraph}
					>
						{isRebuilding ? "Rebuilding graph…" : "Rebuild graph (Antigravity seat)"}
					</Button>
					<RebuildProgressCaption isRebuilding={isRebuilding} line={rebuildProgressLine} />
				</div>
			) : null}

			{freshness?.error ? (
				<p className="shrink-0 border-b border-border px-2 py-1.5 text-[11px] text-text-tertiary">
					{freshness.error}
				</p>
			) : null}

			<div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5">
				<ImpactSection
					title={`Dependents (${affected.length}${impact.affectedOmitted ? `+${impact.affectedOmitted}` : ""})`}
					hint="Depend on the changed code — this is what may break."
					components={affected}
					changedPathSet={changedPathSet}
					emptyText="Nothing in the graph depends on the changed code."
					onSelectPath={onSelectPath}
				/>
				<ImpactSection
					title={`Changed (${changed.length})`}
					hint="Files in this merge request the graph knows about."
					components={changed}
					changedPathSet={changedPathSet}
					emptyText="The graph has no node for any changed file."
					onSelectPath={onSelectPath}
				/>
				{dependencies.length > 0 ? (
					<ImpactSection
						title={`Dependencies (${dependencies.length}${
							impact.dependenciesOmitted ? `+${impact.dependenciesOmitted}` : ""
						})`}
						hint="What the changed code relies on — context, not blast radius."
						components={dependencies}
						changedPathSet={changedPathSet}
						onSelectPath={onSelectPath}
					/>
				) : null}

				{impact.layers && impact.layers.length > 0 ? (
					<div className="mt-2 border-t border-border px-1.5 pt-2">
						<p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">
							Layers touched
						</p>
						{impact.layers.map((layer) => (
							<p key={layer.id} className="text-[11px] text-text-secondary" title={layer.description}>
								{layer.name}
							</p>
						))}
					</div>
				) : null}

				{impact.unmatchedPaths && impact.unmatchedPaths.length > 0 ? (
					<div className="mt-2 border-t border-border px-1.5 pt-2">
						<p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">
							Not in the graph ({impact.unmatchedPaths.length})
						</p>
						{impact.unmatchedPaths.map((unmatchedPath) => (
							<p key={unmatchedPath} className="truncate font-mono text-[10px] text-text-tertiary" title={unmatchedPath}>
								{unmatchedPath}
							</p>
						))}
					</div>
				) : null}
			</div>
		</div>
	);
}

/**
 * The build's last reported action, next to the button that started it. Read out
 * of the Antigravity CLI's transcript by the runtime — its stream reports tool
 * steps as a bare step type with no detail at all.
 */
function RebuildProgressCaption({
	isRebuilding,
	line,
}: {
	isRebuilding: boolean;
	line: string | null;
}): ReactElement | null {
	if (!isRebuilding || line === null) {
		return null;
	}
	return (
		<p className="truncate font-mono text-[10px] text-text-tertiary" title={line}>
			{line}
		</p>
	);
}

function PanelMessage({ children }: { children: React.ReactNode }): ReactElement {
	return (
		<p className="p-3 text-xs text-text-tertiary" data-testid="review-impact-panel">
			{children}
		</p>
	);
}

function ImpactSection({
	title,
	hint,
	components,
	changedPathSet,
	emptyText,
	onSelectPath,
}: {
	title: string;
	hint: string;
	components: RuntimeReviewGraphComponent[];
	changedPathSet: Set<string>;
	emptyText?: string;
	onSelectPath: (path: string) => void;
}): ReactElement {
	return (
		<div className="mb-2">
			<p className="px-1.5 text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">{title}</p>
			<p className="mb-1 px-1.5 text-[10px] text-text-tertiary">{hint}</p>
			{components.length === 0 && emptyText ? (
				<p className="px-1.5 py-1 text-[11px] text-text-tertiary">{emptyText}</p>
			) : null}
			{components.map((component) => {
				// Only a path that is actually in this merge request can be opened in the
				// diff pane; a dependent lives outside the change by definition.
				const isNavigable = component.filePath !== undefined && changedPathSet.has(component.filePath);
				return (
					<div
						key={component.nodeId}
						className={cn(
							"rounded-md px-1.5 py-1",
							isNavigable ? "cursor-pointer hover:bg-surface-2" : "cursor-default",
						)}
						{...(isNavigable
							? {
									role: "button",
									tabIndex: 0,
									onClick: () => onSelectPath(component.filePath as string),
									onKeyDown: (event: React.KeyboardEvent) => {
										if (event.key === "Enter" || event.key === " ") {
											event.preventDefault();
											onSelectPath(component.filePath as string);
										}
									},
								}
							: {})}
					>
						<div className="flex items-center gap-1.5">
							<span className="shrink-0 rounded bg-surface-3 px-1 font-mono text-[9px] uppercase text-text-tertiary">
								{component.type}
							</span>
							<span
								className="min-w-0 flex-1 truncate font-mono text-[11px] text-text-secondary"
								title={component.filePath ?? component.name}
							>
								{component.filePath ?? component.name}
							</span>
							{component.via ? (
								<span className="flex shrink-0 items-center gap-0.5 text-[9px] text-text-tertiary">
									<GitBranch size={9} />
									{component.via}
								</span>
							) : null}
						</div>
						{component.name !== component.filePath ? (
							<p className="truncate pl-1 text-[10px] text-text-tertiary">{component.name}</p>
						) : null}
					</div>
				);
			})}
		</div>
	);
}
