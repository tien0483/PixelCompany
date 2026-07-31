import { describe, expect, it } from "vitest";

import { mapOfficeOverlayClass, OFFICE_OVERLAY_TOKEN_MAP } from "./theme-tokens";

describe("mapOfficeOverlayClass", () => {
	it("rewrites pixel-agents tokens to Kanban surface classes", () => {
		expect(mapOfficeOverlayClass("bg-bg text-text border-border")).toBe(
			`${OFFICE_OVERLAY_TOKEN_MAP["bg-bg"]} ${OFFICE_OVERLAY_TOKEN_MAP["text-text"]} border-border`,
		);
	});

	it("passes through unknown classes", () => {
		expect(mapOfficeOverlayClass("flex items-center gap-2")).toBe("flex items-center gap-2");
	});
});
