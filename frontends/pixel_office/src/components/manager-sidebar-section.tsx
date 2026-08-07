import type { ReactElement } from "react";
import { useEffect, useState } from "react";
import {
	BarChart3,
	BookOpen,
	GitBranch,
	GraduationCap,
	Settings,
	Terminal,
	Users,
	Wrench,
} from "lucide-react";

import type { RuntimeManagerSnapshot } from "@/runtime/types";
import { cn } from "@/components/ui/cn";
import { FeatureShelfView } from "@/manager/feature-shelf-view";
import { FEATURE_SHELF_SELECTORS } from "@/manager/feature-shelf-selectors";
import { ManagerAnalyticsView } from "@/manager/manager-analytics-view";
import { ManagerInstallationsView } from "@/manager/manager-installations-view";
import { ManagerLogsView } from "@/manager/manager-logs-view";
import { ManagerSettingsView } from "@/manager/manager-settings-view";
import { ManagerStatusBar } from "@/manager/manager-status-bar";
import { MANAGER_LABELS } from "@/manager/manager-labels";
import { TrainingDiskSkillsPanel } from "@/manager/training-disk-skills-panel";
import { TrainingPacksPanel } from "@/manager/training-packs-panel";
import { WorkflowsView } from "@/manager/workflows-view";

export type ManagerSidebarRoute =
	| "agents"
	| "commands"
	| "skills"
	| "rules"
	| "workflows"
	| "installations"
	| "settings"
	| "logs"
	| "analytics";

const ROUTES: Array<{
	id: ManagerSidebarRoute;
	label: string;
	icon: typeof Settings;
}> = [
	{ id: "agents", label: MANAGER_LABELS.routes.agents, icon: Users },
	{ id: "commands", label: MANAGER_LABELS.routes.commands, icon: Terminal },
	{ id: "skills", label: MANAGER_LABELS.routes.skills, icon: GraduationCap },
	{ id: "rules", label: MANAGER_LABELS.routes.rules, icon: BookOpen },
	{ id: "workflows", label: MANAGER_LABELS.routes.workflows, icon: GitBranch },
	{ id: "installations", label: MANAGER_LABELS.routes.installations, icon: Wrench },
	{ id: "settings", label: MANAGER_LABELS.routes.settings, icon: Settings },
	{ id: "logs", label: MANAGER_LABELS.routes.logs, icon: Terminal },
	{ id: "analytics", label: MANAGER_LABELS.routes.analytics, icon: BarChart3 },
];

/**
 * Manager navigation + native Kanban-styled views inside the left sidebar.
 *
 * Agents / Commands / Skills / Rules & Reference are four slices of the same feature
 * list the runtime already streams, so they need no fetch of their own — see feature-shelf-view.
 *
 * Accounts live only in the home upper-right pane (not duplicated here).
 * No raw :8321 iframe / dashboard embed — native surfaces only.
 */
export function ManagerSidebarSection({
	online,
	manager = null,
	settingsFocusToken = 0,
	workspaceId = null,
}: {
	online: boolean;
	manager?: RuntimeManagerSnapshot | null;
	/** Incremented when lower-left Settings is clicked — jumps to Settings route. */
	settingsFocusToken?: number;
	/**
	 * Selected project. The Manager catalog is per project, so the shelves read and
	 * write its `.claude`, and Workflows lists its `.agent/workflows`.
	 */
	workspaceId?: string | null;
}): ReactElement {
	const [route, setRoute] = useState<ManagerSidebarRoute>("settings");
	const active = ROUTES.find((item) => item.id === route) ?? ROUTES[0];

	useEffect(() => {
		if (settingsFocusToken > 0) {
			setRoute("settings");
		}
	}, [settingsFocusToken]);

	return (
		<div className="flex min-h-0 flex-1 flex-col" data-testid="manager-sidebar-section">
			<ManagerStatusBar online={online} manager={manager} />
			<nav className="flex flex-col gap-0.5 px-2 pb-2 shrink-0">
				{ROUTES.map((item) => {
					const Icon = item.icon;
					const isActive = route === item.id;
					return (
						<button
							key={item.id}
							type="button"
							onClick={() => {
								setRoute(item.id);
							}}
							className={cn(
								"flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px]",
								isActive
									? "bg-surface-4 text-text-primary border border-border"
									: "text-text-secondary hover:text-text-primary border border-transparent hover:bg-surface-2",
							)}
						>
							<Icon size={14} className="shrink-0" />
							<span className="truncate flex-1">{item.label}</span>
						</button>
					);
				})}
			</nav>
			<div className="border-y border-border px-2 py-1 shrink-0">
				<span className="truncate text-[10px] text-text-tertiary">
					{active?.label ?? route} · native
				</span>
			</div>
			{route === "agents" ? (
				<FeatureShelfView
					online={online}
					manager={manager}
					copy={MANAGER_LABELS.shelves.agents}
					select={FEATURE_SHELF_SELECTORS.agents}
					workspaceId={workspaceId}
					testId="manager-shelf-agents"
				/>
			) : null}
			{route === "commands" ? (
				<FeatureShelfView
					online={online}
					manager={manager}
					copy={MANAGER_LABELS.shelves.commands}
					select={FEATURE_SHELF_SELECTORS.commands}
					workspaceId={workspaceId}
					testId="manager-shelf-commands"
				/>
			) : null}
			{route === "skills" ? (
				<FeatureShelfView
					online={online}
					manager={manager}
					copy={MANAGER_LABELS.shelves.skills}
					select={FEATURE_SHELF_SELECTORS.skills}
					workspaceId={workspaceId}
					header={
						<>
							<TrainingPacksPanel online={online} />
							<TrainingDiskSkillsPanel online={online} workspaceId={workspaceId} />
						</>
					}
					testId="manager-shelf-skills"
				/>
			) : null}
			{route === "rules" ? (
				<FeatureShelfView
					online={online}
					manager={manager}
					copy={MANAGER_LABELS.shelves.rules}
					select={FEATURE_SHELF_SELECTORS.rules}
					workspaceId={workspaceId}
					testId="manager-shelf-rules"
				/>
			) : null}
			{route === "workflows" ? <WorkflowsView online={online} workspaceId={workspaceId} /> : null}
			{route === "installations" ? <ManagerInstallationsView online={online} /> : null}
			{route === "settings" ? <ManagerSettingsView online={online} manager={manager} /> : null}
			{route === "logs" ? <ManagerLogsView online={online} /> : null}
			{route === "analytics" ? <ManagerAnalyticsView online={online} /> : null}
		</div>
	);
}
