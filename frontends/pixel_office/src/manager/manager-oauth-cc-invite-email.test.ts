import { describe, expect, it } from "vitest";

import { buildClaudeCcOAuthInviteEmail } from "@/manager/manager-oauth-cc-invite-email";

describe("buildClaudeCcOAuthInviteEmail", () => {
	it("includes the 8h refresh-token warning and authorize URL", () => {
		const email = buildClaudeCcOAuthInviteEmail("https://claude.ai/oauth?cc=1");
		expect(email.subject).toContain("Claude Code");
		expect(email.body).toContain("https://claude.ai/oauth?cc=1");
		expect(email.body).toContain("8 hours");
		expect(email.body).toContain("refresh-capable");
		expect(email.clipboardHtml).toContain("8 hours");
		expect(email.clipboardHtml).toContain("Authorize Claude Code (CC)");
		expect(email.clipboardHtml).toContain("Authentication code");
		expect(email.clipboardHtml).toContain('style="');
		expect(email.clipboardHtml).not.toContain("<style");
	});

	it("includes the seat email when provided", () => {
		const email = buildClaudeCcOAuthInviteEmail("https://claude.ai/oauth?cc=1", {
			accountEmail: "dev@example.com",
		});
		expect(email.body).toContain("dev@example.com");
		expect(email.clipboardHtml).toContain("dev@example.com");
	});

	it("escapes HTML in the auth URL", () => {
		const email = buildClaudeCcOAuthInviteEmail('https://claude.ai/oauth?x="1"');
		expect(email.clipboardHtml).toContain("&quot;1&quot;");
		expect(email.clipboardHtml).not.toContain('x="1"');
	});
});
