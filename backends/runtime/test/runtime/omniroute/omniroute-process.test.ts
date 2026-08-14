import { afterEach, describe, expect, it } from "vitest";

import { buildOmniRouteNodeOptions } from "../../../src/omniroute/omniroute-process";

const originalNodeOptions = process.env.NODE_OPTIONS;
const originalMaxOldSpace = process.env.OMNIROUTE_MAX_OLD_SPACE_MB;

function restore(key: "NODE_OPTIONS" | "OMNIROUTE_MAX_OLD_SPACE_MB", value: string | undefined): void {
	if (value === undefined) {
		delete process.env[key];
		return;
	}
	process.env[key] = value;
}

describe("buildOmniRouteNodeOptions", () => {
	afterEach(() => {
		restore("NODE_OPTIONS", originalNodeOptions);
		restore("OMNIROUTE_MAX_OLD_SPACE_MB", originalMaxOldSpace);
	});

	it("raises the heap ceiling that OmniRoute's own dev script would have set", () => {
		delete process.env.NODE_OPTIONS;
		delete process.env.OMNIROUTE_MAX_OLD_SPACE_MB;

		expect(buildOmniRouteNodeOptions()).toBe("--max-old-space-size=4096");
	});

	it("appends to an operator's NODE_OPTIONS instead of replacing it", () => {
		process.env.NODE_OPTIONS = "--enable-source-maps";
		delete process.env.OMNIROUTE_MAX_OLD_SPACE_MB;

		expect(buildOmniRouteNodeOptions()).toBe("--enable-source-maps --max-old-space-size=4096");
	});

	it("honours OMNIROUTE_MAX_OLD_SPACE_MB", () => {
		delete process.env.NODE_OPTIONS;
		process.env.OMNIROUTE_MAX_OLD_SPACE_MB = "8192";

		expect(buildOmniRouteNodeOptions()).toBe("--max-old-space-size=8192");
	});

	it("falls back to the default when the override is not a usable number", () => {
		delete process.env.NODE_OPTIONS;
		process.env.OMNIROUTE_MAX_OLD_SPACE_MB = "not-a-number";

		expect(buildOmniRouteNodeOptions()).toBe("--max-old-space-size=4096");
	});
});
