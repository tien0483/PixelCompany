import { describe, expect, it } from "vitest";

import { reorderMembersBeforeTarget } from "@/components/chain-member-list";

// The dragged member always lands immediately BEFORE the drop target, regardless of
// drag direction — the historical off-by-one was a downward drag landing AFTER the target.
describe("reorderMembersBeforeTarget", () => {
	const members = ["a", "b", "c", "d"];

	it("downward drag lands the member before the target (not after)", () => {
		expect(reorderMembersBeforeTarget(members, "a", "c")).toEqual(["b", "a", "c", "d"]);
	});

	it("upward drag lands the member before the target", () => {
		expect(reorderMembersBeforeTarget(members, "d", "b")).toEqual(["a", "d", "b", "c"]);
	});

	it("dropping the root onto a later follower demotes the root", () => {
		expect(reorderMembersBeforeTarget(members, "a", "c")).toEqual(["b", "a", "c", "d"]);
	});

	it("dropping onto the immediate next neighbor is a no-op (already before it)", () => {
		// a already sits immediately before b, so dropping a onto b changes nothing.
		expect(reorderMembersBeforeTarget(members, "a", "b")).toBeNull();
	});

	it("dropping onto the last member moves to just before it", () => {
		expect(reorderMembersBeforeTarget(members, "a", "d")).toEqual(["b", "c", "a", "d"]);
	});

	it("returns null when the order is unchanged", () => {
		// b already sits immediately before c, so dropping b onto c is a no-op.
		expect(reorderMembersBeforeTarget(members, "b", "c")).toBeNull();
	});

	it("returns null when source and target are the same", () => {
		expect(reorderMembersBeforeTarget(members, "a", "a")).toBeNull();
	});

	it("returns null when an id is not a member", () => {
		expect(reorderMembersBeforeTarget(members, "a", "z")).toBeNull();
		expect(reorderMembersBeforeTarget(members, "z", "a")).toBeNull();
	});
});
