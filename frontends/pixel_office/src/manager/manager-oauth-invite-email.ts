export interface ClaudeOAuthInviteEmail {
	subject: string;
	body: string;
	mailto: string;
}

export interface ClaudeOAuthInviteOptions {
	/** Soft Auto-exclude cap applied when the seat lands (0–100). */
	donateLimitPercent: number;
}

/**
 * Plain-text invite a colleague can follow to authorize Claude for the shared pool.
 * The auth URL uses Anthropic's code-display redirect — they copy the code back to you.
 */
export function buildClaudeOAuthInviteEmail(
	authUrl: string,
	options: ClaudeOAuthInviteOptions,
): ClaudeOAuthInviteEmail {
	const donate = Math.max(0, Math.min(100, Math.round(options.donateLimitPercent)));
	const subject = "Authorize your Claude account for PixelOffice";
	const body = [
		"Hi,",
		"",
		"You've been invited to add your Claude account to our shared PixelOffice account pool.",
		"",
		`Auto tasks will use at most ${String(donate)}% of this Claude plan's usage windows (5h / 7d).`,
		"You (or we) can raise or lower that later in Seats; pinned tasks may still use the seat.",
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
