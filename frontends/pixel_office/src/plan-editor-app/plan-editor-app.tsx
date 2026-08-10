import { type ReactElement, useState } from "react";

import { PlanEditorView } from "@/components/plan-editor/plan-editor-view";
import { ThemeSelect } from "@/components/theme-select";
import { useTheme } from "@/hooks/use-theme";
import { PlanListScreen } from "@/plan-editor-app/plan-list-screen";
import type { RuntimeSavedPlan } from "@/runtime/types";

export function PlanEditorApp(): ReactElement {
	const [openPlan, setOpenPlan] = useState<RuntimeSavedPlan | null>(null);
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
					onClose={() => setOpenPlan(null)}
					headerActions={<ThemeSelect variant="compact" value={themeId} onValueChange={setThemeId} />}
				/>
			) : (
				<PlanListScreen onOpenPlan={setOpenPlan} />
			)}
		</div>
	);
}
