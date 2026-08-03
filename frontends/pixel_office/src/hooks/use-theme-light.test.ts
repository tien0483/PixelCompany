import { describe, expect, it } from "vitest";

import { isLightUiTheme } from "@/hooks/use-theme";

describe("isLightUiTheme", () => {
	it("marks light and high-contrast-light themes as light UI", () => {
		expect(isLightUiTheme("light")).toBe(true);
		expect(isLightUiTheme("overcast")).toBe(true);
		expect(isLightUiTheme("high-contrast-light")).toBe(true);
		expect(isLightUiTheme("default")).toBe(false);
		expect(isLightUiTheme("high-contrast-dark")).toBe(false);
	});
});
