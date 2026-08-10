import { type ReactElement, useState } from "react";

import { PlanEditorView } from "@/components/plan-editor/plan-editor-view";
import { PlanListScreen } from "@/plan-editor-app/plan-list-screen";
import type { RuntimeSavedPlan } from "@/runtime/types";

export function PlanEditorApp(): ReactElement {
	const [openPlan, setOpenPlan] = useState<RuntimeSavedPlan | null>(null);

	if (openPlan) {
		return <PlanEditorView plan={openPlan} workspaceId={null} onClose={() => setOpenPlan(null)} />;
	}

	return <PlanListScreen onOpenPlan={setOpenPlan} />;
}
