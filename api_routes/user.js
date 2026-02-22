import crypto from "crypto";
import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import Busboy from "busboy";
import path from "path";
import sharp from "sharp";
import Stripe from "stripe";
import { sendTemplatedEmail } from "../email/index.js";
import { getEffectiveEmailRecipient } from "./utils/emailSettings.js";
import {
	COOKIE_NAME,
	ONE_WEEK_MS,
	clearAuthCookie,
	getJwtSecret,
	hashToken,
	setAuthCookie,
	shouldLogSession
} from "./auth.js";
import { getBaseAppUrl, getBaseAppUrlForEmail, getThumbnailUrl } from "./utils/url.js";
import { computeWelcome, WELCOME_VERSION } from "./utils/welcome.js";
import { resolveNotificationDisplay } from "./utils/notificationResolver.js";
import { collapseNotificationsByCreation, getCreationIdFromRow } from "./utils/notificationCollapse.js";

export default function createProfileRoutes({ queries }) {
	const router = express.Router();


	function sanitizeReturnUrl(raw) {
		const value = typeof raw === "string" ? raw.trim() : "";
		if (!value) return "/";
		if (!value.startsWith("/")) return "/";
		if (value.startsWith("//")) return "/";
		if (value.includes("://")) return "/";
		if (value.includes("\n") || value.includes("\r")) return "/";
		if (value.length > 2048) return "/";
		return value;
	}

	function getReturnUrl(req) {
		const bodyValue = req?.body?.returnUrl;
		const queryValue = req?.query?.returnUrl;
		return sanitizeReturnUrl(typeof bodyValue === "string" ? bodyValue : (typeof queryValue === "string" ? queryValue : ""));
	}

	function safeJsonParse(value, fallback) {
		if (value == null) return fallback;
		if (typeof value === "object") return value;
		if (typeof value !== "string") return fallback;
		const trimmed = value.trim();
		if (!trimmed) return fallback;
		try {
			return JSON.parse(trimmed);
		} catch {
			return fallback;
		}
	}

	function normalizeUsername(input) {
		const raw = typeof input === "string" ? input.trim() : "";
		if (!raw) return null;
		const normalized = raw.toLowerCase();
		// Simple, stable public handle rules (expand later if needed)
		if (!/^[a-z0-9][a-z0-9_]{2,23}$/.test(normalized)) return null;
		return normalized;
	}

	function normalizeProfileRow(row) {
		if (!row) {
			return {
				user_name: null,
				display_name: null,
				about: null,
				character_description: null,
				socials: {},
				avatar_url: null,
				cover_image_url: null,
				badges: [],
				meta: {},
				created_at: null,
				updated_at: null
			};
		}
		const meta = safeJsonParse(row.meta, {});
		return {
			user_name: row.user_name ?? null,
			display_name: row.display_name ?? null,
			about: row.about ?? null,
			character_description: typeof meta.character_description === "string" ? meta.character_description : null,
			socials: safeJsonParse(row.socials, {}),
			avatar_url: row.avatar_url ?? null,
			cover_image_url: row.cover_image_url ?? null,
			badges: safeJsonParse(row.badges, []),
			meta,
			created_at: row.created_at ?? null,
			updated_at: row.updated_at ?? null
		};
	}

	async function suggestAvailableUsername({ base, userId } = {}) {
		const normalizedBase = normalizeUsername(base);
		if (!normalizedBase) return null;

		// Fast path: available already
		if (queries.selectUserProfileByUsername?.get) {
			const existing = await queries.selectUserProfileByUsername.get(normalizedBase);
			if (!existing || Number(existing.user_id) === Number(userId)) {
				return normalizedBase;
			}
		} else {
			// If we can't check availability, just return the base.
			return normalizedBase;
		}

		// Suffix probing: john_1, john_2, ...
		for (let i = 1; i <= 200; i++) {
			const suffix = `_${i}`;
			const maxBaseLen = 24 - suffix.length;
			let candidateBase = normalizedBase.slice(0, Math.max(1, maxBaseLen));
			candidateBase = candidateBase.replace(/_+$/g, "");
			if (!candidateBase) candidateBase = "user";
			const candidate = normalizeUsername(`${candidateBase}${suffix}`);
			if (!candidate) continue;

			const existing = await queries.selectUserProfileByUsername.get(candidate);
			if (!existing || Number(existing.user_id) === Number(userId)) {
				return candidate;
			}
		}

		return null;
	}

	async function resolveTargetUserFromParams(req, { allowUsername = false } = {}) {
		if (allowUsername && typeof req.params?.username === "string" && req.params.username.trim()) {
			const normalizedUserName = normalizeUsername(req.params.username);
			if (!normalizedUserName) {
				return { error: { status: 400, body: { error: "Invalid username" } } };
			}
			if (!queries.selectUserProfileByUsername?.get) {
				return { error: { status: 500, body: { error: "Username lookup unavailable" } } };
			}
			const profile = await queries.selectUserProfileByUsername.get(normalizedUserName);
			const targetUserId = Number.parseInt(String(profile?.user_id ?? ""), 10);
			if (!Number.isFinite(targetUserId) || targetUserId <= 0) {
				return { error: { status: 404, body: { error: "User not found" } } };
			}
			const target = await queries.selectUserById.get(targetUserId);
			if (!target) {
				return { error: { status: 404, body: { error: "User not found" } } };
			}
			return { targetUserId, target };
		}

		const targetUserId = Number.parseInt(String(req.params?.id ?? ""), 10);
		if (!Number.isFinite(targetUserId) || targetUserId <= 0) {
			return { error: { status: 400, body: { error: "Invalid user id" } } };
		}
		const target = await queries.selectUserById.get(targetUserId);
		if (!target) {
			return { error: { status: 404, body: { error: "User not found" } } };
		}
		return { targetUserId, target };
	}

	function extractGenericKey(url) {
		const raw = typeof url === "string" ? url.trim() : "";
		if (!raw) return null;
		if (!raw.startsWith("/api/images/generic/")) return null;
		const tail = raw.slice("/api/images/generic/".length);
		if (!tail) return null;
		// Decode each path segment to rebuild the storage key safely.
		const segments = tail.split("/").filter(Boolean).map((seg) => {
			try {
				return decodeURIComponent(seg);
			} catch {
				return seg;
			}
		});
		return segments.join("/");
	}

	function buildGenericUrl(key) {
		const segments = String(key || "")
			.split("/")
			.filter(Boolean)
			.map((seg) => encodeURIComponent(seg));
		return `/api/images/generic/${segments.join("/")}`;
	}

	function parseJsonField(raw, fallback, errorMessage) {
		if (raw == null || raw === "") return fallback;
		if (typeof raw === "object") return raw;
		if (typeof raw !== "string") return fallback;
		try {
			return JSON.parse(raw);
		} catch {
			const err = new Error(errorMessage || "Invalid JSON");
			err.code = "INVALID_JSON";
			throw err;
		}
	}

	function parseMultipart(req, { maxFileBytes = 12 * 1024 * 1024 } = {}) {
		return new Promise((resolve, reject) => {
			const busboy = Busboy({
				headers: req.headers,
				limits: {
					fileSize: maxFileBytes,
					files: 2,
					fields: 50
				}
			});

			const fields = {};
			const files = {};

			busboy.on("field", (name, value) => {
				fields[name] = value;
			});

			busboy.on("file", (name, file, info) => {
				const { filename, mimeType } = info || {};
				const chunks = [];
				let total = 0;

				file.on("data", (data) => {
					total += data.length;
					chunks.push(data);
				});

				file.on("limit", () => {
					const err = new Error("File too large");
					err.code = "FILE_TOO_LARGE";
					reject(err);
				});

				file.on("end", () => {
					if (total === 0) return;
					files[name] = {
						filename: filename || "",
						mimeType: mimeType || "application/octet-stream",
						buffer: Buffer.concat(chunks)
					};
				});
			});

			busboy.on("error", (error) => reject(error));
			busboy.on("finish", () => resolve({ fields, files }));

			req.pipe(busboy);
		});
	}

	router.post("/signup", async (req, res) => {
		const email = String(req.body.username || req.body.email || "")
			.trim()
			.toLowerCase();
		const password = String(req.body.password || "");
		const returnUrl = getReturnUrl(req);

		if (!email || !password) {
			return res.status(400).send("Email and password are required.");
		}

		const existingUser = await queries.selectUserByEmail.get(email);
		if (existingUser) {
			const qs = new URLSearchParams();
			qs.set("error", "email_taken");
			if (returnUrl && returnUrl !== "/") {
				qs.set("returnUrl", returnUrl);
			}
			const queryString = qs.toString();
			const url = queryString ? `/auth?${queryString}#signup` : "/auth?error=email_taken#signup";
			return res.redirect(url);
		}

		const passwordHash = bcrypt.hashSync(password, 12);
		const info = await queries.insertUser.run(email, passwordHash, "consumer");
		// Support both insertId (standardized) and lastInsertRowid (legacy SQLite)
		const userId = info.insertId || info.lastInsertRowid;

		// Initialize credits for new user with 100 starting credits
		try {
			await queries.insertUserCredits.run(userId, 100, null);
		} catch (error) {
			// console.error(`[Signup] Failed to initialize credits for user ${userId}:`, {
			// 	error: error.message,
			// 	stack: error.stack,
			// 	name: error.name
			// });
			// Don't fail signup if credits initialization fails
		}

		const token = jwt.sign({ userId }, getJwtSecret(), { expiresIn: "7d" });
		setAuthCookie(res, token, req);
		if (queries.insertSession) {
			const tokenHash = hashToken(token);
			const expiresAt = new Date(Date.now() + ONE_WEEK_MS).toISOString();
			if (shouldLogSession()) {
				// console.log(`[Signup] Creating session for new user ${userId}, expires at: ${expiresAt}`);
			}
			try {
				await queries.insertSession.run(userId, tokenHash, expiresAt);
				if (shouldLogSession()) {
					// console.log(`[Signup] Session created successfully for user ${userId}`);
				}
			} catch (error) {
				if (shouldLogSession()) {
					// console.error(`[Signup] Failed to create session for user ${userId}:`, {
					// 	error: error.message,
					// 	stack: error.stack,
					// 	name: error.name
					// });
				}
				// Don't fail signup if session creation fails - cookie is still set
			}
		}

		return res.redirect(returnUrl || "/");
	});

	router.post("/login", async (req, res) => {
		const raw = String(req.body.username || req.body.email || "").trim();
		const password = String(req.body.password || "");
		const returnUrl = getReturnUrl(req);

		if (!raw || !password) {
			return res.status(400).send("Email/username and password are required.");
		}

		let user = null;
		if (raw.includes("@")) {
			user = await queries.selectUserByEmail.get(raw.toLowerCase());
		} else {
			const un = normalizeUsername(raw);
			if (un && queries.selectUserProfileByUsername?.get && queries.selectUserByIdForLogin?.get) {
				const profile = await queries.selectUserProfileByUsername.get(un);
				if (profile) user = await queries.selectUserByIdForLogin.get(profile.user_id);
			}
			if (!user) user = await queries.selectUserByEmail.get(raw.toLowerCase());
		}

		if (!user || !bcrypt.compareSync(password, user.password_hash)) {
			const qs = new URLSearchParams();
			if (returnUrl && returnUrl !== "/") {
				qs.set("returnUrl", returnUrl);
			}
			const queryString = qs.toString();
			const url = queryString ? `/auth.html?${queryString}#fail` : "/auth.html#fail";
			return res.redirect(url);
		}

		if (user.suspended) {
			const qs = new URLSearchParams();
			if (returnUrl && returnUrl !== "/") {
				qs.set("returnUrl", returnUrl);
			}
			const queryString = qs.toString();
			const url = queryString ? `/auth.html?${queryString}#suspended` : "/auth.html#suspended";
			return res.redirect(url);
		}

		const token = jwt.sign({ userId: user.id }, getJwtSecret(), {
			expiresIn: "7d"
		});
		setAuthCookie(res, token, req);
		if (queries.insertSession) {
			const tokenHash = hashToken(token);
			const expiresAt = new Date(Date.now() + ONE_WEEK_MS).toISOString();
			if (shouldLogSession()) {
				// console.log(`[Login] Creating session for user ${user.id}, expires at: ${expiresAt}`);
			}
			try {
				await queries.insertSession.run(user.id, tokenHash, expiresAt);
				if (shouldLogSession()) {
					// console.log(`[Login] Session created successfully for user ${user.id}`);
				}
			} catch (error) {
				if (shouldLogSession()) {
					// console.error(`[Login] Failed to create session for user ${user.id}:`, {
					// 	error: error.message,
					// 	stack: error.stack,
					// 	name: error.name
					// });
				}
				// Don't fail login if session creation fails - cookie is still set
			}
		}
		return res.redirect(returnUrl || "/");
	});

	router.post("/logout", async (req, res) => {
		if (queries.deleteSessionByTokenHash) {
			const token = req.cookies?.[COOKIE_NAME];
			if (token) {
				const tokenHash = hashToken(token);
				await queries.deleteSessionByTokenHash.run(
					tokenHash,
					req.auth?.userId
				);
			}
		}
		clearAuthCookie(res, req);
		// res.redirect("/auth");
		res.redirect("/");
	});

	router.post("/forgot-password", async (req, res) => {
		const raw = String(req.body.username || req.body.email || "").trim();
		if (!raw) {
			return res.redirect("/auth#sent");
		}
		let user = null;
		if (raw.includes("@")) {
			user = await queries.selectUserByEmail.get(raw.toLowerCase());
		} else {
			const un = normalizeUsername(raw);
			if (un && queries.selectUserProfileByUsername?.get && queries.selectUserById?.get) {
				const profile = await queries.selectUserProfileByUsername.get(un);
				if (profile) user = await queries.selectUserById.get(profile.user_id);
			}
			if (!user) user = await queries.selectUserByEmail.get(raw.toLowerCase());
		}
		if (user && queries.setPasswordResetToken) {
			const rawToken = crypto.randomBytes(32).toString("hex");
			const tokenHash = hashToken(rawToken);
			const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
			try {
				await queries.setPasswordResetToken.run(user.id, tokenHash, expiresAt);
				const resetUrl =
					`${getBaseAppUrlForEmail()}/auth?rt=` +
					encodeURIComponent(rawToken) +
					"#reset";
				const recipientName =
					typeof user.email === "string" && user.email.includes("@")
						? user.email.split("@")[0]
						: "there";
				if (process.env.RESEND_API_KEY && process.env.RESEND_SYSTEM_EMAIL) {
					const to = await getEffectiveEmailRecipient(queries, user.email);
					await sendTemplatedEmail({
						to,
						template: "passwordReset",
						data: { recipientName, resetUrl }
					});
				}
			} catch (err) {
				// Log but do not reveal failure; same response as success
			}
		}
		return res.redirect("/auth#sent");
	});

	router.post("/reset-password", async (req, res) => {
		const token = String(req.body.rt ?? "").trim();
		const password = String(req.body.password ?? "");
		if (!token || !password) {
			return res.redirect("/auth?error=invalid#reset");
		}
		if (!queries.selectUserByResetTokenHash || !queries.updateUserPassword || !queries.clearPasswordResetToken) {
			return res.redirect("/auth?error=invalid#reset");
		}
		const tokenHash = hashToken(token);
		const user = await queries.selectUserByResetTokenHash.get(tokenHash);
		if (!user || !user.meta) {
			return res.redirect("/auth?error=invalid#reset");
		}
		const expiresAt = user.meta.reset_token_expires_at;
		if (!expiresAt || new Date(expiresAt) < new Date()) {
			return res.redirect("/auth?error=invalid#reset");
		}
		const userId = Number(user.id);
		if (!Number.isFinite(userId) || userId < 1) {
			return res.redirect("/auth?error=invalid#reset");
		}
		try {
			const passwordHash = bcrypt.hashSync(password, 12);
			const updateResult = await queries.updateUserPassword.run(userId, passwordHash);
			if (updateResult?.changes !== undefined && updateResult.changes === 0) {
				throw new Error("Password update affected no rows");
			}
			await queries.clearPasswordResetToken.run(userId);
		} catch (err) {
			return res.redirect("/auth?error=invalid#reset");
		}
		return res.redirect("/auth#login");
	});

	router.get("/me", (req, res) => {
		res.json({ userId: req.auth?.userId || null });
	});

	// Username availability helper (used by /welcome)
	router.get("/api/username-suggest", async (req, res) => {
		if (!req.auth?.userId) {
			return res.status(401).json({ error: "Unauthorized" });
		}

		const raw = req.query?.user_name ?? req.query?.username ?? "";
		const base = typeof raw === "string" ? raw.trim() : "";
		const normalizedBase = normalizeUsername(base);
		if (!normalizedBase) {
			return res.status(400).json({
				error: "Invalid username",
				message: "Username must be 3-24 chars, lowercase letters/numbers/underscore, starting with a letter/number."
			});
		}

		const suggested = await suggestAvailableUsername({ base: normalizedBase, userId: req.auth.userId });
		if (!suggested) {
			return res.status(409).json({
				error: "No usernames available",
				message: "Unable to suggest an available username. Please try a different one."
			});
		}

		return res.json({
			ok: true,
			input: normalizedBase,
			suggested,
			available: suggested === normalizedBase
		});
	});

	router.get("/api/profile", async (req, res) => {
		if (!req.auth?.userId) {
			return res.status(401).json({ error: "Unauthorized" });
		}

		const user = await queries.selectUserById.get(req.auth.userId);
		if (!user) {
			return res.status(404).json({ error: "User not found" });
		}

		const profileRow = await queries.selectUserProfileByUserId?.get(req.auth.userId);
		const profile = normalizeProfileRow(profileRow);
		const welcome = computeWelcome({ profileRow });

		// Get credits balance
		let credits = await queries.selectUserCredits.get(req.auth.userId);
		// If no credits record exists, initialize with 100 for existing users
		if (!credits) {
			try {
				await queries.insertUserCredits.run(req.auth.userId, 100, null);
				credits = { balance: 100 };
			} catch (error) {
				// console.error(`[Profile] Failed to initialize credits for user ${req.auth.userId}:`, error);
				credits = { balance: 0 };
			}
		}

		const plan = user.meta?.plan ?? "free";
		const pendingPlanActivation = Boolean(user.meta?.pendingCheckoutSessionId);
		return res.json({ ...user, credits: credits.balance, plan, pendingPlanActivation, profile, welcome });
	});

	// Record that user returned from Stripe Checkout (store session id and timestamp for idempotency / state)
	router.post("/api/subscription/checkout-return", async (req, res) => {
		if (!req.auth?.userId) {
			return res.status(401).json({ error: "Unauthorized" });
		}
		const sessionId = typeof req.body?.sessionId === "string" ? req.body.sessionId.trim() : "";
		if (!sessionId || !sessionId.startsWith("cs_")) {
			return res.status(400).json({ error: "Invalid sessionId", message: "sessionId is required and must be a Stripe checkout session id." });
		}
		if (!queries.recordCheckoutReturn?.run) {
			return res.status(500).json({ error: "Not available", message: "Checkout return recording is not available." });
		}
		try {
			const returnedAt = new Date().toISOString();
			await queries.recordCheckoutReturn.run(req.auth.userId, sessionId, returnedAt);
			return res.json({ ok: true });
		} catch (err) {
			console.error("[POST /api/subscription/checkout-return]", err);
			return res.status(500).json({ error: "Failed to record", message: err?.message || "Could not record checkout return." });
		}
	});

	// Start Stripe Checkout for Founder subscription
	router.post("/api/subscription/checkout", async (req, res) => {
		if (!req.auth?.userId) {
			return res.status(401).json({ error: "Unauthorized" });
		}
		const secretKey = process.env.STRIPE_SECRET_KEY;
		const priceId = process.env.STRIPE_PRICE_ID_FOUNDER;
		if (!secretKey || !priceId) {
			return res.status(503).json({
				error: "STRIPE_NOT_CONFIGURED",
				message: "Subscription checkout is not set up yet."
			});
		}
		try {
			const stripe = new Stripe(secretKey);
			const baseUrl = getBaseAppUrl();
			const user = await queries.selectUserById.get(req.auth.userId);
			const customerEmail = typeof user?.email === "string" && user.email.includes("@") ? user.email : undefined;
			const session = await stripe.checkout.sessions.create({
				mode: "subscription",
				line_items: [{ price: priceId, quantity: 1 }],
				client_reference_id: String(req.auth.userId),
				success_url: `${baseUrl}/pricing?success=1&session_id={CHECKOUT_SESSION_ID}`,
				cancel_url: `${baseUrl}/pricing?canceled=1`,
				...(customerEmail ? { customer_email: customerEmail } : {})
			});
			return res.json({ url: session.url });
		} catch (err) {
			console.error("[POST /api/subscription/checkout]", err);
			return res.status(500).json({
				error: "Checkout failed",
				message: err?.message || "Could not start checkout."
			});
		}
	});

	// Update current user's plan. When switching to free, cancel Stripe subscription if present.
	router.put("/api/profile/plan", async (req, res) => {
		try {
			if (!req.auth?.userId) {
				return res.status(401).json({ error: "Unauthorized", message: "You must be signed in to change your plan." });
			}
			const plan = req.body?.plan;
			if (plan !== "free" && plan !== "founder") {
				return res.status(400).json({ error: "Invalid plan", message: "plan must be 'free' or 'founder'" });
			}
			if (!queries.updateUserPlan?.run) {
				return res.status(500).json({ error: "Plan update not available", message: "Plan updates are not available." });
			}
			const userId = req.auth.userId;
			// Capture subscription id before we change anything (needed for Stripe cancel).
			const userBefore = await queries.selectUserById.get(userId);
			let subscriptionId = null;
			if (plan === "free" && userBefore?.meta) {
				const raw = userBefore.meta.stripeSubscriptionId;
				if (typeof raw === "string" && raw.trim()) {
					subscriptionId = raw.trim();
				} else if (raw && typeof raw === "object" && typeof raw.id === "string") {
					subscriptionId = raw.id.trim();
				}
			}
			// Only cancel in Stripe if we have a valid-looking subscription id (e.g. sub_xxx)
			if (subscriptionId && !subscriptionId.startsWith("sub_")) {
				subscriptionId = null;
			}

			// Write target state to DB before calling Stripe (DB records that we are transitioning to this plan).
			await queries.updateUserPlan.run(userId, plan);
			if (plan === "free" && queries.updateUserStripeSubscriptionId?.run) {
				let stripeCancelFailed = false;
				if (subscriptionId) {
					const stripeSecret = process.env.STRIPE_SECRET_KEY;
					if (stripeSecret) {
						try {
							const stripe = new Stripe(stripeSecret);
							await stripe.subscriptions.cancel(subscriptionId);
						} catch (stripeErr) {
							console.error("[PUT /api/profile/plan] Stripe cancel failed:", stripeErr?.message || stripeErr);
							stripeCancelFailed = true;
						}
					}
				}
				// Always clear subscription id when switching to free so DB matches "no active subscription".
				await queries.updateUserStripeSubscriptionId.run(userId, null);
				if (stripeCancelFailed) {
					return res.status(502).json({
						error: "Cancel failed",
						message: "Could not cancel subscription. Please try again or contact support."
					});
				}
			}

			const user = await queries.selectUserById.get(userId);
			const newPlan = user?.meta?.plan === "founder" ? "founder" : "free";
			return res.json({ ok: true, plan: newPlan });
		} catch (err) {
			console.error("[PUT /api/profile/plan]", err);
			return res.status(500).json({ error: "Update failed", message: err?.message || "Could not update plan." });
		}
	});

	// Update current user's profile (user_profiles table)
	router.put("/api/profile", async (req, res) => {
		try {
			if (!req.auth?.userId) {
				return res.status(401).json({ error: "Unauthorized" });
			}

			const user = await queries.selectUserById.get(req.auth.userId);
			if (!user) {
				return res.status(404).json({ error: "User not found" });
			}

			const existingRow = await queries.selectUserProfileByUserId?.get(req.auth.userId);
			const existingProfile = normalizeProfileRow(existingRow);
			const existingUserName = typeof existingProfile.user_name === "string"
				? existingProfile.user_name.trim()
				: "";

			const rawUserName = req.body?.user_name ?? req.body?.username;
			const userName = normalizeUsername(rawUserName);
			const hasExistingUserName = Boolean(existingUserName);
			const hasUserNameInput = rawUserName !== undefined && rawUserName !== null;
			if (hasExistingUserName && hasUserNameInput) {
				// Username is permanent once set (admin override is a separate endpoint).
				if (!userName || userName !== existingUserName) {
					return res.status(409).json({
						error: "Username is permanent",
						message: "Username cannot be changed after it is set."
					});
				}
			} else if (typeof rawUserName === "string" && !userName) {
				return res.status(400).json({
					error: "Invalid username",
					message: "Username must be 3-24 chars, lowercase letters/numbers/underscore, starting with a letter/number."
				});
			}

			// Enforce uniqueness if username provided
			if (!hasExistingUserName && userName && queries.selectUserProfileByUsername?.get) {
				const existing = await queries.selectUserProfileByUsername.get(userName);
				if (existing && Number(existing.user_id) !== Number(req.auth.userId)) {
					return res.status(409).json({ error: "Username already taken" });
				}
			}

			const requestedMeta = typeof req.body?.meta === "object" && req.body.meta && !Array.isArray(req.body.meta)
				? req.body.meta
				: null;
			const nextMeta = {
				...(typeof existingProfile.meta === "object" && existingProfile.meta ? existingProfile.meta : {}),
				...(requestedMeta || {})
			};

			const finalUserName = hasExistingUserName
				? existingUserName
				: userName;

			if (finalUserName) {
				const legacy = nextMeta?.["onb_version"];
				const prev = Number(nextMeta.welcome_version ?? legacy);
				const prevVersion = Number.isFinite(prev) ? prev : 0;
				nextMeta.welcome_version = Math.max(prevVersion, WELCOME_VERSION);
				delete nextMeta["onb_version"];
			}
			nextMeta.character_description = typeof req.body?.character_description === "string" ? req.body.character_description.trim() || null : (existingProfile.meta?.character_description ?? null);

			const payload = {
				user_name: finalUserName,
				display_name: typeof req.body?.display_name === "string" ? req.body.display_name.trim() : null,
				about: typeof req.body?.about === "string" ? req.body.about.trim() : null,
				socials: typeof req.body?.socials === "object" && req.body.socials ? req.body.socials : {},
				avatar_url: typeof req.body?.avatar_url === "string" ? req.body.avatar_url.trim() : null,
				cover_image_url: typeof req.body?.cover_image_url === "string" ? req.body.cover_image_url.trim() : null,
				badges: Array.isArray(req.body?.badges) ? req.body.badges : [],
				meta: nextMeta
			};

			if (!queries.upsertUserProfile?.run) {
				return res.status(500).json({ error: "Profile storage not available" });
			}

			await queries.upsertUserProfile.run(req.auth.userId, payload);
			let updatedRow = await queries.selectUserProfileByUserId?.get(req.auth.userId);
			let profile = normalizeProfileRow(updatedRow);

			const welcomeComplete = req.body?.welcome_complete === true;
			const avatarUrl = payload.avatar_url || "";
			const tryPrefix = "/api/try/images/";
			const anonCid = typeof req.cookies?.ps_cid === "string" ? req.cookies.ps_cid.trim() : null;
			const avatarFilename =
				avatarUrl.includes(tryPrefix) && avatarUrl.split(tryPrefix)[1]
					? (avatarUrl.split(tryPrefix)[1].split("/")[0].split("?")[0].trim() || null)
					: null;

			// Transition try images (N) for this anon_cid into created_images (unpublished). Copy to user, then remove from try storage and DB. Idempotent via meta.source_anon_id.
			if (
				welcomeComplete &&
				anonCid &&
				queries.selectTryRequestsByCid?.all &&
				queries.selectCreatedImagesAnonByIds?.all &&
				queries.selectCreatedImagesForUser?.all &&
				queries.insertCreatedImage?.run &&
				queries.updateTryRequestsTransitionedByCreatedImageAnonId?.run &&
				queries.deleteCreatedImageAnon?.run
			) {
				try {
					const storage = req.app?.locals?.storage;
					if (storage?.getImageBufferAnon && storage?.uploadImage && storage?.deleteImageAnon) {
						const existingCreations = await queries.selectCreatedImagesForUser.all(req.auth.userId, { limit: 500 });
						const sourceAnonIds = new Set(
							(existingCreations || [])
								.map((c) => (c.meta && typeof c.meta === "object" && c.meta.source_anon_id != null ? Number(c.meta.source_anon_id) : null))
								.filter((id) => Number.isFinite(id))
						);
						const reqs = await queries.selectTryRequestsByCid.all(anonCid);
						const anonIds = [...new Set((reqs || []).map((r) => r.created_image_anon_id).filter(Boolean))];
						if (anonIds.length > 0) {
							const images = await queries.selectCreatedImagesAnonByIds.all(anonIds);
							const byId = new Map((images || []).map((i) => [i.id, i]));
							for (const id of anonIds) {
								const row = byId.get(id);
								if (
									!row ||
									row.status !== "completed" ||
									!row.filename ||
									row.filename.includes("..") ||
									row.filename.includes("/")
								)
									continue;
								if (avatarFilename && row.filename === avatarFilename) continue;
								const alreadyHas = sourceAnonIds.has(Number(row.id));
								try {
									let createdImageId = null;
									if (!alreadyHas) {
										const buffer = await storage.getImageBufferAnon(row.filename);
										const newFilename = `transition_${req.auth.userId}_${row.id}_${Date.now()}.png`;
										const newUrl = await storage.uploadImage(buffer, newFilename);
										const meta = row.meta && typeof row.meta === "object" ? { ...row.meta, source_anon_id: row.id } : { source_anon_id: row.id };
										const insertResult = await queries.insertCreatedImage.run(
											req.auth.userId,
											newFilename,
											newUrl,
											row.width ?? 1024,
											row.height ?? 1024,
											null,
											"completed",
											meta
										);
										createdImageId = insertResult?.insertId ?? insertResult?.lastInsertRowid;
									} else {
										const existing = (existingCreations || []).find((c) => c.meta?.source_anon_id === row.id || c.meta?.source_anon_id === Number(row.id));
										createdImageId = existing?.id;
									}
									if (createdImageId != null) {
										await queries.updateTryRequestsTransitionedByCreatedImageAnonId.run(row.id, {
											userId: req.auth.userId,
											createdImageId
										});
									}
									await queries.deleteCreatedImageAnon.run(row.id);
									await storage.deleteImageAnon(row.filename);
								} catch (err) {
									// skip this image, continue with others
								}
							}
						}
					}
				} catch (transitionErr) {
					// non-fatal; profile and avatar block still run
				}
			}

			// Welcome complete: promote try avatar to creations, create created_image row, and publish
			if (welcomeComplete && avatarUrl.includes(tryPrefix)) {
				const storage = req.app?.locals?.storage;
				const afterPrefix = avatarUrl.split(tryPrefix)[1];
				const filename = afterPrefix ? afterPrefix.split("/")[0].split("?")[0].trim() : "";
				if (
					filename &&
					!filename.includes("..") &&
					storage?.getImageBufferAnon &&
					storage?.uploadImage &&
					queries.insertCreatedImage?.run &&
					queries.publishCreatedImage?.run &&
					queries.insertFeedItem?.run
				) {
					try {
						const buffer = await storage.getImageBufferAnon(filename);
						const newFilename = `welcome_${req.auth.userId}_${Date.now()}.png`;
						const newUrl = await storage.uploadImage(buffer, newFilename);
						const avatarPrompt = typeof req.body?.avatar_prompt === "string" ? req.body.avatar_prompt.trim() || null : null;
						const avatarAnonRow = await queries.selectCreatedImageAnonByFilename?.get?.(filename);
						const welcomeMeta = {
							...(avatarPrompt ? { args: { prompt: avatarPrompt } } : {}),
							...(avatarAnonRow?.id != null ? { source_anon_id: avatarAnonRow.id } : {})
						};
						const welcomeMetaOrNull = Object.keys(welcomeMeta).length > 0 ? welcomeMeta : null;
						const insertResult = await queries.insertCreatedImage.run(
							req.auth.userId,
							newFilename,
							newUrl,
							1024,
							1024,
							null,
							"completed",
							welcomeMetaOrNull
						);
						const createdImageId = insertResult?.insertId ?? insertResult?.lastInsertRowid;
						if (createdImageId) {
							payload.avatar_url = newUrl;
							await queries.upsertUserProfile.run(req.auth.userId, payload);
							const title = payload.display_name
								? `Welcome @${String(payload.user_name).trim()}`
								: "Profile portrait";
							const description = avatarPrompt || (payload.meta?.character_description ?? "").trim() || "";
							await queries.publishCreatedImage.run(
								createdImageId,
								req.auth.userId,
								title,
								description || null,
								false
							);
							const feedAuthor = (payload.display_name && String(payload.display_name).trim()) || user?.email || "User";
							await queries.insertFeedItem.run(title, description, feedAuthor, null, createdImageId);
						}
						// Record transition on try_requests and remove anon row + file
						if (avatarAnonRow?.id && createdImageId && queries.updateTryRequestsTransitionedByCreatedImageAnonId?.run && queries.deleteCreatedImageAnon?.run && storage?.deleteImageAnon) {
							try {
								await queries.updateTryRequestsTransitionedByCreatedImageAnonId.run(avatarAnonRow.id, {
									userId: req.auth.userId,
									createdImageId
								});
								await queries.deleteCreatedImageAnon.run(avatarAnonRow.id);
								await storage.deleteImageAnon(avatarAnonRow.filename);
							} catch (_) {}
						}
						updatedRow = await queries.selectUserProfileByUserId?.get(req.auth.userId);
						profile = normalizeProfileRow(updatedRow);
					} catch (promoteErr) {
						// Profile already saved with try URL; log and return success
						// console.warn("Welcome avatar promote failed:", promoteErr?.message || promoteErr);
					}
				}
			}

			return res.json({ ok: true, profile });
		} catch (error) {
			// console.error("Error updating profile:", error);
			return res.status(500).json({ error: "Internal server error" });
		}
	});

	// Change current user's email (requires current password)
	router.put("/api/account/email", async (req, res) => {
		try {
			if (!req.auth?.userId) {
				return res.status(401).json({ error: "Unauthorized" });
			}
			const userId = req.auth.userId;
			const newEmail = typeof req.body?.new_email === "string" ? req.body.new_email.trim().toLowerCase() : "";
			const password = String(req.body?.password ?? "");

			if (!newEmail) {
				return res.status(400).json({ error: "New email is required" });
			}
			if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
				return res.status(400).json({ error: "Invalid email format" });
			}
			if (!password) {
				return res.status(400).json({ error: "Current password is required to change email" });
			}

			const authUser = await queries.selectUserByIdForLogin?.get(userId);
			if (!authUser || !bcrypt.compareSync(password, authUser.password_hash)) {
				return res.status(401).json({ error: "Incorrect password" });
			}

			const existingByEmail = await queries.selectUserByEmail.get(newEmail);
			if (existingByEmail && Number(existingByEmail.id) !== Number(userId)) {
				return res.status(409).json({ error: "Email already in use", message: "That email is already associated with another account." });
			}

			if (!queries.updateUserEmail?.run) {
				return res.status(500).json({ error: "Email update not available" });
			}
			const { changes } = await queries.updateUserEmail.run(userId, newEmail);
			if (changes === 0) {
				return res.status(409).json({ error: "Email already in use", message: "That email is already associated with another account." });
			}
			return res.json({ ok: true, email: newEmail });
		} catch (err) {
			console.error("[PUT /api/account/email]", err);
			return res.status(500).json({ error: "Update failed", message: err?.message || "Could not update email." });
		}
	});

	// Update current user's profile via multipart form (server uploads images and deletes previous)
	router.post("/api/profile", async (req, res) => {
		try {
			if (!req.auth?.userId) {
				return res.status(401).json({ error: "Unauthorized" });
			}

			const user = await queries.selectUserById.get(req.auth.userId);
			if (!user) {
				return res.status(404).json({ error: "User not found" });
			}

			if (!queries.upsertUserProfile?.run) {
				return res.status(500).json({ error: "Profile storage not available" });
			}

			const { fields, files } = await parseMultipart(req);

			const rawUserName = fields?.user_name ?? fields?.username;
			const userName = normalizeUsername(rawUserName);
			if (typeof rawUserName === "string" && rawUserName.trim() && !userName) {
				return res.status(400).json({
					error: "Invalid username",
					message: "Username must be 3-24 chars, lowercase letters/numbers/underscore, starting with a letter/number."
				});
			}

			if (userName && queries.selectUserProfileByUsername?.get) {
				const existing = await queries.selectUserProfileByUsername.get(userName);
				if (existing && Number(existing.user_id) !== Number(req.auth.userId)) {
					return res.status(409).json({ error: "Username already taken" });
				}
			}

			const existingRow = await queries.selectUserProfileByUserId?.get(req.auth.userId);
			const existingProfile = normalizeProfileRow(existingRow);
			const existingUserName = typeof existingProfile.user_name === "string"
				? existingProfile.user_name.trim()
				: "";
			const hasExistingUserName = Boolean(existingUserName);
			const hasUserNameInput = rawUserName !== undefined && rawUserName !== null && String(rawUserName).trim() !== "";
			if (hasExistingUserName && hasUserNameInput) {
				if (!userName || userName !== existingUserName) {
					return res.status(409).json({
						error: "Username is permanent",
						message: "Username cannot be changed after it is set."
					});
				}
			}

			const avatarRemove = Boolean(fields?.avatar_remove);
			const coverRemove = Boolean(fields?.cover_remove);
			const avatarFile = files?.avatar_file || null;
			const coverFile = files?.cover_file || null;

			const oldAvatarUrl = existingProfile.avatar_url || null;
			const oldCoverUrl = existingProfile.cover_image_url || null;
			const oldAvatarKey = extractGenericKey(oldAvatarUrl);
			const oldCoverKey = extractGenericKey(oldCoverUrl);

			const nextSocials = {
				...(typeof existingProfile.socials === "object" && existingProfile.socials ? existingProfile.socials : {})
			};
			if (typeof fields?.social_website === "string") {
				const website = fields.social_website.trim();
				if (website) nextSocials.website = website;
				else delete nextSocials.website;
			}

			const badges = parseJsonField(fields?.badges, existingProfile.badges || [], "Badges must be valid JSON.");
			if (!Array.isArray(badges)) {
				return res.status(400).json({ error: "Badges must be a JSON array" });
			}
			const meta = parseJsonField(fields?.meta, existingProfile.meta || {}, "Meta must be valid JSON.");
			if (meta == null || typeof meta !== "object" || Array.isArray(meta)) {
				return res.status(400).json({ error: "Meta must be a JSON object" });
			}
			if (hasExistingUserName) {
				const legacy = meta?.["onb_version"];
				const prev = Number(meta.welcome_version ?? legacy);
				const prevVersion = Number.isFinite(prev) ? prev : 0;
				meta.welcome_version = Math.max(prevVersion, WELCOME_VERSION);
				delete meta["onb_version"];
			} else if (userName) {
				const legacy = meta?.["onb_version"];
				const prev = Number(meta.welcome_version ?? legacy);
				const prevVersion = Number.isFinite(prev) ? prev : 0;
				meta.welcome_version = Math.max(prevVersion, WELCOME_VERSION);
				delete meta["onb_version"];
			}
			meta.character_description = typeof fields?.character_description === "string" ? fields.character_description.trim() || null : (existingProfile.meta?.character_description ?? null);

			let avatar_url = avatarRemove ? null : (oldAvatarUrl || null);
			let cover_image_url = coverRemove ? null : (oldCoverUrl || null);

			const now = Date.now();
			const rand = Math.random().toString(36).slice(2, 9);

			const pendingDeletes = [];

			const storage = req.app?.locals?.storage;
			if (!storage?.uploadGenericImage) {
				return res.status(500).json({ error: "Generic images storage not available" });
			}

			if (!avatarRemove && avatarFile?.buffer?.length) {
				let resized;
				try {
					resized = await sharp(avatarFile.buffer)
						.rotate()
						.resize(128, 128, { fit: "cover" })
						.png()
						.toBuffer();
				} catch {
					return res.status(400).json({ error: "Invalid avatar image" });
				}
				const key = `profile/${req.auth.userId}/avatar_${now}_${rand}.png`;
				const stored = await storage.uploadGenericImage(resized, key, {
					contentType: "image/png"
				});
				avatar_url = buildGenericUrl(stored);
				if (oldAvatarKey && storage.deleteGenericImage) pendingDeletes.push(oldAvatarKey);
			} else if (!avatarRemove && !avatarFile?.buffer?.length) {
				const tryUrl = typeof fields?.avatar_try_url === "string" ? fields.avatar_try_url.trim() : "";
				const tryPrefix = "/api/try/images/";
				if (tryUrl.startsWith(tryPrefix)) {
					const afterPrefix = tryUrl.slice(tryPrefix.length);
					const filename = afterPrefix ? afterPrefix.split("/")[0].split("?")[0].trim() : "";
					if (
						filename &&
						!filename.includes("..") &&
						!filename.includes("/") &&
						storage.getImageBufferAnon &&
						storage.uploadImage &&
						queries.insertCreatedImage?.run
					) {
						try {
							const avatarAnonRow = await queries.selectCreatedImageAnonByFilename?.get?.(filename);
							// Idempotent: if we already promoted this anon to a creation (e.g. retry or double-submit), reuse it and avoid saving twice.
							let createdImageId = null;
							let newUrl = null;
							if (avatarAnonRow?.id != null && queries.selectCreatedImagesForUser?.all) {
								const existingCreations = await queries.selectCreatedImagesForUser.all(req.auth.userId, { limit: 500 });
								const existing = (existingCreations || []).find(
									(c) => c.meta && typeof c.meta === "object" && (Number(c.meta.source_anon_id) === Number(avatarAnonRow.id))
								);
								if (existing && (existing.file_path || existing.filename)) {
									newUrl = existing.file_path || (existing.filename ? `/api/images/created/${existing.filename}` : null);
									createdImageId = existing.id;
								}
							}
							if (newUrl && createdImageId != null) {
								avatar_url = newUrl;
								if (oldAvatarKey && storage.deleteGenericImage) pendingDeletes.push(oldAvatarKey);
								if (queries.updateTryRequestsTransitionedByCreatedImageAnonId?.run && queries.deleteCreatedImageAnon?.run && storage.deleteImageAnon) {
									try {
										await queries.updateTryRequestsTransitionedByCreatedImageAnonId.run(avatarAnonRow.id, {
											userId: req.auth.userId,
											createdImageId
										});
										await queries.deleteCreatedImageAnon.run(avatarAnonRow.id);
										await storage.deleteImageAnon(avatarAnonRow.filename);
									} catch (_) {}
								}
							} else {
								const buffer = await storage.getImageBufferAnon(filename);
								const newFilename = `profile_avatar_${req.auth.userId}_${Date.now()}.png`;
								newUrl = await storage.uploadImage(buffer, newFilename);
								const promptText = (typeof meta?.character_description === "string" && meta.character_description.trim()) ? meta.character_description.trim() : null;
								const creationMeta = {
									...(promptText ? { args: { prompt: promptText } } : {}),
									...(avatarAnonRow?.id != null ? { source_anon_id: avatarAnonRow.id } : {})
								};
								const creationMetaOrNull = Object.keys(creationMeta).length > 0 ? creationMeta : null;
								const insertResult = await queries.insertCreatedImage.run(
									req.auth.userId,
									newFilename,
									newUrl,
									1024,
									1024,
									null,
									"completed",
									creationMetaOrNull
								);
								createdImageId = insertResult?.insertId ?? insertResult?.lastInsertRowid;
								if (createdImageId) {
									avatar_url = newUrl;
									if (oldAvatarKey && storage.deleteGenericImage) pendingDeletes.push(oldAvatarKey);
									if (avatarAnonRow?.id && queries.updateTryRequestsTransitionedByCreatedImageAnonId?.run && queries.deleteCreatedImageAnon?.run && storage.deleteImageAnon) {
										try {
											await queries.updateTryRequestsTransitionedByCreatedImageAnonId.run(avatarAnonRow.id, {
												userId: req.auth.userId,
												createdImageId
											});
											await queries.deleteCreatedImageAnon.run(avatarAnonRow.id);
											await storage.deleteImageAnon(avatarAnonRow.filename);
										} catch (_) {}
									}
								}
							}
						} catch (tryErr) {
							// non-fatal: leave avatar_url as existing or null
						}
					} else if (filename && !filename.includes("..") && !filename.includes("/") && storage.getImageBufferAnon) {
						// Fallback: copy to profile storage only (no creation)
						try {
							const buffer = await storage.getImageBufferAnon(filename);
							const resized = await sharp(buffer)
								.rotate()
								.resize(128, 128, { fit: "cover" })
								.png()
								.toBuffer();
							const key = `profile/${req.auth.userId}/avatar_${now}_${rand}.png`;
							const stored = await storage.uploadGenericImage(resized, key, {
								contentType: "image/png"
							});
							avatar_url = buildGenericUrl(stored);
							if (oldAvatarKey && storage.deleteGenericImage) pendingDeletes.push(oldAvatarKey);
							if (storage.deleteImageAnon && queries.selectCreatedImageAnonByFilename?.get && queries.deleteCreatedImageAnon?.run) {
								try {
									const anonRow = await queries.selectCreatedImageAnonByFilename.get(filename);
									if (anonRow?.id) {
										await queries.deleteCreatedImageAnon.run(anonRow.id);
										await storage.deleteImageAnon(filename);
									}
								} catch (_) {}
							}
						} catch (tryErr) {
							// non-fatal
						}
					}
				}
			}
			if (avatarRemove && oldAvatarKey && storage.deleteGenericImage) {
				pendingDeletes.push(oldAvatarKey);
			}

			if (!coverRemove && coverFile?.buffer?.length) {
				const ext = path.extname(coverFile.filename) || ".png";
				const key = `profile/${req.auth.userId}/cover_${now}_${rand}${ext}`;
				const stored = await storage.uploadGenericImage(coverFile.buffer, key, {
					contentType: coverFile.mimeType
				});
				cover_image_url = buildGenericUrl(stored);
				if (oldCoverKey && storage.deleteGenericImage) pendingDeletes.push(oldCoverKey);
			} else if (coverRemove && oldCoverKey && storage.deleteGenericImage) {
				pendingDeletes.push(oldCoverKey);
			}

			const payload = {
				user_name: hasExistingUserName ? existingUserName : (userName || null),
				display_name: typeof fields?.display_name === "string" ? fields.display_name.trim() : existingProfile.display_name || null,
				about: typeof fields?.about === "string" ? fields.about.trim() : existingProfile.about || null,
				socials: nextSocials,
				avatar_url,
				cover_image_url,
				badges,
				meta
			};

			await queries.upsertUserProfile.run(req.auth.userId, payload);
			const updatedRow = await queries.selectUserProfileByUserId?.get(req.auth.userId);
			const profile = normalizeProfileRow(updatedRow);

			// Best-effort delete old images after profile update.
			if (storage.deleteGenericImage && pendingDeletes.length > 0) {
				for (const key of pendingDeletes) {
					try {
						await storage.deleteGenericImage(key);
					} catch (error) {
						// console.warn("Failed to delete previous profile image:", error?.message || error);
					}
				}
			}

			return res.json({ ok: true, profile });
		} catch (error) {
			if (error?.code === "FILE_TOO_LARGE") {
				return res.status(413).json({ error: "Image too large" });
			}
			if (error?.code === "INVALID_JSON") {
				return res.status(400).json({ error: error.message || "Invalid JSON" });
			}
			// console.error("Error updating profile (multipart):", error);
			return res.status(500).json({ error: "Internal server error" });
		}
	});

	// Set current user's avatar from one of their creations (owner only)
	router.post("/api/profile/avatar-from-creation", async (req, res) => {
		try {
			if (!req.auth?.userId) {
				return res.status(401).json({ error: "Unauthorized" });
			}
			const creationId = req.body?.creation_id != null ? Number(req.body.creation_id) : null;
			if (!Number.isFinite(creationId) || creationId <= 0) {
				return res.status(400).json({ error: "Invalid creation_id" });
			}
			if (!queries.selectCreatedImageById?.get) {
				return res.status(500).json({ error: "Profile storage not available" });
			}
			const image = await queries.selectCreatedImageById.get(creationId, req.auth.userId);
			if (!image || Number(image.user_id) !== Number(req.auth.userId)) {
				return res.status(404).json({ error: "Creation not found or you do not own it" });
			}
			if (image.status !== "completed" || !image.filename || image.filename.includes("..") || image.filename.includes("/")) {
				return res.status(400).json({ error: "Creation image is not available" });
			}
			const storage = req.app?.locals?.storage;
			if (!storage?.getImageBuffer || !storage?.uploadGenericImage) {
				return res.status(500).json({ error: "Image storage not available" });
			}
			const existingRow = await queries.selectUserProfileByUserId?.get(req.auth.userId);
			const existingProfile = normalizeProfileRow(existingRow);
			const oldAvatarUrl = existingProfile.avatar_url || null;
			const oldAvatarKey = extractGenericKey(oldAvatarUrl);
			const buffer = await storage.getImageBuffer(image.filename);
			const now = Date.now();
			const rand = Math.random().toString(36).slice(2, 9);
			const resized = await sharp(buffer)
				.rotate()
				.resize(128, 128, { fit: "cover" })
				.png()
				.toBuffer();
			const key = `profile/${req.auth.userId}/avatar_${now}_${rand}.png`;
			const stored = await storage.uploadGenericImage(resized, key, { contentType: "image/png" });
			const avatar_url = buildGenericUrl(stored);
			const payload = {
				user_name: existingProfile.user_name ?? null,
				display_name: existingProfile.display_name ?? null,
				about: existingProfile.about ?? null,
				socials: existingProfile.socials ?? {},
				avatar_url,
				cover_image_url: existingProfile.cover_image_url ?? null,
				badges: existingProfile.badges ?? [],
				meta: existingProfile.meta ?? {}
			};
			await queries.upsertUserProfile.run(req.auth.userId, payload);
			if (oldAvatarKey && storage.deleteGenericImage) {
				try {
					await storage.deleteGenericImage(oldAvatarKey);
				} catch (_) {}
			}
			const updatedRow = await queries.selectUserProfileByUserId?.get(req.auth.userId);
			const profile = normalizeProfileRow(updatedRow);
			return res.json({ ok: true, profile });
		} catch (err) {
			// console.error("Error setting avatar from creation:", err);
			return res.status(500).json({ error: err?.message || "Internal server error" });
		}
	});

	// Public-ish profile summary (auth required for now)
	router.get(["/api/users/:id/profile", "/api/users/by-username/:username/profile"], async (req, res) => {
		try {
			if (!req.auth?.userId) {
				return res.status(401).json({ error: "Unauthorized" });
			}

			const viewer = await queries.selectUserById.get(req.auth.userId);
			if (!viewer) {
				return res.status(404).json({ error: "User not found" });
			}

			const resolved = await resolveTargetUserFromParams(req, { allowUsername: true });
			if (resolved?.error) {
				return res.status(resolved.error.status).json(resolved.error.body);
			}
			const targetUserId = resolved.targetUserId;
			const target = resolved.target;

			const emailPrefix = (() => {
				const email = String(target?.email || "").trim();
				if (!email) return null;
				const local = email.includes("@") ? email.split("@")[0] : email;
				const trimmed = local.trim();
				return trimmed || null;
			})();

			const isSelf = Number(targetUserId) === Number(req.auth.userId);
			const profileRow = await queries.selectUserProfileByUserId?.get(targetUserId);
			const profile = normalizeProfileRow(profileRow);

			const allCountRow = await queries.selectAllCreatedImageCountForUser?.get(targetUserId);
			const publishedCountRow = await queries.selectPublishedCreatedImageCountForUser?.get(targetUserId);
			const likesCountRow = await queries.selectLikesReceivedForUserPublished?.get(targetUserId);

			const stats = {
				creations_total: Number(allCountRow?.count ?? 0),
				creations_published: Number(publishedCountRow?.count ?? 0),
				likes_received: Number(likesCountRow?.count ?? 0),
				member_since: target.created_at ?? null
			};

			const viewerFollowsRow = isSelf
				? null
				: queries.selectUserFollowStatus?.get
					? await queries.selectUserFollowStatus.get(req.auth.userId, targetUserId)
					: null;
			const viewerFollows = Boolean(viewerFollowsRow?.viewer_follows);

			const publicUser = isSelf
				? { id: target.id, email: target.email, role: target.role, created_at: target.created_at }
				: { id: target.id, role: target.role, created_at: target.created_at, email_prefix: emailPrefix };

			const plan = target?.meta?.plan === "founder" ? "founder" : "free";
			return res.json({
				user: publicUser,
				profile,
				plan,
				stats,
				is_self: isSelf,
				viewer_follows: viewerFollows
			});
		} catch (error) {
			// console.error("Error loading user profile summary:", error);
			return res.status(500).json({ error: "Internal server error" });
		}
	});

	// Created images for a user (published-only unless viewer is owner and include=all)
	router.get(["/api/users/:id/created-images", "/api/users/by-username/:username/created-images"], async (req, res) => {
		try {
			if (!req.auth?.userId) {
				return res.status(401).json({ error: "Unauthorized" });
			}

			const viewer = await queries.selectUserById.get(req.auth.userId);
			if (!viewer) {
				return res.status(404).json({ error: "User not found" });
			}

			const resolved = await resolveTargetUserFromParams(req, { allowUsername: true });
			if (resolved?.error) {
				return res.status(resolved.error.status).json(resolved.error.body);
			}
			const targetUserId = resolved.targetUserId;

			const isSelf = Number(targetUserId) === Number(req.auth.userId);
			const isAdmin = viewer?.role === 'admin';
			const include = String(req.query?.include || "").toLowerCase();
			const wantAll = include === "all";
			const includeUnavailable = isAdmin && (wantAll || req.query?.includeUnavailable === "1");
			const limit = Math.min(200, Math.max(1, Number.parseInt(String(req.query?.limit ?? "24"), 10) || 24));
			const offset = Math.max(0, Number.parseInt(String(req.query?.offset ?? "0"), 10) || 0);
			const pagination = { limit, offset };

			let images = [];
			if ((isSelf || isAdmin) && wantAll && queries.selectCreatedImagesForUser?.all) {
				images = await queries.selectCreatedImagesForUser.all(targetUserId, { includeUnavailable, ...pagination });
			} else if (queries.selectPublishedCreatedImagesForUser?.all) {
				images = await queries.selectPublishedCreatedImagesForUser.all(targetUserId, pagination);
			} else if (queries.selectCreatedImagesForUser?.all) {
				// Fallback: filter in memory (no pagination)
				const all = await queries.selectCreatedImagesForUser.all(targetUserId, { includeUnavailable });
				images = Array.isArray(all) ? all.filter((img) => img?.published === 1 || img?.published === true).slice(offset, offset + limit) : [];
			}

			const mapped = (Array.isArray(images) ? images : []).map((img) => {
				const url = img.file_path || (img.filename ? `/api/images/created/${img.filename}` : null);
				const userDeleted = !!(img.unavailable_at != null && img.unavailable_at !== "");
				const status = img.status || "completed";
				const meta = typeof img.meta === "string" ? (() => { try { return JSON.parse(img.meta); } catch { return null; } })() : img.meta ?? null;
				const isModeratedError = (() => {
					if (status !== "failed" || meta == null) return false;
					try {
						const parts = [];
						if (typeof meta.error === "string" && meta.error.trim()) parts.push(meta.error.trim());
						const pe = meta.provider_error;
						if (pe != null && typeof pe === "object" && pe.body != null) {
							const b = pe.body;
							if (typeof b === "string") parts.push(b.trim());
							else if (typeof b === "object") {
								if (typeof b.error === "string" && b.error.trim()) parts.push(b.error.trim());
								else if (typeof b.message === "string" && b.message.trim()) parts.push(b.message.trim());
							}
						}
						const errorText = parts.join(" ").toLowerCase();
						return errorText.length > 0 && errorText.includes("moderated");
					} catch {
						return false;
					}
				})();
				return {
					id: img.id,
					filename: img.filename,
					url,
					thumbnail_url: getThumbnailUrl(url),
					width: img.width,
					height: img.height,
					color: img.color,
					status,
					created_at: img.created_at,
					published: img.published === 1 || img.published === true,
					published_at: img.published_at || null,
					title: img.title || null,
					description: img.description || null,
					is_moderated_error: isModeratedError,
					...(isAdmin && userDeleted ? { user_deleted: true } : {})
				};
			});

			const has_more = mapped.length === limit;
			return res.json({ images: mapped, has_more, is_self: isSelf, scope: isSelf && wantAll ? "all" : "published" });
		} catch (error) {
			// console.error("Error loading user created images:", error);
			return res.status(500).json({ error: "Internal server error" });
		}
	});

	// Creations this user has liked (published only; for profile Likes tab)
	router.get(["/api/users/:id/liked-creations", "/api/users/by-username/:username/liked-creations"], async (req, res) => {
		try {
			if (!req.auth?.userId) {
				return res.status(401).json({ error: "Unauthorized" });
			}
			const viewer = await queries.selectUserById.get(req.auth.userId);
			if (!viewer) {
				return res.status(404).json({ error: "User not found" });
			}
			const resolved = await resolveTargetUserFromParams(req, { allowUsername: true });
			if (resolved?.error) {
				return res.status(resolved.error.status).json(resolved.error.body);
			}
			const targetUserId = resolved.targetUserId;
			if (!queries.selectCreatedImagesLikedByUser?.all) {
				return res.json({ images: [], has_more: false });
			}
			const limit = Math.min(200, Math.max(1, Number.parseInt(String(req.query?.limit ?? "24"), 10) || 24));
			const offset = Math.max(0, Number.parseInt(String(req.query?.offset ?? "0"), 10) || 0);
			const images = await queries.selectCreatedImagesLikedByUser.all(targetUserId, { limit, offset });
			const mapped = (Array.isArray(images) ? images : []).map((img) => {
				const url = img.file_path || (img.filename ? `/api/images/created/${img.filename}` : null);
				return {
					id: img.id,
					filename: img.filename,
					url,
					thumbnail_url: getThumbnailUrl(url),
					width: img.width,
					height: img.height,
					color: img.color,
					created_at: img.created_at,
					title: img.title || null,
					description: img.description || null
				};
			});
			return res.json({ images: mapped, has_more: mapped.length === limit });
		} catch (error) {
			return res.status(500).json({ error: "Internal server error" });
		}
	});

	// Comments by this user with creation context (for profile Comments tab)
	router.get(["/api/users/:id/comments", "/api/users/by-username/:username/comments"], async (req, res) => {
		try {
			if (!req.auth?.userId) {
				return res.status(401).json({ error: "Unauthorized" });
			}
			const viewer = await queries.selectUserById.get(req.auth.userId);
			if (!viewer) {
				return res.status(404).json({ error: "User not found" });
			}
			const resolved = await resolveTargetUserFromParams(req, { allowUsername: true });
			if (resolved?.error) {
				return res.status(resolved.error.status).json(resolved.error.body);
			}
			const targetUserId = resolved.targetUserId;
			const limit = Math.min(200, Math.max(1, Number.parseInt(String(req.query?.limit ?? "20"), 10) || 20));
			const offset = Math.max(0, Number.parseInt(String(req.query?.offset ?? "0"), 10) || 0);
			const commentsRaw = await queries.selectCommentsByUser?.all(targetUserId, { limit, offset }) ?? [];
			const comments = (Array.isArray(commentsRaw) ? commentsRaw : []).map((c) => ({
				...c,
				created_image_thumbnail_url: c?.created_image_url ? getThumbnailUrl(c.created_image_url) : null
			}));
			return res.json({ comments, has_more: comments.length === limit });
		} catch (error) {
			return res.status(500).json({ error: "Internal server error" });
		}
	});

	router.get("/api/notifications", async (req, res) => {
		try {
			if (!req.auth?.userId) {
				return res.status(401).json({ error: "Unauthorized" });
			}

			const user = await queries.selectUserById.get(req.auth.userId);
			if (!user) {
				return res.status(404).json({ error: "User not found" });
			}

			const rows = await queries.selectNotificationsForUser.all(
				user.id,
				user.role
			);
			const resolved = await Promise.all(
				rows.map(async (row) => {
					const r = typeof row?.type === "string" && row.type.trim()
						? await resolveNotificationDisplay(row, queries)
						: null;
					let creationTitle = r?.creation_title ?? null;
					if (!creationTitle && row?.meta != null) {
						try {
							const meta = typeof row.meta === "string" ? JSON.parse(row.meta) : row.meta;
							creationTitle = typeof meta?.creation_title === "string" ? meta.creation_title.trim() : null;
						} catch {
							// ignore
						}
					}
					return {
						id: row.id,
						title: r?.title ?? row.title ?? "Notification",
						message: r?.message ?? row.message ?? "",
						link: r?.link ?? row.link ?? null,
						type: row.type ?? null,
						created_at: row.created_at,
						acknowledged_at: row.acknowledged_at,
						creation_id: getCreationIdFromRow(row),
						creation_title: creationTitle || null
					};
				})
			);
			const notifications = collapseNotificationsByCreation(resolved);
			return res.json({ notifications });
		} catch (error) {
			// console.error("Error loading notifications:", error);
			return res.status(500).json({ error: "Internal server error" });
		}
	});

	router.get("/api/notifications/unread-count", async (req, res) => {
		try {
			if (!req.auth?.userId) {
				return res.json({ count: 0 });
			}

			const user = await queries.selectUserById.get(req.auth.userId);
			if (!user) {
				return res.json({ count: 0 });
			}

			const result = await queries.selectUnreadNotificationCount.get(
				user.id,
				user.role
			);
			return res.json({ count: result?.count ?? 0 });
		} catch (error) {
			// console.error("Error loading unread notification count:", error);
			return res.json({ count: 0 });
		}
	});

	router.post("/api/notifications/acknowledge", async (req, res) => {
		try {
			if (!req.auth?.userId) {
				return res.status(401).json({ error: "Unauthorized" });
			}

			const user = await queries.selectUserById.get(req.auth.userId);
			if (!user) {
				return res.status(404).json({ error: "User not found" });
			}

			const id = Number(req.body?.id);
			if (!id) {
				return res.status(400).json({ error: "Notification id required" });
			}

			// When the notification is a comment/tip for a creation, we mark all notifications for that creation
			// as read (no per-sub-item state; the collapsed row is one unit).
			let result;
			try {
				if (queries.selectNotificationById?.get && queries.acknowledgeNotificationsForUserAndCreation?.run) {
					const row = await queries.selectNotificationById.get(id, user.id, user.role);
					if (!row) {
						return res.status(404).json({ error: "Notification not found" });
					}
					const creationId = getCreationIdFromRow(row);
					const type = typeof row.type === "string" ? row.type.trim() : null;
					const collapseTypes = new Set(["comment", "comment_thread", "tip"]);
					const acknowledgeByCreation = creationId != null && type && collapseTypes.has(type);
					result = acknowledgeByCreation
						? await queries.acknowledgeNotificationsForUserAndCreation.run(user.id, user.role, creationId)
						: await queries.acknowledgeNotificationById.run(id, user.id, user.role);
				} else {
					result = await queries.acknowledgeNotificationById.run(id, user.id, user.role);
				}
			} catch (ackError) {
				// Fallback: e.g. missing columns on older DB, or adapter quirk
				if (process.env.NODE_ENV !== "production") {
					console.error("Notification ack (by-creation path) failed, falling back to single ack:", ackError?.message ?? ackError);
				}
				result = await queries.acknowledgeNotificationById.run(id, user.id, user.role);
			}

			const updated = result?.changes ?? (typeof result?.updated === "number" ? result.updated : 0);
			return res.json({ ok: true, updated });
		} catch (error) {
			if (process.env.NODE_ENV !== "production") {
				console.error("Error acknowledging notification:", error?.message ?? error);
			}
			return res.status(500).json({ error: "Internal server error" });
		}
	});

	router.post("/api/notifications/acknowledge-all", async (req, res) => {
		try {
			if (!req.auth?.userId) {
				return res.status(401).json({ error: "Unauthorized" });
			}

			const user = await queries.selectUserById.get(req.auth.userId);
			if (!user) {
				return res.status(404).json({ error: "User not found" });
			}

			const result = await queries.acknowledgeAllNotificationsForUser.run(
				user.id,
				user.role
			);
			return res.json({ ok: true, updated: result.changes });
		} catch (error) {
			// console.error("Error acknowledging all notifications:", error);
			return res.status(500).json({ error: "Internal server error" });
		}
	});

	router.get("/api/credits", async (req, res) => {
		try {
			if (!req.auth?.userId) {
				return res.status(401).json({ error: "Unauthorized" });
			}

			const user = await queries.selectUserById?.get?.(req.auth.userId);
			const isAdmin = user?.role === "admin";

			const credits = await queries.selectUserCredits.get(req.auth.userId);

			// If no credits record exists, initialize with 100
			if (!credits) {
				try {
					await queries.insertUserCredits.run(req.auth.userId, 100, null);
					const newCredits = await queries.selectUserCredits.get(req.auth.userId);
					return res.json({
						balance: newCredits.balance,
						canClaim: isAdmin ? false : true,
						lastClaimDate: null
					});
				} catch (error) {
					// console.error("Error initializing credits:", error);
					return res.status(500).json({ error: "Internal server error" });
				}
			}

			// Check if can claim (last claim was not today in UTC). Admins cannot claim.
			let canClaim = (() => {
				if (isAdmin) return false;
				if (!credits.last_daily_claim_at) return true;
				const now = new Date();
				const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
				const lastClaimDate = new Date(credits.last_daily_claim_at);
				const lastClaimUTC = new Date(Date.UTC(lastClaimDate.getUTCFullYear(), lastClaimDate.getUTCMonth(), lastClaimDate.getUTCDate()));
				return lastClaimUTC.getTime() < todayUTC.getTime();
			})();

			return res.json({
				balance: credits.balance,
				canClaim,
				lastClaimDate: credits.last_daily_claim_at
			});
		} catch (error) {
			// console.error("Error loading credits:", error);
			return res.status(500).json({ error: "Internal server error" });
		}
	});

	router.post("/api/credits/claim", async (req, res) => {
		try {
			if (!req.auth?.userId) {
				return res.status(401).json({ error: "Unauthorized" });
			}

			const user = await queries.selectUserById?.get?.(req.auth.userId);
			if (user?.role === "admin") {
				return res.status(403).json({ error: "Admins cannot claim daily credits" });
			}

			const result = await queries.claimDailyCredits.run(req.auth.userId, 10);

			if (!result.success) {
				return res.status(400).json({
					success: false,
					balance: result.balance,
					message: result.message || "Daily credits already claimed today"
				});
			}

			return res.json({
				success: true,
				balance: result.balance,
				message: "Daily credits claimed successfully"
			});
		} catch (error) {
			// console.error("Error claiming daily credits:", error);
			return res.status(500).json({ error: "Internal server error" });
		}
	});

	router.post("/api/credits/tip", async (req, res) => {
		try {
			if (!req.auth?.userId) {
				return res.status(401).json({ error: "Unauthorized" });
			}

			if (!queries.transferCredits?.run) {
				return res.status(500).json({ error: "Credits transfer not available" });
			}

			const fromUserId = Number(req.auth.userId);
			const toUserId = Number(req.body?.toUserId);
			const rawAmount = Number(req.body?.amount);
			const amount = Math.round(rawAmount * 10) / 10;
			const rawCreatedImageId = req.body?.createdImageId;
			const createdImageId = rawCreatedImageId != null ? Number(rawCreatedImageId) : null;
			const rawMessage = req.body?.message;
			const message =
				typeof rawMessage === "string" ? rawMessage.trim() : "";

			if (!Number.isFinite(toUserId) || toUserId <= 0) {
				return res.status(400).json({ error: "Invalid recipient user id" });
			}
			if (!Number.isFinite(amount) || amount <= 0) {
				return res.status(400).json({ error: "Invalid amount" });
			}
			if (toUserId === fromUserId) {
				return res.status(400).json({ error: "Cannot tip yourself" });
			}

			if (message && message.length > 500) {
				return res.status(400).json({ error: "Message is too long" });
			}

			let creation = null;
			if (createdImageId !== null) {
				if (!Number.isFinite(createdImageId) || createdImageId <= 0) {
					return res.status(400).json({ error: "Invalid creation id" });
				}
				if (!queries.selectCreatedImageByIdAnyUser?.get) {
					return res.status(500).json({ error: "Creation lookup not available" });
				}
				creation = await queries.selectCreatedImageByIdAnyUser.get(createdImageId);
				if (!creation) {
					return res.status(404).json({ error: "Creation not found" });
				}
			}

			const sender = await queries.selectUserById.get(fromUserId);
			if (!sender) {
				return res.status(404).json({ error: "User not found" });
			}
			const senderProfile = await queries.selectUserProfileByUserId?.get(sender.id) ?? null;

			const recipient = await queries.selectUserById.get(toUserId);
			if (!recipient) {
				return res.status(404).json({ error: "Recipient not found" });
			}

			let transferResult;
			try {
				transferResult = await queries.transferCredits.run(fromUserId, toUserId, amount);
			} catch (error) {
				const message = String(error?.message || "");
				const code = error?.code || "";
				const isInsufficient =
					code === "INSUFFICIENT_CREDITS" ||
					message.toLowerCase().includes("insufficient");
				if (isInsufficient) {
					return res.status(400).json({ error: "Insufficient credits" });
				}
				const isSelfTip = message.toLowerCase().includes("tip yourself");
				if (isSelfTip) {
					return res.status(400).json({ error: "Cannot tip yourself" });
				}
				// console.error("Error transferring credits:", error);
				return res.status(500).json({ error: "Internal server error" });
			}

			// Log tip activity (best-effort; do not fail transfer on error)
			try {
				if (queries.insertTipActivity?.run) {
					const source = createdImageId != null ? "creation" : "admin";
					const meta = null;
					await queries.insertTipActivity.run(
						fromUserId,
						toUserId,
						createdImageId,
						amount,
						message || null,
						source,
						meta
					);
				}
			} catch {
				// ignore tip_activity failures
			}

			// Best-effort notification
			try {
				if (queries.insertNotification?.run) {
					const title = "You received a tip";
					const notifMessage = `Someone tipped you ${amount.toFixed(1)} credits.`;
					const link =
						createdImageId != null
							? `/creations/${encodeURIComponent(String(createdImageId))}`
							: "/";
					const target = createdImageId != null ? { creation_id: createdImageId } : {};
					const meta = { amount };
					await queries.insertNotification.run(toUserId, null, title, notifMessage, link, sender.id, "tip", target, meta);
				}
			} catch (error) {
				// console.error("Failed to insert tip notification:", error);
				// do not fail the transfer
			}

			const fromBalance =
				transferResult && typeof transferResult.fromBalance === "number"
					? transferResult.fromBalance
					: transferResult && typeof transferResult.from_balance === "number"
						? transferResult.from_balance
						: null;
			const toBalance =
				transferResult && typeof transferResult.toBalance === "number"
					? transferResult.toBalance
					: transferResult && typeof transferResult.to_balance === "number"
						? transferResult.to_balance
						: null;

			return res.json({
				success: true,
				fromBalance,
				toBalance
			});
		} catch (error) {
			// console.error("Error tipping credits:", error);
			return res.status(500).json({ error: "Internal server error" });
		}
	});

	return router;
}
