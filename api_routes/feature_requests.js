import express from "express";
import { sendTemplatedEmail } from "../email/index.js";

const ADMIN_FEATURE_REQUEST_EMAIL = "parascene.admin@crosshj.com";

async function requireUser(req, res, queries) {
	if (!req.auth?.userId) {
		res.status(401).json({ error: "Unauthorized" });
		return null;
	}

	const user = await queries.selectUserById.get(req.auth.userId);
	if (!user) {
		res.status(404).json({ error: "User not found" });
		return null;
	}

	let profile = null;
	try {
		profile = await queries.selectUserProfileByUserId?.get?.(user.id);
	} catch {
		profile = null;
	}

	return { user, profile };
}

function getUserDisplayName({ user, profile } = {}) {
	const displayName = typeof profile?.display_name === "string" ? profile.display_name.trim() : "";
	if (displayName) return displayName;
	const userName = typeof profile?.user_name === "string" ? profile.user_name.trim() : "";
	if (userName) return userName;
	const name = typeof user?.name === "string" ? user.name.trim() : "";
	if (name) return name;
	const email = String(user?.email || "").trim();
	const localPart = email.includes("@") ? email.split("@")[0] : email;
	return localPart || "Someone";
}

function normalizeText(value, { max = 5000 } = {}) {
	const text = typeof value === "string" ? value.trim() : "";
	if (!text) return "";
	return text.length > max ? text.slice(0, max) : text;
}

function normalizeContext(raw) {
	const input = raw && typeof raw === "object" ? raw : {};
	const out = {};
	const set = (key, value, max = 500) => {
		const text = typeof value === "string" ? value.trim() : "";
		if (!text) return;
		out[key] = text.length > max ? text.slice(0, max) : text;
	};
	const setNum = (key, value) => {
		const n = Number(value);
		if (!Number.isFinite(n)) return;
		out[key] = n;
	};

	set("route", input.route, 80);
	set("referrer", input.referrer, 800);
	set("timezone", input.timezone, 120);
	set("locale", input.locale, 80);
	set("platform", input.platform, 120);
	set("colorScheme", input.colorScheme, 20);
	set("reducedMotion", input.reducedMotion, 20);
	set("network", input.network, 80);

	setNum("viewportWidth", input.viewportWidth);
	setNum("viewportHeight", input.viewportHeight);
	setNum("screenWidth", input.screenWidth);
	setNum("screenHeight", input.screenHeight);
	setNum("devicePixelRatio", input.devicePixelRatio);

	return out;
}

export default function createFeatureRequestRoutes({ queries }) {
	const router = express.Router();

	router.post("/api/feature-requests", async (req, res) => {
		const userBundle = await requireUser(req, res, queries);
		if (!userBundle) return;
		const { user, profile } = userBundle;

		const message = normalizeText(req.body?.message, { max: 5000 });
		const context = normalizeContext(req.body?.context);

		if (!message) {
			return res.status(400).json({ error: "Details are required." });
		}

		// Fail clearly if email isn't configured.
		if (!process.env.RESEND_API_KEY || !process.env.RESEND_SYSTEM_EMAIL) {
			return res.status(503).json({ error: "Email is not configured on this environment." });
		}

		const requesterEmail = String(user?.email || "").trim();
		const requesterName = getUserDisplayName({ user, profile });
		const requesterUserId = user?.id ?? null;
		const requesterRole = typeof user?.role === "string" ? user.role : "";
		const requesterCreatedAt = user?.created_at ?? null;
		const requesterUserName = typeof profile?.user_name === "string" ? profile.user_name.trim() : "";
		const requesterDisplayName = typeof profile?.display_name === "string" ? profile.display_name.trim() : "";

		const userAgent = String(req.get("user-agent") || "").trim();
		const acceptLanguage = String(req.get("accept-language") || "").trim();
		const referer = String(req.get("referer") || "").trim();
		const forwardedFor = String(req.get("x-forwarded-for") || "").trim();
		const ip = String(req.ip || "").trim();
		const ips = Array.isArray(req.ips) ? req.ips.map((v) => String(v || "").trim()).filter(Boolean) : [];

		try {
			await sendTemplatedEmail({
				to: ADMIN_FEATURE_REQUEST_EMAIL,
				template: "featureRequest",
				replyTo: requesterEmail || undefined,
				data: {
					requesterName,
					requesterEmail,
					requesterUserId,
					requesterUserName,
					requesterDisplayName,
					requesterRole,
					requesterCreatedAt,
					message,
					userAgent,
					acceptLanguage,
					referer: referer || context.referrer || "",
					forwardedFor,
					ip,
					ips,
					context,
					submittedAt: new Date().toISOString()
				}
			});
			return res.json({ ok: true });
		} catch (error) {
			return res.status(500).json({ error: error?.message || "Failed to send feature request." });
		}
	});

	// Support report (e.g. Landscape modal troubleshooting): same admin email, rich payload
	router.post("/api/support-report", async (req, res) => {
		const userBundle = await requireUser(req, res, queries);
		if (!userBundle) return;

		const report = req.body?.report && typeof req.body.report === "object" ? req.body.report : {};
		if (!process.env.RESEND_API_KEY || !process.env.RESEND_SYSTEM_EMAIL) {
			return res.status(503).json({ error: "Email is not configured on this environment." });
		}

		const { user, profile } = userBundle;
		const requesterEmail = String(user?.email || "").trim();
		const requesterName = getUserDisplayName({ user, profile });
		const requesterUserId = user?.id ?? null;
		const requesterUserName = typeof profile?.user_name === "string" ? profile.user_name.trim() : "";
		const requesterDisplayName = typeof profile?.display_name === "string" ? profile.display_name.trim() : "";
		const userAgent = String(req.get("user-agent") || "").trim();
		const acceptLanguage = String(req.get("accept-language") || "").trim();
		const referer = String(req.get("referer") || "").trim();
		const ip = String(req.ip || "").trim();

		try {
			await sendTemplatedEmail({
				to: ADMIN_FEATURE_REQUEST_EMAIL,
				template: "supportReport",
				replyTo: requesterEmail || undefined,
				data: {
					requesterName,
					requesterEmail,
					requesterUserId,
					requesterUserName,
					requesterDisplayName,
					report,
					userAgent,
					acceptLanguage,
					referer,
					ip,
					submittedAt: new Date().toISOString()
				}
			});
			return res.json({ ok: true });
		} catch (error) {
			return res.status(500).json({ error: error?.message || "Failed to send support report." });
		}
	});

	return router;
}

