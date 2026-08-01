import { describe, expect, it } from "vitest";

import { buildClaudeOAuthInviteEmail } from "@/manager/manager-oauth-invite-email";

describe("buildClaudeOAuthInviteEmail", () => {
	it("includes the donate percent and authorize URL in plain and HTML bodies", () => {
		const email = buildClaudeOAuthInviteEmail("https://claude.ai/oauth?x=1", {
			donateLimitPercent: 70,
		});
		expect(email.subject).toContain("Claude");
		expect(email.body).toContain("https://claude.ai/oauth?x=1");
		expect(email.body).toContain("70%");
		expect(email.body).toContain("pinned tasks may still use the seat");
		expect(email.htmlBody).toContain("https://claude.ai/oauth?x=1");
		expect(email.htmlBody).toContain("70%");
		expect(email.htmlBody).toContain("Authorize Claude account");
		expect(email.htmlBody).toContain("<!--StartFragment-->");
		expect(email.clipboardHtml).toContain("https://claude.ai/oauth?x=1");
		expect(email.clipboardHtml).toContain("70%");
		expect(email.clipboardHtml).toContain('style="');
		expect(email.clipboardHtml).not.toContain("<style");
		expect(email.clipboardHtml).toContain("Authentication code");
		expect(email.mailto).toContain("mailto:");
	});

	it("escapes HTML in the auth URL", () => {
		const email = buildClaudeOAuthInviteEmail('https://claude.ai/oauth?x="1"', {
			donateLimitPercent: 50,
		});
		expect(email.clipboardHtml).toContain("&quot;1&quot;");
		expect(email.clipboardHtml).not.toContain('x="1"');
	});
});
