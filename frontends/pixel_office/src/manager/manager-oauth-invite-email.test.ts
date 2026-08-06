import { describe, expect, it } from "vitest";

import {
	buildClaudeOAuthInviteEmail,
	buildClaudeReauthInviteEmail,
} from "@/manager/manager-oauth-invite-email";

describe("buildClaudeOAuthInviteEmail", () => {
	it("includes the Vercel form URL and form steps in plain and HTML bodies", () => {
		const formUrl = "https://example.vercel.app/?sessionId=abc";
		const email = buildClaudeOAuthInviteEmail(formUrl);
		expect(email.subject).toContain("Claude");
		expect(email.body).toContain(formUrl);
		expect(email.body).toContain("usage windows");
		expect(email.body).toContain("Paste the authorization code back into the form");
		expect(email.htmlBody).toContain(formUrl);
		expect(email.htmlBody).toContain("Open authorization form");
		expect(email.htmlBody).toContain("<!--StartFragment-->");
		expect(email.clipboardHtml).toContain(formUrl);
		expect(email.clipboardHtml).toContain('style="');
		expect(email.clipboardHtml).not.toContain("<style");
		expect(email.clipboardHtml).toContain("Choose the usage percentage");
		expect(email.clipboardHtml).not.toContain("Authentication code");
		expect(email.mailto).toContain("mailto:");
	});

	it("escapes HTML in the form URL", () => {
		const email = buildClaudeOAuthInviteEmail('https://example.vercel.app/?x="1"');
		expect(email.clipboardHtml).toContain("&quot;1&quot;");
		expect(email.clipboardHtml).not.toContain('x="1"');
	});

	it("greets the sender by name when one is given", () => {
		const formUrl = "https://example.vercel.app/?sessionId=abc";
		expect(buildClaudeOAuthInviteEmail(formUrl).body).toContain("Hi,");
		const named = buildClaudeOAuthInviteEmail(formUrl, {
			senderName: "Alice",
		});
		expect(named.body).toContain("Hi Alice,");
		expect(named.clipboardHtml).toContain("Hi Alice,");
	});

	it("escapes HTML in the sender name", () => {
		const email = buildClaudeOAuthInviteEmail("https://example.vercel.app/", {
			senderName: "<script>x</script>",
		});
		expect(email.clipboardHtml).not.toContain("<script>");
		expect(email.clipboardHtml).toContain("&lt;script&gt;");
	});
});

describe("buildClaudeReauthInviteEmail", () => {
	it("includes form URL and optional seat email", () => {
		const formUrl = "https://example.vercel.app/?sessionId=reauth";
		const email = buildClaudeReauthInviteEmail(formUrl, {
			accountEmail: "dev@example.com",
		});
		expect(email.subject).toContain("Re-authorize");
		expect(email.body).toContain(formUrl);
		expect(email.body).toContain("dev@example.com");
		expect(email.clipboardHtml).toContain("Re-authorize Claude account");
		expect(email.clipboardHtml).toContain("dev@example.com");
	});
});
