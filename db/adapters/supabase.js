import { createClient } from "@supabase/supabase-js";
import path from "path";
import sharp from "sharp";
import { RELATED_PARAM_DEFAULTS, RELATED_PARAM_KEYS } from "./relatedParams.js";
import { getThumbnailUrl } from "../../api_routes/utils/url.js";

// Note: Supabase schema must be provisioned separately (SQL editor/migrations).
// This adapter expects all tables to be prefixed with "prsn_".

function requireEnv(name) {
	const value = process.env[name];
	if (!value) {
		throw new Error(`Missing required env var ${name}`);
	}
	return value;
}

function applyUserOrRoleFilter(query, userId, role) {
	const hasUserId = userId !== null && userId !== undefined;
	const hasRole = role !== null && role !== undefined;
	if (hasUserId && hasRole) {
		return { query: query.or(`user_id.eq.${userId},role.eq.${role}`), hasFilter: true };
	}
	if (hasUserId) {
		return { query: query.eq("user_id", userId), hasFilter: true };
	}
	if (hasRole) {
		return { query: query.eq("role", role), hasFilter: true };
	}
	return { query, hasFilter: false };
}

function prefixedTable(name) {
	return `prsn_${name}`;
}

export function openDb() {
	const supabaseUrl = requireEnv("SUPABASE_URL");
	const supabaseKey = requireEnv("SUPABASE_ANON_KEY");
	const supabase = createClient(supabaseUrl, supabaseKey);

	// Use service role key for storage operations and backend operations (bypasses RLS)
	// This is needed for admin operations and operations that need to access all columns
	const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
	const serviceClient = serviceRoleKey
		? createClient(supabaseUrl, serviceRoleKey)
		: supabase;
	const storageClient = serviceClient;

	const queries = {
		selectUserByEmail: {
			get: async (email) => {
				// Use serviceClient to bypass RLS for authentication
				const { data, error } = await serviceClient
					.from(prefixedTable("users"))
					.select("id, email, password_hash, role, meta")
					.eq("email", email)
					.maybeSingle();
				if (error) throw error;
				if (!data) return undefined;
				const meta = typeof data.meta === "object" && data.meta !== null ? data.meta : {};
				return { ...data, meta, suspended: meta.suspended === true };
			}
		},
		selectUserById: {
			get: async (id) => {
				// Use serviceClient to bypass RLS for authentication
				const { data, error } = await serviceClient
					.from(prefixedTable("users"))
					.select("id, email, role, created_at, meta")
					.eq("id", id)
					.maybeSingle();
				if (error) throw error;
				if (!data) return undefined;
				const meta = typeof data.meta === "object" && data.meta !== null ? data.meta : {};
				return { ...data, meta, suspended: meta.suspended === true };
			}
		},
		selectUserByIdForLogin: {
			get: async (id) => {
				const { data, error } = await serviceClient
					.from(prefixedTable("users"))
					.select("id, password_hash, meta")
					.eq("id", id)
					.maybeSingle();
				if (error) throw error;
				if (!data) return undefined;
				const meta = typeof data.meta === "object" && data.meta !== null ? data.meta : {};
				return { ...data, meta, suspended: meta.suspended === true };
			}
		},
		selectUserByStripeSubscriptionId: {
			get: async (subscriptionId) => {
				if (subscriptionId == null || String(subscriptionId).trim() === "") return undefined;
				const { data, error } = await serviceClient
					.from(prefixedTable("users"))
					.select("id, email, role, created_at, meta")
					.contains("meta", { stripeSubscriptionId: subscriptionId })
					.maybeSingle();
				if (error) throw error;
				if (!data) return undefined;
				const meta = typeof data.meta === "object" && data.meta !== null ? data.meta : {};
				return { ...data, meta, suspended: meta.suspended === true };
			}
		},
		selectUserProfileByUserId: {
			get: async (userId) => {
				const { data, error } = await serviceClient
					.from(prefixedTable("user_profiles"))
					.select("user_id, user_name, display_name, about, socials, avatar_url, cover_image_url, badges, meta, created_at, updated_at")
					.eq("user_id", userId)
					.maybeSingle();
				if (error) throw error;
				return data ?? undefined;
			}
		},
		selectUserProfileByUsername: {
			get: async (userName) => {
				const { data, error } = await serviceClient
					.from(prefixedTable("user_profiles"))
					.select("user_id, user_name, meta")
					.eq("user_name", userName)
					.maybeSingle();
				if (error) throw error;
				return data ?? undefined;
			}
		},
		upsertUserProfile: {
			run: async (userId, profile) => {
				const payload = {
					user_id: userId,
					user_name: profile?.user_name ?? null,
					display_name: profile?.display_name ?? null,
					about: profile?.about ?? null,
					socials: profile?.socials ?? null,
					avatar_url: profile?.avatar_url ?? null,
					cover_image_url: profile?.cover_image_url ?? null,
					badges: profile?.badges ?? null,
					meta: profile?.meta ?? null,
					updated_at: new Date().toISOString()
				};
				const { data, error } = await serviceClient
					.from(prefixedTable("user_profiles"))
					.upsert(payload, { onConflict: "user_id" })
					.select("user_id");
				if (error) throw error;
				return { changes: data?.length ?? 0 };
			}
		},
		insertUserFollow: {
			run: async (followerId, followingId) => {
				const { data, error } = await serviceClient
					.from(prefixedTable("user_follows"))
					.upsert(
						{ follower_id: followerId, following_id: followingId },
						{ onConflict: "follower_id,following_id", ignoreDuplicates: true }
					)
					.select("id");
				if (error) throw error;
				return { changes: data?.length ?? 0 };
			}
		},
		deleteUserFollow: {
			run: async (followerId, followingId) => {
				const { data, error } = await serviceClient
					.from(prefixedTable("user_follows"))
					.delete()
					.eq("follower_id", followerId)
					.eq("following_id", followingId)
					.select("id");
				if (error) throw error;
				return { changes: data?.length ?? 0 };
			}
		},
		selectUserFollowStatus: {
			get: async (followerId, followingId) => {
				const { data, error } = await serviceClient
					.from(prefixedTable("user_follows"))
					.select("id")
					.eq("follower_id", followerId)
					.eq("following_id", followingId)
					.maybeSingle();
				if (error) throw error;
				return data ? { viewer_follows: 1 } : undefined;
			}
		},
		selectUserFollowers: {
			all: async (userId, options = {}) => {
				const limit = Math.min(200, Math.max(1, Number.parseInt(String(options?.limit ?? "50"), 10) || 50));
				const offset = Math.max(0, Number.parseInt(String(options?.offset ?? "0"), 10) || 0);
				const { data: followRows, error } = await serviceClient
					.from(prefixedTable("user_follows"))
					.select("follower_id, created_at")
					.eq("following_id", userId)
					.order("created_at", { ascending: false })
					.range(offset, offset + limit - 1);
				if (error) throw error;

				const followerIds = Array.from(new Set(
					(followRows ?? [])
						.map((row) => row?.follower_id)
						.filter((id) => id !== null && id !== undefined)
						.map((id) => Number(id))
						.filter((id) => Number.isFinite(id) && id > 0)
				));

				let profileByUserId = new Map();
				if (followerIds.length > 0) {
					const { data: profileRows, error: profileError } = await serviceClient
						.from(prefixedTable("user_profiles"))
						.select("user_id, user_name, display_name, avatar_url")
						.in("user_id", followerIds);
					if (profileError) throw profileError;
					profileByUserId = new Map(
						(profileRows ?? []).map((row) => [String(row.user_id), row])
					);
				}

				return (followRows ?? []).map((row) => {
					const id = row?.follower_id ?? null;
					const profile = id != null ? profileByUserId.get(String(id)) ?? null : null;
					return {
						user_id: id,
						followed_at: row?.created_at ?? null,
						user_name: profile?.user_name ?? null,
						display_name: profile?.display_name ?? null,
						avatar_url: profile?.avatar_url ?? null
					};
				});
			}
		},
		/** Like selectUserFollowers but adds viewer_follows (true if viewer follows this follower). */
		selectUserFollowersWithViewer: {
			all: async (targetUserId, viewerId, options = {}) => {
				const limit = Math.min(200, Math.max(1, Number.parseInt(String(options?.limit ?? "50"), 10) || 50));
				const offset = Math.max(0, Number.parseInt(String(options?.offset ?? "0"), 10) || 0);
				const { data: followRows, error } = await serviceClient
					.from(prefixedTable("user_follows"))
					.select("follower_id, created_at")
					.eq("following_id", targetUserId)
					.order("created_at", { ascending: false })
					.range(offset, offset + limit - 1);
				if (error) throw error;

				const followerIds = Array.from(new Set(
					(followRows ?? [])
						.map((row) => row?.follower_id)
						.filter((id) => id != null && id !== undefined)
						.map((id) => Number(id))
						.filter((id) => Number.isFinite(id) && id > 0)
				));

				let profileByUserId = new Map();
				let viewerFollowsSet = new Set();
				if (followerIds.length > 0) {
					const [profileRes, viewerFollowsRes] = await Promise.all([
						serviceClient.from(prefixedTable("user_profiles")).select("user_id, user_name, display_name, avatar_url").in("user_id", followerIds),
						serviceClient.from(prefixedTable("user_follows")).select("following_id").eq("follower_id", viewerId).in("following_id", followerIds)
					]);
					if (profileRes.error) throw profileRes.error;
					profileByUserId = new Map((profileRes.data ?? []).map((row) => [String(row.user_id), row]));
					viewerFollowsSet = new Set((viewerFollowsRes.data ?? []).map((r) => r?.following_id).filter(Boolean).map(String));
				}

				return (followRows ?? []).map((row) => {
					const id = row?.follower_id ?? null;
					const profile = id != null ? profileByUserId.get(String(id)) ?? null : null;
					return {
						user_id: id,
						followed_at: row?.created_at ?? null,
						user_name: profile?.user_name ?? null,
						display_name: profile?.display_name ?? null,
						avatar_url: profile?.avatar_url ?? null,
						viewer_follows: id != null ? viewerFollowsSet.has(String(id)) : false
					};
				});
			}
		},
		selectUserFollowing: {
			all: async (userId, options = {}) => {
				const limit = Math.min(200, Math.max(1, Number.parseInt(String(options?.limit ?? "50"), 10) || 50));
				const offset = Math.max(0, Number.parseInt(String(options?.offset ?? "0"), 10) || 0);
				const { data: followRows, error } = await serviceClient
					.from(prefixedTable("user_follows"))
					.select("following_id, created_at")
					.eq("follower_id", userId)
					.order("created_at", { ascending: false })
					.range(offset, offset + limit - 1);
				if (error) throw error;

				const followingIds = Array.from(new Set(
					(followRows ?? [])
						.map((row) => row?.following_id)
						.filter((id) => id !== null && id !== undefined)
						.map((id) => Number(id))
						.filter((id) => Number.isFinite(id) && id > 0)
				));

				let profileByUserId = new Map();
				if (followingIds.length > 0) {
					const { data: profileRows, error: profileError } = await serviceClient
						.from(prefixedTable("user_profiles"))
						.select("user_id, user_name, display_name, avatar_url")
						.in("user_id", followingIds);
					if (profileError) throw profileError;
					profileByUserId = new Map(
						(profileRows ?? []).map((row) => [String(row.user_id), row])
					);
				}

				return (followRows ?? []).map((row) => {
					const id = row?.following_id ?? null;
					const profile = id != null ? profileByUserId.get(String(id)) ?? null : null;
					return {
						user_id: id,
						followed_at: row?.created_at ?? null,
						user_name: profile?.user_name ?? null,
						display_name: profile?.display_name ?? null,
						avatar_url: profile?.avatar_url ?? null
					};
				});
			}
		},
		selectSessionByTokenHash: {
			get: async (tokenHash, userId) => {
				// Use serviceClient to bypass RLS for authentication
				const { data, error } = await serviceClient
					.from(prefixedTable("sessions"))
					.select("id, user_id, token_hash, expires_at")
					.eq("token_hash", tokenHash)
					.eq("user_id", userId)
					.maybeSingle();
				if (error) throw error;
				return data ?? undefined;
			}
		},
		insertUser: {
			run: async (email, password_hash, role) => {
				// Use serviceClient to bypass RLS for authentication
				const { data, error } = await serviceClient
					.from(prefixedTable("users"))
					.insert({ email, password_hash, role })
					.select("id")
					.single();
				if (error) throw error;
				return {
					insertId: data.id,
					lastInsertRowid: data.id,
					changes: 1
				};
			}
		},
		insertSession: {
			run: async (userId, tokenHash, expiresAt) => {
				// Use serviceClient to bypass RLS for authentication
				const { data, error } = await serviceClient
					.from(prefixedTable("sessions"))
					.insert({ user_id: userId, token_hash: tokenHash, expires_at: expiresAt })
					.select("id")
					.single();
				if (error) throw error;
				return {
					insertId: data.id,
					lastInsertRowid: data.id,
					changes: 1
				};
			}
		},
		refreshSessionExpiry: {
			run: async (id, expiresAt) => {
				// Use serviceClient to bypass RLS for authentication
				const { data, error } = await serviceClient
					.from(prefixedTable("sessions"))
					.update({ expires_at: expiresAt })
					.eq("id", id)
					.select("id");
				if (error) throw error;
				return { changes: data?.length ?? 0 };
			}
		},
		deleteSessionByTokenHash: {
			run: async (tokenHash, userId) => {
				// Use serviceClient to bypass RLS for authentication
				let query = serviceClient.from(prefixedTable("sessions")).delete();
				query = query.eq("token_hash", tokenHash);
				if (userId) {
					query = query.eq("user_id", userId);
				}
				const { data, error } = await query.select("id");
				if (error) throw error;
				return { changes: data?.length ?? 0 };
			}
		},
		deleteExpiredSessions: {
			run: async (nowIso) => {
				// Use serviceClient to bypass RLS for authentication
				const { data, error } = await serviceClient
					.from(prefixedTable("sessions"))
					.delete()
					.lte("expires_at", nowIso)
					.select("id");
				if (error) throw error;
				return { changes: data?.length ?? 0 };
			}
		},
		selectUsers: {
			all: async () => {
				// Use serviceClient to bypass RLS for admin operations
				const { data, error } = await serviceClient
					.from(prefixedTable("users"))
					.select(`
            id,
            email,
            role,
            created_at,
            last_active_at,
            meta,
            ${prefixedTable("user_profiles")} (
              user_name,
              display_name,
              avatar_url
            )
          `)
					.order("id", { ascending: true });
				if (error) throw error;
				return (data ?? []).map((row) => {
					const profile = row?.[prefixedTable("user_profiles")] || null;
					const meta = typeof row.meta === "object" && row.meta !== null ? row.meta : {};
					return {
						id: row.id,
						email: row.email,
						role: row.role,
						created_at: row.created_at,
						last_active_at: row.last_active_at ?? null,
						meta,
						suspended: meta.suspended === true,
						user_name: profile?.user_name ?? null,
						display_name: profile?.display_name ?? null,
						avatar_url: profile?.avatar_url ?? null
					};
				});
			}
		},
		updateUserSuspended: {
			run: async (userId, suspended) => {
				const { data: current, error: selectError } = await serviceClient
					.from(prefixedTable("users"))
					.select("meta")
					.eq("id", userId)
					.maybeSingle();
				if (selectError) throw selectError;
				const existing = current?.meta ?? null;
				const meta = typeof existing === "object" && existing !== null ? { ...existing } : {};
				meta.suspended = Boolean(suspended);
				const { error } = await serviceClient
					.from(prefixedTable("users"))
					.update({ meta })
					.eq("id", userId);
				if (error) throw error;
				return { changes: 1 };
			}
		},
		updateUserPlan: {
			run: async (userId, plan) => {
				const { data: current, error: selectError } = await serviceClient
					.from(prefixedTable("users"))
					.select("meta")
					.eq("id", userId)
					.maybeSingle();
				if (selectError) throw selectError;
				const existing = current?.meta ?? null;
				const meta = typeof existing === "object" && existing !== null ? { ...existing } : {};
				meta.plan = plan === "founder" ? "founder" : "free";
				if (plan === "founder") {
					delete meta.pendingCheckoutSessionId;
					delete meta.pendingCheckoutReturnedAt;
				}
				const { error } = await serviceClient
					.from(prefixedTable("users"))
					.update({ meta })
					.eq("id", userId);
				if (error) throw error;
				return { changes: 1 };
			}
		},
		recordCheckoutReturn: {
			run: async (userId, sessionId, returnedAt) => {
				const { data: current, error: selectError } = await serviceClient
					.from(prefixedTable("users"))
					.select("meta")
					.eq("id", userId)
					.maybeSingle();
				if (selectError) throw selectError;
				const existing = current?.meta ?? null;
				const meta = typeof existing === "object" && existing !== null ? { ...existing } : {};
				meta.pendingCheckoutSessionId = sessionId;
				meta.pendingCheckoutReturnedAt = returnedAt;
				const { error } = await serviceClient
					.from(prefixedTable("users"))
					.update({ meta })
					.eq("id", userId);
				if (error) throw error;
				return { changes: 1 };
			}
		},
		updateUserStripeSubscriptionId: {
			run: async (userId, subscriptionId) => {
				const { data: current, error: selectError } = await serviceClient
					.from(prefixedTable("users"))
					.select("meta")
					.eq("id", userId)
					.maybeSingle();
				if (selectError) throw selectError;
				const existing = current?.meta ?? null;
				const meta = typeof existing === "object" && existing !== null ? { ...existing } : {};
				if (subscriptionId != null) {
					meta.stripeSubscriptionId = subscriptionId;
					delete meta.pendingCheckoutSessionId;
					delete meta.pendingCheckoutReturnedAt;
				} else {
					delete meta.stripeSubscriptionId;
					delete meta.pendingCheckoutSessionId;
					delete meta.pendingCheckoutReturnedAt;
				}
				const { error } = await serviceClient
					.from(prefixedTable("users"))
					.update({ meta })
					.eq("id", userId);
				if (error) throw error;
				return { changes: 1 };
			}
		},
		updateUserLastActive: {
			run: async (userId) => {
				const { error } = await serviceClient
					.from(prefixedTable("users"))
					.update({ last_active_at: new Date().toISOString() })
					.eq("id", userId)
					.or("last_active_at.is.null,last_active_at.lt." + new Date(Date.now() - 15 * 60 * 1000).toISOString());
				if (error) throw error;
				return { changes: 1 };
			}
		},
		setPasswordResetToken: {
			run: async (userId, tokenHash, expiresAt) => {
				const { data: current, error: selectError } = await serviceClient
					.from(prefixedTable("users"))
					.select("meta")
					.eq("id", userId)
					.maybeSingle();
				if (selectError) throw selectError;
				const existing = current?.meta ?? null;
				const meta = typeof existing === "object" && existing !== null ? { ...existing } : {};
				meta.reset_token_hash = tokenHash;
				meta.reset_token_expires_at = expiresAt;
				const { error } = await serviceClient
					.from(prefixedTable("users"))
					.update({ meta })
					.eq("id", userId);
				if (error) throw error;
				return { changes: 1 };
			}
		},
		selectUserByResetTokenHash: {
			get: async (tokenHash) => {
				const { data, error } = await serviceClient
					.from(prefixedTable("users"))
					.select("id, email, password_hash, role, meta")
					.contains("meta", { reset_token_hash: tokenHash })
					.maybeSingle();
				if (error) throw error;
				if (!data) return undefined;
				const meta = typeof data.meta === "object" && data.meta !== null ? data.meta : {};
				return { ...data, meta, suspended: meta.suspended === true };
			}
		},
		clearPasswordResetToken: {
			run: async (userId) => {
				const { data: current, error: selectError } = await serviceClient
					.from(prefixedTable("users"))
					.select("meta")
					.eq("id", userId)
					.maybeSingle();
				if (selectError) throw selectError;
				const existing = current?.meta ?? null;
				const meta = typeof existing === "object" && existing !== null ? { ...existing } : {};
				delete meta.reset_token_hash;
				delete meta.reset_token_expires_at;
				const { error } = await serviceClient
					.from(prefixedTable("users"))
					.update({ meta })
					.eq("id", userId);
				if (error) throw error;
				return { changes: 1 };
			}
		},
		updateUserPassword: {
			run: async (userId, passwordHash) => {
				const { data, error } = await serviceClient
					.from(prefixedTable("users"))
					.update({ password_hash: passwordHash })
					.eq("id", userId)
					.select("id");
				if (error) throw error;
				const changes = Array.isArray(data) && data.length > 0 ? data.length : 0;
				return { changes };
			}
		},
		updateUserEmail: {
			run: async (userId, newEmail) => {
				const normalized = String(newEmail).trim().toLowerCase();
				const { data, error } = await serviceClient
					.from(prefixedTable("users"))
					.update({ email: normalized })
					.eq("id", userId)
					.select("id");
				if (error) throw error;
				const changes = Array.isArray(data) && data.length > 0 ? data.length : 0;
				return { changes };
			}
		},
		selectModerationQueue: {
			all: async () => {
				// Use serviceClient to bypass RLS for backend operations
				const { data, error } = await serviceClient
					.from(prefixedTable("moderation_queue"))
					.select("id, content_type, content_id, status, reason, created_at")
					.order("created_at", { ascending: false });
				if (error) throw error;
				return data ?? [];
			}
		},
		selectProviders: {
			all: async () => {
				// Use serviceClient to bypass RLS for backend operations
				const { data, error } = await serviceClient
					.from(prefixedTable("servers"))
					.select(`
            id,
            user_id,
            name,
            status,
            server_url,
            auth_token,
            status_date,
            description,
            members_count,
            server_config,
            created_at,
            updated_at,
            prsn_users!prsn_servers_user_id_fkey(email)
          `)
					.order("name", { ascending: true });
				if (error) throw error;
				// Transform the data to flatten the user email
				return (data ?? []).map(provider => {
					const { prsn_users, ...rest } = provider;
					return {
						...rest,
						owner_email: prsn_users?.email || null
					};
				});
			}
		},
		insertProvider: {
			run: async (userId, name, status, serverUrl, serverConfig = null, authToken = null) => {
				const resolvedAuthToken = typeof authToken === "string" && authToken.trim()
					? authToken.trim()
					: null;
				const { data, error } = await serviceClient
					.from(prefixedTable("servers"))
					.insert({
						user_id: userId,
						name,
						status,
						server_url: serverUrl,
						server_config: serverConfig,
						auth_token: resolvedAuthToken
					})
					.select("id")
					.single();
				if (error) throw error;
				return {
					insertId: data.id,
					changes: 1
				};
			}
		},
		selectPolicies: {
			all: async () => {
				// Use serviceClient to bypass RLS for backend operations
				const { data, error } = await serviceClient
					.from(prefixedTable("policy_knobs"))
					.select("id, key, value, description, updated_at")
					.order("key", { ascending: true });
				if (error) throw error;
				return data ?? [];
			}
		},
		selectPolicyByKey: {
			get: async (key) => {
				const { data, error } = await serviceClient
					.from(prefixedTable("policy_knobs"))
					.select("id, key, value, description, updated_at")
					.eq("key", key)
					.limit(1)
					.maybeSingle();
				if (error) throw error;
				return data;
			}
		},
		upsertPolicyKey: {
			run: async (key, value, description) => {
				const { data: existing } = await serviceClient
					.from(prefixedTable("policy_knobs"))
					.select("id")
					.eq("key", key)
					.limit(1)
					.maybeSingle();
				const now = new Date().toISOString();
				if (existing) {
					const { error } = await serviceClient
						.from(prefixedTable("policy_knobs"))
						.update({ value, description: description ?? null, updated_at: now })
						.eq("key", key);
					if (error) throw error;
					return { changes: 1 };
				}
				const { error } = await serviceClient
					.from(prefixedTable("policy_knobs"))
					.insert({ key, value, description: description ?? null, updated_at: now });
				if (error) throw error;
				return { changes: 1 };
			}
		},
		getRelatedParams: {
			get: async () => {
				const all = await queries.selectPolicies.all();
				const byKey = Object.fromEntries(
					all.filter((r) => r.key.startsWith("related.")).map((r) => [r.key, r.value])
				);
				const out = { ...RELATED_PARAM_DEFAULTS };
				for (const key of RELATED_PARAM_KEYS) {
					if (byKey[key] !== undefined) out[key] = byKey[key];
				}
				return out;
			}
		},
		recordTransition: {
			run: async (fromId, toId) => {
				const table = prefixedTable("related_transitions");
				const now = new Date().toISOString();
				const { data: existing } = await serviceClient
					.from(table)
					.select("to_created_image_id, count, last_updated")
					.eq("from_created_image_id", fromId)
					.eq("to_created_image_id", toId)
					.maybeSingle();
				if (existing) {
					const { error } = await serviceClient
						.from(table)
						.update({ count: existing.count + 1, last_updated: now })
						.eq("from_created_image_id", fromId)
						.eq("to_created_image_id", toId);
					if (error) throw error;
				} else {
					const { error } = await serviceClient.from(table).insert({
						from_created_image_id: fromId,
						to_created_image_id: toId,
						count: 1,
						last_updated: now
					});
					if (error) throw error;
				}
				const params = await queries.getRelatedParams.get();
				const capK = Math.max(0, parseInt(params["related.transition_cap_k"], 10) || 50);
				const { data: rows } = await serviceClient
					.from(table)
					.select("to_created_image_id, last_updated")
					.eq("from_created_image_id", fromId)
					.order("last_updated", { ascending: true });
				if (rows && rows.length > capK) {
					const toEvict = rows.slice(0, rows.length - capK).map((r) => r.to_created_image_id);
					for (const toIdEvict of toEvict) {
						const { error } = await serviceClient
							.from(table)
							.delete()
							.eq("from_created_image_id", fromId)
							.eq("to_created_image_id", toIdEvict);
						if (error) throw error;
					}
				}
				return { changes: 1 };
			}
		},
		selectTransitions: {
			list: async ({ page = 1, limit = 20, sortBy = "count", sortDir = "desc" } = {}) => {
				const table = prefixedTable("related_transitions");
				const from = (page - 1) * limit;
				const validColumns = ["from_created_image_id", "to_created_image_id", "count", "last_updated"];
				const orderColumn = validColumns.includes(sortBy) ? sortBy : "count";
				const ascending = sortDir === "asc";
				const { data: items, error } = await serviceClient
					.from(table)
					.select("from_created_image_id, to_created_image_id, count, last_updated")
					.order(orderColumn, { ascending })
					.range(from, from + limit - 1);
				if (error) throw error;
				const { count: total, error: countError } = await serviceClient
					.from(table)
					.select("*", { count: "exact", head: true });
				if (countError) throw countError;
				return {
					items: items ?? [],
					total: total ?? 0,
					page,
					limit,
					hasMore: (items?.length ?? 0) === limit && (total ?? 0) > from + limit
				};
			}
		},
		selectRelatedToCreatedImage: {
			all: async (createdImageId, viewerId, options = {}) => {
				const limit = Math.min(Math.max(1, parseInt(options.limit, 10) || 10), 24);
				const seedIds = Array.isArray(options.seedIds) && options.seedIds.length > 0
					? options.seedIds.map((id) => Number(id)).filter((n) => Number.isFinite(n) && n > 0).slice(0, 10)
					: [Number(createdImageId)].filter((n) => Number.isFinite(n) && n > 0);
				if (seedIds.length === 0) return { ids: [], hasMore: false };
				const excludeIds = new Set([
					...(Array.isArray(options.excludeIds) ? options.excludeIds.map((id) => Number(id)) : []),
					...seedIds,
					Number(createdImageId)
				].filter((n) => Number.isFinite(n)));
				const params = options.params ?? await queries.getRelatedParams.get();
				const lineageWeight = Math.max(0, parseInt(params["related.lineage_weight"], 10) || 100);
				const lineageMinSlots = Math.max(0, parseInt(params["related.lineage_min_slots"], 10) || 2);
				const sameServerMethodWeight = Math.max(0, parseInt(params["related.same_server_method_weight"], 10) || 80);
				const sameCreatorWeight = Math.max(0, parseInt(params["related.same_creator_weight"], 10) || 50);
				const fallbackWeight = Math.max(0, parseInt(params["related.fallback_weight"], 10) || 20);
				const capPerSignal = Math.max(1, Math.min(500, parseInt(params["related.candidate_cap_per_signal"], 10) || 100));
				const randomSlotsPerBatch = Math.max(0, parseInt(params["related.random_slots_per_batch"], 10) || 0);
				const fallbackEnabled = String(params["related.fallback_enabled"] ?? "true").toLowerCase() === "true";
				const clickNextWeight = 50;
				const decayHalfLifeDays = parseFloat(params["related.transition_decay_half_life_days"], 10);
				const windowDays = Math.max(0, parseFloat(params["related.transition_window_days"], 10) || 0);

				const imgTable = prefixedTable("created_images");
				const { data: seedRows, error: seedErr } = await serviceClient
					.from(imgTable)
					.select("id, user_id, meta")
					.in("id", seedIds)
					.eq("published", true);
				if (seedErr) throw seedErr;
				const seeds = (seedRows ?? []).map((r) => ({
					id: Number(r.id),
					user_id: r.user_id != null ? Number(r.user_id) : null,
					meta: r.meta != null && typeof r.meta === "object" ? r.meta : {}
				}));
				const seedIdSet = new Set(seeds.map((s) => s.id));
				const parentIds = seeds.map((s) => s.meta?.mutate_of_id != null ? Number(s.meta.mutate_of_id) : null).filter((n) => Number.isFinite(n) && !excludeIds.has(n));
				const serverMethodPairs = [...new Set(seeds.map((s) => {
					const sid = s.meta?.server_id; const m = s.meta?.method;
					return sid != null && m != null ? `${sid}\t${m}` : null;
				}).filter(Boolean))];
				const creatorUserIds = [...new Set(seeds.map((s) => s.user_id).filter(Boolean))];

				const byId = new Map();
				function addCandidates(list, score) {
					for (const row of list) {
						const id = row.id != null ? Number(row.id) : null;
						if (id == null || excludeIds.has(id) || seedIdSet.has(id)) continue;
						const cur = byId.get(id);
						if (cur == null || score > cur.score) byId.set(id, { id, score, created_at: row.created_at });
					}
				}

				const lineageIds = new Set();
				if (seedIds.length > 0) {
					const orClause = seedIds.map((id) => `meta->>mutate_of_id.eq.${id}`).join(",");
					const { data: children } = await serviceClient.from(imgTable).select("id, created_at").eq("published", true).or(orClause).limit(capPerSignal);
					addCandidates(children ?? [], lineageWeight);
					(children ?? []).forEach((r) => lineageIds.add(Number(r.id)));
					if (parentIds.length > 0) {
						const { data: parents } = await serviceClient.from(imgTable).select("id, created_at").in("id", parentIds).eq("published", true).limit(capPerSignal);
						addCandidates(parents ?? [], lineageWeight);
						(parents ?? []).forEach((r) => lineageIds.add(Number(r.id)));
					}
				}

				if (serverMethodPairs.length > 0) {
					const orClauses = serverMethodPairs.map((pair) => {
						const [sid, m] = pair.split("\t");
						return `and(meta->>server_id.eq.${sid},meta->>method.eq.${m})`;
					});
					const { data: sameSm } = await serviceClient.from(imgTable).select("id, created_at").eq("published", true).or(orClauses.join(",")).limit(capPerSignal);
					addCandidates(sameSm ?? [], sameServerMethodWeight);
				}

				if (creatorUserIds.length > 0) {
					const { data: sameCreator } = await serviceClient.from(imgTable).select("id, created_at").eq("published", true).in("user_id", creatorUserIds).limit(capPerSignal);
					addCandidates(sameCreator ?? [], sameCreatorWeight);
				}

				if (fallbackEnabled) {
					const { data: fallback } = await serviceClient.from(imgTable).select("id, created_at").eq("published", true).order("created_at", { ascending: false }).limit(capPerSignal);
					addCandidates(fallback ?? [], fallbackWeight);
				}

				// Click-next: fetch transitions for seeds, time decay, normalize, blend into content score
				const clickScoreByToId = new Map();
				if (clickNextWeight > 0 && seedIds.length > 0) {
					const transTable = prefixedTable("related_transitions");
					const { data: transRows } = await serviceClient
						.from(transTable)
						.select("from_created_image_id, to_created_image_id, count, last_updated")
						.in("from_created_image_id", seedIds);
					const nowMs = Date.now();
					const halfLifeDays = Number.isFinite(decayHalfLifeDays) && decayHalfLifeDays > 0 ? decayHalfLifeDays : null;
					for (const row of transRows ?? []) {
						const toId = row.to_created_image_id != null ? Number(row.to_created_image_id) : null;
						if (toId == null || excludeIds.has(toId) || seedIdSet.has(toId)) continue;
						const count = Math.max(0, parseInt(row.count, 10) || 0);
						const lastUpdated = row.last_updated ? new Date(row.last_updated).getTime() : nowMs;
						const ageDays = (nowMs - lastUpdated) / (24 * 60 * 60 * 1000);
						let effective;
						if (windowDays > 0 && !halfLifeDays) {
							effective = ageDays <= windowDays ? count : 0;
						} else if (halfLifeDays) {
							effective = count * Math.pow(2, -ageDays / halfLifeDays);
						} else {
							effective = count;
						}
						clickScoreByToId.set(toId, (clickScoreByToId.get(toId) ?? 0) + effective);
					}
					// Normalize to 0–1 by max sum
					const maxSum = clickScoreByToId.size > 0 ? Math.max(...clickScoreByToId.values()) : 0;
					if (maxSum > 0) {
						for (const [id, sum] of clickScoreByToId) {
							clickScoreByToId.set(id, sum / maxSum);
						}
					}
				}

				// Blend: final_score = content_score + click_next_weight * click_next_score
				for (const entry of byId.values()) {
					entry.score += clickNextWeight * (clickScoreByToId.get(entry.id) ?? 0);
				}

				let sorted = [...byId.values()].sort((a, b) => b.score - a.score || new Date(b.created_at || 0) - new Date(a.created_at || 0));
				const lineageSorted = sorted.filter((c) => lineageIds.has(c.id));
				const otherSorted = sorted.filter((c) => !lineageIds.has(c.id));
				const lineageTake = Math.min(lineageMinSlots, lineageSorted.length);
				const combined = [...lineageSorted.slice(0, lineageTake), ...otherSorted];
				const deduped = [];
				const seen = new Set();
				for (const c of combined) {
					if (seen.has(c.id)) continue;
					seen.add(c.id);
					deduped.push(c);
				}
				const randomSlots = Math.min(randomSlotsPerBatch, limit);
				/* Fetch limit+1 so we can set hasMore when there are more candidates */
				const rankedTake = Math.max(0, limit + 1 - randomSlots);
				const rankedIds = deduped.slice(0, rankedTake).map((c) => c.id);
				const excludeAndRanked = new Set([...excludeIds, ...rankedIds, ...seedIds]);
				let randomIds = [];
				if (randomSlots > 0) {
					const { data: randRows } = await serviceClient.from(imgTable).select("id").eq("published", true).order("created_at", { ascending: false }).limit(randomSlots * 3);
					const pool = (randRows ?? []).map((r) => Number(r.id)).filter((id) => !excludeAndRanked.has(id));
					for (let i = 0; i < randomSlots && pool.length > 0; i++) {
						const idx = Math.floor(Math.random() * pool.length);
						randomIds.push(pool[idx]);
						excludeAndRanked.add(pool[idx]);
						pool.splice(idx, 1);
					}
				}
				const ids = [...rankedIds];
				for (let i = 0; i < randomSlots; i++) {
					if (randomIds[i] != null) ids.push(randomIds[i]);
				}
				const hasMore = ids.length > limit;
				return { ids: ids.slice(0, limit), hasMore };
			}
		},
		selectNotificationsForUser: {
			all: async (userId, role) => {
				// Use service client to bypass RLS for backend operations
				let query = serviceClient
					.from(prefixedTable("notifications"))
					.select("id, title, message, link, created_at, acknowledged_at, actor_user_id, type, target, meta")
					.order("created_at", { ascending: false });
				const { query: filteredQuery, hasFilter } = applyUserOrRoleFilter(
					query,
					userId,
					role
				);
				if (!hasFilter) {
					return [];
				}
				const { data, error } = await filteredQuery;
				if (error) {
					if (error.code === '42703' && error.message?.includes('user_id')) {
						throw new Error(
							`Database schema error: The ${prefixedTable("notifications")} table is missing the 'user_id' column. ` +
							`Please apply the schema from db/schemas/supabase_01.sql to your Supabase database. ` +
							`Original error: ${error.message}`
						);
					}
					throw error;
				}
				return data ?? [];
			}
		},
		selectNotificationById: {
			get: async (id, userId, role) => {
				let query = serviceClient
					.from(prefixedTable("notifications"))
					.select("id, title, message, link, created_at, acknowledged_at, actor_user_id, type, target, meta")
					.eq("id", id);
				const { query: filteredQuery, hasFilter } = applyUserOrRoleFilter(query, userId, role);
				if (!hasFilter) return undefined;
				const { data, error } = await filteredQuery.maybeSingle();
				if (error) throw error;
				return data ?? undefined;
			}
		},
		acknowledgeNotificationsForUserAndCreation: {
			run: async (userId, role, creationId) => {
				const linkPattern = `/creations/${creationId}`;
				const baseUpdate = () =>
					serviceClient
						.from(prefixedTable("notifications"))
						.update({ acknowledged_at: new Date().toISOString() })
						.is("acknowledged_at", null)
						.eq("link", linkPattern);
				let total = 0;
				let didRoleUpdate = false;
				// PostgREST doesn't support .or() on UPDATE reliably; run user_id then role (same pattern as acknowledgeNotificationById).
				if (userId != null) {
					let { data, error } = await baseUpdate().eq("user_id", userId).select("id");
					if (error?.code === "42703" && error?.message?.includes("user_id") && role != null) {
						({ data, error } = await baseUpdate().eq("role", role).select("id"));
						didRoleUpdate = true;
					}
					if (error) throw error;
					total += (data ?? []).length;
				}
				if (role != null && !didRoleUpdate) {
					const { data, error } = await baseUpdate().eq("role", role).select("id");
					if (error) throw error;
					total += (data ?? []).length;
				}
				return { changes: total };
			}
		},
		selectUnreadNotificationCount: {
			get: async (userId, role) => {
				// Use service client to bypass RLS for backend operations
				let query = serviceClient
					.from(prefixedTable("notifications"))
					.select("*", { count: "exact", head: true })
					.is("acknowledged_at", null);
				const { query: filteredQuery, hasFilter } = applyUserOrRoleFilter(
					query,
					userId,
					role
				);
				if (!hasFilter) {
					return { count: 0 };
				}
				const { count, error } = await filteredQuery;
				if (error) {
					if (error.code === '42703' && error.message?.includes('user_id')) {
						throw new Error(
							`Database schema error: The ${prefixedTable("notifications")} table is missing the 'user_id' column. ` +
							`Please apply the schema from db/schemas/supabase_01.sql to your Supabase database. ` +
							`Original error: ${error.message}`
						);
					}
					throw error;
				}
				return { count: count ?? 0 };
			}
		},
		acknowledgeNotificationById: {
			run: async (id, userId, role) => {
				const hasUserId = userId !== null && userId !== undefined;
				const hasRole = role !== null && role !== undefined;

				if (!hasUserId && !hasRole) {
					return { changes: 0 };
				}

				// PostgREST doesn't support .or() in UPDATE queries the same way as SELECT
				// Try each condition separately - return on first match
				// Must create a fresh query for each attempt (can't reuse query builders)

				// Try with user_id first if provided
				if (hasUserId) {
					let { data, error } = await serviceClient
						.from(prefixedTable("notifications"))
						.update({ acknowledged_at: new Date().toISOString() })
						.eq("id", id)
						.is("acknowledged_at", null)
						.eq("user_id", userId)
						.select("id");

					// Prod may have table without user_id column (older schema)
					if (error?.code === "42703" && error?.message?.includes("user_id") && hasRole) {
						({ data, error } = await serviceClient
							.from(prefixedTable("notifications"))
							.update({ acknowledged_at: new Date().toISOString() })
							.eq("id", id)
							.is("acknowledged_at", null)
							.eq("role", role)
							.select("id"));
					}
					if (error) throw error;
					if (data && data.length > 0) {
						return { changes: data.length };
					}
				}

				// If user_id didn't match, try with role
				if (hasRole) {
					const { data, error } = await serviceClient
						.from(prefixedTable("notifications"))
						.update({ acknowledged_at: new Date().toISOString() })
						.eq("id", id)
						.is("acknowledged_at", null)
						.eq("role", role)
						.select("id");

					if (error) throw error;
					if (data && data.length > 0) {
						return { changes: data.length };
					}
				}

				return { changes: 0 };
			}
		},
		/** Update a single notification by id only (no user/role check). For diagnostic/maintenance use only. */
		updateNotificationAcknowledgedAtById: {
			run: async (id) => {
				const { data, error } = await serviceClient
					.from(prefixedTable("notifications"))
					.update({ acknowledged_at: new Date().toISOString() })
					.eq("id", id)
					.is("acknowledged_at", null)
					.select("id");
				if (error) throw error;
				return { changes: (data ?? []).length };
			}
		},
		acknowledgeAllNotificationsForUser: {
			run: async (userId, role) => {
				const hasUserId = userId !== null && userId !== undefined;
				const hasRole = role !== null && role !== undefined;
				if (!hasUserId && !hasRole) return { changes: 0 };

				const baseUpdate = () =>
					serviceClient
						.from(prefixedTable("notifications"))
						.update({ acknowledged_at: new Date().toISOString() })
						.is("acknowledged_at", null);
				let total = 0;
				let didRoleUpdate = false;
				// PostgREST doesn't support .or() on UPDATE reliably; run user_id then role (same pattern as acknowledgeNotificationById).
				if (hasUserId) {
					let { data, error } = await baseUpdate().eq("user_id", userId).select("id");
					if (error?.code === "42703" && error?.message?.includes("user_id") && hasRole) {
						({ data, error } = await baseUpdate().eq("role", role).select("id"));
						didRoleUpdate = true;
					}
					if (error) throw error;
					total += (data ?? []).length;
				}
				if (hasRole && !didRoleUpdate) {
					const { data, error } = await baseUpdate().eq("role", role).select("id");
					if (error) throw error;
					total += (data ?? []).length;
				}
				return { changes: total };
			}
		},
		insertNotification: {
			run: async (userId, role, title, message, link, actor_user_id, type, target, meta) => {
				// Use serviceClient to bypass RLS for backend operations
				const payload = {
					user_id: userId ?? null,
					role: role ?? null,
					title,
					message,
					link: link ?? null,
					acknowledged_at: null
				};
				if (actor_user_id != null) payload.actor_user_id = actor_user_id;
				if (type != null) payload.type = type;
				if (target != null) payload.target = typeof target === "string" ? target : JSON.stringify(target);
				if (meta != null) payload.meta = typeof meta === "object" ? meta : meta;
				const { data, error } = await serviceClient
					.from(prefixedTable("notifications"))
					.insert(payload)
					.select("id")
					.single();
				if (error) throw error;
				return {
					insertId: data.id,
					lastInsertRowid: data.id,
					changes: 1
				};
			}
		},
		selectDistinctUserIdsWithUnreadNotificationsSince: {
			all: async (sinceIso) => {
				const { data, error } = await serviceClient
					.from(prefixedTable("notifications"))
					.select("user_id")
					.not("user_id", "is", null)
					.is("acknowledged_at", null)
					.gte("created_at", sinceIso);
				if (error) throw error;
				const seen = new Set();
				const userIds = (data ?? [])
					.map((r) => r?.user_id)
					.filter((id) => id != null && !seen.has(String(id)) && (seen.add(String(id)), true));
				return userIds.map((id) => ({ user_id: id }));
			}
		},
		insertEmailSend: {
			run: async (userId, campaign, meta) => {
				const { data, error } = await serviceClient
					.from(prefixedTable("email_sends"))
					.insert({
						user_id: userId,
						campaign,
						meta: meta ?? null
					})
					.select("id")
					.single();
				if (error) throw error;
				return { insertId: data.id, lastInsertRowid: data.id, changes: 1 };
			}
		},
		selectUserEmailCampaignState: {
			get: async (userId) => {
				const { data, error } = await serviceClient
					.from(prefixedTable("email_user_campaign_state"))
					.select("user_id, last_digest_sent_at, welcome_email_sent_at, first_creation_nudge_sent_at, last_reengagement_sent_at, last_creation_highlight_sent_at, updated_at, meta")
					.eq("user_id", userId)
					.maybeSingle();
				if (error) throw error;
				return data;
			}
		},
		upsertUserEmailCampaignStateLastDigest: {
			run: async (userId, sentAtIso) => {
				const { error } = await serviceClient
					.from(prefixedTable("email_user_campaign_state"))
					.upsert(
						{
							user_id: userId,
							last_digest_sent_at: sentAtIso,
							updated_at: new Date().toISOString()
						},
						{ onConflict: "user_id" }
					);
				if (error) throw error;
				return { changes: 1 };
			}
		},
		upsertUserEmailCampaignStateWelcome: {
			run: async (userId, sentAtIso) => {
				const { error } = await serviceClient
					.from(prefixedTable("email_user_campaign_state"))
					.upsert(
						{
							user_id: userId,
							welcome_email_sent_at: sentAtIso,
							updated_at: new Date().toISOString()
						},
						{ onConflict: "user_id" }
					);
				if (error) throw error;
				return { changes: 1 };
			}
		},
		upsertUserEmailCampaignStateFirstCreationNudge: {
			run: async (userId, sentAtIso) => {
				const { error } = await serviceClient
					.from(prefixedTable("email_user_campaign_state"))
					.upsert(
						{
							user_id: userId,
							first_creation_nudge_sent_at: sentAtIso,
							updated_at: new Date().toISOString()
						},
						{ onConflict: "user_id" }
					);
				if (error) throw error;
				return { changes: 1 };
			}
		},
		upsertUserEmailCampaignStateReengagement: {
			run: async (userId, sentAtIso) => {
				const { error } = await serviceClient
					.from(prefixedTable("email_user_campaign_state"))
					.upsert(
						{
							user_id: userId,
							last_reengagement_sent_at: sentAtIso,
							updated_at: new Date().toISOString()
						},
						{ onConflict: "user_id" }
					);
				if (error) throw error;
				return { changes: 1 };
			}
		},
		upsertUserEmailCampaignStateCreationHighlight: {
			run: async (userId, sentAtIso) => {
				const { error } = await serviceClient
					.from(prefixedTable("email_user_campaign_state"))
					.upsert(
						{
							user_id: userId,
							last_creation_highlight_sent_at: sentAtIso,
							updated_at: new Date().toISOString()
						},
						{ onConflict: "user_id" }
					);
				if (error) throw error;
				return { changes: 1 };
			}
		},
		selectUsersEligibleForReengagement: {
			// inactiveBeforeIso: treat user as inactive if COALESCE(last_active_at, created_at) <= this
			// lastReengagementBeforeIso: only include users with last_reengagement_sent_at null or <= this (cooldown)
			all: async (inactiveBeforeIso, lastReengagementBeforeIso) => {
				const { data: creators, error: cErr } = await serviceClient
					.from(prefixedTable("created_images"))
					.select("user_id");
				if (cErr) throw cErr;
				const creatorIds = [...new Set((creators ?? []).map((r) => r?.user_id).filter((id) => id != null))];
				if (creatorIds.length === 0) return [];
				const { data: users, error: uErr } = await serviceClient
					.from(prefixedTable("users"))
					.select("id, email, last_active_at, created_at")
					.in("id", creatorIds)
					.not("email", "is", null);
				if (uErr) throw uErr;
				const inactiveCutoff = inactiveBeforeIso ?? "1970-01-01T00:00:00.000Z";
				const lastActivity = (u) => u?.last_active_at ?? u?.created_at ?? "";
				const inactiveUserIds = (users ?? [])
					.filter((u) => u?.email && String(u.email).trim().includes("@"))
					.filter((u) => lastActivity(u) <= inactiveCutoff)
					.map((u) => u?.id)
					.filter((id) => id != null);
				if (inactiveUserIds.length === 0) return [];
				const { data: stateRows, error: sErr } = await serviceClient
					.from(prefixedTable("email_user_campaign_state"))
					.select("user_id, welcome_email_sent_at, last_reengagement_sent_at")
					.in("user_id", inactiveUserIds);
				if (sErr) throw sErr;
				// Only re-engage users who have already received welcome (so we never send "we miss you" before "welcome")
				const stateByUser = Object.fromEntries((stateRows ?? []).map((s) => [String(s?.user_id), s]));
				const reengagementBlocked = new Set(
					(stateRows ?? [])
						.filter((s) => {
							const sent = s?.last_reengagement_sent_at;
							if (sent == null) return false;
							return lastReengagementBeforeIso != null && sent > lastReengagementBeforeIso;
						})
						.map((s) => String(s?.user_id))
				);
				return inactiveUserIds
					.filter((id) => {
						const state = stateByUser[String(id)];
						if (!state || state.welcome_email_sent_at == null) return false;
						return !reengagementBlocked.has(String(id));
					})
					.map((user_id) => ({ user_id }));
			}
		},
		selectCreationsEligibleForHighlight: {
			// sinceIso: comments on creations after this time make a creation "hot"
			// highlightSentBeforeIso: only include owners with last_creation_highlight_sent_at null or <= this
			all: async (sinceIso, highlightSentBeforeIso) => {
				const { data: comments, error: cErr } = await serviceClient
					.from(prefixedTable("comments_created_image"))
					.select("created_image_id")
					.gte("created_at", sinceIso ?? "1970-01-01T00:00:00.000Z");
				if (cErr) throw cErr;
				const countByCreation = {};
				for (const row of comments ?? []) {
					const id = row?.created_image_id;
					if (id != null) countByCreation[id] = (countByCreation[id] || 0) + 1;
				}
				const creationIds = Object.keys(countByCreation).map(Number).filter((id) => id > 0);
				if (creationIds.length === 0) return [];
				const { data: creations, error: imgErr } = await serviceClient
					.from(prefixedTable("created_images"))
					.select("id, user_id, title")
					.in("id", creationIds);
				if (imgErr) throw imgErr;
				const ownerIds = [...new Set((creations ?? []).map((r) => r?.user_id).filter((id) => id != null))];
				if (ownerIds.length === 0) return [];
				const { data: stateRows, error: sErr } = await serviceClient
					.from(prefixedTable("email_user_campaign_state"))
					.select("user_id, last_creation_highlight_sent_at")
					.in("user_id", ownerIds);
				if (sErr) throw sErr;
				const highlightBlocked = new Set(
					(stateRows ?? [])
						.filter((s) => {
							const sent = s?.last_creation_highlight_sent_at;
							if (sent == null) return false;
							return highlightSentBeforeIso != null && sent > highlightSentBeforeIso;
						})
						.map((s) => String(s?.user_id))
				);
				const byOwner = {};
				for (const c of creations ?? []) {
					const uid = c?.user_id;
					if (uid == null || highlightBlocked.has(String(uid))) continue;
					const count = countByCreation[c?.id] || 0;
					if (!byOwner[uid] || count > (byOwner[uid].comment_count || 0)) {
						byOwner[uid] = {
							user_id: uid,
							creation_id: c?.id,
							title: (c?.title && String(c.title).trim()) || "Untitled",
							comment_count: count
						};
					}
				}
				return Object.values(byOwner);
			}
		},
		selectUsersEligibleForWelcomeEmail: {
			all: async (createdBeforeIso) => {
				const { data: users, error: uErr } = await serviceClient
					.from(prefixedTable("users"))
					.select("id")
					.not("email", "is", null)
					.lte("created_at", createdBeforeIso);
				if (uErr) throw uErr;
				const userIds = (users ?? []).map((r) => r?.id).filter((id) => id != null);
				if (userIds.length === 0) return [];
				const { data: sent, error: sErr } = await serviceClient
					.from(prefixedTable("email_user_campaign_state"))
					.select("user_id")
					.in("user_id", userIds)
					.not("welcome_email_sent_at", "is", null);
				if (sErr) throw sErr;
				const sentSet = new Set((sent ?? []).map((r) => String(r?.user_id)));
				return userIds.filter((id) => !sentSet.has(String(id))).map((user_id) => ({ user_id }));
			}
		},
		selectUsersEligibleForFirstCreationNudge: {
			// welcomeSentBeforeIso: only nudge users who were sent welcome at least this long ago so we never send both in the same run
			all: async (welcomeSentBeforeIso) => {
				const cutoff = welcomeSentBeforeIso ?? "1970-01-01T00:00:00.000Z";
				const { data: withCreations, error: cErr } = await serviceClient
					.from(prefixedTable("created_images"))
					.select("user_id");
				if (cErr) throw cErr;
				const hasCreation = new Set((withCreations ?? []).map((r) => String(r?.user_id)));
				const { data: stateRows, error: stateErr } = await serviceClient
					.from(prefixedTable("email_user_campaign_state"))
					.select("user_id")
					.not("welcome_email_sent_at", "is", null)
					.lte("welcome_email_sent_at", cutoff)
					.is("first_creation_nudge_sent_at", null);
				if (stateErr) throw stateErr;
				const candidateIds = (stateRows ?? [])
					.map((r) => r?.user_id)
					.filter((id) => id != null && !hasCreation.has(String(id)));
				return candidateIds.map((user_id) => ({ user_id }));
			}
		},
		selectEmailSendsCountForUserSince: {
			get: async (userId, campaign, sinceIso) => {
				const { data, error } = await serviceClient
					.from(prefixedTable("email_sends"))
					.select("id")
					.eq("user_id", userId)
					.eq("campaign", campaign)
					.gte("created_at", sinceIso);
				if (error) throw error;
				return { count: (data ?? []).length };
			}
		},
		countEmailSends: {
			get: async () => {
				const { count, error } = await serviceClient
					.from(prefixedTable("email_sends"))
					.select("id", { count: "exact", head: true });
				if (error) throw error;
				return { count: count ?? 0 };
			}
		},
		listEmailSendsRecent: {
			all: async (limit, offset = 0) => {
				const cap = Math.min(Math.max(0, Number(limit) || 200), 500);
				const off = Math.max(0, Number(offset) || 0);
				const { data, error } = await serviceClient
					.from(prefixedTable("email_sends"))
					.select("id, user_id, campaign, created_at, meta")
					.order("created_at", { ascending: false })
					.range(off, off + cap - 1);
				if (error) throw error;
				return data ?? [];
			}
		},
		selectDigestActivityByOwnerSince: {
			all: async (ownerUserId, sinceIso) => {
				const { data: creations, error: creationsError } = await serviceClient
					.from(prefixedTable("created_images"))
					.select("id, title")
					.eq("user_id", ownerUserId);
				if (creationsError) throw creationsError;
				const creationIds = (creations ?? []).map((r) => r.id).filter((id) => id != null);
				if (creationIds.length === 0) return [];

				const { data: comments, error: commentsError } = await serviceClient
					.from(prefixedTable("comments_created_image"))
					.select("created_image_id")
					.in("created_image_id", creationIds)
					.gte("created_at", sinceIso);
				if (commentsError) throw commentsError;

				const countByImage = {};
				for (const row of comments ?? []) {
					const id = row?.created_image_id;
					if (id != null) countByImage[id] = (countByImage[id] || 0) + 1;
				}
				const byId = Object.fromEntries((creations ?? []).map((c) => [c.id, c]));
				return Object.entries(countByImage)
					.map(([created_image_id, comment_count]) => ({
						created_image_id: Number(created_image_id),
						title: (byId[Number(created_image_id)]?.title && String(byId[Number(created_image_id)].title).trim()) || "Untitled",
						comment_count: Number(comment_count)
					}))
					.sort((a, b) => b.comment_count - a.comment_count || a.created_image_id - b.created_image_id);
			}
		},
		selectDigestActivityByCommenterSince: {
			all: async (commenterUserId, sinceIso) => {
				const { data: myComments, error: myError } = await serviceClient
					.from(prefixedTable("comments_created_image"))
					.select("created_image_id")
					.eq("user_id", commenterUserId);
				if (myError) throw myError;
				const creationIds = [...new Set((myComments ?? []).map((r) => r?.created_image_id).filter((id) => id != null))];
				if (creationIds.length === 0) return [];

				const { data: creations, error: creationsError } = await serviceClient
					.from(prefixedTable("created_images"))
					.select("id, title")
					.in("id", creationIds)
					.neq("user_id", commenterUserId);
				if (creationsError) throw creationsError;
				const notOwnedIds = (creations ?? []).map((r) => r.id).filter((id) => id != null);
				if (notOwnedIds.length === 0) return [];

				const { data: comments, error: commentsError } = await serviceClient
					.from(prefixedTable("comments_created_image"))
					.select("created_image_id")
					.in("created_image_id", notOwnedIds)
					.gte("created_at", sinceIso)
					.neq("user_id", commenterUserId);
				if (commentsError) throw commentsError;

				const countByImage = {};
				for (const row of comments ?? []) {
					const id = row?.created_image_id;
					if (id != null) countByImage[id] = (countByImage[id] || 0) + 1;
				}
				const byId = Object.fromEntries((creations ?? []).map((c) => [c.id, c]));
				return Object.entries(countByImage)
					.map(([created_image_id, comment_count]) => ({
						created_image_id: Number(created_image_id),
						title: (byId[Number(created_image_id)]?.title && String(byId[Number(created_image_id)].title).trim()) || "Untitled",
						comment_count: Number(comment_count)
					}))
					.sort((a, b) => b.comment_count - a.comment_count || a.created_image_id - b.created_image_id);
			}
		},
		insertEmailLinkClick: {
			run: async (emailSendId, userId, path) => {
				const { error } = await serviceClient
					.from(prefixedTable("email_link_clicks"))
					.insert({
						email_send_id: emailSendId,
						user_id: userId ?? null,
						path: path ?? null
					});
				if (error) throw error;
				return { changes: 1 };
			}
		},
		selectFeedItems: {
			all: async (excludeUserId) => {
				const viewerId = excludeUserId ?? null;
				if (viewerId === null || viewerId === undefined) {
					return [];
				}

				const { data: followRows, error: followError } = await serviceClient
					.from(prefixedTable("user_follows"))
					.select("following_id")
					.eq("follower_id", viewerId);
				if (followError) throw followError;

				const followingIdSet = new Set(
					(followRows ?? [])
						.map((row) => row?.following_id)
						.filter((id) => id !== null && id !== undefined)
						.map((id) => String(id))
				);
				if (followingIdSet.size === 0) {
					return [];
				}

				// Use serviceClient to bypass RLS for backend operations
				const { data, error } = await serviceClient
					.from(prefixedTable("feed_items"))
					.select(
						"id, title, summary, author, tags, created_at, created_image_id, prsn_created_images(filename, file_path, user_id, unavailable_at)"
					)
					.order("created_at", { ascending: false });
				if (error) throw error;
				const items = (data ?? []).map((item) => {
					const { prsn_created_images, ...rest } = item;
					const filename = prsn_created_images?.filename ?? null;
					const file_path = prsn_created_images?.file_path ?? null;
					const user_id = prsn_created_images?.user_id ?? null;
					const unavailable_at = prsn_created_images?.unavailable_at ?? null;
					return {
						...rest,
						filename,
						user_id,
						unavailable_at,
						// Use file_path (which contains the URL) or fall back to constructing from filename
						url: file_path || (filename ? `/api/images/created/${filename}` : null),
						like_count: 0,
						comment_count: 0,
						viewer_liked: false
					};
				});
				const filtered = items.filter((item) => {
					if (item.user_id === null || item.user_id === undefined) return false;
					if (item.unavailable_at != null && item.unavailable_at !== "") return false;
					return followingIdSet.has(String(item.user_id));
				});

				const createdImageIds = filtered
					.map((item) => item.created_image_id)
					.filter((id) => id !== null && id !== undefined);

				if (createdImageIds.length === 0) {
					return filtered;
				}

				// Bulk like counts via view
				const { data: countRows, error: countError } = await serviceClient
					.from(prefixedTable("created_image_like_counts"))
					.select("created_image_id, like_count")
					.in("created_image_id", createdImageIds);
				if (countError) throw countError;

				const countById = new Map(
					(countRows ?? []).map((row) => [String(row.created_image_id), Number(row.like_count ?? 0)])
				);

				// Bulk comment counts via view
				const { data: commentCountRows, error: commentCountError } = await serviceClient
					.from(prefixedTable("created_image_comment_counts"))
					.select("created_image_id, comment_count")
					.in("created_image_id", createdImageIds);
				if (commentCountError) throw commentCountError;

				const commentCountById = new Map(
					(commentCountRows ?? []).map((row) => [String(row.created_image_id), Number(row.comment_count ?? 0)])
				);

				// Bulk viewer liked lookup
				let likedIdSet = null;
				if (viewerId !== null && viewerId !== undefined) {
					const { data: likedRows, error: likedError } = await serviceClient
						.from(prefixedTable("likes_created_image"))
						.select("created_image_id")
						.eq("user_id", viewerId)
						.in("created_image_id", createdImageIds);
					if (likedError) throw likedError;
					likedIdSet = new Set((likedRows ?? []).map((row) => String(row.created_image_id)));
				}

				// Attach profile fields (display_name, user_name, avatar_url) for authors
				const authorIds = Array.from(new Set(
					filtered
						.map((item) => item.user_id)
						.filter((id) => id !== null && id !== undefined)
						.map((id) => Number(id))
						.filter((id) => Number.isFinite(id) && id > 0)
				));

				let profileByUserId = new Map();
				let planByUserId = new Map();
				if (authorIds.length > 0) {
					const { data: profileRows, error: profileError } = await serviceClient
						.from(prefixedTable("user_profiles"))
						.select("user_id, user_name, display_name, avatar_url")
						.in("user_id", authorIds);
					if (profileError) throw profileError;
					profileByUserId = new Map(
						(profileRows ?? []).map((row) => [String(row.user_id), row])
					);
					const { data: userRows, error: userError } = await serviceClient
						.from(prefixedTable("users"))
						.select("id, meta")
						.in("id", authorIds);
					if (!userError && userRows?.length) {
						userRows.forEach((row) => {
							const plan = row?.meta?.plan === "founder" ? "founder" : "free";
							planByUserId.set(String(row.id), plan);
						});
					}
				}

				return filtered.map((item) => {
					const key = item.created_image_id === null || item.created_image_id === undefined
						? null
						: String(item.created_image_id);
					const likeCount = key ? (countById.get(key) ?? 0) : 0;
					const commentCount = key ? (commentCountById.get(key) ?? 0) : 0;
					const viewerLiked = key && likedIdSet ? likedIdSet.has(key) : false;
					const profile = item.user_id !== null && item.user_id !== undefined
						? profileByUserId.get(String(item.user_id)) ?? null
						: null;
					const authorPlan = item.user_id != null ? (planByUserId.get(String(item.user_id)) ?? "free") : "free";
					return {
						...item,
						like_count: likeCount,
						comment_count: commentCount,
						viewer_liked: viewerLiked,
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
				if (id === null || id === undefined) {
					return [];
				}

				// Get list of users the viewer follows to exclude them from explore
				const { data: followRows, error: followError } = await serviceClient
					.from(prefixedTable("user_follows"))
					.select("following_id")
					.eq("follower_id", id);
				if (followError) throw followError;

				const followingIdSet = new Set(
					(followRows ?? [])
						.map((row) => row?.following_id)
						.filter((id) => id !== null && id !== undefined)
						.map((id) => String(id))
				);

				// Use serviceClient to bypass RLS for backend operations
				const { data, error } = await serviceClient
					.from(prefixedTable("feed_items"))
					.select(
						"id, title, summary, author, tags, created_at, created_image_id, prsn_created_images(filename, file_path, user_id)"
					)
					.order("created_at", { ascending: false });
				if (error) throw error;

				const items = (data ?? []).map((item) => {
					const { prsn_created_images, ...rest } = item;
					const filename = prsn_created_images?.filename ?? null;
					const file_path = prsn_created_images?.file_path ?? null;
					const user_id = prsn_created_images?.user_id ?? null;
					return {
						...rest,
						filename,
						user_id,
						url: file_path || (filename ? `/api/images/created/${filename}` : null),
						thumbnail_url: getThumbnailUrl(file_path || (filename ? `/api/images/created/${filename}` : null)),
						like_count: 0,
						comment_count: 0,
						viewer_liked: false
					};
				});

				// Explore shows all authored creations, excluding those from users the viewer follows and the viewer themselves.
				const viewerIdStr = String(id);
				const filtered = items.filter((item) => {
					if (item.user_id === null || item.user_id === undefined) return false;
					// Exclude items from the viewer themselves
					if (String(item.user_id) === viewerIdStr) return false;
					// Exclude items from users the viewer follows
					return !followingIdSet.has(String(item.user_id));
				});

				const createdImageIds = filtered
					.map((item) => item.created_image_id)
					.filter((createdImageId) => createdImageId !== null && createdImageId !== undefined);

				if (createdImageIds.length === 0) {
					return filtered;
				}

				// Bulk like counts via view
				const { data: countRows, error: countError } = await serviceClient
					.from(prefixedTable("created_image_like_counts"))
					.select("created_image_id, like_count")
					.in("created_image_id", createdImageIds);
				if (countError) throw countError;

				const countById = new Map(
					(countRows ?? []).map((row) => [String(row.created_image_id), Number(row.like_count ?? 0)])
				);

				// Bulk comment counts via view
				const { data: commentCountRows, error: commentCountError } = await serviceClient
					.from(prefixedTable("created_image_comment_counts"))
					.select("created_image_id, comment_count")
					.in("created_image_id", createdImageIds);
				if (commentCountError) throw commentCountError;

				const commentCountById = new Map(
					(commentCountRows ?? []).map((row) => [String(row.created_image_id), Number(row.comment_count ?? 0)])
				);

				// Bulk viewer liked lookup
				let likedIdSet = null;
				const viewer = id;
				if (viewer !== null && viewer !== undefined) {
					const { data: likedRows, error: likedError } = await serviceClient
						.from(prefixedTable("likes_created_image"))
						.select("created_image_id")
						.eq("user_id", viewer)
						.in("created_image_id", createdImageIds);
					if (likedError) throw likedError;
					likedIdSet = new Set((likedRows ?? []).map((row) => String(row.created_image_id)));
				}

				// Attach profile fields for authors
				const authorIds = Array.from(new Set(
					filtered
						.map((item) => item.user_id)
						.filter((userId) => userId !== null && userId !== undefined)
						.map((userId) => Number(userId))
						.filter((userId) => Number.isFinite(userId) && userId > 0)
				));

				let profileByUserId = new Map();
				if (authorIds.length > 0) {
					const { data: profileRows, error: profileError } = await serviceClient
						.from(prefixedTable("user_profiles"))
						.select("user_id, user_name, display_name, avatar_url")
						.in("user_id", authorIds);
					if (profileError) throw profileError;
					profileByUserId = new Map(
						(profileRows ?? []).map((row) => [String(row.user_id), row])
					);
				}

				const full = filtered.map((item) => {
					const key = item.created_image_id === null || item.created_image_id === undefined
						? null
						: String(item.created_image_id);
					const likeCount = key ? (countById.get(key) ?? 0) : 0;
					const commentCount = key ? (commentCountById.get(key) ?? 0) : 0;
					const viewerLiked = key && likedIdSet ? likedIdSet.has(key) : false;
					const profile = item.user_id !== null && item.user_id !== undefined
						? profileByUserId.get(String(item.user_id)) ?? null
						: null;
					return {
						...item,
						like_count: likeCount,
						comment_count: commentCount,
						viewer_liked: viewerLiked,
						author_user_name: profile?.user_name ?? null,
						author_display_name: profile?.display_name ?? null,
						author_avatar_url: profile?.avatar_url ?? null
					};
				});
				return full;
			};

			// Paginated: same logic as exploreAll but limits the initial DB fetch so we don't pull the whole table.
			const explorePaginated = async (viewerId, { limit = 24, offset = 0 } = {}) => {
				const id = viewerId ?? null;
				if (id === null || id === undefined) return [];

				// Allow limit+1 (e.g. 101) so API can detect hasMore; cap at 500 for safety
				const lim = Math.min(Math.max(0, Number(limit) || 24), 500);
				const off = Math.max(0, Number(offset) || 0);

				const { data: followRows, error: followError } = await serviceClient
					.from(prefixedTable("user_follows"))
					.select("following_id")
					.eq("follower_id", id);
				if (followError) throw followError;

				const followingIdSet = new Set(
					(followRows ?? [])
						.map((row) => row?.following_id)
						.filter((fid) => fid !== null && fid !== undefined)
						.map((fid) => String(fid))
				);

				// Single paginated query path:
				// fetch the requested page directly with DB-side exclusion filters.
				const excludedAuthorIds = Array.from(
					new Set(
						[String(id), ...followingIdSet]
							.map((value) => Number(value))
							.filter((value) => Number.isFinite(value) && value > 0)
					)
				);
				let query = serviceClient
					.from(prefixedTable("feed_items"))
					.select(
						"id, title, summary, author, tags, created_at, created_image_id, prsn_created_images!inner(filename, file_path, user_id, unavailable_at)"
					)
					.not("prsn_created_images.user_id", "is", null)
					.is("prsn_created_images.unavailable_at", null)
					.order("created_at", { ascending: false })
					.range(off, off + lim - 1);
				if (excludedAuthorIds.length > 0) {
					query = query.not("prsn_created_images.user_id", "in", `(${excludedAuthorIds.join(",")})`);
				}

				const { data, error } = await query;
				if (error) throw error;

				const page = (Array.isArray(data) ? data : [])
					.map((row) => {
						const { prsn_created_images, ...rest } = row;
						const filename = prsn_created_images?.filename ?? null;
						const file_path = prsn_created_images?.file_path ?? null;
						const user_id = prsn_created_images?.user_id ?? null;
						const resolvedUrl = file_path || (filename ? `/api/images/created/${filename}` : null);
						return {
							...rest,
							filename,
							user_id,
							url: resolvedUrl,
							thumbnail_url: getThumbnailUrl(resolvedUrl),
							like_count: 0,
							comment_count: 0,
							viewer_liked: false
						};
					})
					.filter((item) => item?.user_id != null && typeof item?.url === "string" && item.url.length > 0);
				const createdImageIds = page
					.map((item) => item.created_image_id)
					.filter((cid) => cid !== null && cid !== undefined);

				if (createdImageIds.length === 0) return page;

				const { data: countRows, error: countError } = await serviceClient
					.from(prefixedTable("created_image_like_counts"))
					.select("created_image_id, like_count")
					.in("created_image_id", createdImageIds);
				if (countError) throw countError;
				const countById = new Map(
					(countRows ?? []).map((row) => [String(row.created_image_id), Number(row.like_count ?? 0)])
				);

				const { data: commentCountRows, error: commentCountError } = await serviceClient
					.from(prefixedTable("created_image_comment_counts"))
					.select("created_image_id, comment_count")
					.in("created_image_id", createdImageIds);
				if (commentCountError) throw commentCountError;
				const commentCountById = new Map(
					(commentCountRows ?? []).map((row) => [String(row.created_image_id), Number(row.comment_count ?? 0)])
				);

				let likedIdSet = null;
				if (id !== null && id !== undefined) {
					const { data: likedRows, error: likedError } = await serviceClient
						.from(prefixedTable("likes_created_image"))
						.select("created_image_id")
						.eq("user_id", id)
						.in("created_image_id", createdImageIds);
					if (likedError) throw likedError;
					likedIdSet = new Set((likedRows ?? []).map((row) => String(row.created_image_id)));
				}

				const authorIds = [...new Set(
					page
						.map((item) => item.user_id)
						.filter((uid) => uid != null && Number.isFinite(Number(uid)))
				)].map(Number).filter((n) => n > 0);

				let profileByUserId = new Map();
				if (authorIds.length > 0) {
					const { data: profileRows, error: profileError } = await serviceClient
						.from(prefixedTable("user_profiles"))
						.select("user_id, user_name, display_name, avatar_url")
						.in("user_id", authorIds);
					if (profileError) throw profileError;
					profileByUserId = new Map((profileRows ?? []).map((row) => [String(row.user_id), row]));
				}

				return page.map((item) => {
					const key = item.created_image_id != null ? String(item.created_image_id) : null;
					const likeCount = key ? (countById.get(key) ?? 0) : 0;
					const commentCount = key ? (commentCountById.get(key) ?? 0) : 0;
					const viewerLiked = key && likedIdSet ? likedIdSet.has(key) : false;
					const profile = item.user_id != null ? profileByUserId.get(String(item.user_id)) ?? null : null;
					return {
						...item,
						like_count: likeCount,
						comment_count: commentCount,
						viewer_liked: viewerLiked,
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
				const { data, error } = await serviceClient
					.from(prefixedTable("feed_items"))
					.select(
						"id, title, summary, author, tags, created_at, created_image_id, prsn_created_images(filename, file_path, user_id)"
					)
					.order("created_at", { ascending: false });
				if (error) throw error;

				const items = (data ?? []).map((item) => {
					const { prsn_created_images, ...rest } = item;
					const filename = prsn_created_images?.filename ?? null;
					const file_path = prsn_created_images?.file_path ?? null;
					const user_id = prsn_created_images?.user_id ?? null;
					return {
						...rest,
						filename,
						user_id,
						url: file_path || (filename ? `/api/images/created/${filename}` : null),
						thumbnail_url: getThumbnailUrl(file_path || (filename ? `/api/images/created/${filename}` : null)),
						like_count: 0,
						comment_count: 0,
						viewer_liked: false
					};
				});

				const filtered = items.filter((item) => item.user_id != null && item.user_id !== undefined);
				const createdImageIds = filtered
					.map((item) => item.created_image_id)
					.filter((id) => id != null && id !== undefined);

				if (createdImageIds.length === 0) return filtered;

				const { data: countRows, error: countError } = await serviceClient
					.from(prefixedTable("created_image_like_counts"))
					.select("created_image_id, like_count")
					.in("created_image_id", createdImageIds);
				if (countError) throw countError;
				const countById = new Map(
					(countRows ?? []).map((row) => [String(row.created_image_id), Number(row.like_count ?? 0)])
				);

				const { data: commentCountRows, error: commentCountError } = await serviceClient
					.from(prefixedTable("created_image_comment_counts"))
					.select("created_image_id, comment_count")
					.in("created_image_id", createdImageIds);
				if (commentCountError) throw commentCountError;
				const commentCountById = new Map(
					(commentCountRows ?? []).map((row) => [String(row.created_image_id), Number(row.comment_count ?? 0)])
				);

				const authorIds = [...new Set(
					filtered
						.map((item) => item.user_id)
						.filter((uid) => uid != null && Number.isFinite(Number(uid)))
				)].map(Number).filter((n) => n > 0);
				let profileByUserId = new Map();
				if (authorIds.length > 0) {
					const { data: profileRows, error: profileError } = await serviceClient
						.from(prefixedTable("user_profiles"))
						.select("user_id, user_name, display_name, avatar_url")
						.in("user_id", authorIds);
					if (profileError) throw profileError;
					profileByUserId = new Map((profileRows ?? []).map((row) => [String(row.user_id), row]));
				}

				return filtered.map((item) => {
					const key = item.created_image_id != null ? String(item.created_image_id) : null;
					const likeCount = key ? (countById.get(key) ?? 0) : 0;
					const commentCount = key ? (commentCountById.get(key) ?? 0) : 0;
					const profile = item.user_id != null ? profileByUserId.get(String(item.user_id)) ?? null : null;
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

				const { data, error } = await serviceClient
					.from(prefixedTable("feed_items"))
					.select(
						"id, title, summary, author, tags, created_at, created_image_id, prsn_created_images(filename, file_path, user_id)"
					)
					.order("created_at", { ascending: false });
				if (error) throw error;

				const items = (data ?? []).map((item) => {
					const { prsn_created_images, ...rest } = item;
					const filename = prsn_created_images?.filename ?? null;
					const file_path = prsn_created_images?.file_path ?? null;
					const user_id = prsn_created_images?.user_id ?? null;
					return {
						...rest,
						filename,
						user_id,
						url: file_path || (filename ? `/api/images/created/${filename}` : null),
						like_count: 0,
						comment_count: 0,
						viewer_liked: false
					};
				});

				const viewerIdStr = String(id);
				const filtered = items.filter((item) => {
					if (item.user_id === null || item.user_id === undefined) return false;
					if (String(item.user_id) === viewerIdStr) return false;
					return true;
				});

				const createdImageIds = filtered
					.map((item) => item.created_image_id)
					.filter((createdImageId) => createdImageId !== null && createdImageId !== undefined);

				if (createdImageIds.length === 0) return [];

				const { data: countRows, error: countError } = await serviceClient
					.from(prefixedTable("created_image_like_counts"))
					.select("created_image_id, like_count")
					.in("created_image_id", createdImageIds);
				if (countError) throw countError;

				const likeById = new Map(
					(countRows ?? []).map((row) => [String(row.created_image_id), Number(row.like_count ?? 0)])
				);

				const { data: commentCountRows, error: commentCountError } = await serviceClient
					.from(prefixedTable("created_image_comment_counts"))
					.select("created_image_id, comment_count")
					.in("created_image_id", createdImageIds);
				if (commentCountError) throw commentCountError;

				const commentCountById = new Map(
					(commentCountRows ?? []).map((row) => [String(row.created_image_id), Number(row.comment_count ?? 0)])
				);

				const withEngagement = filtered.filter((item) => {
					const key = item.created_image_id != null ? String(item.created_image_id) : null;
					if (!key) return false;
					const likes = likeById.get(key) ?? 0;
					const comments = commentCountById.get(key) ?? 0;
					return likes > 0 || comments > 0;
				});

				if (withEngagement.length === 0) return [];

				const finalImageIds = withEngagement.map((item) => item.created_image_id).filter(Boolean);

				let likedIdSet = null;
				if (id !== null && id !== undefined) {
					const { data: likedRows, error: likedError } = await serviceClient
						.from(prefixedTable("likes_created_image"))
						.select("created_image_id")
						.eq("user_id", id)
						.in("created_image_id", finalImageIds);
					if (likedError) throw likedError;
					likedIdSet = new Set((likedRows ?? []).map((row) => String(row.created_image_id)));
				}

				const authorIds = Array.from(new Set(
					withEngagement
						.map((item) => item.user_id)
						.filter((userId) => userId !== null && userId !== undefined)
						.map((userId) => Number(userId))
						.filter((userId) => Number.isFinite(userId) && userId > 0)
				));

				let profileByUserId = new Map();
				if (authorIds.length > 0) {
					const { data: profileRows, error: profileError } = await serviceClient
						.from(prefixedTable("user_profiles"))
						.select("user_id, user_name, display_name, avatar_url")
						.in("user_id", authorIds);
					if (profileError) throw profileError;
					profileByUserId = new Map(
						(profileRows ?? []).map((row) => [String(row.user_id), row])
					);
				}

				return withEngagement.map((item) => {
					const key = item.created_image_id != null ? String(item.created_image_id) : null;
					const likeCount = key ? (likeById.get(key) ?? 0) : 0;
					const commentCount = key ? (commentCountById.get(key) ?? 0) : 0;
					const viewerLiked = key && likedIdSet ? likedIdSet.has(key) : false;
					const profile = item.user_id != null ? profileByUserId.get(String(item.user_id)) ?? null : null;
					return {
						...item,
						like_count: likeCount,
						comment_count: commentCount,
						viewer_liked: viewerLiked,
						author_user_name: profile?.user_name ?? null,
						author_display_name: profile?.display_name ?? null,
						author_avatar_url: profile?.avatar_url ?? null
					};
				});
			}
		},
		selectMostMutatedFeedItems: {
			all: async (viewerId, limit) => {
				const limitNum = Number.isFinite(Number(limit)) ? Math.max(0, Math.min(Number(limit), 200)) : 25;
				const { data: metaRows, error: metaError } = await serviceClient
					.from(prefixedTable("created_images"))
					.select("meta");
				if (metaError) throw metaError;
				const countById = new Map();
				function toHistoryArray(raw) {
					const h = raw?.history;
					if (Array.isArray(h)) return h;
					if (typeof h === "string") {
						try { const a = JSON.parse(h); return Array.isArray(a) ? a : []; } catch { return []; }
					}
					return [];
				}
				for (const row of metaRows ?? []) {
					const meta = row?.meta;
					const raw = meta != null && typeof meta === "object" ? meta : (typeof meta === "string" ? (() => { try { return JSON.parse(meta); } catch { return null; } })() : null);
					if (!raw || typeof raw !== "object") continue;
					const history = toHistoryArray(raw);
					for (const v of history) {
						const id = v != null ? Number(v) : NaN;
						if (!Number.isFinite(id) || id <= 0) continue;
						countById.set(id, (countById.get(id) ?? 0) + 1);
					}
					// Fallback: count mutate_of_id so older records without history still show up
					const mid = raw.mutate_of_id != null ? Number(raw.mutate_of_id) : NaN;
					if (Number.isFinite(mid) && mid > 0) countById.set(mid, (countById.get(mid) ?? 0) + 1);
				}
				const topIds = [...countById.entries()]
					.sort((a, b) => (b[1] - a[1]) || (a[0] - b[0]))
					.slice(0, limitNum)
					.map(([id]) => id);
				if (topIds.length === 0) return [];
				const { data: images, error: imgError } = await serviceClient
					.from(prefixedTable("created_images"))
					.select("id, title, description, created_at, user_id")
					.in("id", topIds);
				if (imgError) throw imgError;
				const orderById = new Map(topIds.map((id, i) => [Number(id), i]));
				const sorted = (images ?? []).slice().sort((a, b) => (orderById.get(Number(a.id)) ?? 999) - (orderById.get(Number(b.id)) ?? 999));
				const createdImageIds = sorted.map((r) => r.id).filter((id) => id != null);
				if (createdImageIds.length === 0) return [];
				const { data: countRows, error: countError } = await serviceClient
					.from(prefixedTable("created_image_like_counts"))
					.select("created_image_id, like_count")
					.in("created_image_id", createdImageIds);
				if (countError) throw countError;
				const likeById = new Map((countRows ?? []).map((r) => [String(r.created_image_id), Number(r.like_count ?? 0)]));
				const { data: commentRows, error: commentError } = await serviceClient
					.from(prefixedTable("created_image_comment_counts"))
					.select("created_image_id, comment_count")
					.in("created_image_id", createdImageIds);
				if (commentError) throw commentError;
				const commentById = new Map((commentRows ?? []).map((r) => [String(r.created_image_id), Number(r.comment_count ?? 0)]));
				const authorIds = [...new Set(sorted.map((r) => r.user_id).filter(Boolean))];
				let profileByUserId = new Map();
				if (authorIds.length > 0) {
					const { data: profileRows, error: profileError } = await serviceClient
						.from(prefixedTable("user_profiles"))
						.select("user_id, user_name, display_name, avatar_url")
						.in("user_id", authorIds);
					if (!profileError && profileRows) {
						profileByUserId = new Map(profileRows.map((r) => [String(r.user_id), r]));
					}
				}
				return sorted.map((row) => {
					const key = String(row.id);
					const profile = row.user_id != null ? profileByUserId.get(String(row.user_id)) : null;
					return {
						id: row.id,
						created_image_id: row.id,
						title: row.title ?? "",
						summary: row.description ?? "",
						created_at: row.created_at,
						user_id: row.user_id,
						like_count: likeById.get(key) ?? 0,
						comment_count: commentById.get(key) ?? 0,
						author_display_name: profile?.display_name ?? null,
						author_user_name: profile?.user_name ?? null
					};
				});
			}
		},
		selectExploreItems: {
			all: async () => {
				// Use serviceClient to bypass RLS for backend operations
				const { data, error } = await serviceClient
					.from(prefixedTable("explore_items"))
					.select("id, title, summary, category, created_at")
					.order("created_at", { ascending: false });
				if (error) throw error;
				return data ?? [];
			}
		},
		selectCreationsForUser: {
			all: async (userId) => {
				// Use serviceClient to bypass RLS for backend operations
				const { data, error } = await serviceClient
					.from(prefixedTable("creations"))
					.select("id, title, body, status, created_at")
					.eq("user_id", userId)
					.order("created_at", { ascending: false });
				if (error) throw error;
				return data ?? [];
			}
		},
		selectServers: {
			all: async () => {
				// Use serviceClient to bypass RLS for backend operations
				const { data, error } = await serviceClient
					.from(prefixedTable("servers"))
					.select(`
            id,
            user_id,
            name,
            status,
            members_count,
            description,
            created_at,
            server_url,
            auth_token,
            status_date,
            server_config,
            prsn_users!prsn_servers_user_id_fkey(email)
          `)
					.order("name", { ascending: true });
				if (error) throw error;
				// Transform the data to flatten the user email
				return (data ?? []).map(server => {
					const { prsn_users, ...rest } = server;
					return {
						...rest,
						owner_email: prsn_users?.email || null
					};
				});
			}
		},
		selectServerById: {
			get: async (serverId) => {
				// Use serviceClient to bypass RLS for backend operations
				const { data, error } = await serviceClient
					.from(prefixedTable("servers"))
					.select(`
            id,
            user_id,
            name,
            status,
            members_count,
            description,
            created_at,
            server_url,
            auth_token,
            status_date,
            server_config,
            prsn_users!prsn_servers_user_id_fkey(email)
          `)
					.eq("id", serverId)
					.single();
				if (error) {
					if (error.code === 'PGRST116') return null; // Not found
					throw error;
				}
				if (!data) return null;

				// Transform the data to flatten the user email
				const { prsn_users, ...rest } = data;
				return {
					...rest,
					owner_email: prsn_users?.email || null
				};
			}
		},
		updateServerConfig: {
			run: async (serverId, serverConfig) => {
				const { data, error } = await serviceClient
					.from(prefixedTable("servers"))
					.update({
						server_config: serverConfig,
						updated_at: new Date().toISOString()
					})
					.eq("id", serverId)
					.select();
				if (error) throw error;
				return {
					changes: data?.length || 0
				};
			}
		},
		updateServer: {
			run: async (serverId, server) => {
				const { data, error } = await serviceClient
					.from(prefixedTable("servers"))
					.update({
						user_id: server?.user_id ?? null,
						name: server?.name ?? null,
						status: server?.status ?? null,
						server_url: server?.server_url ?? null,
						auth_token: server?.auth_token ?? null,
						status_date: server?.status_date ?? null,
						description: server?.description ?? null,
						members_count: server?.members_count ?? 0,
						server_config: server?.server_config ?? null,
						updated_at: new Date().toISOString()
					})
					.eq("id", serverId)
					.select();
				if (error) throw error;
				return {
					changes: data?.length || 0
				};
			}
		},
		checkServerMembership: {
			get: async (serverId, userId) => {
				const { data, error } = await serviceClient
					.from(prefixedTable("server_members"))
					.select("server_id, user_id")
					.eq("server_id", serverId)
					.eq("user_id", userId)
					.maybeSingle();
				if (error) throw error;
				return data !== null;
			}
		},
		addServerMember: {
			run: async (serverId, userId) => {
				// Check if already a member
				const { data: existing } = await serviceClient
					.from(prefixedTable("server_members"))
					.select("server_id, user_id")
					.eq("server_id", serverId)
					.eq("user_id", userId)
					.maybeSingle();

				if (existing) {
					return { changes: 0 };
				}

				// Insert membership
				const { error: insertError } = await serviceClient
					.from(prefixedTable("server_members"))
					.insert({ server_id: serverId, user_id: userId })
					.select();

				if (insertError) {
					// If already exists (race condition), ignore
					if (insertError.code === '23505') { // Unique violation
						return { changes: 0 };
					}
					throw insertError;
				}

				// Update members_count manually
				const { data: serverData } = await serviceClient
					.from(prefixedTable("servers"))
					.select("members_count")
					.eq("id", serverId)
					.single();

				await serviceClient
					.from(prefixedTable("servers"))
					.update({ members_count: (serverData?.members_count || 0) + 1 })
					.eq("id", serverId);

				return { changes: 1 };
			}
		},
		removeServerMember: {
			run: async (serverId, userId) => {
				const { error } = await serviceClient
					.from(prefixedTable("server_members"))
					.delete()
					.eq("server_id", serverId)
					.eq("user_id", userId);

				if (error) throw error;

				// Update members_count
				const { data: serverData } = await serviceClient
					.from(prefixedTable("servers"))
					.select("members_count")
					.eq("id", serverId)
					.single();

				await serviceClient
					.from(prefixedTable("servers"))
					.update({ members_count: Math.max(0, (serverData?.members_count || 0) - 1) })
					.eq("id", serverId);

				return { changes: 1 };
			}
		},
		insertServer: {
			run: async (userId, name, status, serverUrl, serverConfig = null, authToken = null, description = null) => {
				const resolvedAuthToken = typeof authToken === "string" && authToken.trim()
					? authToken.trim()
					: null;
				const { data, error } = await serviceClient
					.from(prefixedTable("servers"))
					.insert({
						user_id: userId,
						name,
						status,
						server_url: serverUrl,
						server_config: serverConfig,
						auth_token: resolvedAuthToken,
						description
					})
					.select("id")
					.single();
				if (error) throw error;
				return {
					insertId: data.id,
					changes: 1
				};
			}
		},
		selectTemplates: {
			all: async () => {
				// Use serviceClient to bypass RLS for backend operations
				const { data, error } = await serviceClient
					.from(prefixedTable("templates"))
					.select("id, name, category, description, created_at")
					.order("name", { ascending: true });
				if (error) throw error;
				return data ?? [];
			}
		},
		insertCreatedImage: {
			run: async (userId, filename, filePath, width, height, color, status = "creating", meta = null) => {
				// Use serviceClient to bypass RLS for backend operations
				const { data, error } = await serviceClient
					.from(prefixedTable("created_images"))
					.insert({
						user_id: userId,
						filename,
						file_path: filePath,
						width,
						height,
						color,
						status,
						meta
					})
					.select("id")
					.single();
				if (error) throw error;
				return {
					insertId: data.id,
					lastInsertRowid: data.id,
					changes: 1
				};
			}
		},
		updateCreatedImageJobCompleted: {
			run: async (id, userId, { filename, file_path, width, height, color, meta }) => {
				const { data, error } = await serviceClient
					.from(prefixedTable("created_images"))
					.update({
						filename,
						file_path,
						width,
						height,
						color: color ?? null,
						status: "completed",
						meta
					})
					.eq("id", id)
					.eq("user_id", userId)
					.select("id");
				if (error) throw error;
				return { changes: data?.length ?? 0 };
			}
		},
		updateCreatedImageJobFailed: {
			run: async (id, userId, { meta }) => {
				const { data, error } = await serviceClient
					.from(prefixedTable("created_images"))
					.update({
						status: "failed",
						meta
					})
					.eq("id", id)
					.eq("user_id", userId)
					.select("id");
				if (error) throw error;
				return { changes: data?.length ?? 0 };
			}
		},
		resetCreatedImageForRetry: {
			run: async (id, userId, { meta, filename }) => {
				const { data, error } = await serviceClient
					.from(prefixedTable("created_images"))
					.update({
						status: "creating",
						meta,
						filename: filename ?? null,
						file_path: ""
					})
					.eq("id", id)
					.eq("user_id", userId)
					.select("id");
				if (error) throw error;
				return { changes: data?.length ?? 0 };
			}
		},
		updateCreatedImageStatus: {
			run: async (id, userId, status, color = null) => {
				// Use serviceClient to bypass RLS for backend operations
				const updateFields = { status };
				if (color) {
					updateFields.color = color;
				}
				const { data, error } = await serviceClient
					.from(prefixedTable("created_images"))
					.update(updateFields)
					.eq("id", id)
					.eq("user_id", userId)
					.select("id");
				if (error) throw error;
				return { changes: data?.length ?? 0 };
			}
		},
		updateCreatedImageMeta: {
			run: async (id, userId, meta) => {
				const { data, error } = await serviceClient
					.from(prefixedTable("created_images"))
					.update({ meta })
					.eq("id", id)
					.eq("user_id", userId)
					.select("id");
				if (error) throw error;
				return { changes: data?.length ?? 0 };
			}
		},
		selectCreatedImagesForUser: {
			all: async (userId, options = {}) => {
				const includeUnavailable = options?.includeUnavailable === true;
				const limit = Math.min(200, Math.max(1, Number.parseInt(String(options?.limit ?? "50"), 10) || 50));
				const offset = Math.max(0, Number.parseInt(String(options?.offset ?? "0"), 10) || 0);
				let query = serviceClient
					.from(prefixedTable("created_images"))
					.select(
						"id, filename, file_path, width, height, color, status, created_at, published, published_at, title, description, meta, unavailable_at"
					)
					.eq("user_id", userId)
					.order("created_at", { ascending: false });
				if (!includeUnavailable) {
					query = query.is("unavailable_at", null);
				}
				const { data, error } = await query.range(offset, offset + limit - 1);
				if (error) throw error;
				return data ?? [];
			}
		},
		selectPublishedCreatedImagesForUser: {
			all: async (userId, options = {}) => {
				const limit = Math.min(200, Math.max(1, Number.parseInt(String(options?.limit ?? "50"), 10) || 50));
				const offset = Math.max(0, Number.parseInt(String(options?.offset ?? "0"), 10) || 0);
				const { data, error } = await serviceClient
					.from(prefixedTable("created_images"))
					.select(
						"id, filename, file_path, width, height, color, status, created_at, published, published_at, title, description, meta, unavailable_at"
					)
					.eq("user_id", userId)
					.eq("published", true)
					.is("unavailable_at", null)
					.order("created_at", { ascending: false })
					.range(offset, offset + limit - 1);
				if (error) throw error;
				return data ?? [];
			}
		},
		selectPublishedCreationsByPersonalityMention: {
			all: async (personality, options = {}) => {
				const normalized = String(personality || "").trim().toLowerCase();
				if (!/^[a-z0-9][a-z0-9_-]{2,23}$/.test(normalized)) return [];
				const mentionNeedle = `@${normalized}`;
				const limit = Math.min(200, Math.max(1, Number.parseInt(String(options?.limit ?? "50"), 10) || 50));
				const offset = Math.max(0, Number.parseInt(String(options?.offset ?? "0"), 10) || 0);

				const [descriptionRes, titleRes, commentsRes] = await Promise.all([
					serviceClient
						.from(prefixedTable("created_images"))
						.select("id")
						.eq("published", true)
						.is("unavailable_at", null)
						.ilike("description", `%${mentionNeedle}%`)
						.limit(5000),
					serviceClient
						.from(prefixedTable("created_images"))
						.select("id")
						.eq("published", true)
						.is("unavailable_at", null)
						.ilike("title", `%${mentionNeedle}%`)
						.limit(5000),
					serviceClient
						.from(prefixedTable("comments_created_image"))
						.select("created_image_id")
						.ilike("text", `%${mentionNeedle}%`)
						.limit(5000)
				]);
				if (descriptionRes.error) throw descriptionRes.error;
				if (titleRes.error) throw titleRes.error;
				if (commentsRes.error) throw commentsRes.error;

				const idSet = new Set();
				for (const row of descriptionRes.data ?? []) {
					const id = Number(row?.id);
					if (Number.isFinite(id) && id > 0) idSet.add(id);
				}
				for (const row of titleRes.data ?? []) {
					const id = Number(row?.id);
					if (Number.isFinite(id) && id > 0) idSet.add(id);
				}
				for (const row of commentsRes.data ?? []) {
					const id = Number(row?.created_image_id);
					if (Number.isFinite(id) && id > 0) idSet.add(id);
				}
				const ids = Array.from(idSet);
				if (ids.length === 0) return [];

				const { data: images, error: imgError } = await serviceClient
					.from(prefixedTable("created_images"))
					.select("id, filename, file_path, width, height, color, status, created_at, published, published_at, title, description, meta, user_id, unavailable_at")
					.in("id", ids)
					.eq("published", true)
					.is("unavailable_at", null);
				if (imgError) throw imgError;

				return (images ?? [])
					.sort((a, b) => new Date(b?.created_at || 0).getTime() - new Date(a?.created_at || 0).getTime())
					.slice(offset, offset + limit);
			}
		},
		selectPublishedCreationsByTagMention: {
			all: async (tag, options = {}) => {
				const normalized = String(tag || "").trim().toLowerCase();
				if (!/^[a-z0-9][a-z0-9_-]{1,31}$/.test(normalized)) return [];
				const tagNeedle = `#${normalized}`;
				const limit = Math.min(200, Math.max(1, Number.parseInt(String(options?.limit ?? "50"), 10) || 50));
				const offset = Math.max(0, Number.parseInt(String(options?.offset ?? "0"), 10) || 0);

				const [descriptionRes, titleRes, commentsRes] = await Promise.all([
					serviceClient
						.from(prefixedTable("created_images"))
						.select("id")
						.eq("published", true)
						.is("unavailable_at", null)
						.ilike("description", `%${tagNeedle}%`)
						.limit(5000),
					serviceClient
						.from(prefixedTable("created_images"))
						.select("id")
						.eq("published", true)
						.is("unavailable_at", null)
						.ilike("title", `%${tagNeedle}%`)
						.limit(5000),
					serviceClient
						.from(prefixedTable("comments_created_image"))
						.select("created_image_id")
						.ilike("text", `%${tagNeedle}%`)
						.limit(5000)
				]);
				if (descriptionRes.error) throw descriptionRes.error;
				if (titleRes.error) throw titleRes.error;
				if (commentsRes.error) throw commentsRes.error;

				const idSet = new Set();
				for (const row of descriptionRes.data ?? []) {
					const id = Number(row?.id);
					if (Number.isFinite(id) && id > 0) idSet.add(id);
				}
				for (const row of titleRes.data ?? []) {
					const id = Number(row?.id);
					if (Number.isFinite(id) && id > 0) idSet.add(id);
				}
				for (const row of commentsRes.data ?? []) {
					const id = Number(row?.created_image_id);
					if (Number.isFinite(id) && id > 0) idSet.add(id);
				}
				const ids = Array.from(idSet);
				if (ids.length === 0) return [];

				const { data: images, error: imgError } = await serviceClient
					.from(prefixedTable("created_images"))
					.select("id, filename, file_path, width, height, color, status, created_at, published, published_at, title, description, meta, user_id, unavailable_at")
					.in("id", ids)
					.eq("published", true)
					.is("unavailable_at", null);
				if (imgError) throw imgError;

				return (images ?? [])
					.sort((a, b) => new Date(b?.created_at || 0).getTime() - new Date(a?.created_at || 0).getTime())
					.slice(offset, offset + limit);
			}
		},
		selectAllCreatedImageCountForUser: {
			get: async (userId) => {
				const { count, error } = await serviceClient
					.from(prefixedTable("created_images"))
					.select("id", { count: "exact", head: true })
					.eq("user_id", userId)
					.is("unavailable_at", null);
				if (error) throw error;
				return { count: count ?? 0 };
			}
		},
		selectPublishedCreatedImageCountForUser: {
			get: async (userId) => {
				const { count, error } = await serviceClient
					.from(prefixedTable("created_images"))
					.select("id", { count: "exact", head: true })
					.eq("user_id", userId)
					.eq("published", true)
					.is("unavailable_at", null);
				if (error) throw error;
				return { count: count ?? 0 };
			}
		},
		/** Published creations this user has liked (for profile Likes tab). */
		selectCreatedImagesLikedByUser: {
			all: async (userId, options = {}) => {
				const limit = Math.min(200, Math.max(1, Number.parseInt(String(options?.limit ?? "50"), 10) || 50));
				const offset = Math.max(0, Number.parseInt(String(options?.offset ?? "0"), 10) || 0);
				const { data: likeRows, error: likeError } = await serviceClient
					.from(prefixedTable("likes_created_image"))
					.select("created_image_id, created_at")
					.eq("user_id", userId)
					.order("created_at", { ascending: false })
					.range(offset, offset + limit - 1);
				if (likeError) throw likeError;
				const ids = (likeRows ?? []).map((r) => r?.created_image_id).filter((id) => id != null);
				if (ids.length === 0) return [];
				const { data: images, error: imgError } = await serviceClient
					.from(prefixedTable("created_images"))
					.select("id, filename, file_path, width, height, color, status, created_at, published, published_at, title, description, meta, unavailable_at")
					.in("id", ids)
					.eq("published", true)
					.is("unavailable_at", null);
				if (imgError) throw imgError;
				const byId = new Map((images ?? []).map((img) => [String(img.id), img]));
				const orderByLiked = new Map((likeRows ?? []).map((r, i) => [String(r?.created_image_id), r?.created_at ?? ""]));
				return ids
					.map((id) => byId.get(String(id)))
					.filter(Boolean)
					.sort((a, b) => {
						const ta = orderByLiked.get(String(a.id)) ?? a.created_at ?? "";
						const tb = orderByLiked.get(String(b.id)) ?? b.created_at ?? "";
						return String(tb).localeCompare(String(ta));
					});
			}
		},
		/** Comments by this user with creation context and creator/commenter profiles (for profile Comments tab). */
		selectCommentsByUser: {
			all: async (userId, options = {}) => {
				const limitRaw = Number.parseInt(String(options?.limit ?? "50"), 10);
				const limit = Number.isFinite(limitRaw) ? Math.min(200, Math.max(1, limitRaw)) : 50;
				const offset = Math.max(0, Number.parseInt(String(options?.offset ?? "0"), 10) || 0);
				const { data: comments, error: commentsError } = await serviceClient
					.from(prefixedTable("comments_created_image"))
					.select("id, user_id, created_image_id, text, created_at, updated_at")
					.eq("user_id", userId)
					.order("created_at", { ascending: false })
					.range(offset, offset + limit - 1);
				if (commentsError) throw commentsError;
				if (!(comments ?? []).length) return [];
				const imageIds = [...new Set((comments ?? []).map((c) => c?.created_image_id).filter((id) => id != null))];
				const { data: imgs, error: imgError } = await serviceClient
					.from(prefixedTable("created_images"))
					.select("id, title, file_path, created_at, user_id")
					.in("id", imageIds)
					.eq("published", true)
					.is("unavailable_at", null);
				if (imgError) throw imgError;
				const imgById = new Map((imgs ?? []).map((i) => [String(i.id), i]));
				const creatorIds = [...new Set((imgs ?? []).map((i) => i?.user_id).filter((id) => id != null))];
				const commenterIds = [...new Set((comments ?? []).map((c) => c?.user_id).filter((id) => id != null))];
				const allUserIds = [...new Set([...creatorIds, ...commenterIds])];
				let profileByUserId = new Map();
				if (allUserIds.length > 0) {
					const { data: profiles, error: profileError } = await serviceClient
						.from(prefixedTable("user_profiles"))
						.select("user_id, user_name, display_name, avatar_url")
						.in("user_id", allUserIds);
					if (!profileError) {
						profileByUserId = new Map((profiles ?? []).map((p) => [String(p.user_id), p]));
					}
				}
				return (comments ?? []).map((c) => {
					const img = imgById.get(String(c?.created_image_id));
					const creatorId = img?.user_id;
					const commenterId = c?.user_id;
					const creatorProfile = creatorId != null ? profileByUserId.get(String(creatorId)) : null;
					const commenterProfile = commenterId != null ? profileByUserId.get(String(commenterId)) : null;
					return {
						...c,
						created_image_title: img?.title ?? null,
						created_image_url: img?.file_path ?? null,
						created_image_created_at: img?.created_at ?? null,
						created_image_user_id: creatorId ?? null,
						creator_user_name: creatorProfile?.user_name ?? null,
						creator_display_name: creatorProfile?.display_name ?? null,
						creator_avatar_url: creatorProfile?.avatar_url ?? null,
						commenter_user_name: commenterProfile?.user_name ?? null,
						commenter_display_name: commenterProfile?.display_name ?? null,
						commenter_avatar_url: commenterProfile?.avatar_url ?? null
					};
				});
			}
		},
		selectLikesReceivedForUserPublished: {
			get: async (userId) => {
				const { data: images, error: imagesError } = await serviceClient
					.from(prefixedTable("created_images"))
					.select("id")
					.eq("user_id", userId)
					.eq("published", true)
					.is("unavailable_at", null);
				if (imagesError) throw imagesError;
				const ids = (images ?? []).map((row) => row.id).filter((id) => id != null);
				if (ids.length === 0) return { count: 0 };

				const { count, error } = await serviceClient
					.from(prefixedTable("likes_created_image"))
					.select("id", { count: "exact", head: true })
					.in("created_image_id", ids);
				if (error) throw error;
				return { count: count ?? 0 };
			}
		},
		selectCreatedImageById: {
			get: async (id, userId) => {
				const { data, error } = await serviceClient
					.from(prefixedTable("created_images"))
					.select(
						"id, filename, file_path, width, height, color, status, created_at, published, published_at, title, description, user_id, meta, unavailable_at"
					)
					.eq("id", id)
					.eq("user_id", userId)
					.maybeSingle();
				if (error) throw error;
				return data ?? undefined;
			}
		},
		selectCreatedImageByIdAnyUser: {
			get: async (id) => {
				const { data, error } = await serviceClient
					.from(prefixedTable("created_images"))
					.select(
						"id, filename, file_path, width, height, color, status, created_at, published, published_at, title, description, user_id, meta, unavailable_at"
					)
					.eq("id", id)
					.maybeSingle();
				if (error) throw error;
				return data ?? undefined;
			}
		},
		selectCreatedImageByFilename: {
			get: async (filename) => {
				// Use serviceClient to bypass RLS for backend operations
				const { data, error } = await serviceClient
					.from(prefixedTable("created_images"))
					.select(
						"id, filename, file_path, width, height, color, status, created_at, published, published_at, title, description, user_id, meta"
					)
					.eq("filename", filename)
					.maybeSingle();
				if (error) throw error;
				return data ?? undefined;
			}
		},
		/** Direct children: published creations with meta.mutate_of_id = parentId, ordered by created_at asc. */
		selectCreatedImageChildrenByParentId: {
			all: async (parentId) => {
				const id = Number(parentId);
				if (!Number.isFinite(id) || id <= 0) return [];
				const { data, error } = await serviceClient
					.from(prefixedTable("created_images"))
					.select("id, filename, file_path, title, created_at, status")
					.eq("published", true)
					.is("unavailable_at", null)
					.contains("meta", { mutate_of_id: id })
					.order("created_at", { ascending: true });
				if (error) throw error;
				return data ?? [];
			}
		},
		// Anonymous (try) creations (no anon_cid or color; try_requests links requesters to images)
		insertCreatedImageAnon: {
			run: async (prompt, filename, filePath, width, height, status, meta) => {
				const metaVal = typeof meta === "object" && meta !== null ? meta : meta == null ? null : meta;
				const { data, error } = await serviceClient
					.from(prefixedTable("created_images_anon"))
					.insert({
						prompt: prompt ?? null,
						filename,
						file_path: filePath,
						width,
						height,
						status,
						meta: metaVal
					})
					.select("id")
					.single();
				if (error) throw error;
				return Promise.resolve({ insertId: data?.id, changes: data ? 1 : 0 });
			}
		},
		selectCreatedImageAnonById: {
			get: async (id) => {
				const { data, error } = await serviceClient
					.from(prefixedTable("created_images_anon"))
					.select("id, prompt, filename, file_path, width, height, status, created_at, meta")
					.eq("id", id)
					.maybeSingle();
				if (error) throw error;
				return data ?? undefined;
			}
		},
		selectCreatedImagesAnonByIds: {
			all: async (ids) => {
				const safeIds = Array.isArray(ids)
					? ids.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)
					: [];
				if (safeIds.length === 0) return [];
				const { data, error } = await serviceClient
					.from(prefixedTable("created_images_anon"))
					.select("id, prompt, filename, file_path, width, height, status, created_at, meta")
					.in("id", safeIds);
				if (error) throw error;
				return Array.isArray(data) ? data : [];
			}
		},
		/** Up to limit recent completed rows for this prompt, for cache reuse. sinceIso = created_at >= this (e.g. 24h ago). */
		selectRecentCompletedCreatedImageAnonByPrompt: {
			all: async (prompt, sinceIso, limit = 5) => {
				if (prompt == null || String(prompt).trim() === "") return [];
				const safeLimit = Math.min(Math.max(Number(limit) || 5, 1), 20);
				const { data, error } = await serviceClient
					.from(prefixedTable("created_images_anon"))
					.select("id, prompt, filename, file_path, width, height, status, created_at, meta")
					.eq("prompt", String(prompt).trim())
					.eq("status", "completed")
					.gte("created_at", sinceIso)
					.order("created_at", { ascending: false })
					.limit(safeLimit);
				if (error) throw error;
				return Array.isArray(data) ? data : [];
			}
		},
		selectCreatedImageAnonByFilename: {
			get: async (filename) => {
				if (!filename || typeof filename !== "string" || filename.includes("..") || filename.includes("/"))
					return undefined;
				const { data, error } = await serviceClient
					.from(prefixedTable("created_images_anon"))
					.select("id, prompt, filename, file_path, width, height, status, created_at, meta")
					.eq("filename", filename.trim())
					.order("id", { ascending: false })
					.limit(1)
					.maybeSingle();
				if (error) throw error;
				return data ?? undefined;
			}
		},
		countCreatedImagesAnonByFilename: {
			get: async (filename) => {
				if (!filename || typeof filename !== "string" || filename.includes("..") || filename.includes("/"))
					return { count: 0 };
				const { count, error } = await serviceClient
					.from(prefixedTable("created_images_anon"))
					.select("id", { count: "exact", head: true })
					.eq("filename", filename.trim());
				if (error) throw error;
				return { count: count ?? 0 };
			}
		},
		updateTryRequestsNullAnonId: {
			run: async (createdImageAnonId) => {
				const id = Number(createdImageAnonId);
				const { error } = await serviceClient
					.from(prefixedTable("try_requests"))
					.update({ created_image_anon_id: null })
					.eq("created_image_anon_id", id);
				if (error) throw error;
				return Promise.resolve({ changes: 1 });
			}
		},
		updateTryRequestsTransitionedByCreatedImageAnonId: {
			run: async (createdImageAnonId, { userId, createdImageId }) => {
				const id = Number(createdImageAnonId);
				const { data: rows, error: selectErr } = await serviceClient
					.from(prefixedTable("try_requests"))
					.select("id, meta")
					.eq("created_image_anon_id", id);
				if (selectErr) throw selectErr;
				const at = new Date().toISOString();
				const transitioned = { at, user_id: Number(userId), created_image_id: Number(createdImageId) };
				for (const row of rows ?? []) {
					const meta = typeof row.meta === "object" && row.meta !== null ? { ...row.meta, transitioned } : { transitioned };
					const { error } = await serviceClient
						.from(prefixedTable("try_requests"))
						.update({ created_image_anon_id: null, meta })
						.eq("id", row.id);
					if (error) throw error;
				}
				return Promise.resolve({ changes: (rows ?? []).length });
			}
		},
		deleteCreatedImageAnon: {
			run: async (id) => {
				const { error } = await serviceClient
					.from(prefixedTable("created_images_anon"))
					.delete()
					.eq("id", Number(id));
				if (error) throw error;
				return Promise.resolve({ changes: 1 });
			}
		},
		selectTryRequestByCidAndPrompt: {
			get: async (anonCid, prompt) => {
				if (prompt == null || String(prompt).trim() === "") return undefined;
				const { data, error } = await serviceClient
					.from(prefixedTable("try_requests"))
					.select("id, anon_cid, prompt, created_at, fulfilled_at, created_image_anon_id")
					.eq("anon_cid", anonCid)
					.eq("prompt", String(prompt).trim())
					.order("created_at", { ascending: false })
					.limit(1);
				if (error) throw error;
				const row = Array.isArray(data) && data.length > 0 ? data[0] : null;
				return row ?? undefined;
			}
		},
		selectTryRequestsByCid: {
			all: async (anonCid) => {
				const { data, error } = await serviceClient
					.from(prefixedTable("try_requests"))
					.select("id, anon_cid, prompt, created_at, fulfilled_at, created_image_anon_id")
					.eq("anon_cid", anonCid)
					.order("created_at", { ascending: false });
				if (error) throw error;
				return data ?? [];
			}
		},
		/** Unique anon_cids from try_requests with request count; excludes __pool__. Order by last_request_at desc. */
		selectTryRequestAnonCidsWithCount: {
			all: async () => {
				const { data, error } = await serviceClient
					.from(prefixedTable("try_requests"))
					.select("anon_cid, created_at")
					.neq("anon_cid", "__pool__");
				if (error) throw error;
				const rows = data ?? [];
				const byCid = new Map();
				for (const r of rows) {
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
				const { data, error } = await serviceClient
					.from(prefixedTable("try_requests"))
					.select("anon_cid, meta")
					.is("created_image_anon_id", null)
					.not("meta", "is", null);
				if (error) throw error;
				return (data ?? []).filter((r) => r.meta != null && typeof r.meta === "object" && r.meta.transitioned != null);
			}
		},
		updateCreatedImageAnonJobCompleted: {
			run: async (id, { filename, file_path, width, height, meta }) => {
				const metaVal = typeof meta === "object" && meta !== null ? meta : meta == null ? null : meta;
				const { error } = await serviceClient
					.from(prefixedTable("created_images_anon"))
					.update({
						filename,
						file_path: file_path,
						width,
						height,
						status: "completed",
						meta: metaVal
					})
					.eq("id", id);
				if (error) throw error;
				return Promise.resolve({ changes: 1 });
			}
		},
		updateCreatedImageAnonJobFailed: {
			run: async (id, { meta }) => {
				const metaVal = typeof meta === "object" && meta !== null ? meta : meta == null ? null : meta;
				const { error } = await serviceClient
					.from(prefixedTable("created_images_anon"))
					.update({ status: "failed", meta: metaVal })
					.eq("id", id);
				if (error) throw error;
				return Promise.resolve({ changes: 1 });
			}
		},
		insertTryRequest: {
			run: async (anonCid, prompt, created_image_anon_id, fulfilled_at = null, meta = null) => {
				const metaVal = typeof meta === "object" && meta !== null ? meta : meta == null ? null : meta;
				const { error } = await serviceClient
					.from(prefixedTable("try_requests"))
					.insert({
						anon_cid: anonCid,
						prompt: prompt ?? null,
						created_image_anon_id,
						fulfilled_at: fulfilled_at ?? null,
						meta: metaVal,
					});
				if (error) throw error;
				return Promise.resolve({ changes: 1 });
			}
		},
		updateTryRequestFulfilledByCreatedImageAnonId: {
			run: async (created_image_anon_id, fulfilled_at_iso) => {
				const { error } = await serviceClient
					.from(prefixedTable("try_requests"))
					.update({ fulfilled_at: fulfilled_at_iso })
					.eq("created_image_anon_id", created_image_anon_id)
					.is("fulfilled_at", null);
				if (error) throw error;
				return Promise.resolve({ changes: 1 });
			}
		},
		selectCreatedImageDescriptionAndMetaByIds: {
			all: async (ids) => {
				const safeIds = Array.isArray(ids)
					? ids.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)
					: [];
				if (safeIds.length === 0) return [];
				const { data, error } = await serviceClient
					.from(prefixedTable("created_images"))
					.select("id, description, meta")
					.in("id", safeIds);
				if (error) throw error;
				return data ?? [];
			}
		},
		selectAllCreatedImageIdAndMeta: {
			all: async () => {
				const { data, error } = await serviceClient
					.from(prefixedTable("created_images"))
					.select("id, meta");
				if (error) throw error;
				return data ?? [];
			}
		},
		selectFeedItemsByCreationIds: {
			all: async (ids) => {
				const safeIds = Array.isArray(ids)
					? ids.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)
					: [];
				if (safeIds.length === 0) return [];
				// prsn_created_images has title, description (no summary column); use description for summary
				const { data: images, error: imgError } = await serviceClient
					.from(prefixedTable("created_images"))
					.select("id, title, description, created_at, user_id, filename, file_path")
					.in("id", safeIds);
				if (imgError) throw imgError;
				const orderById = new Map(safeIds.map((id, i) => [Number(id), i]));
				const sorted = (images ?? []).slice().sort((a, b) => (orderById.get(Number(a.id)) ?? 999) - (orderById.get(Number(b.id)) ?? 999));
				const createdImageIds = sorted.map((r) => r.id).filter((id) => id != null);
				if (createdImageIds.length === 0) return [];
				const { data: countRows, error: countError } = await serviceClient
					.from(prefixedTable("created_image_like_counts"))
					.select("created_image_id, like_count")
					.in("created_image_id", createdImageIds);
				if (countError) throw countError;
				const likeById = new Map((countRows ?? []).map((r) => [String(r.created_image_id), Number(r.like_count ?? 0)]));
				const { data: commentRows, error: commentError } = await serviceClient
					.from(prefixedTable("created_image_comment_counts"))
					.select("created_image_id, comment_count")
					.in("created_image_id", createdImageIds);
				if (commentError) throw commentError;
				const commentById = new Map((commentRows ?? []).map((r) => [String(r.created_image_id), Number(r.comment_count ?? 0)]));
				const authorIds = [...new Set(sorted.map((r) => r.user_id).filter(Boolean))];
				let profileByUserId = new Map();
				if (authorIds.length > 0) {
					const { data: profileRows, error: profileError } = await serviceClient
						.from(prefixedTable("user_profiles"))
						.select("user_id, user_name, display_name")
						.in("user_id", authorIds);
					if (!profileError && profileRows) {
						profileByUserId = new Map(profileRows.map((r) => [String(r.user_id), r]));
					}
				}
				return sorted.map((row) => {
					const key = String(row.id);
					const profile = row.user_id != null ? profileByUserId.get(String(row.user_id)) : null;
					const url =
						row.file_path ??
						(row.filename
							? `/api/images/created/${row.filename}`
							: null);
					return {
						id: row.id,
						created_image_id: row.id,
						title: row.title ?? "",
						summary: row.description ?? "",
						created_at: row.created_at,
						user_id: row.user_id,
						like_count: likeById.get(key) ?? 0,
						comment_count: commentById.get(key) ?? 0,
						author_display_name: profile?.display_name ?? null,
						author_user_name: profile?.user_name ?? null,
						author_avatar_url: profile?.avatar_url ?? null,
						url
					};
				});
			}
		},
		insertCreatedImageLike: {
			run: async (userId, createdImageId) => {
				// Use serviceClient to bypass RLS for backend operations
				const { data, error } = await serviceClient
					.from(prefixedTable("likes_created_image"))
					.upsert(
						{ user_id: userId, created_image_id: createdImageId },
						{ onConflict: "user_id,created_image_id", ignoreDuplicates: true }
					)
					.select("id");
				if (error) throw error;
				return { changes: data?.length ?? 0 };
			}
		},
		deleteCreatedImageLike: {
			run: async (userId, createdImageId) => {
				const { data, error } = await serviceClient
					.from(prefixedTable("likes_created_image"))
					.delete()
					.eq("user_id", userId)
					.eq("created_image_id", createdImageId)
					.select("id");
				if (error) throw error;
				return { changes: data?.length ?? 0 };
			}
		},
		selectCreatedImageLikeCount: {
			get: async (createdImageId) => {
				const { data, error } = await serviceClient
					.from(prefixedTable("created_image_like_counts"))
					.select("created_image_id, like_count")
					.eq("created_image_id", createdImageId)
					.maybeSingle();
				if (error) throw error;
				return { like_count: Number(data?.like_count ?? 0) };
			}
		},
		selectCreatedImageViewerLiked: {
			get: async (userId, createdImageId) => {
				const { data, error } = await serviceClient
					.from(prefixedTable("likes_created_image"))
					.select("id")
					.eq("user_id", userId)
					.eq("created_image_id", createdImageId)
					.maybeSingle();
				if (error) throw error;
				return data ? { viewer_liked: 1 } : undefined;
			}
		},
		selectViewerLikedCreationIds: {
			all: async (userId, creationIds) => {
				const safeIds = Array.isArray(creationIds)
					? creationIds.map((id) => Number(id)).filter((n) => Number.isFinite(n) && n > 0)
					: [];
				if (safeIds.length === 0) return [];
				const { data, error } = await serviceClient
					.from(prefixedTable("likes_created_image"))
					.select("created_image_id")
					.eq("user_id", userId)
					.in("created_image_id", safeIds);
				if (error) throw error;
				return (data ?? []).map((r) => Number(r.created_image_id));
			}
		},
		insertCreatedImageComment: {
			run: async (userId, createdImageId, text) => {
				const { data, error } = await serviceClient
					.from(prefixedTable("comments_created_image"))
					.insert({
						user_id: userId,
						created_image_id: createdImageId,
						text
					})
					.select("id, user_id, created_image_id, text, created_at, updated_at")
					.single();
				if (error) throw error;

				let profile = null;
				if (userId !== null && userId !== undefined) {
					const { data: profileRow, error: profileError } = await serviceClient
						.from(prefixedTable("user_profiles"))
						.select("user_id, user_name, display_name, avatar_url")
						.eq("user_id", userId)
						.maybeSingle();
					if (profileError) throw profileError;
					profile = profileRow ?? null;
				}

				return {
					...data,
					user_name: profile?.user_name ?? null,
					display_name: profile?.display_name ?? null,
					avatar_url: profile?.avatar_url ?? null
				};
			}
		},
		selectCreatedImageCommenterUserIdsDistinct: {
			all: async (createdImageId) => {
				const { data, error } = await serviceClient
					.from(prefixedTable("comments_created_image"))
					.select("user_id")
					.eq("created_image_id", createdImageId);
				if (error) throw error;
				return Array.from(new Set(
					(data ?? [])
						.map((row) => row?.user_id)
						.filter((id) => id !== null && id !== undefined)
						.map((id) => Number(id))
						.filter((id) => Number.isFinite(id) && id > 0)
				));
			}
		},
		selectCreatedImageComments: {
			all: async (createdImageId, options = {}) => {
				const order = String(options?.order || "asc").toLowerCase() === "desc" ? "desc" : "asc";
				const limitRaw = Number.parseInt(String(options?.limit ?? "50"), 10);
				const offsetRaw = Number.parseInt(String(options?.offset ?? "0"), 10);
				const limit = Number.isFinite(limitRaw) ? Math.min(200, Math.max(1, limitRaw)) : 50;
				const offset = Number.isFinite(offsetRaw) ? Math.max(0, offsetRaw) : 0;

				let q = serviceClient
					.from(prefixedTable("comments_created_image"))
					.select("id, user_id, created_image_id, text, created_at, updated_at")
					.eq("created_image_id", createdImageId)
					.order("created_at", { ascending: order === "asc" });

				// Use range() for offset/limit paging.
				q = q.range(offset, offset + limit - 1);

				const { data, error } = await q;
				if (error) throw error;
				const comments = data ?? [];

				const userIds = Array.from(new Set(
					comments
						.map((row) => row?.user_id)
						.filter((id) => id !== null && id !== undefined)
						.map((id) => Number(id))
						.filter((id) => Number.isFinite(id) && id > 0)
				));

				let profileByUserId = new Map();
				let planByUserId = new Map();
				if (userIds.length > 0) {
					const [profileRes, usersRes] = await Promise.all([
						serviceClient
							.from(prefixedTable("user_profiles"))
							.select("user_id, user_name, display_name, avatar_url")
							.in("user_id", userIds),
						serviceClient
							.from(prefixedTable("users"))
							.select("id, meta")
							.in("id", userIds)
					]);
					if (profileRes.error) throw profileRes.error;
					if (usersRes.error) throw usersRes.error;
					profileByUserId = new Map(
						(profileRes.data ?? []).map((row) => [String(row.user_id), row])
					);
					planByUserId = new Map(
						(usersRes.data ?? []).map((row) => [
							String(row.id),
							row?.meta?.plan === "founder" ? "founder" : "free"
						])
					);
				}

				return comments.map((row) => {
					const profile = row?.user_id !== null && row?.user_id !== undefined
						? profileByUserId.get(String(row.user_id)) ?? null
						: null;
					const plan = row?.user_id != null ? (planByUserId.get(String(row.user_id)) ?? "free") : "free";
					return {
						...row,
						user_name: profile?.user_name ?? null,
						display_name: profile?.display_name ?? null,
						avatar_url: profile?.avatar_url ?? null,
						plan
					};
				});
			}
		},
		selectCreatedImageTips: {
			all: async (createdImageId, options = {}) => {
				const order = String(options?.order || "asc").toLowerCase() === "desc" ? "desc" : "asc";
				const limitRaw = Number.parseInt(String(options?.limit ?? "50"), 10);
				const offsetRaw = Number.parseInt(String(options?.offset ?? "0"), 10);
				const limit = Number.isFinite(limitRaw) ? Math.min(200, Math.max(1, limitRaw)) : 50;
				const offset = Number.isFinite(offsetRaw) ? Math.max(0, offsetRaw) : 0;

				let q = serviceClient
					.from(prefixedTable("tip_activity"))
					.select("id, from_user_id, created_image_id, amount, message, source, meta, created_at, updated_at")
					.eq("created_image_id", createdImageId)
					.order("created_at", { ascending: order === "asc" });

				q = q.range(offset, offset + limit - 1);

				const { data, error } = await q;
				if (error) throw error;
				const tips = data ?? [];

				const userIds = Array.from(new Set(
					tips
						.map((row) => row?.from_user_id)
						.filter((id) => id !== null && id !== undefined)
						.map((id) => Number(id))
						.filter((id) => Number.isFinite(id) && id > 0)
				));

				let profileByUserId = new Map();
				let planByUserId = new Map();
				if (userIds.length > 0) {
					const [profileRes, usersRes] = await Promise.all([
						serviceClient
							.from(prefixedTable("user_profiles"))
							.select("user_id, user_name, display_name, avatar_url")
							.in("user_id", userIds),
						serviceClient
							.from(prefixedTable("users"))
							.select("id, meta")
							.in("id", userIds)
					]);
					if (profileRes.error) throw profileRes.error;
					if (usersRes.error) throw usersRes.error;
					profileByUserId = new Map(
						(profileRes.data ?? []).map((row) => [String(row.user_id), row])
					);
					planByUserId = new Map(
						(usersRes.data ?? []).map((row) => [
							String(row.id),
							row?.meta?.plan === "founder" ? "founder" : "free"
						])
					);
				}

				return tips.map((row) => {
					const profile = row?.from_user_id !== null && row?.from_user_id !== undefined
						? profileByUserId.get(String(row.from_user_id)) ?? null
						: null;
					const plan = row?.from_user_id != null ? (planByUserId.get(String(row.from_user_id)) ?? "free") : "free";
					return {
						id: row.id,
						user_id: row.from_user_id,
						created_image_id: row.created_image_id,
						amount: row.amount,
						message: row.message,
						source: row.source,
						meta: row.meta,
						created_at: row.created_at,
						updated_at: row.updated_at,
						user_name: profile?.user_name ?? null,
						display_name: profile?.display_name ?? null,
						avatar_url: profile?.avatar_url ?? null,
						plan
					};
				});
			}
		},
		selectLatestCreatedImageComments: {
			all: async (options = {}) => {
				const limitRaw = Number.parseInt(String(options?.limit ?? "10"), 10);
				const limit = Number.isFinite(limitRaw) ? Math.min(200, Math.max(1, limitRaw)) : 10;

				// Over-fetch a bit so filtering unpublished creations still returns enough rows.
				const fetchLimit = Math.min(200, Math.max(10, limit * 5));

				const { data: rawComments, error: commentsError } = await serviceClient
					.from(prefixedTable("comments_created_image"))
					.select("id, user_id, created_image_id, text, created_at, updated_at")
					.order("created_at", { ascending: false })
					.limit(fetchLimit);
				if (commentsError) throw commentsError;

				const comments = rawComments ?? [];

				const createdImageIds = Array.from(new Set(
					comments
						.map((row) => row?.created_image_id)
						.filter((id) => id !== null && id !== undefined)
						.map((id) => Number(id))
						.filter((id) => Number.isFinite(id) && id > 0)
				));

				let imageById = new Map();
				if (createdImageIds.length > 0) {
					const { data: imageRows, error: imageError } = await serviceClient
						.from(prefixedTable("created_images"))
						.select("id, title, published, user_id, file_path, created_at")
						.in("id", createdImageIds);
					if (imageError) throw imageError;
					imageById = new Map((imageRows ?? []).map((row) => [String(row.id), row]));
				}

				const creatorUserIds = Array.from(new Set(
					Array.from(imageById.values())
						.map((row) => row?.user_id)
						.filter((id) => id !== null && id !== undefined)
						.map((id) => Number(id))
						.filter((id) => Number.isFinite(id) && id > 0)
				));

				let creatorProfileByUserId = new Map();
				if (creatorUserIds.length > 0) {
					const { data: creatorProfiles, error: creatorProfileError } = await serviceClient
						.from(prefixedTable("user_profiles"))
						.select("user_id, user_name, display_name, avatar_url")
						.in("user_id", creatorUserIds);
					if (creatorProfileError) throw creatorProfileError;
					creatorProfileByUserId = new Map(
						(creatorProfiles ?? []).map((row) => [String(row.user_id), row])
					);
				}

				const visibleComments = comments
					.map((row) => {
						const image = row?.created_image_id !== null && row?.created_image_id !== undefined
							? imageById.get(String(row.created_image_id)) ?? null
							: null;
						const creatorProfile = image?.user_id !== null && image?.user_id !== undefined
							? creatorProfileByUserId.get(String(image.user_id)) ?? null
							: null;
						return {
							...row,
							created_image_title: image?.title ?? null,
							created_image_url: image?.file_path ?? null,
							created_image_created_at: image?.created_at ?? null,
							created_image_published: image?.published ?? null,
							created_image_user_id: image?.user_id ?? null,
							created_image_user_name: creatorProfile?.user_name ?? null,
							created_image_display_name: creatorProfile?.display_name ?? null,
							created_image_avatar_url: creatorProfile?.avatar_url ?? null
						};
					})
					.filter((row) => row?.created_image_published === true);

				const trimmed = visibleComments.slice(0, limit);

				const userIds = Array.from(new Set(
					trimmed
						.map((row) => row?.user_id)
						.filter((id) => id !== null && id !== undefined)
						.map((id) => Number(id))
						.filter((id) => Number.isFinite(id) && id > 0)
				));

				const creatorUserIdsForPlan = Array.from(new Set(
					trimmed
						.map((row) => row?.created_image_user_id)
						.filter((id) => id !== null && id !== undefined)
						.map((id) => Number(id))
						.filter((id) => Number.isFinite(id) && id > 0)
				));

				const allUserIds = Array.from(new Set([...userIds, ...creatorUserIdsForPlan]));

				let profileByUserId = new Map();
				if (userIds.length > 0) {
					const { data: profileRows, error: profileError } = await serviceClient
						.from(prefixedTable("user_profiles"))
						.select("user_id, user_name, display_name, avatar_url")
						.in("user_id", userIds);
					if (profileError) throw profileError;
					profileByUserId = new Map(
						(profileRows ?? []).map((row) => [String(row.user_id), row])
					);
				}

				let planByUserId = new Map();
				if (allUserIds.length > 0) {
					const { data: userRows, error: userError } = await serviceClient
						.from(prefixedTable("users"))
						.select("id, meta")
						.in("id", allUserIds);
					if (userError) throw userError;
					planByUserId = new Map(
						(userRows ?? []).map((r) => [
							String(r.id),
							r?.meta?.plan === "founder" ? "founder" : "free"
						])
					);
				}

				return trimmed.map((row) => {
					const profile = row?.user_id !== null && row?.user_id !== undefined
						? profileByUserId.get(String(row.user_id)) ?? null
						: null;
					const plan = row?.user_id != null ? (planByUserId.get(String(row.user_id)) ?? "free") : "free";
					const created_image_owner_plan = row?.created_image_user_id != null
						? (planByUserId.get(String(row.created_image_user_id)) ?? "free")
						: "free";
					return {
						...row,
						user_name: profile?.user_name ?? null,
						display_name: profile?.display_name ?? null,
						avatar_url: profile?.avatar_url ?? null,
						plan,
						created_image_owner_plan
					};
				});
			}
		},
		selectCreatedImageCommentCount: {
			get: async (createdImageId) => {
				const { data, error } = await serviceClient
					.from(prefixedTable("created_image_comment_counts"))
					.select("created_image_id, comment_count")
					.eq("created_image_id", createdImageId)
					.maybeSingle();
				if (error) throw error;
				return { comment_count: Number(data?.comment_count ?? 0) };
			}
		},
		publishCreatedImage: {
			run: async (id, userId, title, description, isAdmin = false) => {
				// Use serviceClient to bypass RLS for backend operations
				const query = serviceClient
					.from(prefixedTable("created_images"))
					.update({
						published: true,
						published_at: new Date().toISOString(),
						title,
						description
					})
					.eq("id", id);

				if (!isAdmin) {
					query.eq("user_id", userId);
				}

				const { data, error } = await query.select("id");
				if (error) throw error;
				return { changes: data?.length ?? 0 };
			}
		},
		markCreatedImageUnavailable: {
			run: async (id, userId) => {
				const { data, error } = await serviceClient
					.from(prefixedTable("created_images"))
					.update({ unavailable_at: new Date().toISOString() })
					.eq("id", id)
					.eq("user_id", userId)
					.select("id");
				if (error) throw error;
				return { changes: data?.length ?? 0 };
			}
		},
		deleteCreatedImageById: {
			run: async (id, userId) => {
				const { data, error } = await serviceClient
					.from(prefixedTable("created_images"))
					.delete()
					.eq("id", id)
					.eq("user_id", userId)
					.select("id");
				if (error) throw error;
				return { changes: data?.length ?? 0 };
			}
		},
		insertFeedItem: {
			run: async (title, summary, author, tags, createdImageId) => {
				// Use serviceClient to bypass RLS for backend operations
				const { data, error } = await serviceClient
					.from(prefixedTable("feed_items"))
					.insert({
						title,
						summary,
						author,
						tags: tags || null,
						created_image_id: createdImageId || null
					})
					.select("id")
					.single();
				if (error) throw error;
				return {
					insertId: data.id,
					lastInsertRowid: data.id,
					changes: 1
				};
			}
		},
		selectFeedItemByCreatedImageId: {
			get: async (createdImageId) => {
				const { data, error } = await serviceClient
					.from(prefixedTable("feed_items"))
					.select("id, title, summary, author, tags, created_at, created_image_id")
					.eq("created_image_id", createdImageId)
					.order("created_at", { ascending: false })
					.limit(1)
					.maybeSingle();
				if (error) throw error;
				return data ?? undefined;
			}
		},
		updateCreatedImage: {
			run: async (id, userId, title, description, isAdmin = false) => {
				// Use serviceClient to bypass RLS for backend operations
				// Admin can update any image, owner can only update their own
				const query = serviceClient
					.from(prefixedTable("created_images"))
					.update({
						title,
						description
					})
					.eq("id", id);

				if (!isAdmin) {
					query.eq("user_id", userId);
				}

				const { data, error } = await query.select("id");
				if (error) throw error;
				return { changes: data?.length ?? 0 };
			}
		},
		unpublishCreatedImage: {
			run: async (id, userId, isAdmin = false) => {
				// Use serviceClient to bypass RLS for backend operations
				// Admin can unpublish any image, owner can only unpublish their own
				const query = serviceClient
					.from(prefixedTable("created_images"))
					.update({
						published: false,
						published_at: null
					})
					.eq("id", id);

				if (!isAdmin) {
					query.eq("user_id", userId);
				}

				const { data, error } = await query.select("id");
				if (error) throw error;
				return { changes: data?.length ?? 0 };
			}
		},
		updateFeedItem: {
			run: async (createdImageId, title, summary) => {
				// Use serviceClient to bypass RLS for backend operations
				const { data, error } = await serviceClient
					.from(prefixedTable("feed_items"))
					.update({
						title,
						summary
					})
					.eq("created_image_id", createdImageId)
					.select("id");
				if (error) throw error;
				return { changes: data?.length ?? 0 };
			}
		},
		deleteFeedItemByCreatedImageId: {
			run: async (createdImageId) => {
				// Use serviceClient to bypass RLS for backend operations
				const { data, error } = await serviceClient
					.from(prefixedTable("feed_items"))
					.delete()
					.eq("created_image_id", createdImageId)
					.select("id");
				if (error) throw error;
				return { changes: data?.length ?? 0 };
			}
		},
		deleteAllLikesForCreatedImage: {
			run: async (createdImageId) => {
				// Use serviceClient to bypass RLS for backend operations
				const { data, error } = await serviceClient
					.from(prefixedTable("likes_created_image"))
					.delete()
					.eq("created_image_id", createdImageId)
					.select("id");
				if (error) throw error;
				return { changes: data?.length ?? 0 };
			}
		},
		deleteAllCommentsForCreatedImage: {
			run: async (createdImageId) => {
				// Use serviceClient to bypass RLS for backend operations
				const { data, error } = await serviceClient
					.from(prefixedTable("comments_created_image"))
					.delete()
					.eq("created_image_id", createdImageId)
					.select("id");
				if (error) throw error;
				return { changes: data?.length ?? 0 };
			}
		},
		selectUserCredits: {
			get: async (userId) => {
				// Use serviceClient to bypass RLS for backend operations
				const { data, error } = await serviceClient
					.from(prefixedTable("user_credits"))
					.select("id, user_id, balance, last_daily_claim_at, created_at, updated_at")
					.eq("user_id", userId)
					.maybeSingle();
				if (error) throw error;
				return data ?? undefined;
			}
		},
		insertUserCredits: {
			run: async (userId, balance, lastDailyClaimAt) => {
				// Use serviceClient to bypass RLS for backend operations
				const { data, error } = await serviceClient
					.from(prefixedTable("user_credits"))
					.insert({
						user_id: userId,
						balance,
						last_daily_claim_at: lastDailyClaimAt || null
					})
					.select("id")
					.single();
				if (error) throw error;
				return {
					insertId: data.id,
					lastInsertRowid: data.id,
					changes: 1
				};
			}
		},
		updateUserCreditsBalance: {
			run: async (userId, amount) => {
				// Use serviceClient to bypass RLS for backend operations
				// First get current balance
				const { data: current, error: selectError } = await serviceClient
					.from(prefixedTable("user_credits"))
					.select("balance")
					.eq("user_id", userId)
					.single();

				if (selectError && selectError.code !== 'PGRST116') throw selectError;

				const newBalance = (current?.balance ?? 0) + amount;

				// Prevent negative credits - ensure balance never goes below 0
				const finalBalance = Math.max(0, newBalance);

				const { data, error } = await serviceClient
					.from(prefixedTable("user_credits"))
					.update({
						balance: finalBalance,
						updated_at: new Date().toISOString()
					})
					.eq("user_id", userId)
					.select("id");

				if (error) throw error;
				return { changes: data?.length ?? 0 };
			}
		},
		insertTipActivity: {
			run: async (fromUserId, toUserId, createdImageId, amount, message, source, meta) => {
				const payload = {
					from_user_id: fromUserId,
					to_user_id: toUserId,
					created_image_id: createdImageId || null,
					amount,
					message: message ?? null,
					source: source ?? null,
					meta: meta ?? null
				};
				const { data, error } = await serviceClient
					.from(prefixedTable("tip_activity"))
					.insert(payload)
					.select("id")
					.single();
				if (error) throw error;
				return {
					insertId: data.id,
					lastInsertRowid: data.id,
					changes: 1
				};
			}
		},
		claimDailyCredits: {
			run: async (userId, amount = 10) => {
				// Use serviceClient to bypass RLS for backend operations
				// Get current credits record
				const { data: credits, error: selectError } = await serviceClient
					.from(prefixedTable("user_credits"))
					.select("id, balance, last_daily_claim_at")
					.eq("user_id", userId)
					.maybeSingle();

				if (selectError) throw selectError;

				if (!credits) {
					// No credits record exists, create one with the daily amount
					const { data: newCredits, error: insertError } = await serviceClient
						.from(prefixedTable("user_credits"))
						.insert({
							user_id: userId,
							balance: amount,
							last_daily_claim_at: new Date().toISOString()
						})
						.select("balance")
						.single();

					if (insertError) throw insertError;
					return {
						success: true,
						balance: newCredits.balance,
						changes: 1
					};
				}

				// Check if already claimed today (UTC)
				const now = new Date();
				const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

				if (credits.last_daily_claim_at) {
					const lastClaimDate = new Date(credits.last_daily_claim_at);
					const lastClaimUTC = new Date(Date.UTC(lastClaimDate.getUTCFullYear(), lastClaimDate.getUTCMonth(), lastClaimDate.getUTCDate()));

					if (lastClaimUTC.getTime() >= todayUTC.getTime()) {
						// Already claimed today
						return {
							success: false,
							balance: credits.balance,
							changes: 0,
							message: 'Daily credits already claimed today'
						};
					}
				}

				// Update balance and last claim date
				const newBalance = credits.balance + amount;
				const { data: updated, error: updateError } = await serviceClient
					.from(prefixedTable("user_credits"))
					.update({
						balance: newBalance,
						last_daily_claim_at: new Date().toISOString(),
						updated_at: new Date().toISOString()
					})
					.eq("user_id", userId)
					.select("balance")
					.single();

				if (updateError) throw updateError;

				return {
					success: true,
					balance: updated.balance,
					changes: 1
				};
			}
		},
		transferCredits: {
			run: async (fromUserId, toUserId, amount) => {
				const { data, error } = await serviceClient.rpc("prsn_transfer_credits", {
					from_user_id: fromUserId,
					to_user_id: toUserId,
					amount
				});
				if (error) throw error;
				// RPC returns a single-row table; PostgREST exposes it as an array
				const row = Array.isArray(data) ? data[0] : data;
				return row || null;
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

				// Collect created image ids for user to clean up feed/likes/comments referencing them.
				const { data: images, error: imgErr } = await serviceClient
					.from(prefixedTable("created_images"))
					.select("id")
					.eq("user_id", userId);
				if (imgErr) throw imgErr;
				const imageIds = (Array.isArray(images) ? images : [])
					.map((row) => Number(row?.id))
					.filter((id) => Number.isFinite(id) && id > 0);

				const changes = {};

				const deleteByEq = async ({ table, column, value, selectColumns = "id" }) => {
					const { data, error } = await serviceClient
						.from(prefixedTable(table))
						.delete()
						.eq(column, value)
						.select(selectColumns);
					if (error) throw error;
					return data?.length ?? 0;
				};

				const deleteByOr = async ({ table, or, selectColumns = "id" }) => {
					const { data, error } = await serviceClient
						.from(prefixedTable(table))
						.delete()
						.or(or)
						.select(selectColumns);
					if (error) throw error;
					return data?.length ?? 0;
				};

				const deleteByIn = async ({ table, column, values, selectColumns = "id" }) => {
					if (!Array.isArray(values) || values.length === 0) return 0;
					const { data, error } = await serviceClient
						.from(prefixedTable(table))
						.delete()
						.in(column, values)
						.select(selectColumns);
					if (error) throw error;
					return data?.length ?? 0;
				};

				// Content referencing user's created images
				changes.feed_items_for_user_images = await deleteByIn({
					table: "feed_items",
					column: "created_image_id",
					values: imageIds
				});
				changes.likes_on_user_images = await deleteByIn({
					table: "likes_created_image",
					column: "created_image_id",
					values: imageIds
				});
				changes.comments_on_user_images = await deleteByIn({
					table: "comments_created_image",
					column: "created_image_id",
					values: imageIds
				});

				// Tip activity linked to user's created images
				changes.tips_on_user_images = await deleteByIn({
					table: "tip_activity",
					column: "created_image_id",
					values: imageIds
				});

				// User's own interactions on other content
				changes.likes_by_user = await deleteByEq({
					table: "likes_created_image",
					column: "user_id",
					value: userId
				});
				changes.comments_by_user = await deleteByEq({
					table: "comments_created_image",
					column: "user_id",
					value: userId
				});

				// Tips sent or received by this user (two deletes to avoid .or() schema-cache issues)
				const tipsFrom = await deleteByEq({
					table: "tip_activity",
					column: "from_user_id",
					value: userId
				});
				const tipsTo = await deleteByEq({
					table: "tip_activity",
					column: "to_user_id",
					value: userId
				});
				changes.tips_by_user = tipsFrom + tipsTo;

				// User-owned content
				changes.created_images = await deleteByEq({
					table: "created_images",
					column: "user_id",
					value: userId
				});
				changes.creations = await deleteByEq({
					table: "creations",
					column: "user_id",
					value: userId
				});

				// Server ownership and membership
				changes.server_memberships = await deleteByEq({
					table: "server_members",
					column: "user_id",
					value: userId,
					// prsn_server_members has no id column (composite PK)
					selectColumns: "server_id,user_id"
				});
				changes.servers_owned = await deleteByEq({
					table: "servers",
					column: "user_id",
					value: userId
				});

				// Notifications and sessions/credits
				changes.notifications = await deleteByEq({
					table: "notifications",
					column: "user_id",
					value: userId
				});
				changes.sessions = await deleteByEq({
					table: "sessions",
					column: "user_id",
					value: userId
				});
				changes.user_credits = await deleteByEq({
					table: "user_credits",
					column: "user_id",
					value: userId
				});

				// Email sends and link clicks (email_link_clicks references email_sends)
				const { data: emailSendRows } = await serviceClient
					.from(prefixedTable("email_sends"))
					.select("id")
					.eq("user_id", userId);
				const emailSendIds = (Array.isArray(emailSendRows) ? emailSendRows : [])
					.map((row) => Number(row?.id))
					.filter((id) => Number.isFinite(id) && id > 0);
				if (emailSendIds.length > 0) {
					changes.email_link_clicks = await deleteByIn({
						table: "email_link_clicks",
						column: "email_send_id",
						values: emailSendIds
					});
				}
				changes.email_sends = await deleteByEq({
					table: "email_sends",
					column: "user_id",
					value: userId
				});
				changes.email_user_campaign_state = await deleteByEq({
					table: "email_user_campaign_state",
					column: "user_id",
					value: userId,
					selectColumns: "user_id"
				});

				// Social graph + profile
				// Some older deployments may have different column names for prsn_user_follows.
				// Prefer explicit cleanup, but don't fail user deletion on schema drift.
				try {
					changes.user_follows = await deleteByOr({
						table: "user_follows",
						or: `follower_id.eq.${userId},following_id.eq.${userId}`
					});
				} catch (error) {
					const message = String(error?.message || "");
					const looksLikeMissingColumn =
						message.toLowerCase().includes("does not exist") &&
						message.toLowerCase().includes("prsn_user_follows");
					if (looksLikeMissingColumn) {
						// Rely on FK cascades when deleting the user row.
						changes.user_follows = null;
					} else {
						throw error;
					}
				}
				changes.user_profile = await deleteByEq({
					table: "user_profiles",
					column: "user_id",
					value: userId,
					// prsn_user_profiles has no id column (primary key is user_id)
					selectColumns: "user_id"
				});

				// Finally delete user row
				changes.user = await deleteByEq({
					table: "users",
					column: "id",
					value: userId
				});

				return { changes };
			}
		}
	};

	const db = supabase;

	async function seed(tableName, items, options = {}) {
		if (!items || items.length === 0) return;

		const { skipIfExists = false, transform, checkExists } = options;
		const table = prefixedTable(tableName);

		if (skipIfExists) {
			if (checkExists) {
				const existing = await checkExists();
				if (existing && existing.length > 0) return;
			} else {
				// Use serviceClient to bypass RLS for backend operations
				const { count, error } = await serviceClient
					.from(table)
					.select("id", { count: "exact", head: true });
				if (error) throw error;
				if (count && count > 0) return;
			}
		}

		const transformedItems = transform ? items.map(transform) : items;
		// Use serviceClient to bypass RLS for backend operations
		const { error } = await serviceClient.from(table).insert(transformedItems);
		if (error) throw error;
	}

	async function reset() {
		const tables = [
			"feed_items",
			"comments_created_image",
			"created_images",
			"user_profiles",
			"sessions",
			"notifications",
			"creations",
			"moderation_queue",
			"provider_statuses",
			"provider_metrics",
			"provider_grants",
			"provider_templates",
			"policy_knobs",
			"provider_registry",
			"servers",
			"templates",
			"explore_items",
			"users"
		].map((table) => prefixedTable(table));

		for (const table of tables) {
			// Use serviceClient to bypass RLS for backend operations
			// Delete all rows - using a condition that should match all rows
			const { error } = await serviceClient.from(table).delete().gte("id", 0);
			if (error) {
				// If delete fails, try alternative approach
				const { error: error2 } = await serviceClient.from(table).delete().neq("id", -1);
				if (error2) throw error2;
			}
		}
	}

	// Storage interface for images using Supabase Storage
	// Images are stored in a private bucket and served through the backend
	const STORAGE_BUCKET = "prsn_created-images";
	const STORAGE_BUCKET_ANON = "prsn_created-images-anon";
	const STORAGE_THUMBNAIL_BUCKET = "prsn_created-images-thumbnails";
	const GENERIC_BUCKET = "prsn_generic-images";

	function getThumbnailFilename(filename) {
		const ext = path.extname(filename);
		const base = path.basename(filename, ext);
		return `${base}_th${ext || ""}`;
	}

	const storage = {
		uploadImage: async (buffer, filename) => {
			// Use storage client (service role if available) for uploads to private bucket
			const { data, error } = await storageClient.storage
				.from(STORAGE_BUCKET)
				.upload(filename, buffer, {
					contentType: "image/png",
					upsert: true
				});

			if (error) {
				throw new Error(`Failed to upload image to Supabase Storage: ${error.message}`);
			}

			const thumbnailBuffer = await sharp(buffer)
				.resize(250, 250, { fit: "cover" })
				.png()
				.toBuffer();
			const { error: thumbnailError } = await storageClient.storage
				.from(STORAGE_THUMBNAIL_BUCKET)
				.upload(filename, thumbnailBuffer, {
					contentType: "image/png",
					upsert: true
				});
			if (thumbnailError) {
				throw new Error(`Failed to upload thumbnail to Supabase Storage: ${thumbnailError.message}`);
			}

			// Return backend route URL instead of public Supabase URL
			// Images will be served through /api/images/created/:filename
			return `/api/images/created/${filename}`;
		},

		getImageUrl: (filename) => {
			// Return backend route URL - images are served through the backend
			return `/api/images/created/${filename}`;
		},

		uploadImageAnon: async (buffer, filename) => {
			const { error } = await storageClient.storage
				.from(STORAGE_BUCKET_ANON)
				.upload(filename, buffer, { contentType: "image/png", upsert: true });
			if (error) {
				throw new Error(`Failed to upload anon image to Supabase Storage: ${error.message}`);
			}
			return `/api/try/images/${filename}`;
		},

		getImageUrlAnon: (filename) => `/api/try/images/${filename}`,

		getImageBufferAnon: async (filename) => {
			const { data, error } = await storageClient.storage
				.from(STORAGE_BUCKET_ANON)
				.download(filename);
			if (error) {
				throw new Error(`Anon image not found: ${filename}`);
			}
			const arrayBuffer = await data.arrayBuffer();
			return Buffer.from(arrayBuffer);
		},

		deleteImageAnon: async (filename) => {
			if (!filename || filename.includes("..") || filename.includes("/")) return;
			try {
				await storageClient.storage.from(STORAGE_BUCKET_ANON).remove([filename]);
			} catch (_) { }
		},

		getImageBuffer: async (filename, options = {}) => {
			const isThumbnail = options?.variant === "thumbnail";
			const bucket = isThumbnail ? STORAGE_THUMBNAIL_BUCKET : STORAGE_BUCKET;
			// Fetch image from Supabase Storage and return as buffer
			// Uses storage client (service role if available) to access private bucket
			const { data, error } = await storageClient.storage
				.from(bucket)
				.download(filename);

			if (error) {
				// console.error("Supabase image fetch failed, serving fallback image.", {
				// 	bucket,
				// 		filename,
				// 		variant: options?.variant ?? null,
				// 			error: error?.message ?? error
				// });
				return sharp({
					create: {
						width: 250,
						height: 250,
						channels: 3,
						background: "#b0b0b0"
					}
				})
					.png()
					.toBuffer();
			}

			// Convert blob to buffer
			const arrayBuffer = await data.arrayBuffer();
			return Buffer.from(arrayBuffer);
		},

		getGenericImageBuffer: async (key) => {
			const objectKey = String(key || "");
			if (!objectKey) {
				throw new Error("Image not found");
			}
			const { data, error } = await storageClient.storage
				.from(GENERIC_BUCKET)
				.download(objectKey);
			if (error) {
				throw new Error(`Image not found: ${objectKey}`);
			}
			const arrayBuffer = await data.arrayBuffer();
			return Buffer.from(arrayBuffer);
		},

		uploadGenericImage: async (buffer, key, options = {}) => {
			const objectKey = String(key || "");
			if (!objectKey) {
				throw new Error("Invalid key");
			}
			const contentType = String(options?.contentType || "application/octet-stream");
			const { error } = await storageClient.storage
				.from(GENERIC_BUCKET)
				.upload(objectKey, buffer, { contentType, upsert: true });
			if (error) {
				throw new Error(`Failed to upload generic image: ${error.message}`);
			}
			return objectKey;
		},

		deleteGenericImage: async (key) => {
			const objectKey = String(key || "");
			if (!objectKey) return;
			const { error } = await storageClient.storage
				.from(GENERIC_BUCKET)
				.remove([objectKey]);
			if (error && error.message && !error.message.toLowerCase().includes("not found")) {
				throw new Error(`Failed to delete generic image: ${error.message}`);
			}
		},

		deleteImage: async (filename) => {
			// Use storage client (service role if available) for deletes
			const { error } = await storageClient.storage
				.from(STORAGE_BUCKET)
				.remove([filename]);

			if (error) {
				// Don't throw if file doesn't exist
				if (error.message && !error.message.includes("not found")) {
					throw new Error(`Failed to delete image from Supabase Storage: ${error.message}`);
				}
			}
		},

		clearAll: async () => {
			// Use storage client (service role if available) for admin operations
			// List all files in the bucket
			const { data: files, error: listError } = await storageClient.storage
				.from(STORAGE_BUCKET)
				.list();

			if (listError) {
				// If bucket doesn't exist, that's okay - nothing to clear
				if (listError.message && listError.message.includes("not found")) {
					return;
				}
				throw new Error(`Failed to list images in Supabase Storage: ${listError.message}`);
			}

			if (files && files.length > 0) {
				const fileNames = files.map(file => file.name);
				const { error: deleteError } = await storageClient.storage
					.from(STORAGE_BUCKET)
					.remove(fileNames);

				if (deleteError) {
					throw new Error(`Failed to clear images from Supabase Storage: ${deleteError.message}`);
				}
			}
		}
	};

	return { db, queries, seed, reset, storage };
}
