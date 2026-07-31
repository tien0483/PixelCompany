import type { ReactElement } from "react";
import { useEffect, useState } from "react";
import {
	BarChart3,
	BookOpen,
	GraduationCap,
	ScrollText,
	Settings,
	Users,
	Wrench,
} from "lucide-react";

import type { RuntimeJackedSnapshot } from "@/runtime/types";
import { cn } from "@/components/ui/cn";
import { FeatureShelfView } from "@/jacked/feature-shelf-view";
import { FEATURE_SHELF_SELECTORS } from "@/jacked/feature-shelf-selectors";
import { JackedAnalyticsView } from "@/jacked/jacked-analytics-view";
import { JackedInstallationsView } from "@/jacked/jacked-installations-view";
import { JackedLogsView } from "@/jacked/jacked-logs-view";
import { JackedSettingsView } from "@/jacked/jacked-settings-view";
import { JackedStatusBar } from "@/jacked/jacked-status-bar";
import { MANAGER_LABELS } from "@/jacked/manager-labels";
import { TrainingPacksPanel } from "@/jacked/training-packs-panel";

export type JackedSidebarRoute =
	| "staff"
	| "playbooks"
	| "training"
	| "handbook"
	| "installations"
	| "settings"
	| "logs"
	| "analytics";

const ROUTES: Array<{
	id: JackedSidebarRoute;
	label: string;
	icon: typeof Settings;
}> = [
	{ id: "staff", label: MANAGER_LABELS.routes.staff, icon: Users },
	{ id: "playbooks", label: MANAGER_LABELS.routes.playbooks, icon: ScrollText },
	{ id: "training", label: MANAGER_LABELS.routes.training, icon: GraduationCap },
	{ id: "handbook", label: MANAGER_LABELS.routes.handbook, icon: BookOpen },
	{ id: "installations", label: MANAGER_LABELS.routes.installations, icon: Wrench },
	{ id: "settings", label: MANAGER_LABELS.routes.settings, icon: Settings },
	{ id: "logs", label: MANAGER_LABELS.routes.logs, icon: ScrollText },
	{ id: "analytics", label: MANAGER_LABELS.routes.analytics, icon: BarChart3 },
];

/**
 * Manager navigation + native Kanban-styled views inside the left sidebar.
 *
 * Staff / Playbooks / Training / Handbook are four slices of the same feature list the
 * runtime already streams, so they need no fetch of their own — see feature-shelf-view.
 *
 * Accounts live only in the home upper-right pane (not duplicated here).
 * No raw :8321 iframe / dashboard embed — native surfaces only.
 */
export function JackedSidebarSection({
	online,
	jacked = null,
	settingsFocusToken = 0,
}: {
	online: boolean;
	jacked?: RuntimeJackedSnapshot | null;
	/** Incremented when lower-left Settings is clicked — jumps to Settings route. */
	settingsFocusToken?: number;
}): ReactElement {
	const [route, setRoute] = useState<JackedSidebarRoute>("settings");
	const active = ROUTES.find((item) => item.id === route) ?? ROUTES[0];

	useEffect(() => {
		if (settingsFocusToken > 0) {
			setRoute("settings");
		}
	}, [settingsFocusToken]);

	return (
		<div className="flex min-h-0 flex-1 flex-col" data-testid="jacked-sidebar-section">
			<JackedStatusBar online={online} jacked={jacked} />
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
			{route === "staff" ? (
				<FeatureShelfView
					online={online}
					jacked={jacked}
					copy={MANAGER_LABELS.shelves.staff}
					select={FEATURE_SHELF_SELECTORS.staff}
					testId="manager-shelf-staff"
				/>
			) : null}
			{route === "playbooks" ? (
				<FeatureShelfView
					online={online}
					jacked={jacked}
					copy={MANAGER_LABELS.shelves.playbooks}
					select={FEATURE_SHELF_SELECTORS.playbooks}
					testId="manager-shelf-playbooks"
				/>
			) : null}
			{route === "training" ? (
				<FeatureShelfView
					online={online}
					jacked={jacked}
					copy={MANAGER_LABELS.shelves.training}
					select={FEATURE_SHELF_SELECTORS.training}
					header={<TrainingPacksPanel online={online} />}
					testId="manager-shelf-training"
				/>
			) : null}
			{route === "handbook" ? (
				<FeatureShelfView
					online={online}
					jacked={jacked}
					copy={MANAGER_LABELS.shelves.handbook}
					select={FEATURE_SHELF_SELECTORS.handbook}
					testId="manager-shelf-handbook"
				/>
			) : null}
			{route === "installations" ? <JackedInstallationsView online={online} /> : null}
			{route === "settings" ? <JackedSettingsView online={online} jacked={jacked} /> : null}
			{route === "logs" ? <JackedLogsView online={online} /> : null}
			{route === "analytics" ? <JackedAnalyticsView online={online} /> : null}
		</div>
	);
}
