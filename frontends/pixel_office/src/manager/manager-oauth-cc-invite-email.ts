import type { ClaudeOAuthInviteEmail } from "@/manager/manager-oauth-invite-email";

export interface ClaudeCcOAuthInviteOptions {
	/** Seat email shown in the invite when re-authorizing CC for an existing account. */
	accountEmail?: string;
}

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

function buildCcInvitePlainText(authUrl: string, accountEmail?: string): string {
	const seatLine =
		accountEmail && accountEmail.trim().length > 0
			? [`This authorization is for the seat: ${accountEmail.trim()}`, ""]
			: [];
	return [
		"Hi,",
		"",
		"You've been asked to authorize Claude Code (CC) for our shared PixelOffice account pool.",
		"",
		...seatLine,
		"Why this matters — the ~8 hour refresh token:",
		"Without a CC refresh token, Claude Code credentials expire after about 8 hours and cannot renew automatically.",
		"This CC authorization creates a separate, refresh-capable token so CC sessions keep working without re-signing in every day.",
		"It is independent from the usage token used by the Manager dashboard.",
		"",
		"Open the link below, sign in with your Claude account, and approve access:",
		"",
		authUrl,
		"",
		"After you approve, Anthropic shows an Authentication code screen.",
		"Copy the whole code line (it looks like: xxxxx#yyyyy) and send it back to me.",
		"",
		"Example of what you'll see:",
		"  Authentication code",
		"  Copy this code and send it back to me:",
		"  [ gray box with your code ]",
		"",
		"This link expires in about 10 minutes.",
		"",
		"Thanks!",
	].join("\n");
}

/** Visual mock of Anthropic's post-approval code screen (inline styles for email paste). */
function buildPasteCodeGuidanceHtml(font: string): string {
	const sampleCode = "your-code-here#state-token";
	return [
		`<p style="margin:0 0 12px 0;font-size:14px;font-weight:600;color:#1f2328;">Step 3 — After you approve, Anthropic shows a screen like this:</p>`,
		`<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 20px 0;border:1px solid #e5e7eb;border-radius:16px;background-color:#ffffff;">`,
		`<tr><td style="padding:32px 24px 28px 24px;font-family:${font};text-align:center;">`,
		`<h2 style="margin:0 0 12px 0;font-size:28px;font-weight:700;color:#111827;line-height:1.2;font-family:${font};">Authentication code</h2>`,
		`<p style="margin:0 0 20px 0;font-size:16px;color:#374151;font-family:${font};">Copy this code and send it back to me:</p>`,
		`<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 20px 0;">`,
		`<tr><td style="background-color:#f3f4f6;border-radius:12px;padding:16px 18px;text-align:left;">`,
		`<p style="margin:0;font-family:ui-monospace,'SFMono-Regular',Menlo,Consolas,monospace;font-size:13px;line-height:1.45;color:#111827;word-break:break-all;">${sampleCode}</p>`,
		`</td></tr></table>`,
		`<table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin:0 auto;">`,
		`<tr><td style="border:1px solid #d1d5db;border-radius:10px;padding:10px 16px;font-size:15px;color:#111827;font-family:${font};">`,
		`&#128203;&nbsp; Copy code`,
		`</td></tr></table>`,
		`<p style="margin:16px 0 0 0;font-size:12px;color:#6b7280;font-family:${font};">Yours will be a real code — copy the entire line and reply to this email.</p>`,
		`</td></tr></table>`,
	].join("");
}

function buildCcInviteClipboardHtml(authUrl: string, accountEmail?: string): string {
	const safeUrl = escapeHtml(authUrl);
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
		`<p style="margin:0 0 8px 0;font-size:12px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:#D29922;text-align:center;">PixelOffice · Claude Code</p>`,
		`<h1 style="margin:0 0 16px 0;font-size:22px;font-weight:600;color:#1f2328;text-align:center;line-height:1.3;">Authorize Claude Code (CC)</h1>`,
		`<p style="margin:0 0 16px 0;font-size:15px;color:#24292f;">Hi,</p>`,
		`<p style="margin:0 0 16px 0;font-size:15px;color:#24292f;">You've been asked to authorize <strong style="color:#1f2328;">Claude Code (CC)</strong> for our shared PixelOffice account pool.</p>`,
		seatBlock,
		`<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 20px 0;">`,
		`<tr><td style="background-color:#fff8e6;border-left:4px solid #D29922;border-radius:8px;padding:14px 16px;font-size:14px;color:#424a53;">`,
		`<p style="margin:0 0 8px 0;font-size:14px;font-weight:600;color:#9A6700;">Why this matters — the ~8 hour refresh token</p>`,
		`<p style="margin:0 0 8px 0;font-size:14px;color:#424a53;">Without a CC refresh token, Claude Code credentials expire after about <strong style="color:#1f2328;">8 hours</strong> and cannot renew automatically.</p>`,
		`<p style="margin:0;font-size:14px;color:#424a53;">This CC authorization creates a separate, <strong style="color:#1f2328;">refresh-capable</strong> token so CC sessions keep working without re-signing in every day. It is independent from the usage token used by the Manager dashboard.</p>`,
		`</td></tr></table>`,
		`<table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin:8px auto 20px auto;">`,
		`<tr><td align="center" style="border-radius:8px;background-color:#D29922;">`,
		`<a href="${safeUrl}" target="_blank" style="display:inline-block;background-color:#D29922;color:#ffffff;font-size:15px;font-weight:600;padding:12px 24px;text-decoration:none;border-radius:8px;font-family:${font};">Authorize Claude Code (CC)</a>`,
		`</td></tr></table>`,
		`<p style="margin:0 0 20px 0;font-size:12px;color:#656d76;text-align:center;word-break:break-all;">Or open this link:<br>`,
		`<a href="${safeUrl}" style="color:#D29922;">${safeUrl}</a></p>`,
		`<p style="margin:0 0 10px 0;font-size:14px;font-weight:600;color:#1f2328;">What to do next</p>`,
		`<ol style="margin:0 0 20px 0;padding-left:20px;font-size:14px;color:#424a53;">`,
		`<li style="margin-bottom:8px;">Open the link and sign in with your Claude account.</li>`,
		`<li style="margin-bottom:8px;">Approve access when Anthropic asks.</li>`,
		`<li style="margin-bottom:0;">Copy the authorization code from the screen below and send it back to me.</li>`,
		`</ol>`,
		buildPasteCodeGuidanceHtml(font),
		`<p style="margin:0 0 8px 0;font-size:12px;color:#656d76;">This invite link expires in about 10 minutes.</p>`,
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
<title>Authorize Claude Code (CC) for PixelOffice</title>
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
 */
export function buildClaudeCcOAuthInviteEmail(
	authUrl: string,
	options: ClaudeCcOAuthInviteOptions = {},
): ClaudeOAuthInviteEmail {
	const accountEmail = options.accountEmail?.trim();
	const subject = "Authorize Claude Code (CC) for PixelOffice";
	const body = buildCcInvitePlainText(authUrl, accountEmail);
	const clipboardHtml = buildCcInviteClipboardHtml(authUrl, accountEmail);
	const htmlBody = buildCcInviteHtmlDocument(clipboardHtml);
	const mailto = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
	return { subject, body, htmlBody, clipboardHtml, mailto };
}
