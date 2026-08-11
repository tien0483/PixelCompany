import type { ReactElement } from "react";

import { PlanEditorView } from "@/components/plan-editor/plan-editor-view";
import { ThemeSelect } from "@/components/theme-select";
import { Spinner } from "@/components/ui/spinner";
import { useTheme } from "@/hooks/use-theme";
import { PlanListScreen } from "@/plan-editor-app/plan-list-screen";
import { usePlanRoute } from "@/plan-editor-app/use-plan-route";

export function PlanEditorApp(): ReactElement {
	const { openPlan, isRestoringPlan, openPlanFromList, closePlan } = usePlanRoute();
	const { themeId, setThemeId } = useTheme();

	// This shell owns the app's height. `#root` is `height: 100%` but a *block* box
	// (globals.css), so `PlanEditorView`'s own `flex-1` resolves against nothing when it
	// is mounted directly under it: the editor then lays out at content height, the panes
	// collapse to a two-row textarea plus a 150px iframe, and the generation log looks
	// like it owns half the window. Inside the full app App.tsx supplies this flex column,
	// so the editor only needs it here.
	return (
		<div className="flex h-[100svh] min-h-0 flex-col bg-surface-0 text-text-primary">
			{openPlan ? (
				// The standalone package has no settings dialog, so the theme picker travels
				// with the editor header — otherwise it would vanish the moment a plan opens.
				<PlanEditorView
					plan={openPlan}
					workspaceId={null}
					onClose={closePlan}
					headerActions={<ThemeSelect variant="compact" value={themeId} onValueChange={setThemeId} />}
				/>
			) : isRestoringPlan ? (
				// A reload with `#plan=<id>` has to resolve that id before the editor can mount;
				// showing the list in the meantime would look like the plan failed to reopen.
				<div className="flex min-h-0 flex-1 items-center justify-center" data-testid="plan-route-restoring">
					<Spinner size={20} />
				</div>
			) : (
				<PlanListScreen onOpenPlan={openPlanFromList} />
			)}
		</div>
	);
}
