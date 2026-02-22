import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { RELATED_PARAM_DEFAULTS, RELATED_PARAM_KEYS } from "./relatedParams.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const users = [];
const user_profiles = [];
const moderation_queue = [];
const servers = [];
const server_members = [];
const policy_knobs = [];
const notifications = [];
const feed_items = [];
const explore_items = [];
const creations = [];
const templates = [];
const user_follows = [];

const created_images = [];
const created_images_anon = [];
const try_requests = [];
const sessions = [];
const user_credits = [];
const likes_created_image = [];
const comments_created_image = [];
const tip_activity = [];
const email_sends = [];
const email_user_campaign_state = [];
const email_link_clicks = [];

// On Vercel, use /tmp directory which is writable
// Otherwise use the local data directory
const dataDir = process.env.VERCEL
	? "/tmp/parascene-data"
	: path.join(__dirname, "..", "data");
const imagesDir = path.join(dataDir, "images", "created");
const imagesDirAnon = path.join(dataDir, "images", "created_anon");
const genericImagesDir = path.join(dataDir, "images", "generic");

function ensureImagesDir() {
	try {
		if (!fs.existsSync(imagesDir)) {
			fs.mkdirSync(imagesDir, { recursive: true });
		}
	} catch (error) {
		// If directory creation fails (e.g., on Vercel without /tmp access),
		// log a warning but don't throw - images will be stored in memory only
		// console.warn(`Warning: Could not create images directory: ${error.message}`);
		// console.warn("Images will not be persisted to disk. Consider using Supabase adapter on Vercel.");
	}
}

function ensureImagesDirAnon() {
	try {
		if (!fs.existsSync(imagesDirAnon)) {
			fs.mkdirSync(imagesDirAnon, { recursive: true });
		}
	} catch (_) { }
}

function ensureGenericImagesDir() {
	try {
		if (!fs.existsSync(genericImagesDir)) {
			fs.mkdirSync(genericImagesDir, { recursive: true });
		}
	} catch (error) {
		// console.warn(`Warning: Could not create generic images directory: ${error.message}`);
	}
}

const TABLE_TIMESTAMP_FIELDS = {
	users: ["created_at"],
	user_profiles: ["created_at", "updated_at"],
	moderation_queue: ["created_at"],
	servers: ["created_at", "updated_at", "status_date"],
	policy_knobs: ["updated_at"],
	notifications: ["created_at"],
	email_sends: ["created_at"],
	email_user_campaign_state: ["updated_at"],
	email_link_clicks: ["clicked_at"],
	tip_activity: ["created_at", "updated_at"],
	feed_items: ["created_at"],
	explore_items: ["created_at"],
	creations: ["created_at"],
	templates: ["created_at"],
	created_images: ["created_at"],
	user_follows: ["created_at"]
};

export function openDb() {
	let nextUserId = users.length + 1;
	let nextNotificationId = notifications.length + 1;
	let nextUserCreditsId = user_credits.length + 1;

	const queries = {
		selectUserByEmail: {
			get: async (email) => {
				const user = users.find((u) => u.email === email);
				if (!user) return undefined;
				const meta = user.meta != null && typeof user.meta === "object" ? user.meta : {};
				return { ...user, meta, suspended: meta.suspended === true };
			}
		},
		selectUserById: {
			get: async (id) => {
				const user = users.find((entry) => entry.id === Number(id));
				if (!user) return undefined;
				const { password_hash, ...safeUser } = user;
				const meta = safeUser.meta != null && typeof safeUser.meta === "object" ? safeUser.meta : {};
				return { ...safeUser, meta, suspended: meta.suspended === true };
			}
		},
		selectUserByIdForLogin: {
			get: async (id) => {
				const user = users.find((entry) => entry.id === Number(id));
				if (!user) return undefined;
				const meta = user.meta != null && typeof user.meta === "object" ? user.meta : {};
				return { id: user.id, password_hash: user.password_hash, meta, suspended: meta.suspended === true };
			}
		},
		selectUserByStripeSubscriptionId: {
			get: async (subscriptionId) => {
				if (subscriptionId == null || String(subscriptionId).trim() === "") return undefined;
				const user = users.find((u) => u.meta?.stripeSubscriptionId === String(subscriptionId));
				if (!user) return undefined;
				const { password_hash, ...safeUser } = user;
				const meta = safeUser.meta != null && typeof safeUser.meta === "object" ? safeUser.meta : {};
				return { ...safeUser, meta, suspended: meta.suspended === true };
			}
		},
		selectUserProfileByUserId: {
			get: async (userId) =>
				user_profiles.find((row) => row.user_id === Number(userId))
		},
		selectUserProfileByUsername: {
			get: async (userName) =>
				user_profiles.find((row) => row.user_name === String(userName))
		},
		upsertUserProfile: {
			run: async (userId, profile) => {
				const id = Number(userId);
				const now = new Date().toISOString();
				const existing = user_profiles.find((row) => row.user_id === id);
				const next = {
					user_id: id,
					user_name: profile?.user_name ?? null,
					display_name: profile?.display_name ?? null,
					about: profile?.about ?? null,
					socials: profile?.socials ?? null,
					avatar_url: profile?.avatar_url ?? null,
					cover_image_url: profile?.cover_image_url ?? null,
					badges: profile?.badges ?? null,
					meta: profile?.meta ?? null,
					created_at: existing?.created_at ?? now,
					updated_at: now
				};
				if (existing) {
					Object.assign(existing, next);
				} else {
					user_profiles.push(next);
				}
				return { changes: 1 };
			}
		},
		selectSessionByTokenHash: {
			get: async (tokenHash, userId) =>
				sessions.find(
					(session) =>
						session.token_hash === tokenHash &&
						session.user_id === Number(userId)
				)
		},
		insertUser: {
			run: async (email, password_hash, role) => {
				const user = {
					id: nextUserId++,
					email,
					password_hash,
					role,
					created_at: new Date().toISOString(),
					last_active_at: null,
					meta: {}
				};
				users.push(user);
				// Standardize return value: use insertId (also support lastInsertRowid for backward compat)
				return { insertId: user.id, lastInsertRowid: user.id, changes: 1 };
			}
		},
		insertSession: {
			run: async (userId, tokenHash, expiresAt) => {
				const session = {
					id: sessions.length > 0
						? Math.max(...sessions.map((s) => s.id || 0)) + 1
						: 1,
					user_id: Number(userId),
					token_hash: tokenHash,
					expires_at: expiresAt,
					created_at: new Date().toISOString()
				};
				sessions.push(session);
				return { insertId: session.id, lastInsertRowid: session.id, changes: 1 };
			}
		},
		refreshSessionExpiry: {
			run: async (id, expiresAt) => {
				const session = sessions.find((entry) => entry.id === Number(id));
				if (!session) {
					return { changes: 0 };
				}
				session.expires_at = expiresAt;
				return { changes: 1 };
			}
		},
		deleteSessionByTokenHash: {
			run: async (tokenHash, userId) => {
				const beforeCount = sessions.length;
				if (userId) {
					for (let i = sessions.length - 1; i >= 0; i -= 1) {
						if (
							sessions[i].token_hash === tokenHash &&
							sessions[i].user_id === Number(userId)
						) {
							sessions.splice(i, 1);
						}
					}
				} else {
					for (let i = sessions.length - 1; i >= 0; i -= 1) {
						if (sessions[i].token_hash === tokenHash) {
							sessions.splice(i, 1);
						}
					}
				}
				return { changes: beforeCount - sessions.length };
			}
		},
		deleteExpiredSessions: {
			run: async (nowIso) => {
				const beforeCount = sessions.length;
				const nowMs = Date.parse(nowIso);
				for (let i = sessions.length - 1; i >= 0; i -= 1) {
					const expiresAtMs = Date.parse(sessions[i].expires_at);
					if (
						Number.isFinite(nowMs) &&
						Number.isFinite(expiresAtMs) &&
						expiresAtMs <= nowMs
					) {
						sessions.splice(i, 1);
					}
				}
				return { changes: beforeCount - sessions.length };
			}
		},
		selectUsers: {
			all: async () =>
				users.map(({ password_hash, ...safeUser }) => {
					const profile = user_profiles.find(
						(row) => row.user_id === Number(safeUser.id)
					);
					const meta = safeUser.meta != null && typeof safeUser.meta === "object" ? safeUser.meta : {};
					return {
						...safeUser,
						last_active_at: safeUser.last_active_at ?? null,
						meta,
						suspended: meta.suspended === true,
						user_name: profile?.user_name ?? null,
						display_name: profile?.display_name ?? null,
						avatar_url: profile?.avatar_url ?? null
					};
				})
		},
		updateUserSuspended: {
			run: async (userId, suspended) => {
				const user = users.find((u) => Number(u.id) === Number(userId));
				if (!user) return { changes: 0 };
				user.meta = user.meta != null && typeof user.meta === "object" ? { ...user.meta } : {};
				user.meta.suspended = Boolean(suspended);
				return { changes: 1 };
			}
		},
		updateUserPlan: {
			run: async (userId, plan) => {
				const user = users.find((u) => Number(u.id) === Number(userId));
				if (!user) return { changes: 0 };
				user.meta = user.meta != null && typeof user.meta === "object" ? { ...user.meta } : {};
				user.meta.plan = plan === "founder" ? "founder" : "free";
				if (plan === "founder") {
					delete user.meta.pendingCheckoutSessionId;
					delete user.meta.pendingCheckoutReturnedAt;
				}
				return { changes: 1 };
			}
		},
		recordCheckoutReturn: {
			run: async (userId, sessionId, returnedAt) => {
				const user = users.find((u) => Number(u.id) === Number(userId));
				if (!user) return { changes: 0 };
				user.meta = user.meta != null && typeof user.meta === "object" ? { ...user.meta } : {};
				user.meta.pendingCheckoutSessionId = sessionId;
				user.meta.pendingCheckoutReturnedAt = returnedAt;
				return { changes: 1 };
			}
		},
		updateUserStripeSubscriptionId: {
			run: async (userId, subscriptionId) => {
				const user = users.find((u) => Number(u.id) === Number(userId));
				if (!user) return { changes: 0 };
				user.meta = user.meta != null && typeof user.meta === "object" ? { ...user.meta } : {};
				if (subscriptionId != null) {
					user.meta.stripeSubscriptionId = subscriptionId;
					delete user.meta.pendingCheckoutSessionId;
					delete user.meta.pendingCheckoutReturnedAt;
				} else {
					delete user.meta.stripeSubscriptionId;
					delete user.meta.pendingCheckoutSessionId;
					delete user.meta.pendingCheckoutReturnedAt;
				}
				return { changes: 1 };
			}
		},
		updateUserLastActive: {
			run: async (userId) => {
				const user = users.find((u) => Number(u.id) === Number(userId));
				if (!user) return { changes: 0 };
				const now = new Date();
				const fifteenMinAgo = new Date(now.getTime() - 15 * 60 * 1000);
				const last = user.last_active_at ? new Date(user.last_active_at) : null;
				if (last !== null && last > fifteenMinAgo) return { changes: 0 };
				user.last_active_at = now.toISOString();
				return { changes: 1 };
			}
		},
		setPasswordResetToken: {
			run: async (userId, tokenHash, expiresAt) => {
				const user = users.find((u) => Number(u.id) === Number(userId));
				if (!user) return { changes: 0 };
				user.meta = user.meta != null && typeof user.meta === "object" ? { ...user.meta } : {};
				user.meta.reset_token_hash = tokenHash;
				user.meta.reset_token_expires_at = expiresAt;
				return { changes: 1 };
			}
		},
		selectUserByResetTokenHash: {
			get: async (tokenHash) => {
				const user = users.find((u) => u.meta?.reset_token_hash === tokenHash);
				if (!user) return undefined;
				const meta = user.meta != null && typeof user.meta === "object" ? user.meta : {};
				return { ...user, meta, suspended: meta.suspended === true };
			}
		},
		clearPasswordResetToken: {
			run: async (userId) => {
				const user = users.find((u) => Number(u.id) === Number(userId));
				if (!user) return { changes: 0 };
				user.meta = user.meta != null && typeof user.meta === "object" ? { ...user.meta } : {};
				delete user.meta.reset_token_hash;
				delete user.meta.reset_token_expires_at;
				return { changes: 1 };
			}
		},
		updateUserPassword: {
			run: async (userId, passwordHash) => {
				const user = users.find((u) => Number(u.id) === Number(userId));
				if (!user) return { changes: 0 };
				user.password_hash = passwordHash;
				return { changes: 1 };
			}
		},
		updateUserEmail: {
			run: async (userId, newEmail) => {
				const normalized = String(newEmail).trim().toLowerCase();
				const other = users.find((u) => Number(u.id) !== Number(userId) && u.email === normalized);
				if (other) return { changes: 0 };
				const user = users.find((u) => Number(u.id) === Number(userId));
				if (!user) return { changes: 0 };
				user.email = normalized;
				return { changes: 1 };
			}
		},
		selectModerationQueue: {
			all: async () => [...moderation_queue]
		},
		selectProviders: {
			all: async () => {
				// Join with users to get owner email
				return servers.map(provider => {
					const user = users.find(u => u.id === provider.user_id);
					return {
						...provider,
						owner_email: user?.email || null
					};
				});
			}
		},
		insertProvider: {
			run: async (userId, name, status, serverUrl, serverConfig = null, authToken = null) => {
				const id = servers.length + 1;
				const now = new Date().toISOString();
				const resolvedAuthToken = typeof authToken === "string" && authToken.trim()
					? authToken.trim()
					: null;
				servers.push({
					id,
					user_id: userId,
					name,
					status,
					server_url: serverUrl,
					auth_token: resolvedAuthToken,
					status_date: null,
					description: null,
					members_count: 0,
					server_config: serverConfig,
					created_at: now,
					updated_at: now
				});
				return Promise.resolve({
					insertId: id,
					changes: 1
				});
			}
		},
		selectPolicies: {
			all: async () => [...policy_knobs]
		},
		selectPolicyByKey: {
			get: async (key) => policy_knobs.find((p) => p.key === key) ?? null
		},
		upsertPolicyKey: {
			run: async (key, value, description) => {
				const existing = policy_knobs.find((p) => p.key === key);
				const now = new Date().toISOString();
				if (existing) {
					existing.value = value;
					existing.description = description ?? existing.description;
					existing.updated_at = now;
					return { changes: 1 };
				}
				policy_knobs.push({
					id: policy_knobs.length + 1,
					key,
					value,
					description: description ?? null,
					updated_at: now
				});
				return { changes: 1 };
			}
		},
		getRelatedParams: {
			get: async () => {
				const byKey = Object.fromEntries(
					policy_knobs.filter((p) => p.key.startsWith("related.")).map((p) => [p.key, p.value])
				);
				const out = { ...RELATED_PARAM_DEFAULTS };
				for (const key of RELATED_PARAM_KEYS) {
					if (byKey[key] !== undefined) out[key] = byKey[key];
				}
				return out;
			}
		},
		recordTransition: {
			run: async () => ({ changes: 1 })
		},
		selectTransitions: {
			list: async () => ({
				items: [],
				total: 0,
				page: 1,
				limit: 20,
				hasMore: false
			})
		},
		selectRelatedToCreatedImage: {
			all: async () => ({ ids: [], hasMore: false })
		},
		selectNotificationsForUser: {
			all: async (userId, role) =>
				notifications.filter(
					(note) => note.user_id === userId || note.role === role
				)
		},
		selectNotificationById: {
			get: async (id, userId, role) => {
				const note = notifications.find(
					(n) => Number(n.id) === Number(id) && (n.user_id === userId || n.role === role)
				);
				return note ?? undefined;
			}
		},
		acknowledgeNotificationsForUserAndCreation: {
			run: async (userId, role, creationId) => {
				const linkPattern = `/creations/${creationId}`;
				let count = 0;
				for (const note of notifications) {
					if (
						!note.acknowledged_at &&
						(note.user_id === userId || note.role === role) &&
						note.link === linkPattern
					) {
						note.acknowledged_at = new Date().toISOString();
						count++;
					}
				}
				return { changes: count };
			}
		},
		selectUnreadNotificationCount: {
			get: async (userId, role) => ({
				count: notifications.filter(
					(note) =>
						!note.acknowledged_at &&
						(note.user_id === userId || note.role === role)
				).length
			})
		},
		acknowledgeNotificationById: {
			run: async (id, userId, role) => {
				const notification = notifications.find(
					(note) =>
						note.id === Number(id) &&
						!note.acknowledged_at &&
						(note.user_id === userId || note.role === role)
				);
				if (!notification) {
					return { changes: 0 };
				}
				notification.acknowledged_at = new Date().toISOString();
				return { changes: 1 };
			}
		},
		updateNotificationAcknowledgedAtById: {
			run: async (id) => {
				const note = notifications.find((n) => n.id === Number(id) && !n.acknowledged_at);
				if (!note) return { changes: 0 };
				note.acknowledged_at = new Date().toISOString();
				return { changes: 1 };
			}
		},
		acknowledgeAllNotificationsForUser: {
			run: async (userId, role) => {
				let count = 0;
				for (const note of notifications) {
					if (!note.acknowledged_at && (note.user_id === userId || note.role === role)) {
						note.acknowledged_at = new Date().toISOString();
						count++;
					}
				}
				return { changes: count };
			}
		},
		insertNotification: {
			run: async (userId, role, title, message, link, actor_user_id, type, target, meta) => {
				const notification = {
					id: nextNotificationId++,
					user_id: userId ?? null,
					role: role ?? null,
					title,
					message,
					link: link ?? null,
					actor_user_id: actor_user_id ?? null,
					type: type ?? null,
					target: target != null && typeof target !== "string" ? JSON.stringify(target) : (target ?? null),
					meta: meta != null && typeof meta !== "string" ? JSON.stringify(meta) : (meta ?? null),
					created_at: new Date().toISOString(),
					acknowledged_at: null
				};
				notifications.push(notification);
				return { insertId: notification.id, lastInsertRowid: notification.id, changes: 1 };
			}
		},
		selectDistinctUserIdsWithUnreadNotificationsSince: {
			all: async (sinceIso) => {
				const seen = new Set();
				return notifications
					.filter(
						(n) =>
							n.user_id != null &&
							!n.acknowledged_at &&
							n.created_at >= sinceIso
					)
					.map((n) => n.user_id)
					.filter((id) => {
						const k = String(id);
						if (seen.has(k)) return false;
						seen.add(k);
						return true;
					})
					.map((user_id) => ({ user_id }));
			}
		},
		insertEmailSend: {
			run: async (userId, campaign, meta) => {
				const id = email_sends.length + 1;
				email_sends.push({
					id,
					user_id: userId,
					campaign,
					created_at: new Date().toISOString(),
					meta: meta ?? null
				});
				return { insertId: id, lastInsertRowid: id, changes: 1 };
			}
		},
		selectUserEmailCampaignState: {
			get: async (userId) => {
				return email_user_campaign_state.find((s) => s.user_id === userId) ?? null;
			}
		},
		upsertUserEmailCampaignStateLastDigest: {
			run: async (userId, sentAtIso) => {
				const now = new Date().toISOString();
				const existing = email_user_campaign_state.find((s) => s.user_id === userId);
				if (existing) {
					existing.last_digest_sent_at = sentAtIso;
					existing.updated_at = now;
					return { changes: 1 };
				}
				email_user_campaign_state.push({
					user_id: userId,
					last_digest_sent_at: sentAtIso,
					welcome_email_sent_at: null,
					first_creation_nudge_sent_at: null,
					last_reengagement_sent_at: null,
					last_creation_highlight_sent_at: null,
					updated_at: now,
					meta: null
				});
				return { changes: 1 };
			}
		},
		upsertUserEmailCampaignStateWelcome: {
			run: async (userId, sentAtIso) => {
				const now = new Date().toISOString();
				const existing = email_user_campaign_state.find((s) => s.user_id === userId);
				if (existing) {
					existing.welcome_email_sent_at = sentAtIso;
					existing.updated_at = now;
					return { changes: 1 };
				}
				email_user_campaign_state.push({
					user_id: userId,
					last_digest_sent_at: null,
					welcome_email_sent_at: sentAtIso,
					first_creation_nudge_sent_at: null,
					last_reengagement_sent_at: null,
					last_creation_highlight_sent_at: null,
					updated_at: now,
					meta: null
				});
				return { changes: 1 };
			}
		},
		upsertUserEmailCampaignStateFirstCreationNudge: {
			run: async (userId, sentAtIso) => {
				const now = new Date().toISOString();
				const existing = email_user_campaign_state.find((s) => s.user_id === userId);
				if (existing) {
					existing.first_creation_nudge_sent_at = sentAtIso;
					existing.updated_at = now;
					return { changes: 1 };
				}
				email_user_campaign_state.push({
					user_id: userId,
					last_digest_sent_at: null,
					welcome_email_sent_at: null,
					first_creation_nudge_sent_at: sentAtIso,
					last_reengagement_sent_at: null,
					last_creation_highlight_sent_at: null,
					updated_at: now,
					meta: null
				});
				return { changes: 1 };
			}
		},
		upsertUserEmailCampaignStateReengagement: {
			run: async (userId, sentAtIso) => {
				const now = new Date().toISOString();
				const existing = email_user_campaign_state.find((s) => s.user_id === userId);
				if (existing) {
					existing.last_reengagement_sent_at = sentAtIso;
					existing.updated_at = now;
					return { changes: 1 };
				}
				email_user_campaign_state.push({
					user_id: userId,
					last_digest_sent_at: null,
					welcome_email_sent_at: null,
					first_creation_nudge_sent_at: null,
					last_reengagement_sent_at: sentAtIso,
					last_creation_highlight_sent_at: null,
					updated_at: now,
					meta: null
				});
				return { changes: 1 };
			}
		},
		upsertUserEmailCampaignStateCreationHighlight: {
			run: async (userId, sentAtIso) => {
				const now = new Date().toISOString();
				const existing = email_user_campaign_state.find((s) => s.user_id === userId);
				if (existing) {
					existing.last_creation_highlight_sent_at = sentAtIso;
					existing.updated_at = now;
					return { changes: 1 };
				}
				email_user_campaign_state.push({
					user_id: userId,
					last_digest_sent_at: null,
					welcome_email_sent_at: null,
					first_creation_nudge_sent_at: null,
					last_reengagement_sent_at: null,
					last_creation_highlight_sent_at: sentAtIso,
					updated_at: now,
					meta: null
				});
				return { changes: 1 };
			}
		},
		selectUsersEligibleForReengagement: {
			// Only users who have already received welcome (so we never send "we miss you" before "welcome")
			all: async (inactiveBeforeIso, lastReengagementBeforeIso) => {
				const userList = (typeof globalThis.__mockDb !== "undefined" && globalThis.__mockDb?.users) ?? users;
				const creationList = (typeof globalThis.__mockDb !== "undefined" && globalThis.__mockDb?.created_images) ?? created_images ?? [];
				const stateList = (typeof globalThis.__mockDb !== "undefined" && globalThis.__mockDb?.email_user_campaign_state) ?? email_user_campaign_state;
				const hasCreation = new Set(creationList.map((c) => c?.user_id).filter((id) => id != null));
				const inactiveCutoff = inactiveBeforeIso ?? "1970-01-01T00:00:00.000Z";
				const reengagementCutoff = lastReengagementBeforeIso ?? "9999-12-31T23:59:59.999Z";
				const lastActivity = (u) => u?.last_active_at ?? u?.created_at ?? "";
				return userList
					.filter((u) => u?.email && String(u.email).trim() && String(u.email).includes("@"))
					.filter((u) => hasCreation.has(u.id))
					.filter((u) => lastActivity(u) <= inactiveCutoff)
					.filter((u) => {
						const s = stateList.find((x) => x.user_id === u.id);
						if (!s || s.welcome_email_sent_at == null) return false;
						return s.last_reengagement_sent_at == null || (s.last_reengagement_sent_at ?? "") <= reengagementCutoff;
					})
					.map((u) => ({ user_id: u.id }));
			}
		},
		selectCreationsEligibleForHighlight: {
			all: async (sinceIso, highlightSentBeforeIso) => {
				const creationList = (typeof globalThis.__mockDb !== "undefined" && globalThis.__mockDb?.created_images) ?? created_images ?? [];
				const commentList = (typeof globalThis.__mockDb !== "undefined" && globalThis.__mockDb?.comments_created_image) ?? comments_created_image ?? [];
				const stateList = (typeof globalThis.__mockDb !== "undefined" && globalThis.__mockDb?.email_user_campaign_state) ?? email_user_campaign_state;
				const since = sinceIso ?? "1970-01-01T00:00:00.000Z";
				const highlightCutoff = highlightSentBeforeIso ?? "9999-12-31T23:59:59.999Z";
				const countByCreation = {};
				for (const c of commentList) {
					if ((c?.created_at ?? "") >= since) {
						const id = c?.created_image_id;
						if (id != null) countByCreation[id] = (countByCreation[id] || 0) + 1;
					}
				}
				const byOwner = {};
				for (const ci of creationList) {
					const count = countByCreation[ci?.id] || 0;
					if (count === 0) continue;
					const uid = ci?.user_id;
					if (uid == null) continue;
					const s = stateList.find((x) => x.user_id === uid);
					if (s && s.last_creation_highlight_sent_at != null && (s.last_creation_highlight_sent_at ?? "") > highlightCutoff) continue;
					if (!byOwner[uid] || count > (byOwner[uid].comment_count || 0)) {
						byOwner[uid] = {
							user_id: uid,
							creation_id: ci?.id,
							title: (ci?.title && String(ci.title).trim()) || "Untitled",
							comment_count: count
						};
					}
				}
				return Object.values(byOwner);
			}
		},
		selectUsersEligibleForWelcomeEmail: {
			all: async (createdBeforeIso) => {
				const userList = (typeof globalThis.__mockDb !== "undefined" && globalThis.__mockDb?.users) ?? users;
				const stateList = (typeof globalThis.__mockDb !== "undefined" && globalThis.__mockDb?.email_user_campaign_state) ?? email_user_campaign_state;
				return userList
					.filter((u) => u?.email && String(u.email).trim() && String(u.email).includes("@"))
					.filter((u) => (u?.created_at ?? "") <= (createdBeforeIso ?? ""))
					.filter((u) => {
						const s = stateList.find((x) => x.user_id === u.id);
						return !s || s.welcome_email_sent_at == null;
					})
					.map((u) => ({ user_id: u.id }));
			}
		},
		selectUsersEligibleForFirstCreationNudge: {
			// welcomeSentBeforeIso: only nudge users who were sent welcome at least this long ago so we never send both in the same run
			all: async (welcomeSentBeforeIso) => {
				const userList = (typeof globalThis.__mockDb !== "undefined" && globalThis.__mockDb?.users) ?? users;
				const creationList = (typeof globalThis.__mockDb !== "undefined" && globalThis.__mockDb?.created_images) ?? created_images ?? [];
				const stateList = (typeof globalThis.__mockDb !== "undefined" && globalThis.__mockDb?.email_user_campaign_state) ?? email_user_campaign_state;
				const hasCreation = new Set(creationList.map((c) => c?.user_id).filter((id) => id != null));
				const cutoff = welcomeSentBeforeIso ?? "1970-01-01T00:00:00.000Z";
				return userList
					.filter((u) => u?.email && String(u.email).trim() && String(u.email).includes("@"))
					.filter((u) => !hasCreation.has(u.id))
					.filter((u) => {
						const s = stateList.find((x) => x.user_id === u.id);
						return s && s.welcome_email_sent_at != null && (s.welcome_email_sent_at ?? "") <= cutoff && s.first_creation_nudge_sent_at == null;
					})
					.map((u) => ({ user_id: u.id }));
			}
		},
		selectEmailSendsCountForUserSince: {
			get: async (userId, campaign, sinceIso) => {
				const count = email_sends.filter(
					(s) => s.user_id === userId && s.campaign === campaign && s.created_at >= sinceIso
				).length;
				return { count };
			}
		},
		countEmailSends: {
			get: async () => ({ count: email_sends.length })
		},
		listEmailSendsRecent: {
			all: async (limit, offset = 0) => {
				const cap = Math.min(Math.max(0, Number(limit) || 200), 500);
				const off = Math.max(0, Number(offset) || 0);
				const sorted = [...email_sends].sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
				return sorted.slice(off, off + cap).map((s) => ({
					id: s.id,
					user_id: s.user_id,
					campaign: s.campaign,
					created_at: s.created_at,
					meta: s.meta ?? null
				}));
			}
		},
		selectDigestActivityByOwnerSince: {
			all: async (ownerUserId, sinceIso) => {
				const owned = (created_images ?? []).filter((ci) => Number(ci?.user_id) === Number(ownerUserId));
				const out = [];
				for (const ci of owned) {
					const count = (comments_created_image ?? []).filter(
						(c) => Number(c?.created_image_id) === Number(ci.id) && (c?.created_at ?? "") >= sinceIso
					).length;
					if (count > 0) {
						out.push({
							created_image_id: Number(ci.id),
							title: (ci?.title && String(ci.title).trim()) || "Untitled",
							comment_count: count
						});
					}
				}
				out.sort((a, b) => b.comment_count - a.comment_count || a.created_image_id - b.created_image_id);
				return out;
			}
		},
		selectDigestActivityByCommenterSince: {
			all: async (commenterUserId, sinceIso) => {
				const myCommentCreationIds = [...new Set(
					(comments_created_image ?? [])
						.filter((c) => Number(c?.user_id) === Number(commenterUserId))
						.map((c) => Number(c?.created_image_id))
						.filter((id) => Number.isFinite(id))
				)];
				const notOwned = (created_images ?? []).filter(
					(ci) => myCommentCreationIds.includes(Number(ci?.id)) && Number(ci?.user_id) !== Number(commenterUserId)
				);
				const out = [];
				for (const ci of notOwned) {
					const count = (comments_created_image ?? []).filter(
						(c) => Number(c?.created_image_id) === Number(ci.id)
							&& (c?.created_at ?? "") >= sinceIso
							&& Number(c?.user_id) !== Number(commenterUserId)
					).length;
					if (count > 0) {
						out.push({
							created_image_id: Number(ci.id),
							title: (ci?.title && String(ci.title).trim()) || "Untitled",
							comment_count: count
						});
					}
				}
				out.sort((a, b) => b.comment_count - a.comment_count || a.created_image_id - b.created_image_id);
				return out;
			}
		},
		insertEmailLinkClick: {
			run: async (emailSendId, userId, path) => {
				email_link_clicks.push({
					id: email_link_clicks.length + 1,
					email_send_id: emailSendId,
					user_id: userId ?? null,
					clicked_at: new Date().toISOString(),
					path: path ?? null
				});
				return { changes: 1 };
			}
		},
		selectFeedItems: {
			all: async (excludeUserId) => {
				const viewerId = excludeUserId ?? null;
				if (viewerId === null || viewerId === undefined) {
					return [];
				}

				const followingIdSet = new Set(
					user_follows
						.filter((row) => row.follower_id === Number(viewerId))
						.map((row) => String(row.following_id))
				);

				const filtered = feed_items.filter((item) => {
					const ci = created_images.find((c) => Number(c.id) === Number(item.created_image_id));
					const authorId = ci?.user_id ?? item.user_id ?? null;
					if (authorId === null || authorId === undefined) return false;
					if (ci?.unavailable_at != null && ci.unavailable_at !== "") return false;
					return followingIdSet.has(String(authorId));
				});

				return filtered.map((item) => {
					const ci = created_images.find((c) => Number(c.id) === Number(item.created_image_id));
					const authorId = ci?.user_id ?? item.user_id;
					const profile = user_profiles.find((p) => p.user_id === Number(authorId));
					const user = users.find((u) => Number(u.id) === Number(authorId));
					const authorPlan = user?.meta?.plan === "founder" ? "founder" : "free";
					return {
						...item,
						user_id: authorId,
						author_user_name: profile?.user_name ?? null,
						author_display_name: profile?.display_name ?? null,
						author_avatar_url: profile?.avatar_url ?? null,
						author_plan: authorPlan
					};
				});
			}
		},
		selectExploreFeedItems: (() => {
			const exploreAll = async (viewerId) => {
				const id = viewerId ?? null;
				if (id === null || id === undefined) return [];

				const viewerIdNum = Number(id);
				const followingIds = new Set(
					user_follows
						.filter((row) => row.follower_id === viewerIdNum)
						.map((row) => Number(row.following_id))
				);

				const filtered = feed_items
					.filter((item) => {
						if (item.user_id === null || item.user_id === undefined) return false;
						const itemUserId = Number(item.user_id);
						if (itemUserId === viewerIdNum) return false;
						return !followingIds.has(itemUserId);
					})
					.slice()
					.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));

				return filtered.map((item) => {
					const profile = user_profiles.find((p) => p.user_id === Number(item.user_id));
					return {
						...item,
						author_user_name: profile?.user_name ?? null,
						author_display_name: profile?.display_name ?? null,
						author_avatar_url: profile?.avatar_url ?? null
					};
				});
			};

			// Paginated: filter then slice then map — only build the requested page (no "all" then slice).
			const explorePaginated = async (viewerId, { limit = 24, offset = 0 } = {}) => {
				const id = viewerId ?? null;
				if (id === null || id === undefined) return [];

				const viewerIdNum = Number(id);
				const followingIds = new Set(
					user_follows
						.filter((row) => row.follower_id === viewerIdNum)
						.map((row) => Number(row.following_id))
				);

				const filtered = feed_items
					.filter((item) => {
						if (item.user_id === null || item.user_id === undefined) return false;
						const itemUserId = Number(item.user_id);
						if (itemUserId === viewerIdNum) return false;
						return !followingIds.has(itemUserId);
					})
					.slice()
					.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));

				// Allow limit+1 (e.g. 101) so API can detect hasMore; cap at 500 for safety
				const lim = Math.min(Math.max(0, Number(limit) || 24), 500);
				const off = Math.max(0, Number(offset) || 0);
				const page = filtered.slice(off, off + lim);

				return page.map((item) => {
					const profile = user_profiles.find((p) => p.user_id === Number(item.user_id));
					return {
						...item,
						author_user_name: profile?.user_name ?? null,
						author_display_name: profile?.display_name ?? null,
						author_avatar_url: profile?.avatar_url ?? null
					};
				});
			};

			return {
				all: exploreAll,
				paginated: explorePaginated
			};
		})(),
		selectNewestPublishedFeedItems: {
			// All published feed items, newest first (no viewer/follow filtering). Used for Advanced create "Newest".
			all: async (userId) => {
				const itemsWithUser = feed_items.map((item) => {
					const user_id = item.user_id != null ? Number(item.user_id) : (() => {
						const ci = created_images.find((c) => Number(c.id) === Number(item.created_image_id));
						return ci?.user_id != null ? Number(ci.user_id) : null;
					})();
					return { ...item, user_id };
				});
				const filtered = itemsWithUser
					.filter((item) => item.user_id != null && item.user_id !== undefined)
					.slice()
					.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
				return filtered.map((item) => {
					const cid = Number(item.created_image_id);
					const likeCount = likes_created_image.filter((l) => Number(l.created_image_id) === cid).length;
					const commentCount = comments_created_image.filter((c) => Number(c.created_image_id) === cid).length;
					const profile = user_profiles.find((p) => p.user_id === Number(item.user_id));
					return {
						...item,
						like_count: likeCount,
						comment_count: commentCount,
						viewer_liked: false,
						author_user_name: profile?.user_name ?? null,
						author_display_name: profile?.display_name ?? null,
						author_avatar_url: profile?.avatar_url ?? null
					};
				});
			}
		},
		selectNewbieFeedItems: {
			all: async (viewerId) => {
				const id = viewerId ?? null;
				if (id === null || id === undefined) {
					return [];
				}
				const viewerIdNum = Number(id);
				const itemsWithUser = feed_items.map((item) => {
					const user_id = item.user_id != null ? Number(item.user_id) : (() => {
						const ci = created_images.find((c) => Number(c.id) === Number(item.created_image_id));
						return ci?.user_id != null ? Number(ci.user_id) : null;
					})();
					return { ...item, user_id };
				});
				const filtered = itemsWithUser
					.filter((item) => {
						if (item.user_id === null || item.user_id === undefined) return false;
						if (Number(item.user_id) === viewerIdNum) return false;
						const cid = Number(item.created_image_id);
						const likeCount = likes_created_image.filter((l) => Number(l.created_image_id) === cid).length;
						const commentCount = comments_created_image.filter((c) => Number(c.created_image_id) === cid).length;
						return likeCount > 0 || commentCount > 0;
					})
					.slice()
					.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));

				return filtered.map((item) => {
					const cid = Number(item.created_image_id);
					const likeCount = likes_created_image.filter((l) => Number(l.created_image_id) === cid).length;
					const commentCount = comments_created_image.filter((c) => Number(c.created_image_id) === cid).length;
					const profile = user_profiles.find((p) => p.user_id === Number(item.user_id));
					return {
						...item,
						like_count: likeCount,
						comment_count: commentCount,
						viewer_liked: Boolean(likes_created_image.some((l) => Number(l.created_image_id) === cid && Number(l.user_id) === viewerIdNum)),
						author_user_name: profile?.user_name ?? null,
						author_display_name: profile?.display_name ?? null,
						author_avatar_url: profile?.avatar_url ?? null
					};
				});
			}
		},
		selectAllCreatedImageIdAndMeta: {
			all: async () => {
				return created_images.map((img) => ({ id: img.id, meta: img.meta }));
			}
		},
		selectViewerLikedCreationIds: {
			all: async (userId, creationIds) => {
				const safeIds = Array.isArray(creationIds)
					? creationIds.map((id) => Number(id)).filter((n) => Number.isFinite(n) && n > 0)
					: [];
				if (safeIds.length === 0) return [];
				const idSet = new Set(safeIds);
				return likes_created_image
					.filter((l) => Number(l.user_id) === Number(userId) && idSet.has(Number(l.created_image_id)))
					.map((l) => Number(l.created_image_id));
			}
		},
		selectFeedItemsByCreationIds: {
			all: async (ids) => {
				const safeIds = Array.isArray(ids)
					? ids.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)
					: [];
				if (safeIds.length === 0) return [];
				const idSet = new Set(safeIds);
				const sorted = created_images
					.filter((img) => img.id != null && idSet.has(Number(img.id)))
					.slice()
					.sort((a, b) => safeIds.indexOf(Number(a.id)) - safeIds.indexOf(Number(b.id)));
				return sorted.map((row) => {
					const id = Number(row.id);
					const likeCount = likes_created_image.filter((l) => Number(l.created_image_id) === id).length;
					const commentCount = comments_created_image.filter((c) => Number(c.created_image_id) === id).length;
					const profile = user_profiles.find((p) => Number(p.user_id) === Number(row.user_id));
					const url =
						row.file_path ??
						(row.filename
							? `/api/images/created/${row.filename}`
							: null);
					return {
						id: row.id,
						created_image_id: row.id,
						title: row.title ?? "",
						summary: row.summary ?? "",
						created_at: row.created_at,
						user_id: row.user_id,
						like_count: likeCount,
						comment_count: commentCount,
						author_display_name: profile?.display_name ?? null,
						author_user_name: profile?.user_name ?? null,
						author_avatar_url: profile?.avatar_url ?? null,
						url
					};
				});
			}
		},
		selectMostMutatedFeedItems: {
			all: async (viewerId, limit) => {
				const limitNum = Number.isFinite(Number(limit)) ? Math.max(0, Math.min(Number(limit), 200)) : 25;
				function toHistoryArray(meta) {
					const h = meta?.history;
					if (Array.isArray(h)) return h;
					if (typeof h === "string") {
						try { const a = JSON.parse(h); return Array.isArray(a) ? a : []; } catch { return []; }
					}
					return [];
				}
				const countById = new Map();
				for (const img of created_images) {
					const meta = img.meta != null && typeof img.meta === "object" ? img.meta : (typeof img.meta === "string" ? (() => { try { return JSON.parse(img.meta); } catch { return null; } })() : null);
					if (!meta || typeof meta !== "object") continue;
					const history = toHistoryArray(meta);
					for (const v of history) {
						const id = v != null ? Number(v) : NaN;
						if (!Number.isFinite(id) || id <= 0) continue;
						countById.set(id, (countById.get(id) ?? 0) + 1);
					}
					const mid = meta.mutate_of_id != null ? Number(meta.mutate_of_id) : NaN;
					if (Number.isFinite(mid) && mid > 0) countById.set(mid, (countById.get(mid) ?? 0) + 1);
				}
				const topIds = [...countById.entries()]
					.sort((a, b) => (b[1] - a[1]) || (a[0] - b[0]))
					.slice(0, limitNum)
					.map(([id]) => id);
				if (topIds.length === 0) return [];
				const idSet = new Set(topIds);
				const sorted = created_images
					.filter((img) => img.id != null && idSet.has(Number(img.id)))
					.slice()
					.sort((a, b) => topIds.indexOf(Number(a.id)) - topIds.indexOf(Number(b.id)));
				return sorted.map((row) => {
					const id = Number(row.id);
					const likeCount = likes_created_image.filter((l) => Number(l.created_image_id) === id).length;
					const commentCount = comments_created_image.filter((c) => Number(c.created_image_id) === id).length;
					const profile = user_profiles.find((p) => Number(p.user_id) === Number(row.user_id));
					return {
						id: row.id,
						created_image_id: row.id,
						title: row.title ?? "",
						summary: row.summary ?? "",
						created_at: row.created_at,
						user_id: row.user_id,
						like_count: likeCount,
						comment_count: commentCount,
						author_display_name: profile?.display_name ?? null,
						author_user_name: profile?.user_name ?? null
					};
				});
			}
		},
		insertUserFollow: {
			run: async (followerId, followingId) => {
				const a = Number(followerId);
				const b = Number(followingId);
				if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) return { changes: 0 };
				if (a === b) return { changes: 0 };
				const exists = user_follows.some((row) => row.follower_id === a && row.following_id === b);
				if (exists) return { changes: 0 };
				user_follows.push({ follower_id: a, following_id: b, created_at: new Date().toISOString() });
				return { changes: 1 };
			}
		},
		deleteUserFollow: {
			run: async (followerId, followingId) => {
				const a = Number(followerId);
				const b = Number(followingId);
				const idx = user_follows.findIndex((row) => row.follower_id === a && row.following_id === b);
				if (idx === -1) return { changes: 0 };
				user_follows.splice(idx, 1);
				return { changes: 1 };
			}
		},
		selectUserFollowStatus: {
			get: async (followerId, followingId) => {
				const a = Number(followerId);
				const b = Number(followingId);
				const exists = user_follows.some((row) => row.follower_id === a && row.following_id === b);
				return exists ? { viewer_follows: 1 } : undefined;
			}
		},
		selectUserFollowers: {
			all: async (userId, options = {}) => {
				const limit = Math.min(200, Math.max(1, Number.parseInt(String(options?.limit ?? "50"), 10) || 50));
				const offset = Math.max(0, Number.parseInt(String(options?.offset ?? "0"), 10) || 0);
				const id = Number(userId);
				const rows = user_follows
					.filter((row) => row.following_id === id)
					.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
					.slice(offset, offset + limit);
				return rows.map((row) => {
					const profile = user_profiles.find((p) => p.user_id === Number(row.follower_id));
					return {
						user_id: row.follower_id,
						followed_at: row.created_at,
						user_name: profile?.user_name ?? null,
						display_name: profile?.display_name ?? null,
						avatar_url: profile?.avatar_url ?? null
					};
				});
			}
		},
		selectUserFollowersWithViewer: {
			all: async (targetUserId, viewerId, options = {}) => {
				const limit = Math.min(200, Math.max(1, Number.parseInt(String(options?.limit ?? "50"), 10) || 50));
				const offset = Math.max(0, Number.parseInt(String(options?.offset ?? "0"), 10) || 0);
				const id = Number(targetUserId);
				const viewerIdNum = Number(viewerId);
				const rows = user_follows
					.filter((row) => row.following_id === id)
					.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
					.slice(offset, offset + limit);
				return rows.map((row) => {
					const profile = user_profiles.find((p) => p.user_id === Number(row.follower_id));
					return {
						user_id: row.follower_id,
						followed_at: row.created_at,
						user_name: profile?.user_name ?? null,
						display_name: profile?.display_name ?? null,
						avatar_url: profile?.avatar_url ?? null,
						viewer_follows: user_follows.some(
							(f) => Number(f.follower_id) === viewerIdNum && Number(f.following_id) === Number(row.follower_id)
						)
					};
				});
			}
		},
		selectUserFollowing: {
			all: async (userId, options = {}) => {
				const limit = Math.min(200, Math.max(1, Number.parseInt(String(options?.limit ?? "50"), 10) || 50));
				const offset = Math.max(0, Number.parseInt(String(options?.offset ?? "0"), 10) || 0);
				const id = Number(userId);
				const rows = user_follows
					.filter((row) => row.follower_id === id)
					.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
					.slice(offset, offset + limit);
				return rows.map((row) => {
					const profile = user_profiles.find((p) => p.user_id === Number(row.following_id));
					return {
						user_id: row.following_id,
						followed_at: row.created_at,
						user_name: profile?.user_name ?? null,
						display_name: profile?.display_name ?? null,
						avatar_url: profile?.avatar_url ?? null
					};
				});
			}
		},
		selectExploreItems: {
			all: async () => [...explore_items]
		},
		selectCreationsForUser: {
			all: async (userId) => creations.filter((creation) => creation.user_id === Number(userId))
		},
		selectServers: {
			all: async () => {
				// Join with users to get owner email
				return servers.map(server => {
					const user = users.find(u => u.id === server.user_id);
					return {
						...server,
						owner_email: user?.email || null
					};
				});
			}
		},
		selectServerById: {
			get: async (serverId) => {
				const server = servers.find(s => s.id === Number(serverId));
				if (!server) return null;
				const user = users.find(u => u.id === server.user_id);
				return {
					...server,
					owner_email: user?.email || null
				};
			}
		},
		updateServerConfig: {
			run: async (serverId, serverConfig) => {
				const server = servers.find(s => s.id === Number(serverId));
				if (server) {
					server.server_config = serverConfig;
					server.updated_at = new Date().toISOString();
					return { changes: 1 };
				}
				return { changes: 0 };
			}
		},
		updateServer: {
			run: async (serverId, nextServer) => {
				const server = servers.find(s => s.id === Number(serverId));
				if (!server) {
					return { changes: 0 };
				}
				server.user_id = nextServer?.user_id ?? server.user_id;
				server.name = nextServer?.name ?? server.name;
				server.status = nextServer?.status ?? server.status;
				server.server_url = nextServer?.server_url ?? server.server_url;
				server.auth_token = nextServer?.auth_token ?? null;
				server.status_date = nextServer?.status_date ?? server.status_date ?? null;
				server.description = nextServer?.description ?? server.description ?? null;
				server.members_count = nextServer?.members_count ?? server.members_count ?? 0;
				server.server_config = nextServer?.server_config ?? server.server_config ?? null;
				server.updated_at = new Date().toISOString();
				return { changes: 1 };
			}
		},
		checkServerMembership: {
			get: async (serverId, userId) => {
				return server_members.some(
					m => m.server_id === Number(serverId) && m.user_id === Number(userId)
				);
			}
		},
		addServerMember: {
			run: async (serverId, userId) => {
				const serverIdNum = Number(serverId);
				const userIdNum = Number(userId);

				// Check if already a member
				if (server_members.some(m => m.server_id === serverIdNum && m.user_id === userIdNum)) {
					return { changes: 0 };
				}

				server_members.push({
					server_id: serverIdNum,
					user_id: userIdNum,
					created_at: new Date().toISOString()
				});

				// Update members_count
				const server = servers.find(s => s.id === serverIdNum);
				if (server) {
					server.members_count = (server.members_count || 0) + 1;
				}

				return { changes: 1 };
			}
		},
		removeServerMember: {
			run: async (serverId, userId) => {
				const serverIdNum = Number(serverId);
				const userIdNum = Number(userId);
				const index = server_members.findIndex(
					m => m.server_id === serverIdNum && m.user_id === userIdNum
				);

				if (index === -1) {
					return { changes: 0 };
				}

				server_members.splice(index, 1);

				// Update members_count
				const server = servers.find(s => s.id === serverIdNum);
				if (server) {
					server.members_count = Math.max(0, (server.members_count || 0) - 1);
				}

				return { changes: 1 };
			}
		},
		insertServer: {
			run: async (userId, name, status, serverUrl, serverConfig = null, authToken = null, description = null) => {
				const id = servers.length > 0
					? Math.max(...servers.map(s => s.id || 0)) + 1
					: 1;
				const now = new Date().toISOString();
				const resolvedAuthToken = typeof authToken === "string" && authToken.trim()
					? authToken.trim()
					: null;
				servers.push({
					id,
					user_id: userId,
					name,
					status,
					server_url: serverUrl,
					auth_token: resolvedAuthToken,
					status_date: null,
					description: description || null,
					members_count: 0,
					server_config: serverConfig,
					created_at: now,
					updated_at: now
				});
				return Promise.resolve({
					insertId: id,
					changes: 1
				});
			}
		},
		selectTemplates: {
			all: async () => [...templates]
		},
		insertCreatedImage: {
			run: async (userId, filename, filePath, width, height, color, status = 'creating') => {
				const image = {
					id: created_images.length > 0
						? Math.max(...created_images.map(i => i.id || 0)) + 1
						: 1,
					user_id: userId,
					filename,
					file_path: filePath,
					width,
					height,
					color,
					status,
					created_at: new Date().toISOString()
				};
				created_images.push(image);
				return {
					insertId: image.id,
					lastInsertRowid: image.id,
					changes: 1
				};
			}
		},
		updateCreatedImageStatus: {
			run: async (id, userId, status, color = null) => {
				const image = created_images.find(
					(img) => img.id === Number(id) && img.user_id === Number(userId)
				);
				if (!image) {
					return { changes: 0 };
				}
				image.status = status;
				if (color) {
					image.color = color;
				}
				return { changes: 1 };
			}
		},
		updateCreatedImageMeta: {
			run: async (id, userId, meta) => {
				const image = created_images.find(
					(img) => img.id === Number(id) && img.user_id === Number(userId)
				);
				if (!image) {
					return { changes: 0 };
				}
				image.meta = meta;
				return { changes: 1 };
			}
		},
		resetCreatedImageForRetry: {
			run: async (id, userId, { meta, filename }) => {
				const image = created_images.find(
					(img) => img.id === Number(id) && img.user_id === Number(userId)
				);
				if (!image) {
					return { changes: 0 };
				}
				image.status = "creating";
				image.meta = meta;
				if (filename != null) image.filename = filename;
				image.file_path = "";
				return { changes: 1 };
			}
		},
		selectCreatedImagesForUser: {
			all: async (userId, options = {}) => {
				const includeUnavailable = options?.includeUnavailable === true;
				const limit = Math.min(200, Math.max(1, Number.parseInt(String(options?.limit ?? "50"), 10) || 50));
				const offset = Math.max(0, Number.parseInt(String(options?.offset ?? "0"), 10) || 0);
				const filtered = created_images.filter((img) => {
					if (img.user_id !== Number(userId)) return false;
					if (!includeUnavailable && (img.unavailable_at != null && img.unavailable_at !== "")) return false;
					return true;
				}).sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
				return filtered.slice(offset, offset + limit);
			}
		},
		selectPublishedCreatedImagesForUser: {
			all: async (userId, options = {}) => {
				const limit = Math.min(200, Math.max(1, Number.parseInt(String(options?.limit ?? "50"), 10) || 50));
				const offset = Math.max(0, Number.parseInt(String(options?.offset ?? "0"), 10) || 0);
				const filtered = created_images.filter(
					(img) =>
						img.user_id === Number(userId) &&
						(img.published === true || img.published === 1) &&
						(img.unavailable_at == null || img.unavailable_at === "")
				).sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
				return filtered.slice(offset, offset + limit);
			}
		},
		selectPublishedCreationsByPersonalityMention: {
			all: async (personality, options = {}) => {
				const normalized = String(personality || "").trim().toLowerCase();
				if (!/^[a-z0-9][a-z0-9_-]{2,23}$/.test(normalized)) return [];
				const needle = `@${normalized}`;
				const limit = Math.min(200, Math.max(1, Number.parseInt(String(options?.limit ?? "50"), 10) || 50));
				const offset = Math.max(0, Number.parseInt(String(options?.offset ?? "0"), 10) || 0);

				const creationList = (typeof globalThis.__mockDb !== "undefined" && globalThis.__mockDb?.created_images) ?? created_images ?? [];
				const commentList = (typeof globalThis.__mockDb !== "undefined" && globalThis.__mockDb?.comments_created_image) ?? comments_created_image ?? [];

				const idsFromComments = new Set(
					(commentList ?? [])
						.filter((c) => String(c?.text || "").toLowerCase().includes(needle))
						.map((c) => Number(c?.created_image_id))
						.filter((id) => Number.isFinite(id) && id > 0)
				);

				const matched = (creationList ?? [])
					.filter((img) => {
						const isPublished = img?.published === true || img?.published === 1;
						if (!isPublished) return false;
						if (!(img?.unavailable_at == null || img?.unavailable_at === "")) return false;
						const descMatch = String(img?.description || "").toLowerCase().includes(needle);
						const titleMatch = String(img?.title || "").toLowerCase().includes(needle);
						const commentMatch = idsFromComments.has(Number(img?.id));
						return descMatch || titleMatch || commentMatch;
					})
					.sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));

				return matched.slice(offset, offset + limit);
			}
		},
		selectPublishedCreationsByTagMention: {
			all: async (tag, options = {}) => {
				const normalized = String(tag || "").trim().toLowerCase();
				if (!/^[a-z0-9][a-z0-9_-]{1,31}$/.test(normalized)) return [];
				const needle = `#${normalized}`;
				const limit = Math.min(200, Math.max(1, Number.parseInt(String(options?.limit ?? "50"), 10) || 50));
				const offset = Math.max(0, Number.parseInt(String(options?.offset ?? "0"), 10) || 0);

				const creationList = (typeof globalThis.__mockDb !== "undefined" && globalThis.__mockDb?.created_images) ?? created_images ?? [];
				const commentList = (typeof globalThis.__mockDb !== "undefined" && globalThis.__mockDb?.comments_created_image) ?? comments_created_image ?? [];

				const idsFromComments = new Set(
					(commentList ?? [])
						.filter((c) => String(c?.text || "").toLowerCase().includes(needle))
						.map((c) => Number(c?.created_image_id))
						.filter((id) => Number.isFinite(id) && id > 0)
				);

				const matched = (creationList ?? [])
					.filter((img) => {
						const isPublished = img?.published === true || img?.published === 1;
						if (!isPublished) return false;
						if (!(img?.unavailable_at == null || img?.unavailable_at === "")) return false;
						const descMatch = String(img?.description || "").toLowerCase().includes(needle);
						const titleMatch = String(img?.title || "").toLowerCase().includes(needle);
						const commentMatch = idsFromComments.has(Number(img?.id));
						return descMatch || titleMatch || commentMatch;
					})
					.sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));

				return matched.slice(offset, offset + limit);
			}
		},
		selectAllCreatedImageCountForUser: {
			get: async (userId) => ({
				count: created_images.filter(
					(img) => img.user_id === Number(userId) && (img.unavailable_at == null || img.unavailable_at === "")
				).length
			})
		},
		selectPublishedCreatedImageCountForUser: {
			get: async (userId) => ({
				count: created_images.filter(
					(img) =>
						img.user_id === Number(userId) &&
						(img.published === true || img.published === 1) &&
						(img.unavailable_at == null || img.unavailable_at === "")
				).length
			})
		},
		selectCreatedImagesLikedByUser: {
			all: async (_userId, _options = {}) => []
		},
		selectCommentsByUser: {
			all: async (_userId, _options = {}) => []
		},
		selectLikesReceivedForUserPublished: {
			get: async () => ({ count: 0 })
		},
		selectCreatedImageById: {
			get: async (id, userId) => {
				return created_images.find(
					(img) => img.id === Number(id) && img.user_id === Number(userId)
				);
			}
		},
		selectCreatedImageByIdAnyUser: {
			get: async (id) => {
				return created_images.find(
					(img) => img.id === Number(id)
				);
			}
		},
		selectCreatedImageByFilename: {
			get: async (filename) => {
				return created_images.find(
					(img) => img.filename === filename
				);
			}
		},
		/** Direct children: published creations with meta.mutate_of_id = parentId, ordered by created_at asc. */
		selectCreatedImageChildrenByParentId: {
			all: async (parentId) => {
				const id = Number(parentId);
				if (!Number.isFinite(id) || id <= 0) return [];
				const list = (typeof globalThis.__mockDb !== "undefined" && globalThis.__mockDb?.created_images) ?? created_images ?? [];
				return list
					.filter(
						(img) =>
							(img?.published === true || img?.published === 1) &&
							(img?.unavailable_at == null || img?.unavailable_at === "") &&
							Number(img?.meta?.mutate_of_id) === id
					)
					.sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
					.map((img) => ({
						id: img.id,
						filename: img.filename,
						file_path: img.file_path,
						title: img.title,
						created_at: img.created_at,
						status: img.status
					}));
			}
		},
		insertCreatedImageAnon: {
			run: async (prompt, filename, filePath, width, height, status, meta) => {
				const id = created_images_anon.length > 0
					? Math.max(...created_images_anon.map((i) => i.id || 0)) + 1
					: 1;
				created_images_anon.push({
					id,
					prompt: prompt ?? null,
					filename,
					file_path: filePath,
					width,
					height,
					status,
					created_at: new Date().toISOString(),
					meta: meta ?? null
				});
				return Promise.resolve({ insertId: id, changes: 1 });
			}
		},
		selectCreatedImageAnonById: {
			get: async (id) => created_images_anon.find((r) => r.id === Number(id))
		},
		selectCreatedImagesAnonByIds: {
			all: async (ids) => {
				const safeIds = (Array.isArray(ids) ? ids : []).map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0);
				const idSet = new Set(safeIds);
				return created_images_anon.filter((r) => r.id != null && idSet.has(Number(r.id)));
			}
		},
		selectRecentCompletedCreatedImageAnonByPrompt: {
			all: async (prompt, sinceIso, limit = 5) => {
				if (prompt == null || String(prompt).trim() === "") return [];
				const key = String(prompt).trim();
				const since = new Date(sinceIso).getTime();
				const safeLimit = Math.min(Math.max(Number(limit) || 5, 1), 20);
				return created_images_anon
					.filter(
						(r) =>
							r.prompt === key &&
							r.status === "completed" &&
							new Date(r.created_at).getTime() >= since
					)
					.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
					.slice(0, safeLimit);
			}
		},
		selectCreatedImageAnonByFilename: {
			get: async (filename) => {
				if (!filename || typeof filename !== "string" || filename.includes("..") || filename.includes("/"))
					return undefined;
				const matches = created_images_anon
					.filter((r) => r.filename === filename.trim())
					.sort((a, b) => (b.id || 0) - (a.id || 0));
				return matches[0] ?? undefined;
			}
		},
		countCreatedImagesAnonByFilename: {
			get: async (filename) => {
				if (!filename || typeof filename !== "string" || filename.includes("..") || filename.includes("/"))
					return { count: 0 };
				const count = created_images_anon.filter((r) => r.filename === filename.trim()).length;
				return Promise.resolve({ count });
			}
		},
		updateTryRequestsNullAnonId: {
			run: async (createdImageAnonId) => {
				const id = Number(createdImageAnonId);
				let count = 0;
				for (const row of try_requests) {
					if (row.created_image_anon_id === id) {
						row.created_image_anon_id = null;
						count++;
					}
				}
				return Promise.resolve({ changes: count });
			}
		},
		updateTryRequestsTransitionedByCreatedImageAnonId: {
			run: async (createdImageAnonId, { userId, createdImageId }) => {
				const id = Number(createdImageAnonId);
				const at = new Date().toISOString();
				const transitioned = { at, user_id: Number(userId), created_image_id: Number(createdImageId) };
				let count = 0;
				for (const row of try_requests) {
					if (row.created_image_anon_id === id) {
						row.created_image_anon_id = null;
						const meta = typeof row.meta === "object" && row.meta !== null ? { ...row.meta, transitioned } : { transitioned };
						row.meta = meta;
						count++;
					}
				}
				return Promise.resolve({ changes: count });
			}
		},
		deleteCreatedImageAnon: {
			run: async (id) => {
				const idx = created_images_anon.findIndex((r) => r.id === Number(id));
				if (idx === -1) return Promise.resolve({ changes: 0 });
				created_images_anon.splice(idx, 1);
				return Promise.resolve({ changes: 1 });
			}
		},
		selectTryRequestByCidAndPrompt: {
			get: async (anonCid, prompt) => {
				if (prompt == null || String(prompt).trim() === "") return undefined;
				const key = String(prompt).trim();
				const matches = try_requests
					.filter((r) => r.anon_cid === anonCid && r.prompt === key)
					.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
				return matches[0] ?? undefined;
			}
		},
		selectTryRequestsByCid: {
			all: async (anonCid) =>
				try_requests
					.filter((r) => r.anon_cid === anonCid)
					.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
		},
		/** Unique anon_cids from try_requests with request count; excludes __pool__. Order by last_request_at desc. */
		selectTryRequestAnonCidsWithCount: {
			all: async () => {
				const filtered = try_requests.filter((r) => r.anon_cid !== "__pool__");
				const byCid = new Map();
				for (const r of filtered) {
					const cid = r.anon_cid;
					const at = r.created_at;
					if (!byCid.has(cid)) {
						byCid.set(cid, { anon_cid: cid, request_count: 0, first_request_at: at, last_request_at: at });
					}
					const agg = byCid.get(cid);
					agg.request_count += 1;
					if (at && (!agg.first_request_at || at < agg.first_request_at)) agg.first_request_at = at;
					if (at && (!agg.last_request_at || at > agg.last_request_at)) agg.last_request_at = at;
				}
				return Array.from(byCid.values()).sort((a, b) => {
					const aAt = a.last_request_at || "";
					const bAt = b.last_request_at || "";
					return bAt.localeCompare(aAt);
				});
			}
		},
		/** Rows where created_image_anon_id IS NULL (transitioned); returns anon_cid, meta for building transition map. */
		selectTryRequestsTransitionedMeta: {
			all: async () => {
				return try_requests
					.filter((r) => r.created_image_anon_id == null && r.meta && r.meta.transitioned != null)
					.map((r) => ({ anon_cid: r.anon_cid, meta: r.meta }));
			}
		},
		updateCreatedImageAnonJobCompleted: {
			run: async (id, { filename, file_path, width, height, meta }) => {
				const row = created_images_anon.find((r) => r.id === Number(id));
				if (!row) return Promise.resolve({ changes: 0 });
				row.filename = filename;
				row.file_path = file_path;
				row.width = width;
				row.height = height;
				row.status = "completed";
				row.meta = meta ?? row.meta;
				return Promise.resolve({ changes: 1 });
			}
		},
		updateCreatedImageAnonJobFailed: {
			run: async (id, { meta }) => {
				const row = created_images_anon.find((r) => r.id === Number(id));
				if (!row) return Promise.resolve({ changes: 0 });
				row.status = "failed";
				row.meta = meta ?? row.meta;
				return Promise.resolve({ changes: 1 });
			}
		},
		insertTryRequest: {
			run: async (anonCid, prompt, created_image_anon_id, fulfilled_at = null, meta = null) => {
				const id =
					try_requests.length > 0
						? Math.max(...try_requests.map((r) => r.id || 0)) + 1
						: 1;
				try_requests.push({
					id,
					anon_cid: anonCid,
					prompt: prompt ?? null,
					created_at: new Date().toISOString(),
					fulfilled_at: fulfilled_at ?? null,
					created_image_anon_id: Number(created_image_anon_id),
					meta: meta ?? null,
				});
				return Promise.resolve({ insertId: id, changes: 1 });
			}
		},
		updateTryRequestFulfilledByCreatedImageAnonId: {
			run: async (created_image_anon_id, fulfilled_at_iso) => {
				const rows = try_requests.filter(
					(r) => r.created_image_anon_id === Number(created_image_anon_id) && r.fulfilled_at == null
				);
				rows.forEach((r) => {
					r.fulfilled_at = fulfilled_at_iso;
				});
				return Promise.resolve({ changes: rows.length });
			}
		},
		selectCreatedImageDescriptionAndMetaByIds: {
			all: async (ids) => {
				const safeIds = Array.isArray(ids)
					? ids.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)
					: [];
				if (safeIds.length === 0) return [];
				const idSet = new Set(safeIds);
				return created_images
					.filter((img) => img.id != null && idSet.has(Number(img.id)))
					.map((img) => ({ id: img.id, description: img.description ?? null, meta: img.meta ?? null }));
			}
		},
		publishCreatedImage: {
			run: async (id, userId, title, description, isAdmin = false) => {
				const image = created_images.find(
					(img) => img.id === Number(id) && (isAdmin || img.user_id === Number(userId))
				);
				if (!image) {
					return { changes: 0 };
				}
				image.published = true;
				image.published_at = new Date().toISOString();
				image.title = title;
				image.description = description;
				return { changes: 1 };
			}
		},
		markCreatedImageUnavailable: {
			run: async (id, userId) => {
				const image = created_images.find(
					(img) => img.id === Number(id) && img.user_id === Number(userId)
				);
				if (!image) return { changes: 0 };
				image.unavailable_at = new Date().toISOString();
				return { changes: 1 };
			}
		},
		deleteCreatedImageById: {
			run: async (id, userId) => {
				const index = created_images.findIndex(
					(img) => img.id === Number(id) && img.user_id === Number(userId)
				);
				if (index === -1) {
					return { changes: 0 };
				}
				created_images.splice(index, 1);
				return { changes: 1 };
			}
		},
		updateCreatedImage: {
			run: async (id, userId, title, description, isAdmin = false) => {
				const image = created_images.find(
					(img) => img.id === Number(id) && (isAdmin || img.user_id === Number(userId))
				);
				if (!image) {
					return { changes: 0 };
				}
				image.title = title;
				image.description = description;
				return { changes: 1 };
			}
		},
		unpublishCreatedImage: {
			run: async (id, userId, isAdmin = false) => {
				const image = created_images.find(
					(img) => img.id === Number(id) && (isAdmin || img.user_id === Number(userId))
				);
				if (!image) {
					return { changes: 0 };
				}
				image.published = false;
				image.published_at = null;
				return { changes: 1 };
			}
		},
		insertFeedItem: {
			run: async (title, summary, author, tags, createdImageId) => {
				const id = feed_items.length > 0
					? Math.max(...feed_items.map(item => item.id || 0)) + 1
					: 1;
				const now = new Date().toISOString();
				const item = {
					id,
					title,
					summary,
					author,
					tags: tags || null,
					created_at: now,
					created_image_id: createdImageId || null
				};
				feed_items.push(item);
				return {
					insertId: id,
					lastInsertRowid: id,
					changes: 1
				};
			}
		},
		selectFeedItemByCreatedImageId: {
			get: async (createdImageId) => {
				return feed_items
					.filter(item => item.created_image_id === Number(createdImageId))
					.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))[0];
			}
		},
		updateFeedItem: {
			run: async (createdImageId, title, summary) => {
				const items = feed_items.filter(item => item.created_image_id === Number(createdImageId));
				if (items.length === 0) {
					return { changes: 0 };
				}
				items.forEach(item => {
					item.title = title;
					item.summary = summary;
				});
				return { changes: items.length };
			}
		},
		deleteFeedItemByCreatedImageId: {
			run: async (createdImageId) => {
				const initialLength = feed_items.length;
				const filtered = feed_items.filter(item => item.created_image_id !== Number(createdImageId));
				feed_items.length = 0;
				feed_items.push(...filtered);
				return { changes: initialLength - feed_items.length };
			}
		},
		deleteAllLikesForCreatedImage: {
			run: async (createdImageId) => {
				const initialLength = likes_created_image.length;
				const filtered = likes_created_image.filter(like => like.created_image_id !== Number(createdImageId));
				likes_created_image.length = 0;
				likes_created_image.push(...filtered);
				return { changes: initialLength - likes_created_image.length };
			}
		},
		deleteAllCommentsForCreatedImage: {
			run: async (createdImageId) => {
				const initialLength = comments_created_image.length;
				const filtered = comments_created_image.filter(comment => comment.created_image_id !== Number(createdImageId));
				comments_created_image.length = 0;
				comments_created_image.push(...filtered);
				return { changes: initialLength - comments_created_image.length };
			}
		},
		selectLatestCreatedImageComments: {
			all: async () => {
				// Keep mock adapter minimal for now.
				// (Mock comment creation/listing isn't fully implemented yet.)
				return [];
			}
		},
		selectUserCredits: {
			get: async (userId) =>
				user_credits.find((row) => row.user_id === Number(userId))
		},
		insertUserCredits: {
			run: async (userId, balance, lastDailyClaimAt) => {
				const existing = user_credits.find((row) => row.user_id === Number(userId));
				if (existing) {
					const error = new Error("Credits already exist for user");
					error.code = "CREDITS_ALREADY_EXIST";
					throw error;
				}
				const now = new Date().toISOString();
				const row = {
					id: nextUserCreditsId++,
					user_id: Number(userId),
					balance: Number(balance) || 0,
					last_daily_claim_at: lastDailyClaimAt || null,
					created_at: now,
					updated_at: now
				};
				user_credits.push(row);
				return { insertId: row.id, lastInsertRowid: row.id, changes: 1 };
			}
		},
		updateUserCreditsBalance: {
			run: async (userId, amount) => {
				const id = Number(userId);
				const delta = Number(amount) || 0;
				let row = user_credits.find((entry) => entry.user_id === id);
				const now = new Date().toISOString();
				if (!row) {
					row = {
						id: nextUserCreditsId++,
						user_id: id,
						balance: 0,
						last_daily_claim_at: null,
						created_at: now,
						updated_at: now
					};
					user_credits.push(row);
				}
				const next = Math.max(0, Number(row.balance || 0) + delta);
				row.balance = next;
				row.updated_at = now;
				return { changes: 1 };
			}
		},
		claimDailyCredits: {
			run: async (userId, amount = 10) => {
				const id = Number(userId);
				const delta = Number(amount) || 0;
				const now = new Date();
				const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
				const todayUTCStr = todayUTC.toISOString().slice(0, 10);
				let row = user_credits.find((entry) => entry.user_id === id);
				const nowIso = new Date().toISOString();
				if (!row) {
					row = {
						id: nextUserCreditsId++,
						user_id: id,
						balance: delta,
						last_daily_claim_at: nowIso,
						created_at: nowIso,
						updated_at: nowIso
					};
					user_credits.push(row);
					return { success: true, balance: row.balance, changes: 1 };
				}
				if (row.last_daily_claim_at) {
					const lastClaimDate = new Date(row.last_daily_claim_at);
					const lastClaimUTC = new Date(Date.UTC(lastClaimDate.getUTCFullYear(), lastClaimDate.getUTCMonth(), lastClaimDate.getUTCDate()));
					const lastClaimUTCStr = lastClaimUTC.toISOString().slice(0, 10);
					if (lastClaimUTCStr >= todayUTCStr) {
						return { success: false, balance: row.balance, changes: 0, message: "Daily credits already claimed today" };
					}
				}
				row.balance = Number(row.balance || 0) + delta;
				row.last_daily_claim_at = nowIso;
				row.updated_at = nowIso;
				return { success: true, balance: row.balance, changes: 1 };
			}
		},
		transferCredits: {
			run: async (fromUserId, toUserId, amount) => {
				const fromId = Number(fromUserId);
				const toId = Number(toUserId);
				const delta = Number(amount);
				if (!Number.isFinite(delta) || delta <= 0) {
					const error = new Error("Invalid amount");
					error.code = "INVALID_AMOUNT";
					throw error;
				}
				const nowIso = new Date().toISOString();
				let fromRow = user_credits.find((entry) => entry.user_id === fromId);
				if (!fromRow) {
					fromRow = {
						id: nextUserCreditsId++,
						user_id: fromId,
						balance: 0,
						last_daily_claim_at: null,
						created_at: nowIso,
						updated_at: nowIso
					};
					user_credits.push(fromRow);
				}
				let toRow = user_credits.find((entry) => entry.user_id === toId);
				if (!toRow) {
					toRow = {
						id: nextUserCreditsId++,
						user_id: toId,
						balance: 0,
						last_daily_claim_at: null,
						created_at: nowIso,
						updated_at: nowIso
					};
					user_credits.push(toRow);
				}
				if (Number(fromRow.balance || 0) < delta) {
					const error = new Error("Insufficient credits");
					error.code = "INSUFFICIENT_CREDITS";
					throw error;
				}
				fromRow.balance = Number(fromRow.balance || 0) - delta;
				fromRow.updated_at = nowIso;
				toRow.balance = Number(toRow.balance || 0) + delta;
				toRow.updated_at = nowIso;
				return { fromBalance: fromRow.balance, toBalance: toRow.balance };
			}
		},
		insertTipActivity: {
			run: async (fromUserId, toUserId, createdImageId, amount, message, source, meta) => {
				const id =
					tip_activity.length > 0
						? Math.max(...tip_activity.map((t) => t.id || 0)) + 1
						: 1;
				const now = new Date().toISOString();
				const row = {
					id,
					from_user_id: Number(fromUserId),
					to_user_id: Number(toUserId),
					created_image_id: createdImageId != null ? Number(createdImageId) : null,
					amount: Number(amount) || 0,
					message: message != null ? String(message) : null,
					source: source != null ? String(source) : null,
					meta: meta ?? null,
					created_at: now,
					updated_at: now
				};
				tip_activity.push(row);
				return { insertId: id, lastInsertRowid: id, changes: 1 };
			}
		},
		selectCreatedImageTips: {
			all: async (createdImageId, options = {}) => {
				const order = String(options?.order || "asc").toLowerCase() === "desc" ? "desc" : "asc";
				const limitRaw = Number.parseInt(String(options?.limit ?? "50"), 10);
				const offsetRaw = Number.parseInt(String(options?.offset ?? "0"), 10);
				const limit = Number.isFinite(limitRaw) ? Math.min(200, Math.max(1, limitRaw)) : 50;
				const offset = Number.isFinite(offsetRaw) ? Math.max(0, offsetRaw) : 0;

				const cid = Number(createdImageId);
				const filtered = tip_activity.filter(
					(t) => Number(t.created_image_id) === cid
				);
				const sorted = filtered.slice().sort((a, b) => {
					const cmp = String(a.created_at || "").localeCompare(String(b.created_at || ""));
					return order === "desc" ? -cmp : cmp;
				});

				const slice = sorted.slice(offset, offset + limit);
				return slice.map((t) => {
					const fromUser = users.find((u) => u.id === Number(t.from_user_id));
					const profile = user_profiles.find((p) => p.user_id === Number(t.from_user_id));
					const plan = fromUser?.meta?.plan === "founder" ? "founder" : "free";
					return {
						id: t.id,
						user_id: t.from_user_id,
						created_image_id: t.created_image_id,
						amount: t.amount,
						message: t.message,
						source: t.source,
						meta: t.meta,
						created_at: t.created_at,
						updated_at: t.updated_at,
						user_name: profile?.user_name ?? null,
						display_name: profile?.display_name ?? (fromUser?.email ?? null),
						avatar_url: profile?.avatar_url ?? null,
						plan
					};
				});
			}
		},
		deleteUserAndCleanup: {
			run: async (rawUserId) => {
				const userId = Number(rawUserId);
				if (!Number.isFinite(userId) || userId <= 0) {
					const err = new Error("Invalid user id");
					err.code = "INVALID_USER_ID";
					throw err;
				}

				const changes = {};
				const before = (arr) => arr.length;

				const userImageIds = new Set(
					created_images
						.filter((img) => Number(img?.user_id) === userId)
						.map((img) => Number(img?.id))
						.filter((id) => Number.isFinite(id) && id > 0)
				);

				// Content referencing user's created images
				{
					const b = before(feed_items);
					for (let i = feed_items.length - 1; i >= 0; i -= 1) {
						if (userImageIds.has(Number(feed_items[i]?.created_image_id))) {
							feed_items.splice(i, 1);
						}
					}
					changes.feed_items_for_user_images = b - feed_items.length;
				}

				{
					const b = before(likes_created_image);
					for (let i = likes_created_image.length - 1; i >= 0; i -= 1) {
						if (userImageIds.has(Number(likes_created_image[i]?.created_image_id))) {
							likes_created_image.splice(i, 1);
						}
					}
					changes.likes_on_user_images = b - likes_created_image.length;
				}

				{
					const b = before(comments_created_image);
					for (let i = comments_created_image.length - 1; i >= 0; i -= 1) {
						if (userImageIds.has(Number(comments_created_image[i]?.created_image_id))) {
							comments_created_image.splice(i, 1);
						}
					}
					changes.comments_on_user_images = b - comments_created_image.length;
				}

				// User's own interactions on other content
				{
					const b = before(likes_created_image);
					for (let i = likes_created_image.length - 1; i >= 0; i -= 1) {
						if (Number(likes_created_image[i]?.user_id) === userId) {
							likes_created_image.splice(i, 1);
						}
					}
					changes.likes_by_user = b - likes_created_image.length;
				}

				{
					const b = before(comments_created_image);
					for (let i = comments_created_image.length - 1; i >= 0; i -= 1) {
						if (Number(comments_created_image[i]?.user_id) === userId) {
							comments_created_image.splice(i, 1);
						}
					}
					changes.comments_by_user = b - comments_created_image.length;
				}

				// User-owned content
				{
					const b = before(created_images);
					for (let i = created_images.length - 1; i >= 0; i -= 1) {
						if (Number(created_images[i]?.user_id) === userId) {
							created_images.splice(i, 1);
						}
					}
					changes.created_images = b - created_images.length;
				}

				{
					const b = before(creations);
					for (let i = creations.length - 1; i >= 0; i -= 1) {
						if (Number(creations[i]?.user_id) === userId) {
							creations.splice(i, 1);
						}
					}
					changes.creations = b - creations.length;
				}

				// Server ownership and membership
				{
					const b = before(server_members);
					for (let i = server_members.length - 1; i >= 0; i -= 1) {
						if (Number(server_members[i]?.user_id) === userId) {
							server_members.splice(i, 1);
						}
					}
					changes.server_memberships = b - server_members.length;
				}

				{
					const b = before(servers);
					for (let i = servers.length - 1; i >= 0; i -= 1) {
						if (Number(servers[i]?.user_id) === userId) {
							servers.splice(i, 1);
						}
					}
					changes.servers_owned = b - servers.length;
				}

				// Notifications and sessions/credits
				{
					const b = before(notifications);
					for (let i = notifications.length - 1; i >= 0; i -= 1) {
						if (Number(notifications[i]?.user_id) === userId) {
							notifications.splice(i, 1);
						}
					}
					changes.notifications = b - notifications.length;
				}

				{
					const b = before(sessions);
					for (let i = sessions.length - 1; i >= 0; i -= 1) {
						if (Number(sessions[i]?.user_id) === userId) {
							sessions.splice(i, 1);
						}
					}
					changes.sessions = b - sessions.length;
				}

				{
					const b = before(user_credits);
					for (let i = user_credits.length - 1; i >= 0; i -= 1) {
						if (Number(user_credits[i]?.user_id) === userId) {
							user_credits.splice(i, 1);
						}
					}
					changes.user_credits = b - user_credits.length;
				}

				// Tip activity on user's created images
				{
					const b = before(tip_activity);
					for (let i = tip_activity.length - 1; i >= 0; i -= 1) {
						if (userImageIds.has(Number(tip_activity[i]?.created_image_id))) {
							tip_activity.splice(i, 1);
						}
					}
					changes.tips_on_user_images = b - tip_activity.length;
				}
				// Tip activity sent or received by this user
				{
					const b = before(tip_activity);
					for (let i = tip_activity.length - 1; i >= 0; i -= 1) {
						if (
							Number(tip_activity[i]?.from_user_id) === userId ||
							Number(tip_activity[i]?.to_user_id) === userId
						) {
							tip_activity.splice(i, 1);
						}
					}
					changes.tips_by_user = b - tip_activity.length;
				}

				// Email: link clicks for this user's sends, then sends, then campaign state
				const userEmailSendIds = new Set(
					email_sends
						.filter((s) => Number(s?.user_id) === userId)
						.map((s) => Number(s?.id))
						.filter((id) => Number.isFinite(id) && id > 0)
				);
				{
					const b = before(email_link_clicks);
					for (let i = email_link_clicks.length - 1; i >= 0; i -= 1) {
						if (userEmailSendIds.has(Number(email_link_clicks[i]?.email_send_id))) {
							email_link_clicks.splice(i, 1);
						}
					}
					changes.email_link_clicks = b - email_link_clicks.length;
				}
				{
					const b = before(email_sends);
					for (let i = email_sends.length - 1; i >= 0; i -= 1) {
						if (Number(email_sends[i]?.user_id) === userId) {
							email_sends.splice(i, 1);
						}
					}
					changes.email_sends = b - email_sends.length;
				}
				{
					const b = before(email_user_campaign_state);
					for (let i = email_user_campaign_state.length - 1; i >= 0; i -= 1) {
						if (Number(email_user_campaign_state[i]?.user_id) === userId) {
							email_user_campaign_state.splice(i, 1);
						}
					}
					changes.email_user_campaign_state = b - email_user_campaign_state.length;
				}

				// Social graph + profile
				{
					const b = before(user_follows);
					for (let i = user_follows.length - 1; i >= 0; i -= 1) {
						if (
							Number(user_follows[i]?.follower_id) === userId ||
							Number(user_follows[i]?.following_id) === userId
						) {
							user_follows.splice(i, 1);
						}
					}
					changes.user_follows = b - user_follows.length;
				}

				{
					const b = before(user_profiles);
					for (let i = user_profiles.length - 1; i >= 0; i -= 1) {
						if (Number(user_profiles[i]?.user_id) === userId) {
							user_profiles.splice(i, 1);
						}
					}
					changes.user_profile = b - user_profiles.length;
				}

				// Finally delete user row
				{
					const b = before(users);
					for (let i = users.length - 1; i >= 0; i -= 1) {
						if (Number(users[i]?.id) === userId) {
							users.splice(i, 1);
						}
					}
					changes.user = b - users.length;
				}

				return { changes };
			}
		}
	};

	const db = {
		prepare: () => makeStatement({}),
		exec: () => { }
	};

	async function seed(tableName, items, options = {}) {
		if (!items || items.length === 0) return;

		const { skipIfExists = false, transform, checkExists } = options;

		// Get the appropriate array for this table
		let targetArray;
		switch (tableName) {
			case "users":
				targetArray = users;
				break;
			case "user_profiles":
				targetArray = user_profiles;
				break;
			case "moderation_queue":
				targetArray = moderation_queue;
				break;
			case "servers":
				targetArray = servers;
				break;
			case "policy_knobs":
				targetArray = policy_knobs;
				break;
			case "notifications":
				targetArray = notifications;
				break;
			case "email_sends":
				targetArray = email_sends;
				break;
			case "email_user_campaign_state":
				targetArray = email_user_campaign_state;
				break;
			case "email_link_clicks":
				targetArray = email_link_clicks;
				break;
			case "tip_activity":
				targetArray = tip_activity;
				break;
			case "feed_items":
				targetArray = feed_items;
				break;
			case "explore_items":
				targetArray = explore_items;
				break;
			case "creations":
				targetArray = creations;
				break;
			case "templates":
				targetArray = templates;
				break;
			case "created_images":
				targetArray = created_images;
				break;
			case "user_follows":
				targetArray = user_follows;
				break;
			default:
				// console.warn(`Unknown table: ${tableName}`);
				return;
		}

		// Check if we should skip seeding
		if (skipIfExists) {
			if (checkExists) {
				const existing = await checkExists();
				if (existing && existing.length > 0) return;
			} else {
				if (targetArray.length > 0) return;
			}
		}

		const seededAt = new Date().toISOString();
		const timestampFields = TABLE_TIMESTAMP_FIELDS[tableName] || [];

		// Insert items
		for (const item of items) {
			const transformedItem = transform ? transform(item) : item;
			// Generate ID if needed
			const newItem = { ...transformedItem };
			if (!newItem.id) {
				// Simple ID generation based on array length
				newItem.id = targetArray.length > 0
					? Math.max(...targetArray.map(i => i.id || 0)) + 1
					: 1;
			}

			for (const field of timestampFields) {
				if (!newItem[field]) {
					newItem[field] = seededAt;
				}
			}

			targetArray.push(newItem);
		}

		if (tableName === "users") {
			nextUserId = users.length > 0
				? Math.max(...users.map((user) => user.id || 0)) + 1
				: 1;
		}
	}

	async function reset() {
		// Clear all in-memory data arrays
		users.length = 0;
		user_profiles.length = 0;
		moderation_queue.length = 0;
		provider_registry.length = 0;
		provider_statuses.length = 0;
		provider_metrics.length = 0;
		provider_grants.length = 0;
		provider_templates.length = 0;
		policy_knobs.length = 0;
		notifications.length = 0;
		email_sends.length = 0;
		email_user_campaign_state.length = 0;
		email_link_clicks.length = 0;
		feed_items.length = 0;
		explore_items.length = 0;
		creations.length = 0;
		templates.length = 0;
		created_images.length = 0;
		sessions.length = 0;
		// Reset ID counters
		nextUserId = 1;
		nextNotificationId = 1;
	}

	// Storage interface for images (using filesystem like SQLite)
	const storage = {
		uploadImage: async (buffer, filename) => {
			try {
				ensureImagesDir();
				const filePath = path.join(imagesDir, filename);
				fs.writeFileSync(filePath, buffer);
				return `/images/created/${filename}`;
			} catch (error) {
				// On Vercel or other read-only filesystems, we can't write files
				// Return a URL anyway - the image data is stored in the database record
				// The image won't be accessible via filesystem, but the database entry will exist
				// console.warn(`Warning: Could not write image file ${filename}: ${error.message}`);
				// console.warn("Image metadata will be stored, but file will not be persisted.");
				// console.warn("For production on Vercel, use Supabase adapter with SUPABASE_URL and SUPABASE_ANON_KEY.");
				// Return a URL that indicates the file isn't available
				return `/images/created/${filename}`;
			}
		},

		getImageUrl: (filename) => {
			return `/images/created/${filename}`;
		},

		getImageBuffer: async (filename) => {
			try {
				const filePath = path.join(imagesDir, filename);
				if (!fs.existsSync(filePath)) {
					throw new Error(`Image not found: ${filename}`);
				}
				return fs.readFileSync(filePath);
			} catch (error) {
				// If file doesn't exist (e.g., on Vercel where files can't be written),
				// throw a clear error
				throw new Error(`Image file not available: ${filename}. This may occur on serverless platforms. Consider using Supabase adapter.`);
			}
		},

		uploadImageAnon: async (buffer, filename) => {
			try {
				ensureImagesDirAnon();
				const filePath = path.join(imagesDirAnon, filename);
				fs.writeFileSync(filePath, buffer);
				return `/api/try/images/${filename}`;
			} catch (_) {
				return `/api/try/images/${filename}`;
			}
		},

		getImageUrlAnon: (filename) => `/api/try/images/${filename}`,

		getImageBufferAnon: async (filename) => {
			const filePath = path.join(imagesDirAnon, filename);
			if (!fs.existsSync(filePath)) {
				throw new Error(`Image not found: ${filename}`);
			}
			return fs.readFileSync(filePath);
		},

		deleteImageAnon: async (filename) => {
			if (!filename || filename.includes("..") || filename.includes("/")) return;
			try {
				const filePath = path.join(imagesDirAnon, filename);
				if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
			} catch (_) {}
		},

		getGenericImageBuffer: async (key) => {
			try {
				ensureGenericImagesDir();
				const safeKey = String(key || "");
				const filePath = path.join(genericImagesDir, safeKey.replace(/^\/+/, ""));
				if (!fs.existsSync(filePath)) {
					throw new Error(`Image not found: ${safeKey}`);
				}
				return fs.readFileSync(filePath);
			} catch (error) {
				throw new Error(`Image not found: ${String(key || "")}`);
			}
		},

		uploadGenericImage: async (buffer, key) => {
			try {
				ensureGenericImagesDir();
				const safeKey = String(key || "").replace(/^\/+/, "");
				const filePath = path.join(genericImagesDir, safeKey);
				const dir = path.dirname(filePath);
				try {
					fs.mkdirSync(dir, { recursive: true });
				} catch {
					// ignore
				}
				fs.writeFileSync(filePath, buffer);
				return safeKey;
			} catch (error) {
				throw new Error("Failed to upload image");
			}
		},

		deleteGenericImage: async (key) => {
			try {
				ensureGenericImagesDir();
				const safeKey = String(key || "").replace(/^\/+/, "");
				const filePath = path.join(genericImagesDir, safeKey);
				if (fs.existsSync(filePath)) {
					fs.unlinkSync(filePath);
				}
			} catch {
				// ignore
			}
		},

		deleteImage: async (filename) => {
			const filePath = path.join(imagesDir, filename);
			if (fs.existsSync(filePath)) {
				fs.unlinkSync(filePath);
			}
		},

		clearAll: async () => {
			if (fs.existsSync(imagesDir)) {
				const files = fs.readdirSync(imagesDir);
				for (const file of files) {
					const filePath = path.join(imagesDir, file);
					const stat = fs.statSync(filePath);
					if (stat.isFile()) {
						fs.unlinkSync(filePath);
					}
				}
			}
		}
	};

	return { db, queries, seed, reset, storage };
}
