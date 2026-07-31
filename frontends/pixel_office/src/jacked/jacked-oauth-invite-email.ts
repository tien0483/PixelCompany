export interface ClaudeOAuthInviteEmail {
	subject: string;
	body: string;
	mailto: string;
}

/**
 * Plain-text invite a colleague can follow to authorize Claude for the shared pool.
 * The auth URL uses Anthropic's code-display redirect — they copy the code back to you.
 */
export function buildClaudeOAuthInviteEmail(authUrl: string): ClaudeOAuthInviteEmail {
	const subject = "Authorize your Claude account for PixelOffice";
	const body = [
		"Hi,",
		"",
		"You've been invited to add your Claude account to our shared PixelOffice account pool.",
		"",
		"Open the link below, sign in with your Claude account, and approve access:",
		"",
		authUrl,
		"",
		"After you approve, Anthropic will show an authorization code on screen.",
		"Copy that code and send it back to me so I can finish adding your account.",
		"",
		"This link expires in about 10 minutes.",
		"",
		"Thanks!",
	].join("\n");
	const mailto = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
	return { subject, body, mailto };
}
