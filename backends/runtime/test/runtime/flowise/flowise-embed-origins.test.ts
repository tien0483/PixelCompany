import { afterEach, describe, expect, it } from "vitest";

import { resolvePixelOfficeEmbedOrigins } from "../../../src/flowise/flowise-embed-origins";

describe("resolvePixelOfficeEmbedOrigins", () => {
	const originalHost = process.env.KANBAN_RUNTIME_HOST;

	afterEach(() => {
		if (originalHost === undefined) {
			delete process.env.KANBAN_RUNTIME_HOST;
		} else {
			process.env.KANBAN_RUNTIME_HOST = originalHost;
		}
	});

	it("allows 127.0.0.1 and localhost for the PixelOffice port", () => {
		expect(resolvePixelOfficeEmbedOrigins("3484")).toBe(
			"http://127.0.0.1:3484,https://127.0.0.1:3484,http://localhost:3484,https://localhost:3484",
		);
	});

	it("never emits bracketed IPv6 hosts that CSP frame-ancestors rejects", () => {
		process.env.KANBAN_RUNTIME_HOST = "[::1]";
		const origins = resolvePixelOfficeEmbedOrigins("3484");
		expect(origins).not.toContain("[::1]");
		expect(origins).toContain("http://127.0.0.1:3484");
	});

	it("adds KANBAN_RUNTIME_HOST when it is a plain hostname", () => {
		process.env.KANBAN_RUNTIME_HOST = "studio.local";
		expect(resolvePixelOfficeEmbedOrigins("3484")).toContain("http://studio.local:3484");
	});
});
