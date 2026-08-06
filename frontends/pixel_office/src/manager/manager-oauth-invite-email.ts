export interface ClaudeOAuthInviteEmail {
	subject: string;
	/** Plain-text fallback for mail clients and clipboard. */
	body: string;
	/** Full HTML document (reference / download). */
	htmlBody: string;
	/** Inline-styled fragment for rich clipboard paste into mail clients. */
	clipboardHtml: string;
	mailto: string;
}

export interface ClaudeOAuthInviteOptions {
	/** Seat email shown in the invite when re-authorizing an existing account. */
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

/** `Hi Alice,` when the operator named the sender, plain `Hi,` otherwise. */
export function buildInviteGreeting(senderName?: string): string {
	const trimmed = senderName?.trim() ?? "";
	return trimmed.length > 0 ? `Hi ${trimmed},` : "Hi,";
}

/** HTML-escaped greeting for the clipboard fragments. */
export function buildInviteGreetingHtml(senderName?: string): string {
	return escapeHtml(buildInviteGreeting(senderName));
}

function buildInvitePlainText(formUrl: string, senderName?: string): string {
	return [
		buildInviteGreeting(senderName),
		"",
		"You've been invited to add your Claude account to our shared PixelOffice account pool.",
		"",
		"Open the secure form below. On that page you will:",
		"  1. Choose how much of this Claude plan's usage windows (5h / 7d) auto tasks may use.",
		"  2. Click Authorize to sign in with your Claude account and approve access.",
		"  3. Paste the authorization code back into the form and submit.",
		"",
		formUrl,
		"",
		"This form link expires in about 1 hour.",
		"",
		"Thanks!",
	].join("\n");
}

/**
 * Inline-styled HTML fragment for clipboard paste.
 *
 * Mail clients (Gmail, Outlook) strip `<style>` from clipboard HTML and often
 * ignore full `<!doctype>` documents — only inline-styled table fragments paste
 * as rich content reliably.
 */
function buildInviteClipboardHtml(formUrl: string, senderName?: string): string {
	const safeUrl = escapeHtml(formUrl);
	const greeting = buildInviteGreetingHtml(senderName);
	const font =
		"-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
	return [
		`<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color:#f6f8fa;font-family:${font};margin:0;padding:24px 16px;">`,
		`<tr><td align="center">`,
		`<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="580" style="max-width:580px;width:100%;background-color:#ffffff;border:1px solid #d0d7de;border-radius:12px;">`,
		`<tr><td style="padding:28px;font-family:${font};font-size:15px;line-height:1.55;color:#24292f;">`,
		`<p style="margin:0 0 8px 0;font-size:12px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:#0084FF;text-align:center;">PixelOffice</p>`,
		`<h1 style="margin:0 0 16px 0;font-size:22px;font-weight:600;color:#1f2328;text-align:center;line-height:1.3;">Join our shared Claude account pool</h1>`,
		`<p style="margin:0 0 16px 0;font-size:15px;color:#24292f;">${greeting}</p>`,
		`<p style="margin:0 0 16px 0;font-size:15px;color:#24292f;">You've been invited to add your Claude account to our shared PixelOffice account pool.</p>`,
		`<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 20px 0;">`,
		`<tr><td style="background-color:#f6f8fa;border-left:4px solid #0084FF;border-radius:8px;padding:14px 16px;font-size:14px;color:#424a53;">`,
		`On the form you will choose a usage share for auto tasks (5h / 7d windows), authorize your Claude account, and paste the code there. `,
		`Pinned tasks may still use the seat.`,
		`</td></tr></table>`,
		`<table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin:8px auto 20px auto;">`,
		`<tr><td align="center" style="border-radius:8px;background-color:#0084FF;">`,
		`<a href="${safeUrl}" target="_blank" style="display:inline-block;background-color:#0084FF;color:#ffffff;font-size:15px;font-weight:600;padding:12px 24px;text-decoration:none;border-radius:8px;font-family:${font};">Open authorization form</a>`,
		`</td></tr></table>`,
		`<p style="margin:0 0 20px 0;font-size:12px;color:#656d76;text-align:center;word-break:break-all;">Or open this link:<br>`,
		`<a href="${safeUrl}" style="color:#0084FF;">${safeUrl}</a></p>`,
		`<p style="margin:0 0 10px 0;font-size:14px;font-weight:600;color:#1f2328;">What to do on the form</p>`,
		`<ol style="margin:0 0 20px 0;padding-left:20px;font-size:14px;color:#424a53;">`,
		`<li style="margin-bottom:8px;">Choose the usage percentage auto tasks may use.</li>`,
		`<li style="margin-bottom:8px;">Click Authorize, sign in with your Claude account, and approve access.</li>`,
		`<li style="margin-bottom:0;">Paste the authorization code into the form and submit.</li>`,
		`</ol>`,
		`<p style="margin:0 0 8px 0;font-size:12px;color:#656d76;">This form link expires in about 1 hour.</p>`,
		`<p style="margin:0;font-size:15px;color:#24292f;">Thanks!</p>`,
		`</td></tr></table>`,
		`</td></tr></table>`,
	].join("");
}

function buildInviteHtmlDocument(fragment: string): string {
	return `<!doctype html>
<html lang="en">
<head>
<meta name="viewport" content="width=device-width" />
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
<title>Authorize Claude for PixelOffice</title>
</head>
<body style="margin:0;padding:0;">
<!--StartFragment-->
${fragment}
<!--EndFragment-->
</body>
</html>`;
}

/** Wrap fragment in the Windows CF_HTML envelope Outlook desktop expects. */
function buildCfHtmlEnvelope(fragment: string): string {
	const startMarker = "<!--StartFragment-->";
	const endMarker = "<!--EndFragment-->";
	const html =
		'<html><head><meta http-equiv="Content-Type" content="text/html; charset=utf-8"></head><body>' +
		startMarker +
		fragment +
		endMarker +
		"</body></html>";
	const headerPlaceholder =
		"Version:0.9\r\n" +
		"StartHTML:0000000000\r\n" +
		"EndHTML:0000000000\r\n" +
		"StartFragment:0000000000\r\n" +
		"EndFragment:0000000000\r\n";
	const startHtml = headerPlaceholder.length;
	const startFragment = startHtml + html.indexOf(startMarker) + startMarker.length;
	const endFragment = startHtml + html.indexOf(endMarker);
	const endHtml = startHtml + html.length;
	const header =
		"Version:0.9\r\n" +
		`StartHTML:${String(startHtml).padStart(10, "0")}\r\n` +
		`EndHTML:${String(endHtml).padStart(10, "0")}\r\n` +
		`StartFragment:${String(startFragment).padStart(10, "0")}\r\n` +
		`EndFragment:${String(endFragment).padStart(10, "0")}\r\n`;
	return header + html;
}

/**
 * Invite a colleague to authorize Claude for the shared pool (paste-code OAuth).
 * `formUrl` is the Vercel authorization form (not the raw Anthropic auth URL).
 */
export function buildClaudeOAuthInviteEmail(
	formUrl: string,
	options: ClaudeOAuthInviteOptions = {},
): ClaudeOAuthInviteEmail {
	const subject = "Authorize your Claude account for PixelOffice";
	const body = buildInvitePlainText(formUrl, options.senderName);
	const clipboardHtml = buildInviteClipboardHtml(formUrl, options.senderName);
	const htmlBody = buildInviteHtmlDocument(clipboardHtml);
	const mailto = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
	return { subject, body, htmlBody, clipboardHtml, mailto };
}

/**
 * Re-authorize an existing Claude seat via the Vercel form.
 */
export function buildClaudeReauthInviteEmail(
	formUrl: string,
	options: ClaudeOAuthInviteOptions = {},
): ClaudeOAuthInviteEmail {
	const accountEmail = options.accountEmail?.trim();
	const seatLine =
		accountEmail && accountEmail.length > 0
			? [`This re-authorization is for the seat: ${accountEmail}`, ""]
			: [];
	const subject = "Re-authorize your Claude account for PixelOffice";
	const body = [
		buildInviteGreeting(options.senderName),
		"",
		"You've been asked to re-authorize a Claude account in our shared PixelOffice pool.",
		"",
		...seatLine,
		"Open the secure form below. On that page you will authorize with Claude and paste the code into the form.",
		"",
		formUrl,
		"",
		"This form link expires in about 1 hour.",
		"",
		"Thanks!",
	].join("\n");
	const safeUrl = escapeHtml(formUrl);
	const safeEmail =
		accountEmail && accountEmail.length > 0 ? escapeHtml(accountEmail) : null;
	const font =
		"-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
	const seatBlock = safeEmail
		? `<p style="margin:0 0 16px 0;font-size:14px;color:#424a53;">This re-authorization is for the seat: <strong style="color:#1f2328;">${safeEmail}</strong></p>`
		: "";
	const clipboardHtml = [
		`<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color:#f6f8fa;font-family:${font};margin:0;padding:24px 16px;">`,
		`<tr><td align="center">`,
		`<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="580" style="max-width:580px;width:100%;background-color:#ffffff;border:1px solid #d0d7de;border-radius:12px;">`,
		`<tr><td style="padding:28px;font-family:${font};font-size:15px;line-height:1.55;color:#24292f;">`,
		`<p style="margin:0 0 8px 0;font-size:12px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:#0084FF;text-align:center;">PixelOffice</p>`,
		`<h1 style="margin:0 0 16px 0;font-size:22px;font-weight:600;color:#1f2328;text-align:center;line-height:1.3;">Re-authorize Claude account</h1>`,
		`<p style="margin:0 0 16px 0;font-size:15px;color:#24292f;">${buildInviteGreetingHtml(options.senderName)}</p>`,
		`<p style="margin:0 0 16px 0;font-size:15px;color:#24292f;">You've been asked to re-authorize a Claude account in our shared PixelOffice pool.</p>`,
		seatBlock,
		`<table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin:8px auto 20px auto;">`,
		`<tr><td align="center" style="border-radius:8px;background-color:#0084FF;">`,
		`<a href="${safeUrl}" target="_blank" style="display:inline-block;background-color:#0084FF;color:#ffffff;font-size:15px;font-weight:600;padding:12px 24px;text-decoration:none;border-radius:8px;font-family:${font};">Open authorization form</a>`,
		`</td></tr></table>`,
		`<p style="margin:0 0 20px 0;font-size:12px;color:#656d76;text-align:center;word-break:break-all;">Or open this link:<br>`,
		`<a href="${safeUrl}" style="color:#0084FF;">${safeUrl}</a></p>`,
		`<p style="margin:0 0 8px 0;font-size:12px;color:#656d76;">This form link expires in about 1 hour.</p>`,
		`<p style="margin:0;font-size:15px;color:#24292f;">Thanks!</p>`,
		`</td></tr></table>`,
		`</td></tr></table>`,
	].join("");
	const htmlBody = buildInviteHtmlDocument(clipboardHtml);
	const mailto = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
	return { subject, body, htmlBody, clipboardHtml, mailto };
}

/**
 * Copy rich HTML for paste into Gmail / Outlook compose.
 *
 * Injects text/html via a `copy` event handler — the most reliable path for
 * rich paste across browsers and Electron webviews.
 */
export async function copyClaudeOAuthInviteEmail(email: ClaudeOAuthInviteEmail): Promise<void> {
	if (copyViaCopyEvent(email.clipboardHtml, email.body)) {
		return;
	}
	if (await copyViaClipboardApi(email)) {
		return;
	}
	await navigator.clipboard.writeText(email.body);
}

/**
 * Select inline HTML in a hidden host, then copy with explicit text/html payload.
 */
function copyViaCopyEvent(htmlFragment: string, plain: string): boolean {
	if (typeof document === "undefined" || !document.body) {
		return false;
	}
	const htmlPayload =
		'<html><head><meta charset="utf-8"></head><body>' +
		"<!--StartFragment-->" +
		htmlFragment +
		"<!--EndFragment--></body></html>";

	const host = document.createElement("div");
	host.setAttribute("contenteditable", "true");
	host.innerHTML = htmlFragment;
	host.style.position = "fixed";
	host.style.left = "0";
	host.style.top = "0";
	host.style.width = "1px";
	host.style.height = "1px";
	host.style.overflow = "hidden";
	host.style.opacity = "0";
	host.style.pointerEvents = "none";
	document.body.appendChild(host);
	host.focus();

	const selection = window.getSelection();
	const range = document.createRange();
	range.selectNodeContents(host);
	selection?.removeAllRanges();
	selection?.addRange(range);

	let copied = false;
	const onCopy = (event: ClipboardEvent) => {
		event.preventDefault();
		event.clipboardData?.setData("text/html", htmlPayload);
		event.clipboardData?.setData("text/plain", plain);
		copied = true;
	};
	document.addEventListener("copy", onCopy);
	try {
		document.execCommand("copy");
	} catch {
		copied = false;
	} finally {
		document.removeEventListener("copy", onCopy);
		selection?.removeAllRanges();
		document.body.removeChild(host);
	}
	return copied;
}

async function copyViaClipboardApi(email: ClaudeOAuthInviteEmail): Promise<boolean> {
	if (typeof ClipboardItem === "undefined" || typeof navigator.clipboard.write !== "function") {
		return false;
	}
	const cfHtml = buildCfHtmlEnvelope(email.clipboardHtml);
	try {
		await navigator.clipboard.write([
			new ClipboardItem({
				"text/html": new Blob([cfHtml], { type: "text/html" }),
				"text/plain": new Blob([email.body], { type: "text/plain" }),
			}),
		]);
		return true;
	} catch {
		return false;
	}
}
