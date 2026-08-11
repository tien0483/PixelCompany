import { describe, expect, it } from "vitest";

import { planEditorRouter } from "../../../src/plan-editor-standalone/router";
import { runtimeAppRouter } from "../../../src/trpc/app-router";

/**
 * The standalone package mounts its own trimmed router, but it serves the *same* plan-editor UI
 * as the full app. Any `plans.*` procedure that UI calls has to exist in both, or the standalone
 * build fails at runtime with "no such procedure" — which is exactly how `plans.writeBackup`
 * went missing and broke every Expand-brief run in the packaged editor.
 */
function procedureNames(router: { _def: { procedures: Record<string, unknown> } }, prefix: string): string[] {
	return Object.keys(router._def.procedures)
		.filter((name) => name.startsWith(prefix))
		.sort();
}

describe("standalone plan editor router", () => {
	it("exposes every plans procedure the full app router does", () => {
		expect(procedureNames(planEditorRouter, "plans.")).toEqual(procedureNames(runtimeAppRouter, "plans."));
	});

	it("carries the html-source snapshot pair Refine diffs against", () => {
		const names = procedureNames(planEditorRouter, "plans.");
		expect(names).toContain("plans.readHtmlSource");
		expect(names).toContain("plans.writeHtmlSource");
	});
});
