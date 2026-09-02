import { beforeEach, describe, expect, it } from "vitest";
import { migrateStorageKey, migrateStoragePrefix } from "./migrate-storage-key";

describe("migrateStorageKey", () => {
	beforeEach(() => {
		localStorage.clear();
	});

	it("migrates existing old key to new key, removes old key, and returns the value", () => {
		localStorage.setItem("pixeloffice.plans.seat", JSON.stringify({ seatId: 1 }));

		const result = migrateStorageKey("pixeloffice.plans.seat", "pixtiel.plans.seat");

		expect(result).toBe(JSON.stringify({ seatId: 1 }));
		expect(localStorage.getItem("pixtiel.plans.seat")).toBe(JSON.stringify({ seatId: 1 }));
		expect(localStorage.getItem("pixeloffice.plans.seat")).toBeNull();
	});

	it("keeps existing new key if already present and does not clobber it", () => {
		localStorage.setItem("pixeloffice.plans.seat", "old-val");
		localStorage.setItem("pixtiel.plans.seat", "new-val");

		const result = migrateStorageKey("pixeloffice.plans.seat", "pixtiel.plans.seat");

		expect(result).toBe("new-val");
		expect(localStorage.getItem("pixtiel.plans.seat")).toBe("new-val");
	});

	it("returns existing new key when old key is not present", () => {
		localStorage.setItem("pixtiel.plans.seat", "new-val");

		const result = migrateStorageKey("pixeloffice.plans.seat", "pixtiel.plans.seat");

		expect(result).toBe("new-val");
		expect(localStorage.getItem("pixtiel.plans.seat")).toBe("new-val");
	});

	it("returns null when neither key is present", () => {
		const result = migrateStorageKey("pixeloffice.plans.seat", "pixtiel.plans.seat");

		expect(result).toBeNull();
		expect(localStorage.getItem("pixtiel.plans.seat")).toBeNull();
		expect(localStorage.getItem("pixeloffice.plans.seat")).toBeNull();
	});
});

describe("migrateStoragePrefix", () => {
	beforeEach(() => {
		localStorage.clear();
	});

	it("migrates keys matching old prefix to new prefix and removes old keys", () => {
		localStorage.setItem("pixeloffice.review.seat.1", "seat-1-data");
		localStorage.setItem("pixeloffice.review.seat.2", "seat-2-data");
		localStorage.setItem("other.key.name", "other-val");

		migrateStoragePrefix("pixeloffice.review.seat.", "pixtiel.review.seat.");

		expect(localStorage.getItem("pixtiel.review.seat.1")).toBe("seat-1-data");
		expect(localStorage.getItem("pixtiel.review.seat.2")).toBe("seat-2-data");
		expect(localStorage.getItem("pixeloffice.review.seat.1")).toBeNull();
		expect(localStorage.getItem("pixeloffice.review.seat.2")).toBeNull();
		expect(localStorage.getItem("other.key.name")).toBe("other-val");
	});

	it("preserves new prefix key if already present", () => {
		localStorage.setItem("pixeloffice.review.seat.1", "old-data");
		localStorage.setItem("pixtiel.review.seat.1", "existing-new-data");

		migrateStoragePrefix("pixeloffice.review.seat.", "pixtiel.review.seat.");

		expect(localStorage.getItem("pixtiel.review.seat.1")).toBe("existing-new-data");
	});

	it("does nothing when no matching old prefix keys exist", () => {
		localStorage.setItem("unrelated.key", "foo");

		migrateStoragePrefix("pixeloffice.review.seat.", "pixtiel.review.seat.");

		expect(localStorage.getItem("unrelated.key")).toBe("foo");
		expect(localStorage.length).toBe(1);
	});
});
