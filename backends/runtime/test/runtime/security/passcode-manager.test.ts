import { describe, expect, it } from "vitest";

import {
	deleteSession,
	disablePasscode,
	extractSessionTokenFromCookie,
	generatePasscode,
	getSessionSubject,
	isPasscodeEnabled,
	issueSession,
	issueSessionForSubject,
	revokeAndRegeneratePasscode,
	validatePasscode,
	validateSession,
} from "../../../src/security/passcode-manager";

describe("security/passcode-manager session subject extensions", () => {
	it("issues and retrieves session with subject", () => {
		const subject = {
			email: "engineer@company.com",
			name: "Engineer",
			picture: "https://example.com/pic.jpg",
		};

		const token = issueSessionForSubject(subject);
		expect(token).toHaveLength(64);
		expect(validateSession(token)).toBe(true);

		const retrieved = getSessionSubject(token);
		expect(retrieved).toEqual(subject);
	});

	it("returns null subject for anonymous passcode session", () => {
		const token = issueSession();
		expect(validateSession(token)).toBe(true);
		expect(getSessionSubject(token)).toBeNull();
	});

	it("deletes session on logout", () => {
		const token = issueSession();
		expect(validateSession(token)).toBe(true);

		const deleted = deleteSession(token);
		expect(deleted).toBe(true);
		expect(validateSession(token)).toBe(false);
		expect(getSessionSubject(token)).toBeNull();
	});

	it("preserves standard passcode generation, validation, and disable workflows", () => {
		const passcode = generatePasscode();
		expect(isPasscodeEnabled()).toBe(true);
		expect(validatePasscode(passcode)).toBe(true);
		expect(validatePasscode("wrongpasscode")).toBe(false);

		const newPasscode = revokeAndRegeneratePasscode();
		expect(validatePasscode(passcode)).toBe(false);
		expect(validatePasscode(newPasscode)).toBe(true);

		disablePasscode();
		expect(isPasscodeEnabled()).toBe(false);
		expect(validatePasscode(newPasscode)).toBe(false);
	});

	it("extracts session token from cookie header", () => {
		expect(extractSessionTokenFromCookie("kanban_session=abcd1234efgh5678")).toBe("abcd1234efgh5678");
		expect(extractSessionTokenFromCookie("other=1; kanban_session=abcd1234efgh5678; foo=bar")).toBe("abcd1234efgh5678");
		expect(extractSessionTokenFromCookie(undefined)).toBeNull();
		expect(extractSessionTokenFromCookie("other=1")).toBeNull();
	});
});
