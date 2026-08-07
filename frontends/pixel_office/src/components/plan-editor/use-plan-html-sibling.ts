import { useCallback, useEffect, useState } from "react";

import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import type { RuntimeSavedPlan } from "@/runtime/types";

/** `/plans/foo.md` → `/plans/foo.html`; mirrors writeSavedPlanSibling's `<stem>.html` rule. */
export function htmlSiblingPath(path: string): string {
	const lastSeparator = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
	const fileName = path.slice(lastSeparator + 1);
	const dotIndex = fileName.lastIndexOf(".");
	const stem = dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName;
	return `${path.slice(0, lastSeparator + 1)}${stem}.html`;
}

/**
 * Resolves the `<stem>.html` plan sitting next to `plan`, if it has already been generated.
 * `setSibling` lets a fresh `plans.writeSibling` result land without refetching the library.
 */
export function usePlanHtmlSibling(
	plan: RuntimeSavedPlan | null,
	workspaceId: string | null,
): {
	sibling: RuntimeSavedPlan | null;
	setSibling: (sibling: RuntimeSavedPlan) => void;
} {
	const [sibling, setSibling] = useState<RuntimeSavedPlan | null>(null);
	const planPath = plan?.path ?? null;

	useEffect(() => {
		if (!planPath) {
			setSibling(null);
			return;
		}
		const expectedPath = htmlSiblingPath(planPath);
		if (expectedPath === planPath) {
			setSibling(null);
			return;
		}
		let cancelled = false;
		void (async () => {
			try {
				const response = await getRuntimeTrpcClient(workspaceId).plans.list.query();
				if (cancelled) {
					return;
				}
				const match = response.ok
					? (response.plans.find((entry) => entry.path === expectedPath) ?? null)
					: null;
				setSibling(match);
			} catch {
				if (!cancelled) {
					setSibling(null);
				}
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [planPath, workspaceId]);

	const replaceSibling = useCallback((next: RuntimeSavedPlan) => {
		setSibling(next);
	}, []);

	return { sibling, setSibling: replaceSibling };
}
