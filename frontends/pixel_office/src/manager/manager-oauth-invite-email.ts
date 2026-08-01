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
	/** Soft Auto-exclude cap applied when the seat lands (0–100). */
	donateLimitPercent: number;
}

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

function buildInvitePlainText(authUrl: string, donate: number): string {
	return [
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

/**
 * Inline-styled HTML fragment for clipboard paste.
 *
 * Mail clients (Gmail, Outlook) strip `<style>` from clipboard HTML and often
 * ignore full `<!doctype>` documents — only inline-styled table fragments paste
 * as rich content reliably.
 */
function buildInviteClipboardHtml(authUrl: string, donate: number): string {
	const safeUrl = escapeHtml(authUrl);
	const donateLabel = String(donate);
	const font =
		"-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
	return [
		`<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color:#f6f8fa;font-family:${font};margin:0;padding:24px 16px;">`,
		`<tr><td align="center">`,
		`<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="580" style="max-width:580px;width:100%;background-color:#ffffff;border:1px solid #d0d7de;border-radius:12px;">`,
		`<tr><td style="padding:28px;font-family:${font};font-size:15px;line-height:1.55;color:#24292f;">`,
		`<p style="margin:0 0 8px 0;font-size:12px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:#0084FF;text-align:center;">PixelOffice</p>`,
		`<h1 style="margin:0 0 16px 0;font-size:22px;font-weight:600;color:#1f2328;text-align:center;line-height:1.3;">Join our shared Claude account pool</h1>`,
		`<p style="margin:0 0 16px 0;font-size:15px;color:#24292f;">Hi,</p>`,
		`<p style="margin:0 0 16px 0;font-size:15px;color:#24292f;">You've been invited to add your Claude account to our shared PixelOffice account pool.</p>`,
		`<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 20px 0;">`,
		`<tr><td style="background-color:#f6f8fa;border-left:4px solid #0084FF;border-radius:8px;padding:14px 16px;font-size:14px;color:#424a53;">`,
		`Auto tasks will use at most <strong style="color:#1f2328;">${donateLabel}%</strong> of this Claude plan's usage windows (5h / 7d). `,
		`You (or we) can adjust that later in Seats; pinned tasks may still use the seat.`,
		`</td></tr></table>`,
		`<table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin:8px auto 20px auto;">`,
		`<tr><td align="center" style="border-radius:8px;background-color:#0084FF;">`,
		`<a href="${safeUrl}" target="_blank" style="display:inline-block;background-color:#0084FF;color:#ffffff;font-size:15px;font-weight:600;padding:12px 24px;text-decoration:none;border-radius:8px;font-family:${font};">Authorize Claude account</a>`,
		`</td></tr></table>`,
		`<p style="margin:0 0 20px 0;font-size:12px;color:#656d76;text-align:center;word-break:break-all;">Or open this link:<br>`,
		`<a href="${safeUrl}" style="color:#0084FF;">${safeUrl}</a></p>`,
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

function buildInviteHtmlDocument(authUrl: string, donate: number, fragment: string): string {
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
 * Returns plain text, HTML, and a mailto fallback.
 */
export function buildClaudeOAuthInviteEmail(
	authUrl: string,
	options: ClaudeOAuthInviteOptions,
): ClaudeOAuthInviteEmail {
	const donate = Math.max(0, Math.min(100, Math.round(options.donateLimitPercent)));
	const subject = "Authorize your Claude account for PixelOffice";
	const body = buildInvitePlainText(authUrl, donate);
	const clipboardHtml = buildInviteClipboardHtml(authUrl, donate);
	const htmlBody = buildInviteHtmlDocument(authUrl, donate, clipboardHtml);
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
