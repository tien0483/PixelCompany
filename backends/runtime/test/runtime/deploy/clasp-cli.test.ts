import { describe, expect, it } from "vitest";

import { buildWebAppUrl, parseDeploymentId } from "../../../src/deploy/apps-script-deploy";
import { classifyClaspFailure } from "../../../src/deploy/clasp-cli";

describe("clasp failure classification", () => {
	it("reads a missing credential as needing sign-in", () => {
		expect(classifyClaspFailure("Could not read API credentials. Are you logged in globally?")).toBe("needsLogin");
		expect(classifyClaspFailure("Error: invalid_grant")).toBe("needsLogin");
	});

	it("reads a disabled Apps Script API as its own remedy", () => {
		expect(classifyClaspFailure("User has not enabled the Apps Script API. Enable it by visiting …")).toBe(
			"needsApiEnabled",
		);
	});

	it("prefers the API remedy when the message mentions credentials too", () => {
		expect(classifyClaspFailure("Could not read API credentials — user has not enabled the Apps Script API.")).toBe(
			"needsApiEnabled",
		);
	});

	it("reads a DNS or socket failure as a network problem", () => {
		expect(classifyClaspFailure("getaddrinfo ENOTFOUND registry.npmjs.org")).toBe("needsNetwork");
	});

	it("leaves an unrecognised failure unclassified", () => {
		expect(classifyClaspFailure("Push failed. Errors returned by Apps Script API: Syntax error.")).toBeNull();
	});
});

describe("deploy output parsing", () => {
	it("pulls the deployment id out of clasp's success line", () => {
		const output = "Created version 3.\n- AKfycbwSomeVeryLongDeploymentId @3.\n";
		expect(parseDeploymentId(output)).toBe("AKfycbwSomeVeryLongDeploymentId");
	});

	it("returns null when no deployment id is present", () => {
		expect(parseDeploymentId("Created version 3.\n")).toBeNull();
	});

	it("builds a domain-scoped web app URL", () => {
		expect(buildWebAppUrl("akselos.com", "AKfycbwId")).toBe(
			"https://script.google.com/a/macros/akselos.com/s/AKfycbwId/exec",
		);
	});

	it("falls back to the unscoped URL when no domain is configured", () => {
		expect(buildWebAppUrl("  ", "AKfycbwId")).toBe("https://script.google.com/macros/s/AKfycbwId/exec");
	});
});
