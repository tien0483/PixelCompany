import {
	buildInviteGreeting,
	buildInviteGreetingHtml,
	type ClaudeOAuthInviteEmail,
} from "@/manager/manager-oauth-invite-email";

export interface ClaudeCcOAuthInviteOptions {
	/** Seat email shown in the invite when re-authorizing CC for an existing account. */
	accountEmail?: string;
	/** Colleague sharing the account — greeted by name when set. */
	senderName?: string;
}

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

function buildCcInvitePlainText(
	formUrl: string,
	accountEmail?: string,
	senderName?: string,
): string {
	const seatLine =
		accountEmail && accountEmail.trim().length > 0
			? [`This authorization is for the seat: ${accountEmail.trim()}`, ""]
			: [];
	return [
		buildInviteGreeting(senderName),
		"",
		"You've been asked to authorize Claude Code (CC) for our shared PIXTiel account pool.",
		"",
		...seatLine,
		"Why this matters — the ~8 hour refresh token:",
		"Without a CC refresh token, Claude Code credentials expire after about 8 hours and cannot renew automatically.",
		"This CC authorization creates a separate, refresh-capable token so CC sessions keep working without re-signing in every day.",
		"It is independent from the usage token used by the Manager dashboard.",
		"",
		"Open the secure form below. On that page you will authorize Claude Code and paste the code into the form.",
		"",
		formUrl,
		"",
		"This form link expires in about 1 hour.",
		"",
		"Thanks!",
	].join("\n");
}

function buildCcInviteClipboardHtml(
	formUrl: string,
	accountEmail?: string,
	senderName?: string,
): string {
	const safeUrl = escapeHtml(formUrl);
	const safeEmail =
		accountEmail && accountEmail.trim().length > 0 ? escapeHtml(accountEmail.trim()) : null;
	const font =
		"-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
	const seatBlock = safeEmail
		? `<p style="margin:0 0 16px 0;font-size:14px;color:#424a53;">This authorization is for the seat: <strong style="color:#1f2328;">${safeEmail}</strong></p>`
		: "";
	return [
		`<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color:#f6f8fa;font-family:${font};margin:0;padding:24px 16px;">`,
		`<tr><td align="center">`,
		`<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="580" style="max-width:580px;width:100%;background-color:#ffffff;border:1px solid #d0d7de;border-radius:12px;">`,
		`<tr><td style="padding:28px;font-family:${font};font-size:15px;line-height:1.55;color:#24292f;">`,
		`<p style="margin:0 0 8px 0;font-size:12px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:#D29922;text-align:center;">PIXTiel · Claude Code</p>`,
		`<h1 style="margin:0 0 16px 0;font-size:22px;font-weight:600;color:#1f2328;text-align:center;line-height:1.3;">Authorize Claude Code (CC)</h1>`,
		`<p style="margin:0 0 16px 0;font-size:15px;color:#24292f;">${buildInviteGreetingHtml(senderName)}</p>`,
		`<p style="margin:0 0 16px 0;font-size:15px;color:#24292f;">You've been asked to authorize <strong style="color:#1f2328;">Claude Code (CC)</strong> for our shared PIXTiel account pool.</p>`,
		seatBlock,
		`<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 20px 0;">`,
		`<tr><td style="background-color:#fff8e6;border-left:4px solid #D29922;border-radius:8px;padding:14px 16px;font-size:14px;color:#424a53;">`,
		`<p style="margin:0 0 8px 0;font-size:14px;font-weight:600;color:#9A6700;">Why this matters — the ~8 hour refresh token</p>`,
		`<p style="margin:0 0 8px 0;font-size:14px;color:#424a53;">Without a CC refresh token, Claude Code credentials expire after about <strong style="color:#1f2328;">8 hours</strong> and cannot renew automatically.</p>`,
		`<p style="margin:0;font-size:14px;color:#424a53;">This CC authorization creates a separate, <strong style="color:#1f2328;">refresh-capable</strong> token so CC sessions keep working without re-signing in every day. It is independent from the usage token used by the Manager dashboard.</p>`,
		`</td></tr></table>`,
		`<table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin:8px auto 20px auto;">`,
		`<tr><td align="center" style="border-radius:8px;background-color:#D29922;">`,
		`<a href="${safeUrl}" target="_blank" style="display:inline-block;background-color:#D29922;color:#ffffff;font-size:15px;font-weight:600;padding:12px 24px;text-decoration:none;border-radius:8px;font-family:${font};">Open Claude Code authorization form</a>`,
		`</td></tr></table>`,
		`<p style="margin:0 0 20px 0;font-size:12px;color:#656d76;text-align:center;word-break:break-all;">Or open this link:<br>`,
		`<a href="${safeUrl}" style="color:#D29922;">${safeUrl}</a></p>`,
		`<p style="margin:0 0 10px 0;font-size:14px;font-weight:600;color:#1f2328;">What to do on the form</p>`,
		`<ol style="margin:0 0 20px 0;padding-left:20px;font-size:14px;color:#424a53;">`,
		`<li style="margin-bottom:8px;">Open the form and click Authorize Claude Code.</li>`,
		`<li style="margin-bottom:8px;">Sign in with your Claude account and approve access.</li>`,
		`<li style="margin-bottom:0;">Paste the authorization code into the form and submit.</li>`,
		`</ol>`,
		`<p style="margin:0 0 8px 0;font-size:12px;color:#656d76;">This form link expires in about 1 hour.</p>`,
		`<p style="margin:0;font-size:15px;color:#24292f;">Thanks!</p>`,
		`</td></tr></table>`,
		`</td></tr></table>`,
	].join("");
}

function buildCcInviteHtmlDocument(fragment: string): string {
	return `<!doctype html>
<html lang="en">
<head>
<meta name="viewport" content="width=device-width" />
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
<title>Authorize Claude Code (CC) for PIXTiel</title>
</head>
<body style="margin:0;padding:0;">
<!--StartFragment-->
${fragment}
<!--EndFragment-->
</body>
</html>`;
}

/**
 * Invite email for CC paste-code OAuth — explains the ~8h refresh-token requirement.
 * `formUrl` is the Vercel authorization form (not the raw Anthropic auth URL).
 */
export function buildClaudeCcOAuthInviteEmail(
	formUrl: string,
	options: ClaudeCcOAuthInviteOptions = {},
): ClaudeOAuthInviteEmail {
	const accountEmail = options.accountEmail?.trim();
	const subject = "Authorize Claude Code (CC) for PIXTiel";
	const body = buildCcInvitePlainText(formUrl, accountEmail, options.senderName);
	const clipboardHtml = buildCcInviteClipboardHtml(
		formUrl,
		accountEmail,
		options.senderName,
	);
	const htmlBody = buildCcInviteHtmlDocument(clipboardHtml);
	const mailto = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
	return { subject, body, htmlBody, clipboardHtml, mailto };
}
