import express from "express";
import { buildProviderHeaders, resolveProviderAuthToken } from "./utils/providerAuth.js";
import { getEmailSettings } from "./utils/emailSettings.js";
import { getBaseAppUrlForEmail } from "./utils/url.js";
import { RELATED_PARAM_KEYS } from "../db/adapters/relatedParams.js";

/** Subscription ID stored in user.meta when admin grants founder status without payment. Not a Stripe ID. */
const GIFTED_FOUNDER_SUBSCRIPTION_ID = "gifted_founder";

export default function createAdminRoutes({ queries, storage }) {
	const router = express.Router();

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

	function normalizeProfileRow(row) {
		if (!row) {
			return {
				user_name: null,
				display_name: null,
				about: null,
				socials: {},
				avatar_url: null,
				cover_image_url: null,
				badges: [],
				meta: {},
				created_at: null,
				updated_at: null
			};
		}
		return {
			user_name: row.user_name ?? null,
			display_name: row.display_name ?? null,
			about: row.about ?? null,
			socials: safeJsonParse(row.socials, {}),
			avatar_url: row.avatar_url ?? null,
			cover_image_url: row.cover_image_url ?? null,
			badges: safeJsonParse(row.badges, []),
			meta: safeJsonParse(row.meta, {}),
			created_at: row.created_at ?? null,
			updated_at: row.updated_at ?? null
		};
	}

	function normalizeUsername(input) {
		const raw = typeof input === "string" ? input.trim() : "";
		if (!raw) return null;
		const normalized = raw.toLowerCase();
		if (!/^[a-z0-9][a-z0-9_]{2,23}$/.test(normalized)) return null;
		return normalized;
	}

	async function requireAdmin(req, res) {
		if (!req.auth?.userId) {
			res.status(401).json({ error: "Unauthorized" });
			return null;
		}

		const user = await queries.selectUserById.get(req.auth?.userId);
		if (!user) {
			res.status(404).json({ error: "User not found" });
			return null;
		}

		if (user.role !== 'admin') {
			res.status(403).json({ error: "Forbidden: Admin role required" });
			return null;
		}

		return user;
	}

	function extractGenericKey(url) {
		const raw = typeof url === "string" ? url.trim() : "";
		if (!raw) return null;
		if (!raw.startsWith("/api/images/generic/")) return null;
		const tail = raw.slice("/api/images/generic/".length);
		if (!tail) return null;
		// Decode each path segment to rebuild the storage key safely.
		const segments = tail
			.split("/")
			.filter(Boolean)
			.map((seg) => {
				try {
					return decodeURIComponent(seg);
				} catch {
					return seg;
				}
			});
		return segments.join("/");
	}

	router.get("/admin/users", async (req, res) => {
		const adminUser = await requireAdmin(req, res);
		if (!adminUser) return;

		const users = await queries.selectUsers.all();

		// Fetch credits for each user
		const usersWithCredits = await Promise.all(
			users.map(async (u) => {
				const credits = await queries.selectUserCredits.get(u.id);
				return {
					...u,
					credits: credits?.balance ?? 0
				};
			})
		);

		// Active: role === 'consumer' && !suspended, sorted by last_active_at desc (nulls last)
		const activeUsers = usersWithCredits
			.filter((u) => u.role === "consumer" && !u.suspended)
			.sort((a, b) => {
				const aAt = a.last_active_at ? new Date(a.last_active_at).getTime() : 0;
				const bAt = b.last_active_at ? new Date(b.last_active_at).getTime() : 0;
				return bAt - aAt;
			});

		// Other: role !== 'consumer' OR suspended (order undefined)
		const otherUsers = usersWithCredits.filter(
			(u) => u.role !== "consumer" || u.suspended
		);

		res.json({ activeUsers, otherUsers });
	});

	// Admin-only: update user suspend state (merge into users.meta.suspended).
	router.put("/admin/users/:id", async (req, res) => {
		const admin = await requireAdmin(req, res);
		if (!admin) return;

		const targetUserId = Number.parseInt(String(req.params?.id || ""), 10);
		if (!Number.isFinite(targetUserId) || targetUserId <= 0) {
			return res.status(400).json({ error: "Invalid user id" });
		}

		if (Number(targetUserId) === Number(admin.id)) {
			return res.status(400).json({ error: "Refusing to suspend current admin user" });
		}

		const target = await queries.selectUserById.get(targetUserId);
		if (!target) {
			return res.status(404).json({ error: "User not found" });
		}

		const suspended = req.body?.suspended;
		if (typeof suspended !== "boolean") {
			return res.status(400).json({ error: "suspended must be a boolean" });
		}

		if (!queries.updateUserSuspended?.run) {
			return res.status(500).json({ error: "User suspend update not available" });
		}

		await queries.updateUserSuspended.run(targetUserId, suspended);
		const updated = await queries.selectUserById.get(targetUserId);
		let creditsBalance = 0;
		try {
			const creditsRow = await queries.selectUserCredits.get(targetUserId);
			creditsBalance = creditsRow?.balance ?? 0;
		} catch {
			// ignore
		}
		res.json({
			ok: true,
			user: {
				...updated,
				suspended,
				credits: creditsBalance
			}
		});
	});

	function hasRealFounderSubscription(user) {
		const plan = user?.meta?.plan;
		const subId = user?.meta?.stripeSubscriptionId;
		return plan === "founder" && subId != null && String(subId).trim() !== "" && subId !== GIFTED_FOUNDER_SUBSCRIPTION_ID;
	}

	function hasGiftedFounder(user) {
		return user?.meta?.plan === "founder" && user?.meta?.stripeSubscriptionId === GIFTED_FOUNDER_SUBSCRIPTION_ID;
	}

	// Admin-only: grant founder status without payment (gifted founder). Not allowed for users who have a real Stripe subscription.
	router.post("/admin/users/:id/grant-founder", async (req, res) => {
		const admin = await requireAdmin(req, res);
		if (!admin) return;

		const targetUserId = Number.parseInt(String(req.params?.id || ""), 10);
		if (!Number.isFinite(targetUserId) || targetUserId <= 0) {
			return res.status(400).json({ error: "Invalid user id" });
		}

		const target = await queries.selectUserById.get(targetUserId);
		if (!target) {
			return res.status(404).json({ error: "User not found" });
		}

		if (hasRealFounderSubscription(target)) {
			return res.status(400).json({
				error: "User has a paid subscription",
				message: "Cannot grant gifted founder to a user who has already subscribed."
			});
		}

		if (!queries.updateUserPlan?.run || !queries.updateUserStripeSubscriptionId?.run) {
			return res.status(500).json({ error: "Founder update not available" });
		}

		await queries.updateUserPlan.run(targetUserId, "founder");
		await queries.updateUserStripeSubscriptionId.run(targetUserId, GIFTED_FOUNDER_SUBSCRIPTION_ID);
		const updated = await queries.selectUserById.get(targetUserId);
		let creditsBalance = 0;
		try {
			const creditsRow = await queries.selectUserCredits.get(targetUserId);
			creditsBalance = creditsRow?.balance ?? 0;
		} catch {
			// ignore
		}
		res.json({
			ok: true,
			user: {
				...updated,
				credits: creditsBalance
			}
		});
	});

	// Admin-only: revoke gifted founder status. Only allowed when user has the gifted_founder subscription id (not a real Stripe subscription).
	router.post("/admin/users/:id/revoke-founder", async (req, res) => {
		const admin = await requireAdmin(req, res);
		if (!admin) return;

		const targetUserId = Number.parseInt(String(req.params?.id || ""), 10);
		if (!Number.isFinite(targetUserId) || targetUserId <= 0) {
			return res.status(400).json({ error: "Invalid user id" });
		}

		const target = await queries.selectUserById.get(targetUserId);
		if (!target) {
			return res.status(404).json({ error: "User not found" });
		}

		if (!hasGiftedFounder(target)) {
			return res.status(400).json({
				error: "Not a gifted founder",
				message: "User does not have gifted founder status. Only gifted founder status can be revoked here."
			});
		}

		if (!queries.updateUserPlan?.run || !queries.updateUserStripeSubscriptionId?.run) {
			return res.status(500).json({ error: "Founder update not available" });
		}

		await queries.updateUserPlan.run(targetUserId, "free");
		await queries.updateUserStripeSubscriptionId.run(targetUserId, null);
		const updated = await queries.selectUserById.get(targetUserId);
		let creditsBalance = 0;
		try {
			const creditsRow = await queries.selectUserCredits.get(targetUserId);
			creditsBalance = creditsRow?.balance ?? 0;
		} catch {
			// ignore
		}
		res.json({
			ok: true,
			user: {
				...updated,
				credits: creditsBalance
			}
		});
	});

	// Admin-only: delete a user and clean up related content (likes, comments, images, etc).
	router.delete("/admin/users/:id", async (req, res) => {
		const admin = await requireAdmin(req, res);
		if (!admin) return;

		const targetUserId = Number.parseInt(String(req.params?.id || ""), 10);
		if (!Number.isFinite(targetUserId) || targetUserId <= 0) {
			return res.status(400).json({ error: "Invalid user id" });
		}

		if (Number(targetUserId) === Number(admin.id)) {
			return res.status(400).json({ error: "Refusing to delete current admin user" });
		}

		if (!queries?.deleteUserAndCleanup?.run) {
			return res.status(500).json({ error: "User deletion not available" });
		}

		const target = await queries.selectUserById.get(targetUserId);
		if (!target) {
			return res.status(404).json({ error: "User not found" });
		}

		// Pre-fetch assets to delete from storage (best-effort, after DB cleanup).
		// Includes all created images (e.g. welcome-flow avatar in creations bucket).
		let createdImages = [];
		try {
			if (queries.selectCreatedImagesForUser?.all) {
				createdImages = await queries.selectCreatedImagesForUser.all(targetUserId, {
					includeUnavailable: true,
					limit: 500
				});
			}
		} catch {
			createdImages = [];
		}

		let profileRow = null;
		try {
			profileRow = await queries.selectUserProfileByUserId?.get?.(targetUserId);
		} catch {
			profileRow = null;
		}

		const avatarKey = extractGenericKey(profileRow?.avatar_url);
		const coverKey = extractGenericKey(profileRow?.cover_image_url);
		const imageFilenames = (Array.isArray(createdImages) ? createdImages : [])
			.map((img) => String(img?.filename || "").trim())
			.filter(Boolean);

		let cleanupResult;
		try {
			cleanupResult = await queries.deleteUserAndCleanup.run(targetUserId);
		} catch (error) {
			return res.status(500).json({ error: "Failed to delete user", message: error?.message || String(error) });
		}

		// Best-effort storage cleanup: created images + profile images.
		if (storage?.deleteImage) {
			for (const filename of imageFilenames) {
				try {
					await storage.deleteImage(filename);
				} catch {
					// ignore
				}
			}
		}
		if (storage?.deleteGenericImage) {
			for (const key of [avatarKey, coverKey].filter(Boolean)) {
				try {
					await storage.deleteGenericImage(key);
				} catch {
					// ignore
				}
			}
		}

		return res.json({
			ok: true,
			deleted_user_id: targetUserId,
			result: cleanupResult ?? null
		});
	});

	// Admin-only: override a user's username (write-once for normal users).
	router.put("/admin/users/:id/username", async (req, res) => {
		const admin = await requireAdmin(req, res);
		if (!admin) return;

		const targetUserId = Number.parseInt(String(req.params?.id || ""), 10);
		if (!Number.isFinite(targetUserId) || targetUserId <= 0) {
			return res.status(400).json({ error: "Invalid user id" });
		}

		const target = await queries.selectUserById.get(targetUserId);
		if (!target) {
			return res.status(404).json({ error: "User not found" });
		}

		const rawUserName = req.body?.user_name ?? req.body?.username;
		const userName = normalizeUsername(rawUserName);
		if (!userName) {
			return res.status(400).json({
				error: "Invalid username",
				message: "Username must be 3-24 chars, lowercase letters/numbers/underscore, starting with a letter/number."
			});
		}

		// Uniqueness check
		if (queries.selectUserProfileByUsername?.get) {
			const existing = await queries.selectUserProfileByUsername.get(userName);
			if (existing && Number(existing.user_id) !== Number(targetUserId)) {
				return res.status(409).json({ error: "Username already taken" });
			}
		}

		if (!queries.upsertUserProfile?.run) {
			return res.status(500).json({ error: "Profile storage not available" });
		}

		// Preserve existing profile fields; only update username.
		const existingRow = await queries.selectUserProfileByUserId?.get(targetUserId);
		const existingProfile = normalizeProfileRow(existingRow);

		const nextMeta = {
			...(typeof existingProfile.meta === "object" && existingProfile.meta ? existingProfile.meta : {})
		};

		const payload = {
			user_name: userName,
			display_name: existingProfile.display_name ?? null,
			about: existingProfile.about ?? null,
			socials: typeof existingProfile.socials === "object" && existingProfile.socials ? existingProfile.socials : {},
			avatar_url: existingProfile.avatar_url ?? null,
			cover_image_url: existingProfile.cover_image_url ?? null,
			badges: Array.isArray(existingProfile.badges) ? existingProfile.badges : [],
			meta: nextMeta
		};

		await queries.upsertUserProfile.run(targetUserId, payload);

		const updated = await queries.selectUserProfileByUserId?.get(targetUserId);
		return res.json({ ok: true, profile: normalizeProfileRow(updated) });
	});

	/** GET /admin/anonymous-users — list unique anon_cids from try_requests with request count and transitioned user (excludes __pool__). */
	router.get("/admin/anonymous-users", async (req, res) => {
		const adminUser = await requireAdmin(req, res);
		if (!adminUser) return;

		if (!queries.selectTryRequestAnonCidsWithCount?.all) {
			return res.json({ anonCids: [] });
		}
		const rows = await queries.selectTryRequestAnonCidsWithCount.all();
		const transitionedByCid = new Map();
		if (queries.selectTryRequestsTransitionedMeta?.all) {
			const transitionedRows = await queries.selectTryRequestsTransitionedMeta.all();
			for (const r of transitionedRows ?? []) {
				const meta = r.meta && typeof r.meta === "object" ? r.meta : typeof r.meta === "string" ? safeJsonParse(r.meta, {}) : {};
				const userId = meta?.transitioned?.user_id != null ? Number(meta.transitioned.user_id) : null;
				if (userId && Number.isFinite(userId) && !transitionedByCid.has(r.anon_cid)) {
					transitionedByCid.set(r.anon_cid, userId);
				}
			}
		}
		const userIds = [...new Set(transitionedByCid.values())];
		const userNameByUserId = new Map();
		for (const uid of userIds) {
			const profile = await queries.selectUserProfileByUserId?.get?.(uid);
			const name = profile?.user_name && String(profile.user_name).trim() ? String(profile.user_name).trim() : null;
			userNameByUserId.set(uid, name);
		}
		const anonCids = rows.map((row) => {
			const userId = transitionedByCid.get(row.anon_cid);
			return {
				...row,
				transitioned_user_id: userId ?? null,
				transitioned_user_name: (userId != null ? userNameByUserId.get(userId) : null) ?? null
			};
		});
		res.json({ anonCids });
	});

	/** GET /admin/anonymous-users/:cid — requests for this anon_cid (datetime desc) with image details and view URL. */
	router.get("/admin/anonymous-users/:cid", async (req, res) => {
		const adminUser = await requireAdmin(req, res);
		if (!adminUser) return;

		const cid = typeof req.params?.cid === "string" ? req.params.cid.trim() : "";
		if (!cid) {
			return res.status(400).json({ error: "Invalid anon_cid" });
		}

		const requests = await queries.selectTryRequestsByCid?.all?.(cid) ?? [];
		const imageIds = [...new Set(requests.map((r) => r.created_image_anon_id).filter(Boolean))];
		const images = (await queries.selectCreatedImagesAnonByIds?.all?.(imageIds)) ?? [];
		const imageById = new Map(images.map((img) => [Number(img.id), img]));

		const requestsWithImage = requests.map((r) => {
			const img = imageById.get(Number(r.created_image_anon_id));
			const imagePath = img?.filename ? `/api/try/images/${encodeURIComponent(img.filename)}` : null;
			return {
				id: r.id,
				anon_cid: r.anon_cid,
				prompt: r.prompt,
				created_at: r.created_at,
				fulfilled_at: r.fulfilled_at,
				created_image_anon_id: r.created_image_anon_id,
				image: img
					? {
							id: img.id,
							filename: img.filename,
							file_path: img.file_path,
							width: img.width,
							height: img.height,
							status: img.status,
							created_at: img.created_at,
							image_url: imagePath
						}
					: null
			};
		});

		res.json({ anon_cid: cid, requests: requestsWithImage });
	});

	router.get("/admin/moderation", async (req, res) => {
		const items = await queries.selectModerationQueue.all();
		res.json({ items });
	});

	router.get("/admin/providers", async (req, res) => {
		const providers = await queries.selectProviders.all();
		res.json({ providers });
	});

	router.get("/admin/policies", async (req, res) => {
		const policies = await queries.selectPolicies.all();
		res.json({ policies });
	});

	router.get("/admin/email-sends", async (req, res) => {
		const adminUser = await requireAdmin(req, res);
		if (!adminUser) return;
		const pageSize = parseInt(req.query?.limit, 10);
		const limit = [10, 50, 100].includes(pageSize) ? pageSize : 50;
		const page = Math.max(1, parseInt(req.query?.page, 10) || 1);
		const offset = (page - 1) * limit;
		if (!queries.listEmailSendsRecent?.all) {
			return res.json({ sends: [], total: 0 });
		}
		const [sends, totalRow] = await Promise.all([
			queries.listEmailSendsRecent.all(limit, offset),
			queries.countEmailSends?.get ? queries.countEmailSends.get() : Promise.resolve({ count: 0 })
		]);
		const total = totalRow?.count ?? 0;
		const userIds = [...new Set((sends || []).map((s) => s.user_id).filter((id) => id != null))];
		const userLabelByUserId = {};
		const emailByUserId = {};
		for (const uid of userIds) {
			const [user, profile] = await Promise.all([
				queries.selectUserById?.get?.(uid),
				queries.selectUserProfileByUserId?.get?.(uid)
			]);
			const email = user?.email ?? null;
			if (email) emailByUserId[uid] = email;
			const displayName = (profile?.display_name ?? "").trim() || null;
			const userName = (profile?.user_name ?? "").trim() || null;
			const emailLocal = email ? email.split("@")[0]?.trim() || null : null;
			userLabelByUserId[uid] = displayName || userName || emailLocal || `#${uid}`;
		}
		const sendsWithEmail = (sends || []).map((s) => ({
			id: s.id,
			user_id: s.user_id,
			campaign: s.campaign,
			created_at: s.created_at,
			meta: s.meta ?? null,
			user_email: emailByUserId[s.user_id] ?? null,
			user_label: userLabelByUserId[s.user_id] ?? `#${s.user_id}`
		}));
		res.json({ sends: sendsWithEmail, total });
	});

	router.get("/admin/users/:id/unread-notifications", async (req, res) => {
		const adminUser = await requireAdmin(req, res);
		if (!adminUser) return;

		const targetUserId = Number.parseInt(String(req.params?.id || ""), 10);
		if (!Number.isFinite(targetUserId) || targetUserId <= 0) {
			return res.status(400).json({ error: "Invalid user id" });
		}

		const targetUser = await queries.selectUserById.get(targetUserId);
		if (!targetUser) {
			return res.status(404).json({ error: "User not found" });
		}

		try {
			const result = await queries.selectUnreadNotificationCount.get(
				targetUserId,
				targetUser?.role || null
			);
			res.json({ count: result?.count ?? 0 });
		} catch (error) {
			res.status(500).json({ error: error?.message || "Failed to get notification count" });
		}
	});

	const VALID_TEST_EMAIL_TEMPLATES = [
		"helloFromParascene",
		"commentReceived",
		"commentReceivedDelegated",
		"featureRequest",
		"featureRequestFeedback",
		"passwordReset",
		"digestActivity",
		"welcome",
		"firstCreationNudge",
		"reengagement",
		"creationHighlight",
		"supportReport"
	];

	function getEmailTemplateSampleData() {
		const baseUrl = getBaseAppUrlForEmail();
		return {
			helloFromParascene: {
				recipientName: "Alex"
			},
			commentReceived: {
				recipientName: "Alex",
				commenterName: "Jordan",
				commentText: "This is a sample comment to show how the email template looks with real content. It demonstrates the formatting and layout.",
				creationTitle: "Sunset Over Mountains",
				creationUrl: `${baseUrl}/creations/123`
			},
			commentReceivedDelegated: {
				recipientName: "Alex",
				commenterName: "Jordan",
				commentText: "This is a sample comment to show how the email template looks with real content. It demonstrates the formatting and layout.",
				creationTitle: "Sunset Over Mountains",
				creationUrl: `${baseUrl}/creations/123`,
				impersonation: {
					originalRecipient: {
						name: "Taylor",
						email: "taylor@example.com",
						userId: 123
					},
					reason: "Suppressed recipient"
				}
			},
			featureRequest: {
				requesterName: "Sam",
				requesterEmail: "sam@example.com",
				requesterUserId: 42,
				requesterUserName: "sam",
				requesterDisplayName: "Sam",
				requesterRole: "consumer",
				requesterCreatedAt: "2024-01-15T10:30:00Z",
				message: "It would be great to have dark mode support. The current light theme is nice, but a dark option would be perfect for late-night browsing.",
				userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
				acceptLanguage: "en-US,en;q=0.9",
				referer: `${baseUrl}/feed`,
				forwardedFor: "192.168.1.1",
				ip: "192.168.1.1",
				ips: ["192.168.1.1"],
				context: {
					route: "/feed",
					timezone: "America/New_York",
					locale: "en-US",
					platform: "MacIntel",
					colorScheme: "light",
					reducedMotion: "no-preference",
					network: "4g",
					viewportWidth: 1920,
					viewportHeight: 1080,
					screenWidth: 1920,
					screenHeight: 1080,
					devicePixelRatio: 2
				},
				submittedAt: new Date().toISOString()
			},
			featureRequestFeedback: {
				recipientName: "Alex",
				originalRequest: "It would be great to have dark mode support. The current light theme is nice, but a dark option would be perfect for late-night browsing.",
				message: "We've added your idea to our roadmap. We'll reach out when we have something to share."
			},
			passwordReset: {
				recipientName: "Alex",
				resetUrl: `${baseUrl}/reset-password?rt=sample-token-123`
			},
			digestActivity: {
				recipientName: "Alex",
				activitySummary: "You have 3 creations with new comments.",
				feedUrl: `${baseUrl}/feed`,
				activityItems: [
					{ title: "Sunset Over Mountains", comment_count: 5 },
					{ title: "City Lights at Night", comment_count: 2 }
				],
				otherCreationsActivityItems: [
					{ title: "Ocean Waves", comment_count: 3 }
				]
			},
			welcome: {
				recipientName: "Alex"
			},
			firstCreationNudge: {
				recipientName: "Alex"
			},
			reengagement: {
				recipientName: "Alex"
			},
			creationHighlight: {
				recipientName: "Alex",
				creationTitle: "Sunset Over Mountains",
				creationUrl: `${baseUrl}/creations/123`,
				commentCount: 8
			},
			supportReport: {
				requesterName: "Sam",
				requesterEmail: "sam@example.com",
				requesterUserId: 42,
				requesterUserName: "sam",
				requesterDisplayName: "Sam",
				report: {
					userSummary: "I see a grey box in the Landscape modal and no Generate button. I'm on Windows 11 with Brave.",
					creationId: 2116,
					landscape: {
						creationId: 2116,
						isOwner: true,
						hasImage: false,
						loading: false,
						errorMsg: null,
						genBtnExists: true,
						genBtnVisible: false,
						genBtnDisplay: "none",
						genPromptDisplay: "block",
						placeholderDisplay: "flex",
						errorElDisplay: "none"
					},
					domSummary: {
						modalDisplay: "block",
						modalOpen: true,
						placeholderDisplay: "flex",
						placeholderVisible: true,
						primaryBtnDisplay: "none",
						primaryBtnVisible: false,
						primaryBtnDisabled: false,
						modalContentLength: 420,
						modalContentSnippet: "<div class=\"landscape-placeholder\" data-landscape-placeholder>…"
					},
					context: {
						url: `${baseUrl}/creations/2116`,
						viewportWidth: 1920,
						viewportHeight: 1080,
						screenWidth: 1920,
						screenHeight: 1080,
						devicePixelRatio: 2
					}
				},
				userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
				acceptLanguage: "en-US,en;q=0.9",
				referer: `${baseUrl}/creations/2116`,
				ip: "192.168.1.1",
				submittedAt: new Date().toISOString()
			}
		};
	}

	router.get("/admin/email-templates/:templateName", async (req, res) => {
		const adminUser = await requireAdmin(req, res);
		if (!adminUser) return;

		const { templateName } = req.params;

		try {
			const { renderEmailTemplate } = await import("../email/index.js");
			const sampleData = getEmailTemplateSampleData();

			// Handle delegated template variants
			let actualTemplateName = templateName;
			if (templateName === "commentReceivedDelegated") {
				actualTemplateName = "commentReceived";
			}

			const data = sampleData[templateName];
			if (!data) {
				return res.status(404).json({ error: `Template "${templateName}" not found` });
			}

			const { html } = renderEmailTemplate(actualTemplateName, data);
			res.setHeader("Content-Type", "text/html; charset=utf-8");
			res.send(html);
		} catch (error) {
			console.error("[admin] email-templates render failed:", templateName, error?.message || error);
			if (error?.stack) console.error(error.stack);
			res.status(500).json({ error: error?.message || "Failed to render template" });
		}
	});

	router.post("/admin/send-test-email", async (req, res) => {
		const adminUser = await requireAdmin(req, res);
		if (!adminUser) return;

		const to = typeof req.body?.to === "string" ? req.body.to.trim() : "";
		const template = typeof req.body?.template === "string" ? req.body.template.trim() : "";

		if (!to) {
			return res.status(400).json({ error: "Recipient email is required." });
		}
		if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
			return res.status(400).json({ error: "Please enter a valid email address." });
		}
		if (!VALID_TEST_EMAIL_TEMPLATES.includes(template)) {
			return res.status(400).json({ error: "Invalid or unknown template." });
		}

		const sampleData = getEmailTemplateSampleData();
		let data = sampleData[template];
		if (!data) {
			return res.status(400).json({ error: "Template has no sample data." });
		}

		// Feature Request Feedback: use admin-provided fields (prefer body over sample when provided)
		if (template === "featureRequestFeedback" && req.body) {
			if (req.body.recipientName !== undefined) {
				data.recipientName = typeof req.body.recipientName === "string" ? req.body.recipientName.trim() || data.recipientName : data.recipientName;
			}
			if (req.body.originalRequest !== undefined) {
				data.originalRequest = typeof req.body.originalRequest === "string" ? req.body.originalRequest.trim() : "";
			}
			if (req.body.message !== undefined) {
				data.message = typeof req.body.message === "string" ? req.body.message.trim() : "";
			}
		}

		let actualTemplateName = template;
		if (template === "commentReceivedDelegated") {
			actualTemplateName = "commentReceived";
		}

		try {
			const { sendTemplatedEmail } = await import("../email/index.js");
			const responseData = await sendTemplatedEmail({
				to: [to],
				template: actualTemplateName,
				data
			});
			res.status(200).json({ ok: true, id: responseData?.id ?? null });
		} catch (error) {
			const message = error?.message || "Failed to send test email.";
			res.status(500).json({ error: message });
		}
	});

	router.get("/admin/settings", async (req, res) => {
		const user = await requireAdmin(req, res);
		if (!user) return;
		const s = await getEmailSettings(queries);
		res.json({
			email_use_test_recipient: s.emailUseTestRecipient,
			email_dry_run: s.dryRun,
			digest_utc_windows: s.digestUtcWindowsRaw,
			max_digests_per_user_per_day: String(s.maxDigestsPerUserPerDay),
			digest_activity_hours_lookback: String(s.activityHoursLookback),
			welcome_email_delay_hours: String(s.welcomeEmailDelayHours),
			reengagement_inactive_days: s.reengagementInactiveDays,
			reengagement_cooldown_days: s.reengagementCooldownDays,
			creation_highlight_lookback_hours: s.creationHighlightLookbackHours,
			creation_highlight_cooldown_days: s.creationHighlightCooldownDays,
			creation_highlight_min_comments: s.creationHighlightMinComments
		});
	});

	router.patch("/admin/settings", async (req, res) => {
		const user = await requireAdmin(req, res);
		if (!user) return;
		const body = req.body || {};
		if (typeof body.email_use_test_recipient === "boolean") {
			const value = body.email_use_test_recipient ? "true" : "false";
			if (queries.upsertPolicyKey?.run) {
				await queries.upsertPolicyKey.run(
					"email_use_test_recipient",
					value,
					"When true, all lifecycle/transactional emails go to delivered@resend.dev"
				);
			}
		}
		if (typeof body.email_dry_run === "boolean") {
			const value = body.email_dry_run ? "true" : "false";
			if (queries.upsertPolicyKey?.run) {
				await queries.upsertPolicyKey.run("email_dry_run", value, "When true, cron records digest sends but does not send email.");
			}
		}
		if (typeof body.digest_utc_windows === "string") {
			const value = body.digest_utc_windows.trim();
			if (queries.upsertPolicyKey?.run) {
				await queries.upsertPolicyKey.run("digest_utc_windows", value || "09:00,18:00", "UTC times (HH:MM) when digest may run, comma-separated.");
			}
		}
		if (typeof body.max_digests_per_user_per_day !== "undefined") {
			const value = String(Math.max(0, parseInt(body.max_digests_per_user_per_day, 10) || 0));
			if (queries.upsertPolicyKey?.run) {
				await queries.upsertPolicyKey.run("max_digests_per_user_per_day", value, "Max digest emails per user per UTC day.");
			}
		}
		if (typeof body.digest_activity_hours_lookback !== "undefined") {
			const value = String(Math.max(1, parseInt(body.digest_activity_hours_lookback, 10) || 24));
			if (queries.upsertPolicyKey?.run) {
				await queries.upsertPolicyKey.run("digest_activity_hours_lookback", value, "Hours to look back for unread activity when building digest candidates.");
			}
		}
		if (typeof body.welcome_email_delay_hours !== "undefined") {
			const value = String(Math.max(0, parseInt(body.welcome_email_delay_hours, 10) || 0));
			if (queries.upsertPolicyKey?.run) {
				await queries.upsertPolicyKey.run("welcome_email_delay_hours", value, "Hours after signup before a user is eligible for the welcome email (0 = immediate).");
			}
		}
		if (typeof body.reengagement_inactive_days !== "undefined") {
			const value = String(Math.max(1, parseInt(body.reengagement_inactive_days, 10) || 14));
			if (queries.upsertPolicyKey?.run) {
				await queries.upsertPolicyKey.run("reengagement_inactive_days", value, "Days of inactivity before a user is eligible for re-engagement email.");
			}
		}
		if (typeof body.reengagement_cooldown_days !== "undefined") {
			const value = String(Math.max(1, parseInt(body.reengagement_cooldown_days, 10) || 30));
			if (queries.upsertPolicyKey?.run) {
				await queries.upsertPolicyKey.run("reengagement_cooldown_days", value, "Minimum days between re-engagement emails per user.");
			}
		}
		if (typeof body.creation_highlight_lookback_hours !== "undefined") {
			const value = String(Math.max(1, parseInt(body.creation_highlight_lookback_hours, 10) || 48));
			if (queries.upsertPolicyKey?.run) {
				await queries.upsertPolicyKey.run("creation_highlight_lookback_hours", value, "Hours to look back for comments to consider a creation 'hot' for highlight email.");
			}
		}
		if (typeof body.creation_highlight_cooldown_days !== "undefined") {
			const value = String(Math.max(1, parseInt(body.creation_highlight_cooldown_days, 10) || 7));
			if (queries.upsertPolicyKey?.run) {
				await queries.upsertPolicyKey.run("creation_highlight_cooldown_days", value, "Minimum days between creation highlight emails per user.");
			}
		}
		if (typeof body.creation_highlight_min_comments !== "undefined") {
			const value = String(Math.max(0, parseInt(body.creation_highlight_min_comments, 10) || 1));
			if (queries.upsertPolicyKey?.run) {
				await queries.upsertPolicyKey.run("creation_highlight_min_comments", value, "Minimum comments on a creation in the lookback window to send a highlight email.");
			}
		}
		const s = await getEmailSettings(queries);
		res.json({
			email_use_test_recipient: s.emailUseTestRecipient,
			email_dry_run: s.dryRun,
			digest_utc_windows: s.digestUtcWindowsRaw,
			max_digests_per_user_per_day: String(s.maxDigestsPerUserPerDay),
			digest_activity_hours_lookback: String(s.activityHoursLookback),
			welcome_email_delay_hours: String(s.welcomeEmailDelayHours),
			reengagement_inactive_days: s.reengagementInactiveDays,
			reengagement_cooldown_days: s.reengagementCooldownDays,
			creation_highlight_lookback_hours: s.creationHighlightLookbackHours,
			creation_highlight_cooldown_days: s.creationHighlightCooldownDays,
			creation_highlight_min_comments: s.creationHighlightMinComments
		});
	});

	/** GET /admin/related-settings — all related.* keys and values. Admin-only. */
	router.get("/admin/related-settings", async (req, res) => {
		const adminUser = await requireAdmin(req, res);
		if (!adminUser) return;
		if (!queries.getRelatedParams?.get) {
			return res.json({});
		}
		const settings = await queries.getRelatedParams.get();
		res.json(settings);
	});

	/** PATCH /admin/related-settings — body: flat key/value (e.g. related.lineage_weight: 100). Upsert each into policy_knobs. Admin-only. */
	router.patch("/admin/related-settings", async (req, res) => {
		const adminUser = await requireAdmin(req, res);
		if (!adminUser) return;
		const body = req.body && typeof req.body === "object" ? req.body : {};
		const validKeys = new Set(RELATED_PARAM_KEYS);
		for (const [key, value] of Object.entries(body)) {
			if (!validKeys.has(key) || value === undefined) continue;
			const strValue = String(value);
			if (queries.upsertPolicyKey?.run) {
				await queries.upsertPolicyKey.run(key, strValue, null);
			}
		}
		const settings = await queries.getRelatedParams?.get?.() ?? {};
		res.json(settings);
	});

	/** GET /admin/transitions — page, limit, sort_by, sort_dir. Response: { items, total, page, limit, hasMore }. Admin-only. */
	router.get("/admin/transitions", async (req, res) => {
		const adminUser = await requireAdmin(req, res);
		if (!adminUser) return;
		const page = Math.max(1, parseInt(req.query?.page, 10) || 1);
		const limit = Math.min(100, Math.max(1, parseInt(req.query?.limit, 10) || 20));
		const validSortBy = ["from_created_image_id", "to_created_image_id", "count", "last_updated"];
		const sortBy = validSortBy.includes(req.query?.sort_by) ? req.query.sort_by : "count";
		const sortDir = String(req.query?.sort_dir || "desc").toLowerCase() === "asc" ? "asc" : "desc";
		if (!queries.selectTransitions?.list) {
			return res.json({ items: [], total: 0, page, limit, hasMore: false });
		}
		const result = await queries.selectTransitions.list({ page, limit, sortBy, sortDir });
		res.json({
			items: result.items ?? [],
			total: result.total ?? 0,
			page: result.page ?? page,
			limit: result.limit ?? limit,
			hasMore: result.hasMore ?? false
		});
	});

	router.get("/admin/servers/:id", async (req, res) => {
		const user = await requireAdmin(req, res);
		if (!user) return;

		const serverId = parseInt(req.params.id, 10);
		if (isNaN(serverId)) {
			return res.status(400).json({ error: "Invalid server ID" });
		}

		const server = await queries.selectServerById.get(serverId);
		if (!server) {
			return res.status(404).json({ error: "Server not found" });
		}

		res.json({ server });
	});

	router.put("/admin/servers/:id", async (req, res) => {
		const user = await requireAdmin(req, res);
		if (!user) return;

		const serverId = parseInt(req.params.id, 10);
		if (isNaN(serverId)) {
			return res.status(400).json({ error: "Invalid server ID" });
		}

		const server = await queries.selectServerById.get(serverId);
		if (!server) {
			return res.status(404).json({ error: "Server not found" });
		}

		const payload = req.body || {};

		const nextServer = {
			...server
		};

		if (payload.user_id !== undefined) {
			const nextUserId = Number(payload.user_id);
			if (!Number.isFinite(nextUserId) || nextUserId <= 0) {
				return res.status(400).json({ error: "user_id must be a positive number when provided" });
			}
			nextServer.user_id = nextUserId;
		}

		if (payload.name !== undefined) {
			const nextName = String(payload.name || "").trim();
			if (!nextName) {
				return res.status(400).json({ error: "name must be a non-empty string when provided" });
			}
			nextServer.name = nextName;
		}

		if (payload.status !== undefined) {
			const nextStatus = String(payload.status || "").trim();
			if (!nextStatus) {
				return res.status(400).json({ error: "status must be a non-empty string when provided" });
			}
			nextServer.status = nextStatus;
		}

		if (payload.server_url !== undefined) {
			if (typeof payload.server_url !== "string" || payload.server_url.trim() === "") {
				return res.status(400).json({ error: "server_url must be a non-empty string when provided" });
			}
			let providerUrl;
			try {
				providerUrl = new URL(payload.server_url.trim());
				if (!['http:', 'https:'].includes(providerUrl.protocol)) {
					return res.status(400).json({ error: "server_url must be an HTTP or HTTPS URL" });
				}
			} catch (urlError) {
				return res.status(400).json({ error: "server_url must be a valid URL" });
			}
			nextServer.server_url = providerUrl.toString().replace(/\/$/, '');
		}

		if (payload.auth_token !== undefined) {
			if (payload.auth_token !== null && typeof payload.auth_token !== "string") {
				return res.status(400).json({ error: "auth_token must be a string when provided" });
			}
			nextServer.auth_token = resolveProviderAuthToken(payload.auth_token);
		}

		if (payload.status_date !== undefined) {
			nextServer.status_date = payload.status_date || null;
		}

		if (payload.description !== undefined) {
			nextServer.description = payload.description || null;
		}

		if (payload.members_count !== undefined) {
			const nextMembersCount = Number(payload.members_count);
			if (!Number.isFinite(nextMembersCount) || nextMembersCount < 0) {
				return res.status(400).json({ error: "members_count must be a non-negative number when provided" });
			}
			nextServer.members_count = Math.floor(nextMembersCount);
		}

		if (payload.server_config !== undefined) {
			nextServer.server_config = payload.server_config || null;
		}

		const updateResult = await queries.updateServer.run(serverId, nextServer);
		if (updateResult.changes === 0) {
			return res.status(500).json({ error: "Failed to update server" });
		}

		return res.status(200).json({
			success: true,
			server: nextServer
		});
	});

	router.post("/admin/servers/:id/test", async (req, res) => {
		const user = await requireAdmin(req, res);
		if (!user) return;

		const serverId = parseInt(req.params.id, 10);
		if (isNaN(serverId)) {
			return res.status(400).json({ error: "Invalid server ID" });
		}

		const server = await queries.selectServerById.get(serverId);
		if (!server) {
			return res.status(404).json({ error: "Server not found" });
		}

		const serverUrl = server.server_url;
		if (!serverUrl) {
			return res.status(400).json({ error: "Server URL not configured" });
		}

		// Normalize server_url (remove trailing slash)
		const normalizedUrl = serverUrl.toString().replace(/\/$/, '');

		// Call provider server to get capabilities
		try {
			const response = await fetch(normalizedUrl, {
				method: 'GET',
				headers: buildProviderHeaders({
					'Accept': 'application/json'
				}, server.auth_token),
				signal: AbortSignal.timeout(10000) // 10 second timeout
			});

			if (!response.ok) {
				return res.status(400).json({
					error: `Provider server returned error: ${response.status} ${response.statusText}`,
					server_url: normalizedUrl
				});
			}

			const capabilities = await response.json();

			// Validate response structure
			if (!capabilities.methods || typeof capabilities.methods !== 'object') {
				return res.status(400).json({
					error: "Provider server response missing or invalid 'methods' field",
					server_url: normalizedUrl
				});
			}

			return res.status(200).json({
				capabilities,
				server_url: normalizedUrl
			});
		} catch (fetchError) {
			if (fetchError.name === 'AbortError') {
				return res.status(400).json({
					error: "Provider server did not respond within 10 seconds",
					server_url: normalizedUrl
				});
			}
			return res.status(400).json({
				error: `Failed to connect to provider server: ${fetchError.message}`,
				server_url: normalizedUrl
			});
		}
	});

	router.post("/admin/servers/:id/refresh", async (req, res) => {
		const user = await requireAdmin(req, res);
		if (!user) return;

		const serverId = parseInt(req.params.id, 10);
		if (isNaN(serverId)) {
			return res.status(400).json({ error: "Invalid server ID" });
		}

		const server = await queries.selectServerById.get(serverId);
		if (!server) {
			return res.status(404).json({ error: "Server not found" });
		}

		const serverUrl = server.server_url;
		if (!serverUrl) {
			return res.status(400).json({ error: "Server URL not configured" });
		}

		// Normalize server_url (remove trailing slash)
		const normalizedUrl = serverUrl.toString().replace(/\/$/, '');

		// Call provider server to get capabilities
		try {
			const response = await fetch(normalizedUrl, {
				method: 'GET',
				headers: buildProviderHeaders({
					'Accept': 'application/json'
				}, server.auth_token),
				signal: AbortSignal.timeout(10000) // 10 second timeout
			});

			if (!response.ok) {
				return res.status(400).json({
					error: `Provider server returned error: ${response.status} ${response.statusText}`,
					server_url: normalizedUrl
				});
			}

			const capabilities = await response.json();

			// Validate response structure
			if (!capabilities.methods || typeof capabilities.methods !== 'object') {
				return res.status(400).json({
					error: "Provider server response missing or invalid 'methods' field",
					server_url: normalizedUrl
				});
			}

			// Update server config in database
			const updateResult = await queries.updateServerConfig.run(serverId, capabilities);

			if (updateResult.changes === 0) {
				return res.status(500).json({
					error: "Failed to update server configuration"
				});
			}

			return res.status(200).json({
				success: true,
				capabilities,
				server_url: normalizedUrl
			});
		} catch (fetchError) {
			if (fetchError.name === 'AbortError') {
				return res.status(400).json({
					error: "Provider server did not respond within 10 seconds",
					server_url: normalizedUrl
				});
			}
			return res.status(400).json({
				error: `Failed to connect to provider server: ${fetchError.message}`,
				server_url: normalizedUrl
			});
		}
	});

	return router;
}
