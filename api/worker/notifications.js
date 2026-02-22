import "dotenv/config";
import { openDb } from "../../db/index.js";
import { verifyQStashRequest } from "../../api_routes/utils/qstashVerification.js";
import { sendTemplatedEmail } from "../../email/index.js";
import { getBaseAppUrlForEmail } from "../../api_routes/utils/url.js";
import { getEmailSettings, getEffectiveRecipient } from "../../api_routes/utils/emailSettings.js";
import { markPreviousStepsCompleted } from "../../api_routes/utils/emailCampaignState.js";

const CRON_SECRET_ENV = "CRON_SECRET";

/** Authorize: local uses CRON_SECRET Bearer; prod uses Upstash QStash signature. */
async function authorizeCronRequest(req) {
	const secret = process.env[CRON_SECRET_ENV];
	const authHeader = req.headers?.authorization || "";
	const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
	if (secret && token === secret) {
		return true;
	}
	return await verifyQStashRequest(req);
}

function getStartOfTodayUTC() {
	const d = new Date();
	d.setUTCHours(0, 0, 0, 0);
	return d.toISOString();
}

function getSinceIso(hoursAgo) {
	const d = new Date();
	d.setUTCHours(d.getUTCHours() - hoursAgo, d.getUTCMinutes(), d.getUTCSeconds(), 0);
	return d.toISOString();
}

async function runNotificationsCron({ queries }) {
	const settings = await getEmailSettings(queries);
	const { dryRun, windowHours, maxDigestsPerUserPerDay, activityHoursLookback } = settings;
	const now = new Date();
	const currentHourUTC = now.getUTCHours();
	const inWindow = windowHours.length === 0 || windowHours.includes(currentHourUTC);
	if (!inWindow) {
		return { ok: true, reason: "not_in_window", currentHourUTC, windowHours };
	}

	const startOfTodayUTC = getStartOfTodayUTC();
	const sinceIso = getSinceIso(activityHoursLookback ?? 24);
	let sent = 0;
	let skipped = 0;
	let welcomeSent = 0;
	let firstCreationNudgeSent = 0;
	let reengagementSent = 0;
	let creationHighlightSent = 0;

	const candidateRows = await (queries.selectDistinctUserIdsWithUnreadNotificationsSince?.all(sinceIso) ?? []);
	const userIds = candidateRows.map((r) => r?.user_id).filter((id) => id != null && Number.isFinite(Number(id)));

	const { reengagementInactiveDays, reengagementCooldownDays, creationHighlightLookbackHours, creationHighlightCooldownDays, creationHighlightMinComments, welcomeEmailDelayHours } = settings;
	const inactiveCutoff = new Date();
	inactiveCutoff.setUTCDate(inactiveCutoff.getUTCDate() - reengagementInactiveDays);
	const reengagementCooldownCutoff = new Date();
	reengagementCooldownCutoff.setUTCDate(reengagementCooldownCutoff.getUTCDate() - reengagementCooldownDays);
	const reengagementEligibleRows = await (queries.selectUsersEligibleForReengagement?.all(
		inactiveCutoff.toISOString(),
		reengagementCooldownCutoff.toISOString()
	) ?? []);
	const highlightSince = new Date();
	highlightSince.setUTCHours(highlightSince.getUTCHours() - creationHighlightLookbackHours, highlightSince.getUTCMinutes(), highlightSince.getUTCSeconds(), 0);
	const highlightCooldownCutoff = new Date();
	highlightCooldownCutoff.setUTCDate(highlightCooldownCutoff.getUTCDate() - creationHighlightCooldownDays);
	const highlightEligibleRowsRaw = await (queries.selectCreationsEligibleForHighlight?.all(
		highlightSince.toISOString(),
		highlightCooldownCutoff.toISOString()
	) ?? []);
	const minComments = Math.max(0, Number(creationHighlightMinComments) || 1);
	const highlightEligibleRows = highlightEligibleRowsRaw.filter(
		(r) => Number(r?.comment_count ?? 0) >= minComments
	);
	const userIdsReceivingLaterCampaignThisRun = new Set([
		...reengagementEligibleRows.map((r) => r?.user_id).filter((id) => id != null),
		...highlightEligibleRows.map((r) => r?.user_id).filter((id) => id != null)
	]);

	for (const userId of userIds) {
		const user = await queries.selectUserById?.get(userId);
		const email = user?.email ? String(user.email).trim() : "";
		if (!email || !email.includes("@")) {
			skipped++;
			continue;
		}

		const countRow = await queries.selectEmailSendsCountForUserSince?.get(userId, "digest", startOfTodayUTC);
		const countToday = Number(countRow?.count ?? 0);
		if (countToday >= maxDigestsPerUserPerDay) {
			skipped++;
			continue;
		}

		await queries.insertEmailSend?.run(userId, "digest", null);
		const sentAt = new Date().toISOString();

		if (!dryRun && process.env.RESEND_API_KEY && process.env.RESEND_SYSTEM_EMAIL) {
			const to = getEffectiveRecipient(settings, email);
			const recipientName = user?.display_name || user?.user_name || email.split("@")[0] || "there";
			const feedUrl = getBaseAppUrlForEmail();

			// Get unread notifications to filter digest to only show creations with unread notifications
			const unreadNotifications = await (queries.selectNotificationsForUser?.all(userId, user?.role) ?? []);
			const unreadCreationIds = new Set();
			for (const notif of unreadNotifications) {
				if (!notif.acknowledged_at && notif.link) {
					// Extract creation ID from link like "/creations/123"
					const match = String(notif.link).match(/\/creations\/(\d+)/);
					if (match && match[1]) {
						const creationId = Number(match[1]);
						if (Number.isFinite(creationId) && creationId > 0) {
							unreadCreationIds.add(creationId);
						}
					}
				}
			}

			const ownerRows = await (queries.selectDigestActivityByOwnerSince?.all(userId, sinceIso) ?? []);
			const commenterRows = await (queries.selectDigestActivityByCommenterSince?.all(userId, sinceIso) ?? []);

			// Filter to only include creations with unread notifications
			const filteredOwnerRows = ownerRows.filter((r) => {
				const creationId = Number(r?.created_image_id);
				return Number.isFinite(creationId) && unreadCreationIds.has(creationId);
			});
			const filteredCommenterRows = commenterRows.filter((r) => {
				const creationId = Number(r?.created_image_id);
				return Number.isFinite(creationId) && unreadCreationIds.has(creationId);
			});

			const activityItems = filteredOwnerRows.map((r) => ({
				title: r?.title && String(r.title).trim() ? String(r.title).trim() : "Untitled",
				comment_count: Number(r?.comment_count ?? 0)
			}));
			const otherCreationsActivityItems = filteredCommenterRows.map((r) => ({
				title: r?.title && String(r.title).trim() ? String(r.title).trim() : "Untitled",
				comment_count: Number(r?.comment_count ?? 0)
			}));
			try {
				await sendTemplatedEmail({
					to,
					template: "digestActivity",
					data: {
						recipientName,
						activitySummary: "You have new activity.",
						feedUrl,
						activityItems,
						otherCreationsActivityItems
					}
				});
				if (queries.upsertUserEmailCampaignStateLastDigest?.run) {
					await queries.upsertUserEmailCampaignStateLastDigest.run(userId, sentAt);
				}
				await markPreviousStepsCompleted(queries, userId, sentAt, "digest");
				userIdsReceivingLaterCampaignThisRun.add(userId);
				sent++;
			} catch (err) {
				skipped++;
			}
		}
	}

	const welcomeCutoff = new Date();
	welcomeCutoff.setUTCHours(welcomeCutoff.getUTCHours() - welcomeEmailDelayHours, welcomeCutoff.getUTCMinutes(), welcomeCutoff.getUTCSeconds(), 0);
	const welcomeCutoffIso = welcomeCutoff.toISOString();
	const welcomeEligibleRows = await (queries.selectUsersEligibleForWelcomeEmail?.all(welcomeCutoffIso) ?? []);
	for (const row of welcomeEligibleRows) {
		const userId = row?.user_id;
		if (userId == null || !Number.isFinite(Number(userId))) continue;
		if (userIdsReceivingLaterCampaignThisRun.has(userId)) continue;
		const user = await queries.selectUserById?.get(userId);
		const email = user?.email ? String(user.email).trim() : "";
		if (!email || !email.includes("@")) continue;
		if (!dryRun && process.env.RESEND_API_KEY && process.env.RESEND_SYSTEM_EMAIL) {
			try {
				const to = getEffectiveRecipient(settings, email);
				const recipientName = user?.display_name || user?.user_name || email.split("@")[0] || "there";
				await sendTemplatedEmail({
					to,
					template: "welcome",
					data: { recipientName }
				});
				await queries.insertEmailSend?.run(userId, "welcome", null);
				const sentAt = new Date().toISOString();
				if (queries.upsertUserEmailCampaignStateWelcome?.run) {
					await queries.upsertUserEmailCampaignStateWelcome.run(userId, sentAt);
				}
				welcomeSent++;
			} catch (err) { }
		}
	}

	const nudgeWelcomeCutoff = new Date();
	nudgeWelcomeCutoff.setUTCHours(nudgeWelcomeCutoff.getUTCHours() - 24, nudgeWelcomeCutoff.getUTCMinutes(), nudgeWelcomeCutoff.getUTCSeconds(), 0);
	const nudgeEligibleRows = await (queries.selectUsersEligibleForFirstCreationNudge?.all(nudgeWelcomeCutoff.toISOString()) ?? []);
	for (const row of nudgeEligibleRows) {
		const userId = row?.user_id;
		if (userId == null || !Number.isFinite(Number(userId))) continue;
		if (userIdsReceivingLaterCampaignThisRun.has(userId)) continue;
		const user = await queries.selectUserById?.get(userId);
		const email = user?.email ? String(user.email).trim() : "";
		if (!email || !email.includes("@")) continue;
		if (!dryRun && process.env.RESEND_API_KEY && process.env.RESEND_SYSTEM_EMAIL) {
			try {
				const to = getEffectiveRecipient(settings, email);
				const recipientName = user?.display_name || user?.user_name || email.split("@")[0] || "there";
				await sendTemplatedEmail({
					to,
					template: "firstCreationNudge",
					data: { recipientName }
				});
				await queries.insertEmailSend?.run(userId, "first_creation_nudge", null);
				const sentAt = new Date().toISOString();
				if (queries.upsertUserEmailCampaignStateFirstCreationNudge?.run) {
					await queries.upsertUserEmailCampaignStateFirstCreationNudge.run(userId, sentAt);
				}
				firstCreationNudgeSent++;
			} catch (err) { }
		}
	}

	for (const row of reengagementEligibleRows) {
		const userId = row?.user_id;
		if (userId == null || !Number.isFinite(Number(userId))) continue;
		const user = await queries.selectUserById?.get(userId);
		const email = user?.email ? String(user.email).trim() : "";
		if (!email || !email.includes("@")) continue;
		if (!dryRun && process.env.RESEND_API_KEY && process.env.RESEND_SYSTEM_EMAIL) {
			try {
				const to = getEffectiveRecipient(settings, email);
				const recipientName = user?.display_name || user?.user_name || email.split("@")[0] || "there";
				await sendTemplatedEmail({
					to,
					template: "reengagement",
					data: { recipientName }
				});
				await queries.insertEmailSend?.run(userId, "reengagement", null);
				const sentAt = new Date().toISOString();
				if (queries.upsertUserEmailCampaignStateReengagement?.run) {
					await queries.upsertUserEmailCampaignStateReengagement.run(userId, sentAt);
				}
				await markPreviousStepsCompleted(queries, userId, sentAt, "reengagement");
				reengagementSent++;
			} catch (err) { }
		}
	}

	for (const row of highlightEligibleRows) {
		const userId = row?.user_id;
		if (userId == null || !Number.isFinite(Number(userId))) continue;
		const user = await queries.selectUserById?.get(userId);
		const email = user?.email ? String(user.email).trim() : "";
		if (!email || !email.includes("@")) continue;
		if (!dryRun && process.env.RESEND_API_KEY && process.env.RESEND_SYSTEM_EMAIL) {
			try {
				const to = getEffectiveRecipient(settings, email);
				const recipientName = user?.display_name || user?.user_name || email.split("@")[0] || "there";
				const creationTitle = row?.title && String(row.title).trim() ? String(row.title).trim() : "Untitled";
				const creationId = row?.creation_id;
				const creationUrl = creationId != null ? `${getBaseAppUrlForEmail()}/creations/${creationId}` : getBaseAppUrlForEmail();
				await sendTemplatedEmail({
					to,
					template: "creationHighlight",
					data: {
						recipientName,
						creationTitle,
						creationUrl,
						commentCount: Number(row?.comment_count ?? 0) || 1
					}
				});
				await queries.insertEmailSend?.run(userId, "creation_highlight", null);
				const sentAt = new Date().toISOString();
				if (queries.upsertUserEmailCampaignStateCreationHighlight?.run) {
					await queries.upsertUserEmailCampaignStateCreationHighlight.run(userId, sentAt);
				}
				await markPreviousStepsCompleted(queries, userId, sentAt, "creation_highlight");
				creationHighlightSent++;
			} catch (err) { }
		}
	}

	return {
		ok: true,
		dryRun,
		inWindow: true,
		candidates: userIds.length,
		sent,
		skipped,
		welcomeSent,
		firstCreationNudgeSent,
		reengagementSent,
		creationHighlightSent
	};
}

// Named export to make the core cron logic directly testable without
// needing to spin up an HTTP server or real QStash/DB wiring.
export async function runNotificationsCronForTests(options) {
	return runNotificationsCron(options);
}

export default async function handler(req, res) {
	res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
	res.setHeader("Pragma", "no-cache");
	res.setHeader("Expires", "0");

	if (req.method !== "POST") {
		return res.status(405).json({ error: "Method not allowed" });
	}

	try {
		const authorized = await authorizeCronRequest(req);
		if (!authorized) {
			return res.status(401).json({ error: "Unauthorized" });
		}

		const { queries } = await openDb();
		const result = await runNotificationsCron({ queries });
		return res.status(200).json(result);
	} catch (error) {
		console.error("[Cron] Notifications cron failed:", error);
		return res.status(500).json({ ok: false, error: "Cron failed" });
	}
}
