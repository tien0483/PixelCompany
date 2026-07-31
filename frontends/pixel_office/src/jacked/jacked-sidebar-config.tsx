import type { ReactElement } from "react";
import { Settings } from "lucide-react";

import { Button } from "@/components/ui/button";
import { MANAGER_LABELS } from "@/jacked/manager-labels";

interface JackedSidebarConfigProps {
	/** Switch left sidebar to Jacked → Settings (Accounts live upper-right only). */
	onOpenJackedSettings: () => void;
}

/**
 * Lower-left Jacked config strip: settings only (refresh/pause/resume live in the Office pane's JackedAccountsView).
 */
export function JackedSidebarConfig({
	onOpenJackedSettings,
}: JackedSidebarConfigProps): ReactElement {
	return (
		<div
			data-testid="jacked-sidebar-config"
			className="shrink-0 border-t border-border bg-surface-1 px-2 py-2"
		>
			<div className="flex flex-wrap gap-1">
				<Button
					variant="ghost"
					size="sm"
					className="h-7 px-2 text-[10px]"
					icon={<Settings size={12} />}
					aria-label={MANAGER_LABELS.openSettings}
					onClick={onOpenJackedSettings}
				>
					Settings
				</Button>
			</div>
		</div>
	);
}
