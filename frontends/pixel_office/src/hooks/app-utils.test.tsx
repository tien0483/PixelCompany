import { describe, expect, it } from "vitest";

import {
	buildDetailTaskUrl,
	buildOfficeUrl,
	parseDetailTaskIdFromSearch,
	parseOfficeOpenFromSearch,
} from "@/hooks/app-utils";

describe("parseDetailTaskIdFromSearch", () => {
	it("returns the selected task id when present", () => {
		expect(parseDetailTaskIdFromSearch("?task=task-123")).toBe("task-123");
	});

	it("returns null when the task id is missing or blank", () => {
		expect(parseDetailTaskIdFromSearch("")).toBeNull();
		expect(parseDetailTaskIdFromSearch("?task=")).toBeNull();
		expect(parseDetailTaskIdFromSearch("?task=%20%20")).toBeNull();
	});
});

describe("buildDetailTaskUrl", () => {
	it("adds the task id while preserving other query params and hash", () => {
		expect(
			buildDetailTaskUrl({
				pathname: "/project-1",
				search: "?view=board",
				hash: "#panel",
				taskId: "task-123",
			}),
		).toBe("/project-1?view=board&task=task-123#panel");
	});

	it("removes the task id while preserving other query params", () => {
		expect(
			buildDetailTaskUrl({
				pathname: "/project-1",
				search: "?view=board&task=task-123",
				hash: "",
				taskId: null,
			}),
		).toBe("/project-1?view=board");
	});
});

describe("parseOfficeOpenFromSearch", () => {
	it("reads both spellings of each state", () => {
		expect(parseOfficeOpenFromSearch("?office=1")).toBe(true);
		expect(parseOfficeOpenFromSearch("?office=true")).toBe(true);
		expect(parseOfficeOpenFromSearch("?office=0")).toBe(false);
		expect(parseOfficeOpenFromSearch("?office=false")).toBe(false);
	});

	it("returns null when the URL says nothing, so the stored preference decides", () => {
		expect(parseOfficeOpenFromSearch("")).toBeNull();
		expect(parseOfficeOpenFromSearch("?office=")).toBeNull();
		expect(parseOfficeOpenFromSearch("?office=maybe")).toBeNull();
		expect(parseOfficeOpenFromSearch("?task=task-123")).toBeNull();
	});
});

describe("buildOfficeUrl", () => {
	it("sets the flag without disturbing the task param or hash", () => {
		expect(
			buildOfficeUrl({
				pathname: "/project-1/plans",
				search: "?task=task-123",
				hash: "#panel",
				isOpen: true,
			}),
		).toBe("/project-1/plans?task=task-123&office=1#panel");
	});

	it("overwrites an existing flag rather than appending a second one", () => {
		expect(
			buildOfficeUrl({
				pathname: "/project-1",
				search: "?office=1",
				hash: "",
				isOpen: false,
			}),
		).toBe("/project-1?office=0");
	});
});
