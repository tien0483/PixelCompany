import { describe, expect, it } from "vitest";

import { buildClaudeOAuthInviteEmail } from "@/manager/manager-oauth-invite-email";

describe("buildClaudeOAuthInviteEmail", () => {
	it("includes the donate percent and authorize URL", () => {
		const email = buildClaudeOAuthInviteEmail("https://claude.ai/oauth?x=1", {
			donateLimitPercent: 70,
		});
		expect(email.subject).toContain("Claude");
		expect(email.body).toContain("https://claude.ai/oauth?x=1");
		expect(email.body).toContain("70%");
		expect(email.body).toContain("pinned tasks may still use the seat");
		expect(email.mailto).toContain("mailto:");
	});
});
