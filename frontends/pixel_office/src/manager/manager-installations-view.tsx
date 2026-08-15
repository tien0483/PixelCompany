import type { ReactElement } from "react";
import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

import type { RuntimeManagerInstallationsOverview } from "@/runtime/types";
import { Button } from "@/components/ui/button";
import { MANAGER_LABELS } from "@/manager/manager-labels";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";

interface ManagerInstallationsViewProps {
	online: boolean;
	/** Selected project. Install state is per project, so the readout is scoped to it. */
	workspaceId?: string | null;
}

function ComponentSummary({
	label,
	items,
}: {
	label: string;
	items: Array<{ name: string; displayName: string; installed: boolean }>;
}): ReactElement {
	const installed = items.filter((item) => item.installed).length;
	return (
		<div className="rounded-md border border-border bg-surface-1 px-2 py-1.5">
			<div className="flex justify-between text-[11px]">
				<span className="text-text-secondary">{label}</span>
				<span className="text-text-primary">
					{installed}/{items.length}
				</span>
			</div>
		</div>
	);
}

/**
 * Native Installations surface — global install hero + per-project activity.
 */
export function ManagerInstallationsView({
	online,
	workspaceId = null,
}: ManagerInstallationsViewProps): ReactElement {
	const [overview, setOverview] = useState<RuntimeManagerInstallationsOverview | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		const load = async () => {
			if (!online) {
				setOverview(null);
				return;
			}
			setLoading(true);
			setError(null);
			try {
				const result = await getRuntimeTrpcClient(null).manager.installationsOverview.query(
					workspaceId ? { workspaceId } : undefined,
				);
				if (cancelled) {
					return;
				}
				setOverview(result);
				if (result === null) {
					setError("Could not load installations.");
				}
			} catch (err) {
				if (!cancelled) {
					setError(err instanceof Error ? err.message : "Could not load installations.");
					setOverview(null);
				}
			} finally {
				if (!cancelled) {
					setLoading(false);
				}
			}
		};
		void load();
		return () => {
			cancelled = true;
		};
	}, [online, workspaceId]);

	const reload = () => {
		void (async () => {
			if (!online) {
				return;
			}
			setLoading(true);
			setError(null);
			try {
				const result = await getRuntimeTrpcClient(null).manager.installationsOverview.query(
					workspaceId ? { workspaceId } : undefined,
				);
				setOverview(result);
				if (result === null) {
					setError("Could not load installations.");
				}
			} catch (err) {
				setError(err instanceof Error ? err.message : "Could not load installations.");
				setOverview(null);
			} finally {
				setLoading(false);
			}
		})();
	};

	if (!online) {
		return (
			<div className="flex flex-1 flex-col items-center justify-center gap-2 p-4 text-center">
				<p className="text-[12px] text-text-secondary">{MANAGER_LABELS.offline}</p>
				<p className="text-[11px] text-text-tertiary">{MANAGER_LABELS.installationsOfflineHint}</p>
			</div>
		);
	}

	return (
		<div className="flex min-h-0 flex-1 flex-col overflow-hidden" data-testid="manager-installations-view">
			<div className="flex items-center gap-1 border-b border-border px-2 py-1 shrink-0">
				<span className="flex-1 text-[10px] text-text-tertiary">
					{overview ? `Manager ${overview.version}` : loading ? "Loading…" : "Installations"}
				</span>
				<Button
					variant="ghost"
					size="sm"
					icon={<RefreshCw size={12} />}
					aria-label="Reload installations"
					disabled={loading}
					onClick={reload}
				/>
			</div>
			{error ? (
				<p className="shrink-0 border-b border-border px-2 py-1 text-[10px] text-status-red">{error}</p>
			) : null}
			<div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
				{overview === null && !loading ? (
					<p className="text-[11px] text-text-tertiary">No installation data.</p>
				) : overview === null ? (
					<p className="text-[11px] text-text-tertiary">Loading…</p>
				) : (
					<div className="flex flex-col gap-3">
						<div className="grid grid-cols-2 gap-1.5">
							<ComponentSummary label="Agents" items={overview.agents} />
							<ComponentSummary label="Commands" items={overview.commands} />
							<ComponentSummary label="Hooks" items={overview.hooks} />
							<ComponentSummary label="Knowledge" items={overview.knowledge} />
							{overview.skills.length > 0 ? (
								<ComponentSummary label="Skills" items={overview.skills} />
							) : null}
						</div>
						<div>
							<p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-text-tertiary">
								Projects ({overview.totalProjects})
							</p>
							{overview.projects.length === 0 ? (
								<p className="text-[11px] text-text-tertiary">No project activity yet.</p>
							) : (
								<div className="flex flex-col gap-1.5">
									{overview.projects.map((project) => (
										<div
											key={project.repoPath}
											className="rounded-md border border-border bg-surface-1 px-2 py-1.5"
										>
											<p className="truncate text-[12px] text-text-primary">{project.repoName}</p>
											<p className="truncate text-[10px] text-text-tertiary">{project.repoPath}</p>
											<p className="mt-0.5 text-[10px] text-text-secondary">
												{project.commandsRun} cmds · {project.hookExecutions} hooks ·{" "}
												{project.uniqueSessions} sessions
												{project.hasLessons ? ` · ${project.lessonsCount} lessons` : ""}
											</p>
										</div>
									))}
								</div>
							)}
						</div>
					</div>
				)}
			</div>
		</div>
	);
}
