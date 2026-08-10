import { describe, expect, it } from "vitest";

import { planPreviewBaseHref, withPreviewBase } from "@/components/plan-editor/plan-html-preview";

describe("withPreviewBase", () => {
	const planId = "plan 1/2";

	it("inserts the base tag immediately after <head>", () => {
		const html = "<!doctype html><html><head><title>x</title></head><body></body></html>";

		expect(withPreviewBase(html, "abc")).toBe(
			'<!doctype html><html><head><base href="/api/plans/abc/file/"><title>x</title></head><body></body></html>',
		);
	});

	it("percent-encodes the plan id so an odd id cannot break out of the URL", () => {
		expect(planPreviewBaseHref(planId)).toBe("/api/plans/plan%201%2F2/file/");
	});

	it("creates a head when the document has none", () => {
		expect(withPreviewBase("<html><body>x</body></html>", "abc")).toBe(
			'<html><head><base href="/api/plans/abc/file/"></head><body>x</body></html>',
		);
	});

	it("prepends the base tag for a bare fragment", () => {
		expect(withPreviewBase("<p>x</p>", "abc")).toBe('<base href="/api/plans/abc/file/"><p>x</p>');
	});

	it("leaves a document that already declares a base alone", () => {
		const html = '<html><head><base href="https://example.com/"></head></html>';

		expect(withPreviewBase(html, "abc")).toBe(html);
	});

	it("is a no-op without a plan id or content", () => {
		expect(withPreviewBase("<p>x</p>", null)).toBe("<p>x</p>");
		expect(withPreviewBase("", "abc")).toBe("");
	});
});
