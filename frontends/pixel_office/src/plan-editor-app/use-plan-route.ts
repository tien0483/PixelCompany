import { useCallback, useEffect, useRef, useState } from "react";

import { showAppToast } from "@/components/app-toaster";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import type { RuntimeSavedPlan } from "@/runtime/types";

/**
 * Keeps the open plan in the URL so the standalone Plan Editor survives a reload and
 * answers the browser's Back button. Without this the open plan lived only in component
 * state: reloading a plan you were editing — the obvious thing to do after the sidecar
 * came up late, or after generating a page — dropped you back on the plan list.
 *
 * The id travels in the hash rather than a path segment: the packaged server serves the
 * built `index.html` for `/` and has no history-fallback route, so `/plan/<id>` would
 * 404 on exactly the reload this is meant to survive.
 */
const PLAN_HASH_PREFIX = "#plan=";

export function readPlanIdFromHash(): string | null {
	if (typeof window === "undefined") {
		return null;
	}
	const hash = window.location.hash;
	if (!hash.startsWith(PLAN_HASH_PREFIX)) {
		return null;
	}
	const planId = decodeURIComponent(hash.slice(PLAN_HASH_PREFIX.length));
	return planId.length > 0 ? planId : null;
}

function planHashUrl(planId: string | null): string {
	const { pathname, search } = window.location;
	return `${pathname}${search}${planId === null ? "" : `${PLAN_HASH_PREFIX}${encodeURIComponent(planId)}`}`;
}

/**
 * `pushState` rather than assigning `location.hash`: assigning fires `hashchange`, which
 * would send this hook straight back to the server to re-resolve the plan it just opened.
 * Pushing keeps Back working (the entry it replaces is the list screen) and fires nothing.
 */
function pushPlanId(planId: string | null): void {
	window.history.pushState(null, "", planHashUrl(planId));
}

function replacePlanId(planId: string | null): void {
	window.history.replaceState(null, "", planHashUrl(planId));
}

export interface PlanRoute {
	openPlan: RuntimeSavedPlan | null;
	/** True while a plan id from the URL is being resolved against the saved-plan list. */
	isRestoringPlan: boolean;
	openPlanFromList: (plan: RuntimeSavedPlan) => void;
	closePlan: () => void;
}

export function usePlanRoute(): PlanRoute {
	const [openPlan, setOpenPlan] = useState<RuntimeSavedPlan | null>(null);
	const [isRestoringPlan, setIsRestoringPlan] = useState<boolean>(() => readPlanIdFromHash() !== null);
	// Read inside the navigation handler, which must not be re-registered per state change.
	const openPlanRef = useRef<RuntimeSavedPlan | null>(null);
	openPlanRef.current = openPlan;

	useEffect(() => {
		let isCancelled = false;

		const syncFromUrl = async (): Promise<void> => {
			const planId = readPlanIdFromHash();
			if (planId === null) {
				setOpenPlan(null);
				setIsRestoringPlan(false);
				return;
			}
			if (planId === openPlanRef.current?.id) {
				return;
			}
			setIsRestoringPlan(true);
			try {
				// `plans.list` rather than `plans.read`: the editor loads the file content itself,
				// and a plan whose file vanished comes back from the list flagged instead of throwing.
				const response = await getRuntimeTrpcClient(null).plans.list.query();
				if (isCancelled) {
					return;
				}
				const plan = response.plans.find((entry) => entry.id === planId) ?? null;
				if (plan === null) {
					showAppToast({ intent: "danger", message: "That plan is no longer in the saved list." });
					// Drop the dead id so a later reload lands on the list without the same error.
					replacePlanId(null);
					setOpenPlan(null);
					return;
				}
				setOpenPlan(plan);
			} catch (error) {
				if (isCancelled) {
					return;
				}
				showAppToast({
					intent: "danger",
					message: error instanceof Error ? error.message : String(error),
				});
			} finally {
				if (!isCancelled) {
					setIsRestoringPlan(false);
				}
			}
		};

		void syncFromUrl();
		const handleNavigate = (): void => {
			void syncFromUrl();
		};
		// `popstate` covers Back/Forward over our own pushes; `hashchange` covers a hand-edited
		// or shared URL being applied to an already-loaded page.
		window.addEventListener("popstate", handleNavigate);
		window.addEventListener("hashchange", handleNavigate);
		return () => {
			isCancelled = true;
			window.removeEventListener("popstate", handleNavigate);
			window.removeEventListener("hashchange", handleNavigate);
		};
	}, []);

	const openPlanFromList = useCallback((plan: RuntimeSavedPlan) => {
		setOpenPlan(plan);
		setIsRestoringPlan(false);
		pushPlanId(plan.id);
	}, []);

	const closePlan = useCallback(() => {
		setOpenPlan(null);
		setIsRestoringPlan(false);
		pushPlanId(null);
	}, []);

	return { openPlan, isRestoringPlan, openPlanFromList, closePlan };
}
