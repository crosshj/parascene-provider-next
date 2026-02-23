import crypto from "crypto";
import express from "express";
import Redis from "ioredis";

let redis = null;
function getRedis() {
	if (!redis) redis = Redis.fromEnv();
	return redis;
}

const SEEN_KEY_PREFIX = "policy:seen:";
const FINGERPRINT_TTL_SEC = 60 * 60 * 24; // 24h
const COOKIE_MAX_AGE_SEC = 30 * 24 * 60 * 60; // 30 days

/** Trim, strip control chars, limit length. */
function sanitizeUa(ua) {
	if (typeof ua !== "string") return "";
	const trimmed = ua.trim();
	const noControl = trimmed.replace(/[\x00-\x1F\x7F]/g, "");
	return noControl.slice(0, 200);
}

/** Fingerprint from UA + optional tz/screen only. No IP. Body or query for tz/screen. */
function buildFingerprint(req, bodyOrQuery) {
	const uaNorm = sanitizeUa(req.get?.("user-agent"));
	const tz = bodyOrQuery?.tz != null ? String(bodyOrQuery.tz).trim().slice(0, 64) : "";
	const screen = bodyOrQuery?.screen != null ? String(bodyOrQuery.screen).trim().slice(0, 32) : "";
	const parts = [uaNorm, tz, screen].filter(Boolean);
	const raw = parts.join("|");
	return crypto.createHash("sha256").update(raw, "utf8").digest("hex");
}

export default function createPolicyRoutes() {
	const router = express.Router();

	// GET /api/policy — READ ONLY. Safe to call often. Does not set cookies or write Redis.
	// Cookie is primary; optional short-lived fingerprint (no IP) is secondary.
	// Query: optional tz, screen (hints for fingerprint when no cookie).
	// Returns: { seen: boolean }
	router.get("/api/policy", async (req, res) => {
		try {
			if (req.cookies?.ps_cid) {
				return res.json({ seen: true });
			}
			const hash = buildFingerprint(req, req.query);
			const key = SEEN_KEY_PREFIX + hash;
			const val = await getRedis().get(key);
			const seen = val != null;
			return res.json({ seen });
		} catch (err) {
			return res.status(500).json({ seen: null, error: "policy_unavailable" });
		}
	});

	// POST /api/policy/seen — WRITE / INIT. MUST: mutating by design (may set cookie, write Redis).
	// Call only on first meaningful action (e.g. first Create click, or after first generation success).
	// MUST: Cookie ps_cid is the primary truth; we set it here when missing.
	// Body: optional tz, screen (fingerprint hints).
	// Returns: { ok: true, seen: true }
	router.post("/api/policy/seen", async (req, res) => {
		try {
			if (!req.cookies?.ps_cid) {
				res.cookie("ps_cid", crypto.randomUUID(), {
					httpOnly: true,
					secure: process.env.NODE_ENV === "production",
					sameSite: "lax",
					path: "/",
					maxAge: COOKIE_MAX_AGE_SEC * 1000
				});
			}
			const body = req.body && typeof req.body === "object" ? req.body : {};
			const hash = buildFingerprint(req, body);
			const key = SEEN_KEY_PREFIX + hash;
			await getRedis().set(key, "1", "EX", FINGERPRINT_TTL_SEC); return res.json({ ok: true, seen: true });
		} catch (err) {
			return res.status(500).json({ ok: false, error: "policy_unavailable" });
		}
	});

	return router;
}
