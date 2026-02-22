import { getBaseAppUrlForEmail } from "../api_routes/utils/url.js";

const html = String.raw;

const BRAND_NAME = "parascene";
const BRAND_COLOR = "#0f172a";
const ACCENT_COLOR = "#7c3aed";

function escapeHtml(value) {
	return String(value ?? "")
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

function renderImpersonationBar({ originalRecipient, reason } = {}) {
	if (!originalRecipient) return "";
	const safeName = escapeHtml(originalRecipient?.name || "Unknown");
	const safeEmail = escapeHtml(originalRecipient?.email || "unknown");
	const safeUserId = escapeHtml(
		Number.isFinite(Number(originalRecipient?.userId)) ? Number(originalRecipient.userId) : "unknown"
	);
	const safeReason = escapeHtml(reason || "Suppressed recipient");

	return html`
	<tr>
		<td
			style="background:#fff7ed; border-bottom:1px solid #ea580c; padding:12px 24px; text-align:left; font-family:Arial, Helvetica, sans-serif;">
			<div
				style="color:#9a3412; font-size:12px; font-weight:600; text-transform:uppercase; letter-spacing:0.5px; margin:0 0 6px; font-family:Arial, Helvetica, sans-serif;">
				Delegated delivery
			</div>
			<div style="color:#7c2d12; font-size:13px; line-height:1.6; font-family:Arial, Helvetica, sans-serif;">
				<div><strong>Original recipient</strong>: ${safeName} (${safeEmail})</div>
				<div><strong>User ID</strong>: ${safeUserId}</div>
				<div><strong>Reason</strong>: ${safeReason}</div>
			</div>
		</td>
	</tr>
  `;
}

// Base email layout function
// ctaText: Text for the call-to-action button (e.g., "Visit Us", "View the creation")
// ctaUrl: Full URL for the CTA link (default getBaseAppUrlForEmail(); or pass e.g. getBaseAppUrlForEmail() + "/creations/123")
//         Defaults to base URL (homepage) if not provided
function baseEmailLayout({ preheader, title, bodyHtml, ctaText, ctaUrl = getBaseAppUrlForEmail(), footerText, topNotice, suppressCta = false }) {
	const safePreheader = escapeHtml(preheader || "");
	const safeTitle = escapeHtml(title || "");
	const safeFooter = escapeHtml(footerText || `© ${new Date().getFullYear()} ${BRAND_NAME}. All rights reserved.`);
	const ctaBlock = (!suppressCta && ctaText)
		? html`
	<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px auto 12px;">
		<tr>
			<td
				style="background-color:#7c3aed; border-radius:18px; text-align:center; font-family:Arial, Helvetica, sans-serif;">
				<a href="${ctaUrl}"
					style="display:inline-block; background-color:#7c3aed; color:#ffffff; text-decoration:none; padding:14px 28px; font-weight:600; font-size:16px; letter-spacing:0.2px; min-width:240px; border-radius:18px; font-family:Arial, Helvetica, sans-serif;">
					${escapeHtml(ctaText)}
				</a>
			</td>
		</tr>
	</table>
    `
		: "";

	const emailNotice =
		topNotice?.type === "impersonation" ?
			`<table role="presentation" cellpadding="0" cellspacing="0" width="100%">
				${renderImpersonationBar(topNotice.data)}
			</table>`
			: "";

	return html`
<!DOCTYPE html>
<html lang="en">

<head>
	<meta charset="utf-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1" />
	<title>${safeTitle}</title>
</head>

<body style="margin:0; padding:0; background:#f5f7fb; font-family:Arial, Helvetica, sans-serif;">
	<div style="display:none; max-height:0; overflow:hidden; opacity:0; color:transparent;">
		${safePreheader}
	</div>
	${emailNotice}
	<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f5f7fb; padding:24px 0;">
		<tr>
			<td align="center">
				<table role="presentation" cellpadding="0" cellspacing="0" width="600"
					style="margin:0 auto; font-family:Arial, Helvetica, sans-serif;">
					<tr>
						<td style="padding:0 0 16px 0; padding-left:24px; text-align:left; font-size:0;">
							<span
								style="color:#2b303a; font-style:italic; font-weight:700; font-size:30px; letter-spacing:-0.02em; font-family:Arial, Helvetica, sans-serif;">par</span>
							<span
								style="color:#6b7484; font-style:italic; font-weight:700; font-size:30px; letter-spacing:-0.02em; font-family:Arial, Helvetica, sans-serif;">asc</span>
							<span
								style="color:#2b303a; font-style:italic; font-weight:700; font-size:30px; letter-spacing:-0.02em; font-family:Arial, Helvetica, sans-serif;">ene</span>
						</td>
					</tr>
					<tr>
						<td>
							<table role="presentation" cellpadding="0" cellspacing="0" width="100%"
								style="background:#ffffff; border-radius:12px; overflow:hidden; box-shadow:0 10px 30px rgba(15, 23, 42, 0.08); font-family:Arial, Helvetica, sans-serif;">
								<tr>
									<td style="padding:32px; font-family:Arial, Helvetica, sans-serif;">
										<h1
											style="margin:0 0 16px; color:xxxxxxxxxxxxxx; font-size:24px; line-height:1.3; font-family:Arial, Helvetica, sans-serif;">
											${safeTitle}
										</h1>
										<div
											style="color:#334155; font-size:15px; line-height:1.7; font-family:Arial, Helvetica, sans-serif;">
											${bodyHtml}
										</div>
										${ctaBlock}
									</td>
								</tr>
								<tr>
									<td
										style="padding:20px 32px; background:#f8fafc; color:#64748b; font-size:12px; line-height:1.6; text-align:center; font-family:Arial, Helvetica, sans-serif;">
										${safeFooter}
									</td>
								</tr>
							</table>
						</td>
					</tr>
				</table>
			</td>
		</tr>
	</table>
</body>

</html>
  `.trim();
}

export function renderHelloFromParascene({ recipientName = "there" } = {}) {
	const safeName = escapeHtml(recipientName);
	const subject = "Hello from parascene";
	const preheader = "A quick hello from the parascene team.";
	const bodyHtml = html`
	<p style="margin:0 0 12px;">Hi ${safeName},</p>
	<p style="margin:0 0 12px;">
		Thanks for being part of parascene. We’re building a place to turn prompts into
		creations that feel cinematic and personal.
	</p>
	<p style="margin:0 0 12px;">
		If you want a quick walkthrough or dive straight into creation, we've got you covered.
		We’re always here if you need a hand.
	</p>
	<p style="margin:0;">Warmly,<br />The parascene team</p>
  `;
	const emailHtml = baseEmailLayout({
		preheader,
		title: subject,
		bodyHtml,
		ctaText: "Visit Us",
		ctaUrl: getBaseAppUrlForEmail(),
		footerText: "You’re receiving this email because you’re connected to parascene."
	});
	const text = [
		`Hi ${recipientName},`,
		"",
		"Thanks for being part of parascene. We’re building a place to turn prompts into creations that feel cinematic and personal.",
		"",
		"If you want a quick walkthrough or dive straight into creation, we've got you covered.",
		"",
		"Warmly,",
		"The parascene team"
	].join("\n");

	return { subject, html: emailHtml, text };
}

export function renderPasswordReset({ recipientName = "there", resetUrl = "" } = {}) {
	const safeName = escapeHtml(recipientName);
	const subject = "Reset your parascene password";
	const preheader = "Use the link below to set a new password for your parascene account.";
	const bodyHtml = html`
	<p style="margin:0 0 12px; font-family:Arial, Helvetica, sans-serif;">Hi ${safeName},</p>
	<p style="margin:0 0 12px; font-family:Arial, Helvetica, sans-serif;">
		We received a request to reset your password. Click the button below to choose a new password.
	</p>
	<p style="margin:0 0 12px; font-family:Arial, Helvetica, sans-serif;">
		If you didn't request this, you can safely ignore this email. The link will expire in 1 hour.
	</p>
  `;
	const emailHtml = baseEmailLayout({
		preheader,
		title: subject,
		bodyHtml,
		ctaText: "Reset password",
		ctaUrl: resetUrl,
		footerText: "You're receiving this email because a password reset was requested for your parascene account."
	});
	const text = [
		`Hi ${recipientName},`,
		"",
		"We received a request to reset your password. Use the link below to choose a new password:",
		"",
		resetUrl,
		"",
		"If you didn't request this, you can safely ignore this email. The link will expire in 1 hour."
	].join("\n");

	return { subject, html: emailHtml, text };
}

function truncateMiddle(value, max = 240) {
	const s = String(value ?? "");
	if (s.length <= max) return s;
	const keepStart = Math.max(0, Math.floor(max * 0.7));
	const keepEnd = Math.max(0, max - keepStart - 1);
	return `${s.slice(0, keepStart)}…${s.slice(s.length - keepEnd)}`;
}

// Render comment received email template
// creationUrl: Full URL to the specific creation (e.g. getBaseAppUrlForEmail() + "/creations/123")
//              Defaults to base URL (homepage) if not provided
export function renderCommentReceived({
	recipientName = "there",
	commenterName = "Someone",
	commentText = "",
	creationTitle = "",
	creationUrl = getBaseAppUrlForEmail(), // Full URL to creation, falls back to homepage if not provided
	impersonation = null
} = {}) {
	const safeRecipient = escapeHtml(recipientName);
	const safeCommenter = escapeHtml(commenterName);
	const safeTitle = escapeHtml(creationTitle || "your creation");
	const safeComment = escapeHtml(truncateMiddle(commentText, 600));

	const subject = `New comment on ${creationTitle ? creationTitle : "your creation"}`;
	const preheader = `${commenterName || "Someone"} left a comment on ${creationTitle ? creationTitle : "your creation"}.`;

	const bodyHtml = html`
	<p style="margin:0 0 12px; font-family:Arial, Helvetica, sans-serif;">Hi ${safeRecipient},</p>
	<p style="margin:0 0 12px; font-family:Arial, Helvetica, sans-serif;">
		<strong>${safeCommenter}</strong> commented on <strong>${safeTitle}</strong>.
	</p>
	<div
		style="margin:16px 0 0; padding:14px 16px; border:1px solid #e2e8f0; border-radius:12px; background:#f8fafc; font-family:Arial, Helvetica, sans-serif;">
		<div style="color:#475569; font-size:13px; margin:0 0 6px; font-family:Arial, Helvetica, sans-serif;">Comment</div>
		<div style="color:#0f172a; font-size:15px; line-height:1.6; font-family:Arial, Helvetica, sans-serif;">
			${safeComment}</div>
	</div>
  `;

	const emailHtml = baseEmailLayout({
		preheader,
		title: "You got a comment",
		bodyHtml,
		topNotice: impersonation ? { type: "impersonation", data: impersonation } : null,
		ctaText: "View the creation",
		ctaUrl: creationUrl,
		footerText: "You’re receiving this email because someone commented on your creation."
	});

	const impersonationText = impersonation?.originalRecipient
		? [
			"",
			"--- Delegated delivery ---",
			`Original recipient: ${impersonation.originalRecipient?.name || "Unknown"} (${impersonation.originalRecipient?.email || "unknown"})`,
			`User ID: ${Number.isFinite(Number(impersonation.originalRecipient?.userId))
				? Number(impersonation.originalRecipient.userId)
				: "unknown"
			}`,
			`Reason: ${impersonation.reason || "Suppressed recipient"}`,
			"---"
		].join("\n")
		: "";

	const textLines = [];

	if (impersonationText) {
		textLines.push(impersonationText, "");
	}

	textLines.push(
		`Hi ${recipientName},`,
		"",
		`${commenterName} commented on ${creationTitle || "your creation"}:`,
		"",
		truncateMiddle(commentText, 1200),
		"",
		`View the creation: ${creationUrl}`
	);

	const text = textLines.join("\n");

	return { subject, html: emailHtml, text };
}

export function renderFeatureRequest({
	requesterName = "Someone",
	requesterEmail = "",
	requesterUserId = null,
	requesterUserName = "",
	requesterDisplayName = "",
	requesterRole = "",
	requesterCreatedAt = null,
	message = "",
	userAgent = "",
	acceptLanguage = "",
	referer = "",
	forwardedFor = "",
	ip = "",
	ips = [],
	context = null,
	submittedAt = null
} = {}) {
	const safeRequesterName = escapeHtml(requesterName || "Someone");
	const safeRequesterEmail = escapeHtml(requesterEmail || "unknown");
	const safeUserId = escapeHtml(
		Number.isFinite(Number(requesterUserId)) ? Number(requesterUserId) : "unknown"
	);
	const safeUserName = escapeHtml(requesterUserName || "");
	const safeDisplayName = escapeHtml(requesterDisplayName || "");
	const safeRole = escapeHtml(requesterRole || "");
	const safeUserCreatedAt = escapeHtml(requesterCreatedAt || "");
	const safeMessage = escapeHtml(truncateMiddle(message, 4000));
	const safeUserAgent = escapeHtml(truncateMiddle(userAgent, 280));
	const safeAcceptLanguage = escapeHtml(truncateMiddle(acceptLanguage, 280));
	const safeReferer = escapeHtml(truncateMiddle(referer, 800));
	const safeForwardedFor = escapeHtml(truncateMiddle(forwardedFor, 500));
	const safeIp = escapeHtml(ip || "");
	const safeIps = escapeHtml(Array.isArray(ips) ? ips.filter(Boolean).join(", ") : "");
	const ctx = context && typeof context === "object" ? context : null;
	const safeCtxRoute = escapeHtml(String(ctx?.route || ""));
	const safeCtxTimezone = escapeHtml(String(ctx?.timezone || ""));
	const safeCtxLocale = escapeHtml(String(ctx?.locale || ""));
	const safeCtxPlatform = escapeHtml(String(ctx?.platform || ""));
	const safeCtxColorScheme = escapeHtml(String(ctx?.colorScheme || ""));
	const safeCtxReducedMotion = escapeHtml(String(ctx?.reducedMotion || ""));
	const safeCtxNetwork = escapeHtml(String(ctx?.network || ""));
	const safeCtxViewport = escapeHtml(
		(ctx?.viewportWidth && ctx?.viewportHeight) ? `${ctx.viewportWidth}×${ctx.viewportHeight}` : ""
	);
	const safeCtxScreen = escapeHtml(
		(ctx?.screenWidth && ctx?.screenHeight) ? `${ctx.screenWidth}×${ctx.screenHeight}` : ""
	);
	const safeCtxDpr = escapeHtml(Number.isFinite(Number(ctx?.devicePixelRatio)) ? String(ctx.devicePixelRatio) : "");
	const timestamp = submittedAt ? new Date(submittedAt) : new Date();
	const safeWhen = escapeHtml(timestamp.toISOString());

	const summary = String(message || "")
		.split("\n")
		.map((line) => line.trim())
		.find(Boolean) || "New request";
	const subject = `Feature request: ${truncateMiddle(summary, 80)}`;
	const preheader = `${requesterName || "Someone"} submitted a feature request.`;

	const bodyHtml = html`
		<div
			style="margin:0 0 14px; padding:14px 16px; border:1px solid #e2e8f0; border-radius:12px; background:#ffffff; font-family:Arial, Helvetica, sans-serif;">
			<div style="color:#475569; font-size:13px; margin:0 0 6px; font-family:Arial, Helvetica, sans-serif;">Details</div>
			<div style="color:#0f172a; font-size:15px; line-height:1.7; font-family:Arial, Helvetica, sans-serif;">
				${safeMessage}
			</div>
		</div>
		
		<div style="margin:14px 0 0; font-family:Arial, Helvetica, sans-serif;">
			<div style="color:#475569; font-size:13px; margin:0 0 6px; font-family:Arial, Helvetica, sans-serif;">From</div>
			<div style="font-size:15px; line-height:1.6; font-family:Arial, Helvetica, sans-serif;">
				<strong>${safeRequesterName}</strong> (${safeRequesterEmail})<br />
				<span style="color:#64748b;">User ID:</span> ${safeUserId}<br />
				${(safeUserName || safeDisplayName) ? html`
				<span style="color:#64748b;">Profile:</span>
				${safeDisplayName ? html`<span>${safeDisplayName}</span>` : ""}
				${safeUserName ? html`${safeDisplayName ? html`&nbsp;·&nbsp;` : ""}<span>@${safeUserName}</span>` : ""}
				<br />
				` : ""}
				${safeRole ? html`<span style="color:#64748b;">Role:</span> ${safeRole}<br />` : ""}
				${safeUserCreatedAt ? html`<span style="color:#64748b;">User created:</span> ${safeUserCreatedAt}<br />` : ""}
				<span style="color:#64748b;">Submitted:</span> ${safeWhen}
			</div>
		</div>
		
		${(safeCtxRoute || safeReferer || safeIp || safeForwardedFor || safeAcceptLanguage || safeCtxTimezone || safeCtxLocale
			|| safeCtxPlatform || safeCtxViewport || safeCtxScreen || safeCtxDpr || safeCtxColorScheme || safeCtxReducedMotion ||
			safeCtxNetwork || safeUserAgent) ? html`
		<div style="margin:14px 0 0; font-family:Arial, Helvetica, sans-serif;">
			<div style="color:#475569; font-size:13px; margin:0 0 6px; font-family:Arial, Helvetica, sans-serif;">Context</div>
			<div style="font-size:15px; line-height:1.6; font-family:Arial, Helvetica, sans-serif;">
				${safeCtxRoute ? html`<span style="color:#64748b;">Route:</span> ${safeCtxRoute}<br />` : ""}
				${safeReferer ? html`<span style="color:#64748b;">Referrer:</span> ${safeReferer}<br />` : ""}
				${safeIp ? html`<span style="color:#64748b;">IP:</span> ${safeIp}<br />` : ""}
				${safeIps ? html`<span style="color:#64748b;">IPs:</span> ${safeIps}<br />` : ""}
				${safeForwardedFor ? html`<span style="color:#64748b;">X-Forwarded-For:</span> ${safeForwardedFor}<br />` : ""}
				${safeAcceptLanguage ? html`<span style="color:#64748b;">Accept-Language:</span> ${safeAcceptLanguage}<br />` :
					""}
				${safeCtxTimezone ? html`<span style="color:#64748b;">Timezone:</span> ${safeCtxTimezone}<br />` : ""}
				${safeCtxLocale ? html`<span style="color:#64748b;">Locale:</span> ${safeCtxLocale}<br />` : ""}
				${safeCtxPlatform ? html`<span style="color:#64748b;">Platform:</span> ${safeCtxPlatform}<br />` : ""}
				${safeCtxViewport ? html`<span style="color:#64748b;">Viewport:</span> ${safeCtxViewport}<br />` : ""}
				${safeCtxScreen ? html`<span style="color:#64748b;">Screen:</span> ${safeCtxScreen}<br />` : ""}
				${safeCtxDpr ? html`<span style="color:#64748b;">DPR:</span> ${safeCtxDpr}<br />` : ""}
				${safeCtxColorScheme ? html`<span style="color:#64748b;">Color scheme:</span> ${safeCtxColorScheme}<br />` : ""}
				${safeCtxReducedMotion ? html`<span style="color:#64748b;">Reduced motion:</span> ${safeCtxReducedMotion}<br />`
					: ""}
				${safeCtxNetwork ? html`<span style="color:#64748b;">Network:</span> ${safeCtxNetwork}<br />` : ""}
				${safeUserAgent ? html`<span style="color:#64748b;">User agent:</span> ${safeUserAgent}<br />` : ""}
			</div>
		</div>
		` : ""}
	`;

	const emailHtml = baseEmailLayout({
		preheader,
		title: "New feature request",
		bodyHtml,
		suppressCta: true,
		footerText: "You’re receiving this email because you’re the parascene admin."
	});

	const text = [
		"New feature request",
		"",
		`From: ${requesterName || "Someone"} (${requesterEmail || "unknown"})`,
		`User ID: ${Number.isFinite(Number(requesterUserId)) ? Number(requesterUserId) : "unknown"}`,
		(requesterDisplayName || requesterUserName) ? `Profile: ${requesterDisplayName || ""}${(requesterDisplayName && requesterUserName) ? " · " : ""}${requesterUserName ? `@${requesterUserName}` : ""}` : "",
		requesterRole ? `Role: ${requesterRole}` : "",
		requesterCreatedAt ? `User created: ${requesterCreatedAt}` : "",
		`Submitted: ${timestamp.toISOString()}`,
		"",
		"Details:",
		String(message || "").trim(),
		"",
		(ctx?.route ? `Route: ${ctx.route}` : ""),
		referer ? `Referrer: ${referer}` : "",
		ip ? `IP: ${ip}` : "",
		(Array.isArray(ips) && ips.length) ? `IPs: ${ips.join(", ")}` : "",
		forwardedFor ? `X-Forwarded-For: ${forwardedFor}` : "",
		acceptLanguage ? `Accept-Language: ${acceptLanguage}` : "",
		(ctx?.timezone ? `Timezone: ${ctx.timezone}` : ""),
		(ctx?.locale ? `Locale: ${ctx.locale}` : ""),
		(ctx?.platform ? `Platform: ${ctx.platform}` : ""),
		(ctx?.viewportWidth && ctx?.viewportHeight) ? `Viewport: ${ctx.viewportWidth}x${ctx.viewportHeight}` : "",
		(ctx?.screenWidth && ctx?.screenHeight) ? `Screen: ${ctx.screenWidth}x${ctx.screenHeight}` : "",
		Number.isFinite(Number(ctx?.devicePixelRatio)) ? `DPR: ${ctx.devicePixelRatio}` : "",
		(ctx?.colorScheme ? `Color scheme: ${ctx.colorScheme}` : ""),
		(ctx?.reducedMotion ? `Reduced motion: ${ctx.reducedMotion}` : ""),
		(ctx?.network ? `Network: ${ctx.network}` : ""),
		userAgent ? `User agent: ${userAgent}` : ""
	].filter(Boolean).join("\n");

	return { subject, html: emailHtml, text };
}

// Response email sent by admin to the user who submitted a feature request.
export function renderFeatureRequestFeedback({
	recipientName = "there",
	originalRequest = "",
	message = ""
} = {}) {
	const safeName = escapeHtml(recipientName);
	// Escape first so user content is safe; then turn newlines into <br /> (so they render as line breaks, not literal tags)
	const safeOriginal = escapeHtml(String(originalRequest || "").trim()).replace(/\n/g, "<br />");
	const safeMessage = escapeHtml(String(message || "")).replace(/\n/g, "<br />");

	const subject = "Re: Your feature request";
	const preheader = "A response from the parascene team about your feature request.";

	const bodyHtml = html`
	<p style="margin:0 0 12px; font-family:Arial, Helvetica, sans-serif;">Hi ${safeName},</p>
	<p style="margin:0 0 12px; font-family:Arial, Helvetica, sans-serif;">
		Thanks for taking the time to send us your feature request. Here’s your original request and our reply:
	</p>
	${safeOriginal ? html`
	<div
		style="margin:16px 0 0; padding:14px 16px; border:1px solid #e2e8f0; border-radius:12px; background:#f1f5f9; font-family:Arial, Helvetica, sans-serif;">
		<div style="color:#475569; font-size:13px; margin:0 0 6px; font-family:Arial, Helvetica, sans-serif;">Your request
		</div>
		<div style="color:#0f172a; font-size:15px; line-height:1.7; font-family:Arial, Helvetica, sans-serif;">
			${safeOriginal}
		</div>
	</div>
	` : ""}
	<div
		style="margin:16px 0 0; padding:14px 16px; border:1px solid #e2e8f0; border-radius:12px; background:#f8fafc; font-family:Arial, Helvetica, sans-serif;">
		<div style="color:#475569; font-size:13px; margin:0 0 6px; font-family:Arial, Helvetica, sans-serif;">Our reply
		</div>
		<div style="color:#0f172a; font-size:15px; line-height:1.7; font-family:Arial, Helvetica, sans-serif;">
			${safeMessage}
		</div>
	</div>
	<p style="margin:16px 0 0; font-family:Arial, Helvetica, sans-serif;">
		If you have more ideas or questions, just reply to this email or send another feature request from the app.
	</p>
	<p style="margin:0; font-family:Arial, Helvetica, sans-serif;">— The parascene team</p>
	`;

	const emailHtml = baseEmailLayout({
		preheader,
		title: subject,
		bodyHtml,
		ctaText: "Visit parascene",
		ctaUrl: getBaseAppUrlForEmail(),
		footerText: "You're receiving this because you submitted a feature request on parascene."
	});

	const textLines = [
		`Hi ${recipientName},`,
		"",
		"Thanks for taking the time to send us your feature request. Here's your original request and our reply:",
		""
	];
	if (String(originalRequest || "").trim()) {
		textLines.push("Your request:", "", String(originalRequest || "").trim(), "");
	}
	textLines.push(
		"Our reply:",
		"",
		String(message || "").trim(),
		"",
		"If you have more ideas or questions, just reply to this email or send another feature request from the app.",
		"",
		"— The parascene team",
		"",
		`Visit parascene: ${getBaseAppUrlForEmail()}`
	);
	const text = textLines.join("\n");

	return { subject, html: emailHtml, text };
}

function renderActivityList(items, sectionTitle) {
	const list = Array.isArray(items) ? items : [];
	if (list.length === 0) return "";
	return html`
	<div
		style="margin:16px 0 0; padding:14px 16px; border:1px solid #e2e8f0; border-radius:12px; background:#f8fafc; font-family:Arial, Helvetica, sans-serif;">
		<div
			style="color:#475569; font-size:13px; margin:0 0 10px; font-weight:600; font-family:Arial, Helvetica, sans-serif;">
			${escapeHtml(sectionTitle)}</div>
		<ul
			style="margin:0; padding-left:20px; color:#0f172a; font-size:15px; line-height:1.8; font-family:Arial, Helvetica, sans-serif;">
			${list.map((item) => {
		const title = item?.title && String(item.title).trim() ? escapeHtml(String(item.title).trim()) : "Untitled";
		const count = Number(item?.comment_count ?? 0);
		const commentLabel = count === 1 ? "1 new comment" : `${count} new comments`;
		return `<li><strong>${title}</strong> — ${escapeHtml(commentLabel)}</li>`;
	}).join("")}
		</ul>
	</div>
  `;
}

export function renderDigestActivity({
	recipientName = "there",
	activitySummary = "You have new activity.",
	feedUrl = getBaseAppUrlForEmail(),
	activityItems = [],
	otherCreationsActivityItems = []
} = {}) {
	const safeName = escapeHtml(recipientName);
	const safeSummary = escapeHtml(activitySummary);
	const items = Array.isArray(activityItems) ? activityItems : [];
	const otherItems = Array.isArray(otherCreationsActivityItems) ? otherCreationsActivityItems : [];
	const totalCount = items.length + otherItems.length;
	const subject = "You have new activity on parascene!";
	const preheader = totalCount > 0
		? `${totalCount} creation${totalCount === 1 ? "" : "s"} with new comments`
		: (activitySummary || "You have new activity on parascene.");

	const yourCreationsHtml = renderActivityList(items, "Your creations");
	const otherCreationsHtml = renderActivityList(otherItems, "Creations you've commented on");
	const activityListHtml = yourCreationsHtml || otherCreationsHtml ? html`
	${yourCreationsHtml}
	${otherCreationsHtml}
  ` : "";

	const bodyHtml = html`
	<p style="margin:0 0 12px; font-family:Arial, Helvetica, sans-serif;">Hi ${safeName},</p>
	<p style="margin:0 0 12px; font-family:Arial, Helvetica, sans-serif;">${safeSummary}</p>
	${activityListHtml}
  `;
	const emailHtml = baseEmailLayout({
		preheader,
		title: "Your activity",
		bodyHtml,
		ctaText: "View activity",
		ctaUrl: feedUrl,
		footerText: "You're receiving this because you have notifications on parascene."
	});

	const textSections = [];
	if (items.length > 0) {
		textSections.push("Your creations:", ...items.map((item) => {
			const title = (item?.title && String(item.title).trim()) || "Untitled";
			const count = Number(item?.comment_count ?? 0);
			return `  • ${title} — ${count} new comment${count === 1 ? "" : "s"}`;
		}));
	}
	if (otherItems.length > 0) {
		textSections.push("Creations you've commented on:", ...otherItems.map((item) => {
			const title = (item?.title && String(item.title).trim()) || "Untitled";
			const count = Number(item?.comment_count ?? 0);
			return `  • ${title} — ${count} new comment${count === 1 ? "" : "s"}`;
		}));
	}
	const textLines = [
		`Hi ${recipientName},`,
		"",
		activitySummary,
		...(textSections.length > 0 ? ["", ...textSections] : []),
		"",
		`View activity: ${feedUrl}`
	];
	const text = textLines.join("\n");
	return { subject, html: emailHtml, text };
}

export function renderWelcome({ recipientName = "there" } = {}) {
	const safeName = escapeHtml(recipientName);
	const subject = "You’re early — welcome to parascene";
	const preheader = "You’re one of the first. What you do here matters.";

	const bodyHtml = html`
		<p style="margin:0 0 12px; font-family:Arial, Helvetica, sans-serif;">
			Hi ${safeName},
		</p>
		
		<p style="margin:0 0 12px; font-family:Arial, Helvetica, sans-serif;">
			Welcome to parascene.
		</p>
		
		<p style="margin:0 0 12px; font-family:Arial, Helvetica, sans-serif;">
			You’re one of the first people here. There are only a handful of us so far, which means what you make, notice, and
			suggest actually matters.
		</p>
		
		<p style="margin:0 0 12px; font-family:Arial, Helvetica, sans-serif;">
			Parascene is still taking shape. We’re building it in the open, adjusting quickly, and paying close attention to how
			early users use it — and where it falls short.
		</p>
		
		<p style="margin:0 0 12px; font-family:Arial, Helvetica, sans-serif;">
			Create. Push it somewhere strange. If something feels missing, that’s useful signal, not a problem.
		</p>
		
		<p style="margin:0; font-family:Arial, Helvetica, sans-serif;">
			— The parascene team
		</p>
	`;

	const emailHtml = baseEmailLayout({
		preheader,
		title: subject,
		bodyHtml,
		ctaText: "Go to parascene",
		ctaUrl: getBaseAppUrlForEmail(),
		footerText: "You're receiving this because you signed up for parascene."
	});
	const text = [
		`Hi ${recipientName},`,
		"",
		"Thanks for joining parascene. We're here to help you turn prompts into creations that feel cinematic and personal.",
		"",
		"Create your first scene, explore what others have made, or just say hello in the community.",
		"",
		"— The parascene team",
		"",
		`Go to parascene: ${getBaseAppUrlForEmail()}`
	].join("\n");
	return { subject, html: emailHtml, text };
}

export function renderFirstCreationNudge({ recipientName = "there" } = {}) {
	const safeName = escapeHtml(recipientName);
	const subject = "Your first creation is waiting";
	const preheader = "You haven't created anything yet — here's how to start.";
	const bodyHtml = html`
	<p style="margin:0 0 12px; font-family:Arial, Helvetica, sans-serif;">Hi ${safeName},</p>
	<p style="margin:0 0 12px; font-family:Arial, Helvetica, sans-serif;">
		You've had an account for a bit but haven't made a creation yet. No pressure — but when you're ready, it only takes
		a prompt to get started.
	</p>
	<p style="margin:0 0 12px; font-family:Arial, Helvetica, sans-serif;">
		Describe what you want to see in your own words. We'll turn that into something you can share.
	</p>
	<p style="margin:0; font-family:Arial, Helvetica, sans-serif;">— The parascene team</p>
  `;
	const createUrl = `${getBaseAppUrlForEmail()}/create`;
	const emailHtml = baseEmailLayout({
		preheader,
		title: subject,
		bodyHtml,
		ctaText: "Create something",
		ctaUrl: createUrl,
		footerText: "You're receiving this because you have a parascene account."
	});
	const text = [
		`Hi ${recipientName},`,
		"",
		"You've had an account for a bit but haven't made a creation yet. No pressure — but when you're ready, it only takes a prompt to get started.",
		"",
		"Describe what you want to see in your own words. We'll turn that into something you can share.",
		"",
		"— The parascene team",
		"",
		`Create something: ${createUrl}`
	].join("\n");
	return { subject, html: emailHtml, text };
}

export function renderReengagement({ recipientName = "there" } = {}) {
	const safeName = escapeHtml(recipientName);
	const subject = "We miss you on parascene";
	const preheader = "Your creations are waiting — come back and see what's new.";
	const bodyHtml = html`
	<p style="margin:0 0 12px; font-family:Arial, Helvetica, sans-serif;">Hi ${safeName},</p>
	<p style="margin:0 0 12px; font-family:Arial, Helvetica, sans-serif;">
		It's been a while since we've seen you. Your creations and the community are still here whenever you're ready to
		drop back in.
	</p>
	<p style="margin:0 0 12px; font-family:Arial, Helvetica, sans-serif;">
		Create something new, see what others have been making, or just say hello.
	</p>
	<p style="margin:0; font-family:Arial, Helvetica, sans-serif;">— The parascene team</p>
  `;
	const emailHtml = baseEmailLayout({
		preheader,
		title: subject,
		bodyHtml,
		ctaText: "Visit parascene",
		ctaUrl: getBaseAppUrlForEmail(),
		footerText: "You're receiving this because you have a parascene account."
	});
	const text = [
		`Hi ${recipientName},`,
		"",
		"It's been a while since we've seen you. Your creations and the community are still here whenever you're ready to drop back in.",
		"",
		"Create something new, see what others have been making, or just say hello.",
		"",
		"— The parascene team",
		"",
		`Visit parascene: ${getBaseAppUrlForEmail()}`
	].join("\n");
	return { subject, html: emailHtml, text };
}

export function renderCreationHighlight({
	recipientName = "there",
	creationTitle = "your creation",
	creationUrl = getBaseAppUrlForEmail(),
	commentCount = 1
} = {}) {
	const safeName = escapeHtml(recipientName);
	const safeTitle = escapeHtml(creationTitle || "your creation");
	const count = Number(commentCount) || 1;
	const commentLabel = count === 1 ? "1 new comment" : `${count} new comments`;
	const subject = `"${creationTitle || "Your creation"}" is getting attention`;
	const preheader = `${commentLabel} on ${creationTitle || "your creation"}.`;
	const bodyHtml = html`
	<p style="margin:0 0 12px; font-family:Arial, Helvetica, sans-serif;">Hi ${safeName},</p>
	<p style="margin:0 0 12px; font-family:Arial, Helvetica, sans-serif;">
		Your creation <strong>${safeTitle}</strong> has ${commentLabel.toLowerCase()}. People are engaging with what you
		made.
	</p>
	<p style="margin:0 0 12px; font-family:Arial, Helvetica, sans-serif;">
		Head over to see the conversation and join in.
	</p>
	<p style="margin:0; font-family:Arial, Helvetica, sans-serif;">— The parascene team</p>
  `;
	const emailHtml = baseEmailLayout({
		preheader,
		title: "Your creation is getting attention",
		bodyHtml,
		ctaText: "View creation",
		ctaUrl: creationUrl,
		footerText: "You're receiving this because someone commented on your creation on parascene."
	});
	const text = [
		`Hi ${recipientName},`,
		"",
		`Your creation "${creationTitle || "your creation"}" has ${commentLabel.toLowerCase()}. People are engaging with what you made.`,
		"",
		"Head over to see the conversation and join in.",
		"",
		"— The parascene team",
		"",
		`View creation: ${creationUrl}`
	].join("\n");
	return { subject, html: emailHtml, text };
}

export function renderSupportReport({
	requesterName = "Someone",
	requesterEmail = "",
	requesterUserId = null,
	requesterUserName = "",
	requesterDisplayName = "",
	report = {},
	userAgent = "",
	acceptLanguage = "",
	referer = "",
	ip = "",
	submittedAt = null
} = {}) {
	const safeRequesterName = escapeHtml(requesterName || "Someone");
	const safeRequesterEmail = escapeHtml(requesterEmail || "unknown");
	const safeUserId = escapeHtml(
		Number.isFinite(Number(requesterUserId)) ? Number(requesterUserId) : "unknown"
	);
	const safeUserName = escapeHtml(requesterUserName || "");
	const safeDisplayName = escapeHtml(requesterDisplayName || "");
	const safeUserAgent = escapeHtml(truncateMiddle(userAgent, 400));
	const safeReferer = escapeHtml(truncateMiddle(referer, 600));
	const safeIp = escapeHtml(ip || "");
	const safeAcceptLanguage = escapeHtml(truncateMiddle(acceptLanguage, 200));
	const timestamp = submittedAt ? new Date(submittedAt) : new Date();
	const safeWhen = escapeHtml(timestamp.toISOString());

	let reportStr = "";
	try {
		reportStr = JSON.stringify(report, null, 2);
	} catch {
		reportStr = String(report);
	}
	const safeReport = escapeHtml(truncateMiddle(reportStr, 12000));

	const creationId = report?.creationId ?? report?.landscape?.creationId;
	const userSummary = report?.userSummary ?? "";
	const safeUserSummary = escapeHtml(String(userSummary).trim()).replace(/\n/g, "<br />");
	const subject = `Support report: ${creationId ? `creation ${creationId}` : "Landscape"}`;
	const preheader = `${requesterName || "Someone"} sent a support report to help troubleshoot.`;

	const bodyHtml = html`
		${safeUserSummary ? html`
		<div style="margin:0 0 14px; padding:14px 16px; border:1px solid #e2e8f0; border-radius:12px; background:#ffffff; font-family:Arial, Helvetica, sans-serif;">
			<div style="color:#475569; font-size:13px; margin:0 0 6px;">Summary</div>
			<div style="color:#0f172a; font-size:15px; line-height:1.6; font-family:Arial, Helvetica, sans-serif;">${safeUserSummary}</div>
		</div>
		` : ""}
		<div style="margin:0 0 14px; font-family:Arial, Helvetica, sans-serif;">
			<div style="color:#475569; font-size:13px; margin:0 0 6px;">From</div>
			<div style="font-size:15px; line-height:1.6;">
				<strong>${safeRequesterName}</strong> (${safeRequesterEmail})<br />
				<span style="color:#64748b;">User ID:</span> ${safeUserId}<br />
				${(safeUserName || safeDisplayName) ? html`
				<span style="color:#64748b;">Profile:</span>
				${safeDisplayName ? html`<span>${safeDisplayName}</span>` : ""}
				${safeUserName ? html`${safeDisplayName ? " · " : ""}<span>@${safeUserName}</span>` : ""}<br />
				` : ""}
				<span style="color:#64748b;">Submitted:</span> ${safeWhen}
			</div>
		</div>
		<div style="margin:14px 0 0; font-family:Arial, Helvetica, sans-serif;">
			<div style="color:#475569; font-size:13px; margin:0 0 6px;">Context</div>
			<div style="font-size:15px; line-height:1.6;">
				${safeIp ? html`<span style="color:#64748b;">IP:</span> ${safeIp}<br />` : ""}
				${safeReferer ? html`<span style="color:#64748b;">Referrer:</span> ${safeReferer}<br />` : ""}
				${safeAcceptLanguage ? html`<span style="color:#64748b;">Accept-Language:</span> ${safeAcceptLanguage}<br />` : ""}
				${safeUserAgent ? html`<span style="color:#64748b;">User agent:</span> ${safeUserAgent}<br />` : ""}
			</div>
		</div>
		<div style="margin:14px 0 0; padding:14px 16px; border:1px solid #e2e8f0; border-radius:12px; background:#f8fafc; font-family:Arial, Helvetica, sans-serif;">
			<div style="color:#475569; font-size:13px; margin:0 0 6px;">Report payload</div>
			<pre style="margin:0; font-size:12px; line-height:1.5; white-space:pre-wrap; word-break:break-all; color:#0f172a;">${safeReport}</pre>
		</div>
	`;

	const emailHtml = baseEmailLayout({
		preheader,
		title: "Support report",
		bodyHtml,
		suppressCta: true,
		footerText: "You're receiving this because you're the parascene admin."
	});

	const text = [
		"Support report",
		"",
		userSummary ? ["Summary:", String(userSummary).trim(), ""].join("\n") : "",
		`From: ${requesterName || "Someone"} (${requesterEmail || "unknown"})`,
		`User ID: ${Number.isFinite(Number(requesterUserId)) ? Number(requesterUserId) : "unknown"}`,
		`Submitted: ${timestamp.toISOString()}`,
		"",
		"Context:",
		ip ? `IP: ${ip}` : "",
		referer ? `Referrer: ${referer}` : "",
		acceptLanguage ? `Accept-Language: ${acceptLanguage}` : "",
		userAgent ? `User agent: ${userAgent}` : "",
		"",
		"Report payload:",
		reportStr
	].filter(Boolean).join("\n");

	return { subject, html: emailHtml, text };
}

export const templates = {
	helloFromParascene: renderHelloFromParascene,
	commentReceived: renderCommentReceived,
	featureRequest: renderFeatureRequest,
	featureRequestFeedback: renderFeatureRequestFeedback,
	passwordReset: renderPasswordReset,
	digestActivity: renderDigestActivity,
	welcome: renderWelcome,
	firstCreationNudge: renderFirstCreationNudge,
	reengagement: renderReengagement,
	creationHighlight: renderCreationHighlight,
	supportReport: renderSupportReport
};
