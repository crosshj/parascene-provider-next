import { Resend } from "resend";
import { templates } from "./templates.js";

const SYSTEM_IMPERSONATION_EMAIL = "parascene.system@crosshj.com";

function getRequiredEnv(name) {
	const value = process.env[name];
	if (!value) {
		throw new Error(`Missing required environment variable: ${name}`);
	}
	return value;
}

function normalizeRecipients(to) {
	if (Array.isArray(to)) return to;
	if (typeof to === "string" && to.trim().length > 0) return [to.trim()];
	return [];
}

export function renderEmailTemplate(templateName, data) {
	const renderer = templates[templateName];
	if (!renderer) {
		throw new Error(`Unknown email template: ${templateName}`);
	}
	return renderer(data);
}

export async function sendTemplatedEmail({ to, template, data, replyTo } = {}) {
	const recipients = normalizeRecipients(to);
	if (recipients.length === 0) {
		throw new Error("Email recipient is required.");
	}

	const apiKey = getRequiredEnv("RESEND_API_KEY");
	const fromAddress = getRequiredEnv("RESEND_SYSTEM_EMAIL");
	const { subject, html, text } = renderEmailTemplate(template, data);

	const resend = new Resend(apiKey);
	const payload = {
		from: `parascene <${fromAddress}>`,
		to: recipients,
		subject,
		html,
		text
	};

	if (replyTo) {
		payload.reply_to = replyTo;
	}

	const { data: responseData, error } = await resend.emails.send(payload);

	if (error) {
		throw new Error(`Resend error: ${error.message || "Unknown error"}`);
	}

	// Server log for successful sends (useful for debugging and audits).
	// console.log("[Email] Sent", {
	// 	template,
	// 	to: recipients,
	// 	subject,
	// 	id: responseData?.id || null
	// });

	return responseData;
}

export async function sendDelegatedEmail({
	template,
	data,
	originalRecipient,
	reason,
	replyTo
} = {}) {
	const delegatedData = {
		...(data || {}),
		impersonation: {
			originalRecipient: originalRecipient || null,
			reason: reason || ""
		}
	};

	return sendTemplatedEmail({
		to: SYSTEM_IMPERSONATION_EMAIL,
		template,
		data: delegatedData,
		replyTo
	});
}
