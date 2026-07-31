import type { ReactElement, ReactNode } from "react";

import type { RuntimeJackedSnapshot } from "@/runtime/types";
import { JackedSidebarSection } from "@/components/jacked-sidebar-section";
import { cn } from "@/components/ui/cn";
import { MANAGER_LABELS } from "@/jacked/manager-labels";

/**
 * Manager home-sidebar chrome extracted from ProjectNavigationPanel so core
 * Kanban sidebar wiring stays thin (tab + panel slot only).
 *
 * File and component names keep the `jacked` prefix (upstream API); the visible
 * copy comes from MANAGER_LABELS.
 */

export function HomeSidebarJackedTab({
	active,
	onSelect,
}: {
	active: boolean;
	onSelect: () => void;
}): ReactElement {
	return (
		<button
			type="button"
			data-testid="sidebar-jacked-tab"
			onClick={onSelect}
			className={cn(
				"cursor-pointer rounded-sm px-1.5 py-1 text-[11px] font-medium",
				active
					? "bg-surface-4 text-text-primary border border-border"
					: "text-text-secondary hover:text-text-primary border border-transparent",
			)}
		>
			{MANAGER_LABELS.section}
		</button>
	);
}

export function HomeSidebarJackedPanel({
	online,
	jacked = null,
	settingsFocusToken = 0,
}: {
	online: boolean;
	jacked?: RuntimeJackedSnapshot | null;
	settingsFocusToken?: number;
}): ReactNode {
	return (
		<div className="flex min-h-0 flex-1 flex-col overflow-hidden">
			<JackedSidebarSection
				online={online}
				jacked={jacked}
				settingsFocusToken={settingsFocusToken}
			/>
		</div>
	);
}
