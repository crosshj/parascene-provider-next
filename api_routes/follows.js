import express from "express";

export default function createFollowsRoutes({ queries }) {
	const router = express.Router();

	function parseUserId(param) {
		const id = Number.parseInt(String(param || ""), 10);
		if (!Number.isFinite(id) || id <= 0) return null;
		return id;
	}

	function normalizeUsername(input) {
		const raw = typeof input === "string" ? input.trim() : "";
		if (!raw) return null;
		const normalized = raw.toLowerCase();
		if (!/^[a-z0-9][a-z0-9_]{2,23}$/.test(normalized)) return null;
		return normalized;
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

		const targetUserId = parseUserId(req.params.id);
		if (!targetUserId) {
			return { error: { status: 400, body: { error: "Invalid user id" } } };
		}
		const target = await queries.selectUserById.get(targetUserId);
		if (!target) {
			return { error: { status: 404, body: { error: "User not found" } } };
		}
		return { targetUserId, target };
	}

	function requireAuth(req, res) {
		if (!req.auth?.userId) {
			res.status(401).json({ error: "Unauthorized" });
			return null;
		}
		return Number(req.auth.userId);
	}

	// Follow a user (idempotent)
	router.post(["/api/users/:id/follow", "/api/users/by-username/:username/follow"], async (req, res) => {
		try {
			const viewerId = requireAuth(req, res);
			if (!viewerId) return;

			const resolved = await resolveTargetUserFromParams(req, { allowUsername: true });
			if (resolved?.error) {
				return res.status(resolved.error.status).json(resolved.error.body);
			}
			const targetUserId = resolved.targetUserId;
			if (targetUserId === viewerId) {
				return res.status(400).json({ error: "Cannot follow yourself" });
			}

			if (!queries.insertUserFollow?.run) {
				return res.status(500).json({ error: "Follow storage not available" });
			}

			const result = await queries.insertUserFollow.run(viewerId, targetUserId);
			return res.json({ ok: true, changed: Number(result?.changes ?? 0) > 0 });
		} catch (error) {
			// console.error("Error following user:", error);
			return res.status(500).json({ error: "Internal server error" });
		}
	});

	// Unfollow a user (idempotent)
	router.delete(["/api/users/:id/follow", "/api/users/by-username/:username/follow"], async (req, res) => {
		try {
			const viewerId = requireAuth(req, res);
			if (!viewerId) return;

			const resolved = await resolveTargetUserFromParams(req, { allowUsername: true });
			if (resolved?.error) {
				return res.status(resolved.error.status).json(resolved.error.body);
			}
			const targetUserId = resolved.targetUserId;
			if (targetUserId === viewerId) {
				return res.status(400).json({ error: "Cannot unfollow yourself" });
			}

			if (!queries.deleteUserFollow?.run) {
				return res.status(500).json({ error: "Follow storage not available" });
			}

			const result = await queries.deleteUserFollow.run(viewerId, targetUserId);
			return res.json({ ok: true, changed: Number(result?.changes ?? 0) > 0 });
		} catch (error) {
			// console.error("Error unfollowing user:", error);
			return res.status(500).json({ error: "Internal server error" });
		}
	});

	// List followers for a user (includes viewer_follows when selectUserFollowersWithViewer is available)
	router.get(["/api/users/:id/followers", "/api/users/by-username/:username/followers"], async (req, res) => {
		try {
			const viewerId = requireAuth(req, res);
			if (!viewerId) return;

			const resolved = await resolveTargetUserFromParams(req, { allowUsername: true });
			if (resolved?.error) {
				return res.status(resolved.error.status).json(resolved.error.body);
			}
			const targetUserId = resolved.targetUserId;

			if (!queries.selectUserFollowers?.all) {
				return res.status(500).json({ error: "Follow storage not available" });
			}

			const limit = Math.min(200, Math.max(1, Number.parseInt(String(req.query?.limit ?? "20"), 10) || 20));
			const offset = Math.max(0, Number.parseInt(String(req.query?.offset ?? "0"), 10) || 0);
			const pagination = { limit, offset };

			const followers = queries.selectUserFollowersWithViewer?.all
				? await queries.selectUserFollowersWithViewer.all(targetUserId, viewerId, pagination)
				: await queries.selectUserFollowers.all(targetUserId, pagination);
			const list = Array.isArray(followers) ? followers : [];
			if (list.length && list[0].viewer_follows === undefined) {
				list.forEach((u) => { u.viewer_follows = false; });
			}
			return res.json({ followers: list, has_more: list.length === limit });
		} catch (error) {
			// console.error("Error loading followers:", error);
			return res.status(500).json({ error: "Internal server error" });
		}
	});

	// List who a user is following
	router.get(["/api/users/:id/following", "/api/users/by-username/:username/following"], async (req, res) => {
		try {
			const viewerId = requireAuth(req, res);
			if (!viewerId) return;

			const resolved = await resolveTargetUserFromParams(req, { allowUsername: true });
			if (resolved?.error) {
				return res.status(resolved.error.status).json(resolved.error.body);
			}
			const targetUserId = resolved.targetUserId;

			if (!queries.selectUserFollowing?.all) {
				return res.status(500).json({ error: "Follow storage not available" });
			}

			const limit = Math.min(200, Math.max(1, Number.parseInt(String(req.query?.limit ?? "20"), 10) || 20));
			const offset = Math.max(0, Number.parseInt(String(req.query?.offset ?? "0"), 10) || 0);
			const following = await queries.selectUserFollowing.all(targetUserId, { limit, offset });
			const list = Array.isArray(following) ? following : [];
			return res.json({ following: list, has_more: list.length === limit });
		} catch (error) {
			// console.error("Error loading following:", error);
			return res.status(500).json({ error: "Internal server error" });
		}
	});

	return router;
}

