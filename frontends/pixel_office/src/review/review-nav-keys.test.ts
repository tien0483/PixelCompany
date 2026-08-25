import { describe, expect, it } from "vitest";

import { isTypingTarget, resolveNavKey } from "@/review/review-nav-keys";

function press(
	key: string,
	overrides: { ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; isTypingTarget?: boolean } = {},
) {
	return resolveNavKey({
		key,
		ctrlKey: overrides.ctrlKey ?? false,
		metaKey: overrides.metaKey ?? false,
		altKey: overrides.altKey ?? false,
		isTypingTarget: overrides.isTypingTarget ?? false,
	});
}

describe("resolveNavKey", () => {
	it("maps the bracket pair", () => {
		expect(press("]")).toBe("next");
		expect(press("[")).toBe("previous");
	});

	it("maps the shifted j/k pair, leaving the lowercase keys free", () => {
		expect(press("J")).toBe("next");
		expect(press("K")).toBe("previous");
		expect(press("j")).toBeNull();
		expect(press("k")).toBeNull();
	});

	it("ignores a keystroke that belongs to the browser or the OS", () => {
		expect(press("]", { ctrlKey: true })).toBeNull();
		expect(press("]", { metaKey: true })).toBeNull();
		expect(press("[", { altKey: true })).toBeNull();
	});

	it("ignores a keystroke that is text being typed", () => {
		expect(press("]", { isTypingTarget: true })).toBeNull();
		expect(press("J", { isTypingTarget: true })).toBeNull();
	});

	it("ignores every other key", () => {
		for (const key of ["Enter", "ArrowDown", "PageDown", " ", "a", "}"]) {
			expect(press(key)).toBeNull();
		}
	});
});

describe("isTypingTarget", () => {
	it("recognizes the fields where the keys are literal text", () => {
		expect(isTypingTarget(document.createElement("input"))).toBe(true);
		expect(isTypingTarget(document.createElement("textarea"))).toBe(true);

		// The attribute, not the `contentEditable` property: jsdom implements neither it nor
		// `isContentEditable`, and the attribute is what React and ProseMirror actually render.
		const editable = document.createElement("div");
		editable.setAttribute("contenteditable", "true");
		expect(isTypingTarget(editable)).toBe(true);

		const insideEditable = document.createElement("span");
		editable.appendChild(insideEditable);
		expect(isTypingTarget(insideEditable)).toBe(true);
	});

	it("treats anything else, and nothing at all, as a command target", () => {
		expect(isTypingTarget(document.createElement("div"))).toBe(false);
		expect(isTypingTarget(document.createElement("button"))).toBe(false);
		expect(isTypingTarget(null)).toBe(false);
	});
});
